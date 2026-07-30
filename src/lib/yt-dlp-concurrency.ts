/**
 * Global cap on concurrent yt-dlp subprocesses (details extraction +
 * download combined). Every invocation is a YouTube request from this
 * process's single datacenter IP, and bursts of simultaneous requests get
 * the IP bot-checked for several minutes. Queuing excess work instead of
 * spawning it immediately keeps bursts from tripping that check.
 */
export const MAX_CONCURRENT_YT_DLP_PROCESSES = 3;

/**
 * Ceiling on requests waiting behind the concurrency limit above. Without one,
 * a burst of N requests holds N SSE connections open and then fires N serial
 * YouTube extractions the moment slots free up — the exact kind of burst
 * MAX_CONCURRENT_YT_DLP_PROCESSES exists to prevent, and one that can run up
 * the workspace's hard billing cap in the meantime. Past this many queued,
 * new requests fail fast instead of waiting behind the backlog.
 */
export const MAX_QUEUED_YT_DLP_REQUESTS = 20;

export class YtDlpQueueFullError extends Error {
	constructor() {
		super(`yt-dlp request queue is full (max ${MAX_QUEUED_YT_DLP_REQUESTS})`);
		this.name = "YtDlpQueueFullError";
	}
}

class Semaphore {
	private available: number;
	private readonly queue: Array<() => void> = [];

	constructor(
		limit: number,
		private readonly maxQueueLength: number,
	) {
		this.available = limit;
	}

	/** Synchronous fast path: grabs a free slot immediately, or returns null. */
	tryAcquire(): (() => void) | null {
		if (this.available <= 0) return null;
		this.available -= 1;
		return () => this.release();
	}

	isQueueFull(): boolean {
		return this.queue.length >= this.maxQueueLength;
	}

	/** Slow path: resolves once a slot frees up. */
	acquireQueued(): Promise<() => void> {
		return new Promise((resolve) => {
			this.queue.push(() => {
				this.available -= 1;
				resolve(() => this.release());
			});
		});
	}

	private release(): void {
		this.available += 1;
		const next = this.queue.shift();
		if (next) next();
	}
}

const ytDlpSemaphore = new Semaphore(
	MAX_CONCURRENT_YT_DLP_PROCESSES,
	MAX_QUEUED_YT_DLP_REQUESTS,
);

async function runAndRelease<T>(
	fn: () => Promise<T>,
	release: () => void,
): Promise<T> {
	try {
		return await fn();
	} finally {
		release();
	}
}

/**
 * Runs `fn` once a concurrency slot is free, queuing callers past the limit
 * in FIFO order. Releases the slot on both success and failure.
 *
 * Deliberately not declared `async`: when a slot is immediately available,
 * `fn` is invoked synchronously (no microtask deferral) so callers that spawn
 * a subprocess and immediately attach listeners to it can rely on those
 * listeners being attached before this call returns control to them — the
 * same synchronous-start semantics as calling `fn` directly.
 */
export function withYtDlpConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
	const release = ytDlpSemaphore.tryAcquire();
	if (release) {
		return runAndRelease(fn, release);
	}
	if (ytDlpSemaphore.isQueueFull()) {
		return Promise.reject(new YtDlpQueueFullError());
	}
	return ytDlpSemaphore
		.acquireQueued()
		.then((queuedRelease) => runAndRelease(fn, queuedRelease));
}
