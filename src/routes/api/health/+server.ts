import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { resolveDeployEnvironment, resolveRelease } from "$lib/sentry-options";
import type { RequestHandler } from "./$types";

const PROBE_TIMEOUT_MS = 3000;
const LIVENESS_STATUS = 200;

interface CheckResult {
	ok: boolean;
	status?: number;
	error?: string;
	latencyMs: number;
}

async function probe(url: string): Promise<CheckResult> {
	const start = performance.now();
	try {
		const res = await fetch(url, {
			method: "HEAD",
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return {
			ok: res.ok,
			status: res.status,
			latencyMs: Math.round(performance.now() - start),
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			latencyMs: Math.round(performance.now() - start),
		};
	}
}

/**
 * Server and browser resolve their environment from different sources —
 * runtime env here, build-time constants in the browser bundle — so both are
 * reported. If they disagree, client and server events land under different
 * Sentry environments, which is otherwise only visible as confusing data.
 */
function buildSentryReport() {
	return {
		serverEnabled: Boolean(env.SENTRY_DSN),
		browserEnabled: Boolean(publicEnv.PUBLIC_SENTRY_DSN),
		serverEnvironment: resolveDeployEnvironment(
			env.RAILWAY_ENVIRONMENT_NAME,
			env.SENTRY_ENVIRONMENT,
		),
		browserEnvironment: resolveDeployEnvironment(
			__RAILWAY_ENVIRONMENT_NAME__,
			publicEnv.PUBLIC_SENTRY_ENVIRONMENT,
		),
		release: resolveRelease(env.RAILWAY_GIT_COMMIT_SHA) ?? null,
	};
}

/**
 * No network call, so this can never fail just because bgutil-pot happens to
 * be asleep — which it is by design most of the time (see
 * docs/deployment-strategy.md). This is the form Railway's app-service
 * healthcheck must poll: probing the sidecar from here would turn its normal
 * sleep into an apparent app outage and get the app restart-looped for a
 * dependency that isn't actually down. `configured` only reports what env
 * says; actually reaching the sidecar is what the opt-in deep probe below is
 * for.
 */
function buildLivenessReport() {
	const bgutilUrl = env.BGUTIL_POT_URL;
	return {
		ok: true,
		checks: {
			bgutil_pot: { configured: Boolean(bgutilUrl), url: bgutilUrl ?? null },
		},
		sentry: buildSentryReport(),
	};
}

async function buildDeepProbeReport() {
	const bgutilUrl = env.BGUTIL_POT_URL;
	const bgutil = bgutilUrl
		? await probe(`${bgutilUrl}/ping`)
		: { ok: false, error: "not configured", latencyMs: 0 };

	return {
		ok: bgutil.ok,
		checks: {
			bgutil_pot: { ...bgutil, url: bgutilUrl ?? null },
		},
		sentry: buildSentryReport(),
	};
}

/**
 * The deep probe is opt-in (`?probe=bgutil`) rather than the default, because
 * this same route doubles as the app service's Railway healthcheck target. A
 * sleeping bgutil-pot is normal operation, not an outage, so only a caller
 * that explicitly asks for the deep check gets to treat it as one — and pays
 * the cost of waking the sidecar to find out. Everyone else, including
 * Railway, gets the cheap liveness form below.
 */
export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get("probe") === "bgutil") {
		const report = await buildDeepProbeReport();
		return new Response(JSON.stringify(report), {
			status: report.ok ? 200 : 503,
			headers: { "content-type": "application/json" },
		});
	}

	return new Response(JSON.stringify(buildLivenessReport()), {
		status: LIVENESS_STATUS,
		headers: { "content-type": "application/json" },
	});
};

/**
 * Uptime monitors issue HEAD, not GET — exactly the request type that must
 * stay unconditionally cheap, since it's the one most likely to be polled on
 * a schedule. This ignores the query string entirely rather than forwarding
 * it to GET, so `HEAD /api/health?probe=bgutil` still can't reach or wake the
 * sidecar.
 */
export const HEAD: RequestHandler = async () => {
	return new Response(null, { status: LIVENESS_STATUS });
};
