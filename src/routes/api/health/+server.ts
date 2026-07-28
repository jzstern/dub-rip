import { env } from "$env/dynamic/private";
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

	return new Response(
		JSON.stringify({
			ok: bgutil.ok,
			checks: {
				bgutil_pot: { ...bgutil, url: bgutilUrl ?? null },
			},
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
