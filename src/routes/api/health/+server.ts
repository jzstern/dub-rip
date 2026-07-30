import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { resolveDeployEnvironment, resolveRelease } from "$lib/sentry-options";
import type { RequestHandler } from "./$types";

const PROBE_TIMEOUT_MS = 3000;

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

export const GET: RequestHandler = async () => {
	const bgutilUrl = env.BGUTIL_POT_URL;

	const bgutil = bgutilUrl
		? await probe(`${bgutilUrl}/ping`)
		: { ok: false, error: "not configured", latencyMs: 0 };

	/**
	 * Server and browser resolve their environment from different sources —
	 * runtime env here, build-time constants in the browser bundle — so both are
	 * reported. If they disagree, client and server events land under different
	 * Sentry environments, which is otherwise only visible as confusing data.
	 */
	const sentry = {
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

	return new Response(
		JSON.stringify({
			ok: bgutil.ok,
			checks: {
				bgutil_pot: { ...bgutil, url: bgutilUrl ?? null },
			},
			sentry,
		}),
		{
			status: bgutil.ok ? 200 : 503,
			headers: { "content-type": "application/json" },
		},
	);
};

export const HEAD: RequestHandler = async (event) => {
	const res = await GET(event);
	return new Response(null, { status: res.status });
};
