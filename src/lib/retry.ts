export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 4000;

export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	isRetryable?: (error: unknown) => boolean;
	onRetry?: (attempt: number, error: unknown) => void;
	sleep?: (ms: number) => Promise<void>;
	signal?: AbortSignal;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	const exponential = baseDelayMs * 2 ** (attempt - 1);
	const capped = Math.min(exponential, maxDelayMs);
	const jitter = Math.random() * capped * 0.5;
	return Math.min(capped + jitter, maxDelayMs);
}

/**
 * Races the backoff sleep against `signal` so an abort partway through a wait
 * doesn't hold the caller for the rest of the delay. Leaves the `sleep`
 * injection point itself untouched — it's still called with just `(ms)`,
 * which is what the test suite's fake sleeps expect.
 */
function abortableSleep(
	ms: number,
	sleep: (ms: number) => Promise<void>,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!signal) return sleep(ms);
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		const onAbort = () => resolve();
		signal.addEventListener("abort", onAbort, { once: true });
		sleep(ms).then(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}

/**
 * Retries `fn` on transient failures with exponential backoff and jitter.
 *
 * Bounded on both axes: `maxAttempts` caps the number of tries (default 3
 * total, i.e. up to 2 retries), and `maxDelayMs` caps each backoff sleep
 * (default 4s) so a user is never stuck waiting an unbounded amount of time
 * behind retries. `isRetryable` decides whether a given failure is worth
 * retrying at all — permanent failures (private video, age-restricted, etc.)
 * should return false so they fail fast on the first attempt.
 *
 * `signal`, if given, stops retries once aborted: a call already queued for a
 * retry never starts `fn` again, and one sleeping through its backoff wakes
 * immediately instead of waiting out the full delay.
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const isRetryable = options.isRetryable ?? (() => true);
	const sleep = options.sleep ?? defaultSleep;
	const signal = options.signal;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (signal?.aborted) {
			throw lastError ?? signal.reason ?? new Error("Aborted");
		}
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const hasAttemptsLeft = attempt < maxAttempts;
			if (!hasAttemptsLeft || !isRetryable(error) || signal?.aborted) {
				throw error;
			}
			options.onRetry?.(attempt, error);
			await abortableSleep(
				backoffDelayMs(attempt, baseDelayMs, maxDelayMs),
				sleep,
				signal,
			);
		}
	}
	throw lastError;
}
