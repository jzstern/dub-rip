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
 * Retries `fn` on transient failures with exponential backoff and jitter.
 *
 * Bounded on both axes: `maxAttempts` caps the number of tries (default 3
 * total, i.e. up to 2 retries), and `maxDelayMs` caps each backoff sleep
 * (default 4s) so a user is never stuck waiting an unbounded amount of time
 * behind retries. `isRetryable` decides whether a given failure is worth
 * retrying at all — permanent failures (private video, age-restricted, etc.)
 * should return false so they fail fast on the first attempt.
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

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const hasAttemptsLeft = attempt < maxAttempts;
			if (!hasAttemptsLeft || !isRetryable(error)) {
				throw error;
			}
			options.onRetry?.(attempt, error);
			await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
		}
	}
	throw lastError;
}
