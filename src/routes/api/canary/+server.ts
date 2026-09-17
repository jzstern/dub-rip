import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { isCanaryFailure } from "$lib/canary/classify-canary-run";
import {
	finishCanaryCheckIn,
	startCanaryCheckIn,
} from "$lib/canary/report-canary-check-in";
import { runCanaryDownload } from "$lib/canary/run-canary-download";
import { tokensMatch } from "$lib/canary/tokens-match";
import type { RequestHandler } from "./$types";

const BEARER_PREFIX_LENGTH = "Bearer ".length;

/** The auth-scheme token is case-insensitive per RFC 7235. */
function extractBearerToken(authorizationHeader: string | null): string | null {
	if (!authorizationHeader) return null;
	const scheme = authorizationHeader.slice(0, BEARER_PREFIX_LENGTH);
	if (scheme.toLowerCase() !== "bearer ") return null;
	return authorizationHeader.slice(BEARER_PREFIX_LENGTH);
}

/**
 * A trigger, not a dashboard: it always answers 200 once authenticated, even
 * when the canary classifies a failure, so the GitHub Actions workflow stays
 * green and Sentry — via the check-in this starts and finishes — is the only
 * place that alerts. The workflow only fails if this endpoint is unreachable
 * or answers 401/404/5xx.
 */
export const POST: RequestHandler = async ({ request }) => {
	const canaryToken = env.CANARY_TOKEN;
	if (!canaryToken) {
		return new Response(null, { status: 404 });
	}

	const providedToken = extractBearerToken(
		request.headers.get("authorization"),
	);
	if (!providedToken || !tokensMatch(providedToken, canaryToken)) {
		return new Response(null, { status: 401 });
	}

	const checkInId = startCanaryCheckIn();
	const classification = await runCanaryDownload();
	finishCanaryCheckIn(checkInId, classification);

	return json({
		ok: !isCanaryFailure(classification.stage),
		...classification,
	});
};
