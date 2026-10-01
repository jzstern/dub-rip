import * as Sentry from "@sentry/sveltekit";
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
	buildRateLimitResponse,
	createRateLimiter,
	isRateLimitedPath,
	type RateLimiter,
} from "$lib/rate-limiter";

export interface RateLimitHandleOptions {
	limiter?: RateLimiter;
	isRailway?: () => boolean;
}

export function createRateLimitHandle({
	limiter = createRateLimiter(),
	isRailway = () => Boolean(env.RAILWAY_ENVIRONMENT_NAME),
}: RateLimitHandleOptions = {}): Handle {
	let warnedMissingRealIp = false;

	/**
	 * On Railway `getClientAddress()` is the edge proxy's address, shared by
	 * every visitor, so keying on it would put the whole site in one bucket.
	 * Railway's `X-Real-IP` carries the client; without it, limiting is skipped
	 * rather than falling back.
	 */
	function clientKey(event: RequestEvent): string | null {
		if (isRailway()) {
			const realIp = event.request.headers.get("x-real-ip")?.trim();
			if (realIp) return realIp;
			if (!warnedMissingRealIp) {
				warnedMissingRealIp = true;
				console.warn("Rate limiting skipped: no X-Real-IP header on Railway");
			}
			return null;
		}
		try {
			return event.getClientAddress();
		} catch (err) {
			console.warn("Rate limiting skipped: client address unavailable", err);
			return null;
		}
	}

	return ({ event, resolve }) => {
		const { pathname } = event.url;
		if (!isRateLimitedPath(pathname)) return resolve(event);

		const key = clientKey(event);
		if (key === null) return resolve(event);

		const decision = limiter.consume(key);
		if (decision.allowed) return resolve(event);

		Sentry.addBreadcrumb({
			category: "rate-limit",
			level: "info",
			message: "Request rate limited",
			data: { pathname, retryAfterSeconds: decision.retryAfterSeconds },
		});
		return buildRateLimitResponse(pathname, decision.retryAfterSeconds);
	};
}
