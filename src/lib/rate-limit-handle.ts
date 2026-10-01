import * as Sentry from "@sentry/sveltekit";
import type { Handle } from "@sveltejs/kit";
import {
	buildRateLimitResponse,
	createRateLimiter,
	isRateLimitedPath,
	type RateLimiter,
} from "$lib/rate-limiter";

export function createRateLimitHandle(
	limiter: RateLimiter = createRateLimiter(),
): Handle {
	return ({ event, resolve }) => {
		const { pathname } = event.url;
		if (!isRateLimitedPath(pathname)) return resolve(event);

		let clientKey: string;
		try {
			clientKey = event.getClientAddress();
		} catch (err) {
			console.warn("Rate limiting skipped: client address unavailable", err);
			return resolve(event);
		}

		const decision = limiter.consume(clientKey);
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
