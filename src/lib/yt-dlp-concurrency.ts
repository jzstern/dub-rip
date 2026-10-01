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

	/**
	 * Slow path: resolves once a slot frees up. Aborting `signal` while still
	 * waiting removes the waiter from the queue and rejects with the signal's
	 * reason; once the slot has been handed over, abort no longer affects it.
	 */
	acquireQueued(signal?: AbortSignal): Promise<() => void> {
		return new Promise((resolve, reject) => {
			const waiter = () => {
				signal?.removeEventListener("abort", onAbort);
				this.available -= 1;
				resolve(() => this.release());
			};
			const onAbort = () => {
				const index = this.queue.indexOf(waiter);
				if (index === -1) return;
				this.queue.splice(index, 1);
				reject(abortReason(signal));
			};
			this.queue.push(waiter);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(): void {
		this.available += 1;
		const next = this.queue.shift();
		if (next) next();
	}
}

function abortReason(signal: AbortSignal | undefined): unknown {
	return signal?.reason ?? new Error("yt-dlp request aborted");
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
 *
 * An optional `signal` frees the caller's place in the queue: aborting while
 * waiting rejects with the signal's reason without ever running `fn`, so a
 * disconnected client stops occupying one of the MAX_QUEUED_YT_DLP_REQUESTS
 * slots. It has no effect once `fn` is running — the caller owns killing its
 * own subprocess.
 */
export function withYtDlpConcurrencyLimit<T>(
	fn: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (signal?.aborted) {
		return Promise.reject(abortReason(signal));
	}
	const release = ytDlpSemaphore.tryAcquire();
	if (release) {
		return runAndRelease(fn, release);
	}
	if (ytDlpSemaphore.isQueueFull()) {
		return Promise.reject(new YtDlpQueueFullError());
	}
	return ytDlpSemaphore
		.acquireQueued(signal)
		.then((queuedRelease) => runAndRelease(fn, queuedRelease));
}
