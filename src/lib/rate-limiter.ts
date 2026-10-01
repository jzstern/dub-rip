/**
 * Every request to the rate-limited routes ends up as a yt-dlp run, i.e. a
 * YouTube request from this service's single egress IP. A human previews a
 * link (preview + details = 2 requests) and downloads it (1 request), and the
 * preview refires on each pasted URL, so a burst of 30 covers about ten songs
 * queued up back to back, and 30 per minute sustained is far beyond anything
 * typed by hand. A script hammering the endpoints hits the ceiling within
 * seconds.
 */
export const RATE_LIMIT_BURST = 30;
export const RATE_LIMIT_REFILL_PER_MINUTE = 30;

/**
 * Bounds memory without a sweep timer (timers would defeat app-sleep). Past
 * this many tracked clients the least recently seen is dropped, which at worst
 * hands that client a fresh bucket.
 */
export const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5_000;

export type RateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

interface Bucket {
	tokens: number;
	updatedAt: number;
}

export interface RateLimiterOptions {
	burst?: number;
	refillPerMinute?: number;
	maxTrackedClients?: number;
	now?: () => number;
}

export interface RateLimiter {
	consume(clientKey: string): RateLimitDecision;
	readonly size: number;
}

export function createRateLimiter({
	burst = RATE_LIMIT_BURST,
	refillPerMinute = RATE_LIMIT_REFILL_PER_MINUTE,
	maxTrackedClients = RATE_LIMIT_MAX_TRACKED_CLIENTS,
	now = Date.now,
}: RateLimiterOptions = {}): RateLimiter {
	const refillPerMs = refillPerMinute / 60_000;
	const buckets = new Map<string, Bucket>();

	return {
		get size() {
			return buckets.size;
		},
		consume(clientKey) {
			const currentTime = now();
			const existing = buckets.get(clientKey);
			const tokens = existing
				? Math.min(
						burst,
						existing.tokens +
							Math.max(0, currentTime - existing.updatedAt) * refillPerMs,
					)
				: burst;

			buckets.delete(clientKey);

			if (tokens < 1) {
				buckets.set(clientKey, { tokens, updatedAt: currentTime });
				return {
					allowed: false,
					retryAfterSeconds: Math.ceil((1 - tokens) / refillPerMs / 1000),
				};
			}

			buckets.set(clientKey, { tokens: tokens - 1, updatedAt: currentTime });
			while (buckets.size > maxTrackedClients) {
				const oldest = buckets.keys().next().value;
				if (oldest === undefined) break;
				buckets.delete(oldest);
			}
			return { allowed: true };
		},
	};
}

const RATE_LIMITED_PATH_PREFIXES = ["/api/preview", "/api/download-stream"];

function matchesPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isRateLimitedPath(pathname: string): boolean {
	return RATE_LIMITED_PATH_PREFIXES.some((prefix) =>
		matchesPrefix(pathname, prefix),
	);
}

export const RATE_LIMIT_MESSAGE =
	"Too many requests. Please wait a moment and try again.";

export function buildRateLimitResponse(
	pathname: string,
	retryAfterSeconds: number,
): Response {
	const retryAfter = String(retryAfterSeconds);
	if (matchesPrefix(pathname, "/api/download-stream")) {
		// EventSource treats any non-200 as a bare transport failure with no
		// body, so a 429 here would surface as "Connection lost". A 200 stream
		// carrying one `error` event is the only form the UI can display.
		return new Response(
			`data: ${JSON.stringify({ type: "error", message: RATE_LIMIT_MESSAGE })}\n\n`,
			{
				status: 200,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"Retry-After": retryAfter,
				},
			},
		);
	}
	return new Response(JSON.stringify({ error: RATE_LIMIT_MESSAGE }), {
		status: 429,
		headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
	});
}
