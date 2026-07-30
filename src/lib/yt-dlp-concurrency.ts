/**
 * Global cap on concurrent yt-dlp subprocesses (details extraction +
 * download combined). Every invocation is a YouTube request from this
 * process's single datacenter IP, and bursts of simultaneous requests get
 * the IP bot-checked for several minutes. Queuing excess work instead of
 * spawning it immediately keeps bursts from tripping that check.
 */
export const MAX_CONCURRENT_YT_DLP_PROCESSES = 3;

class Semaphore {
	private available: number;
	private readonly queue: Array<() => void> = [];

	constructor(limit: number) {
		this.available = limit;
	}

	/** Synchronous fast path: grabs a free slot immediately, or returns null. */
	tryAcquire(): (() => void) | null {
		if (this.available <= 0) return null;
		this.available -= 1;
		return () => this.release();
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

const ytDlpSemaphore = new Semaphore(MAX_CONCURRENT_YT_DLP_PROCESSES);

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
	return ytDlpSemaphore
		.acquireQueued()
		.then((queuedRelease) => runAndRelease(fn, queuedRelease));
}
