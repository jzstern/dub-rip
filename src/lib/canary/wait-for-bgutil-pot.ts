const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;
const DEFAULT_RETRY_INTERVAL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 20_000;

export interface WaitForBgutilPotOptions {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	attemptTimeoutMs?: number;
	retryIntervalMs?: number;
	/** No new attempt starts once this much time has passed since the first. */
	maxWaitMs?: number;
}

export interface WaitForBgutilPotResult {
	awake: boolean;
	attempts: number;
	waitedMs: number;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wakes the sleeping bgutil-pot sidecar and waits until it answers `/ping`.
 *
 * The sidecar is a serverless Railway service, so a canary run after a quiet
 * spell starts it cold — measured at 3–9 s until it listens. The yt-dlp
 * bgutil plugin checks `/ping` once, with a 5 s timeout, and caches a failure
 * for 60 s, so a cold start makes the sidecar look unavailable for the whole
 * run. A real user never sees this: `POST /api/preview` prewarms the sidecar
 * seconds before they click Download. Without the same wake the canary is
 * harsher than the path it stands in for, and every canary failure carries
 * that confounder.
 *
 * Never throws and never reports to Sentry: a cold sidecar is normal, and if
 * it never answers the caller downloads anyway and lets that run say what
 * happened. `/ping` only — `/get_pot` does real BotGuard work.
 */
export async function waitForBgutilPot(
	bgutilPotUrl: string,
	options: WaitForBgutilPotOptions = {},
): Promise<WaitForBgutilPotResult> {
	const {
		fetch: fetchImpl = fetch,
		sleep = defaultSleep,
		now = () => performance.now(),
		attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
		retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
		maxWaitMs = DEFAULT_MAX_WAIT_MS,
	} = options;

	const start = now();
	const waitedMs = (): number => Math.round(now() - start);
	let attempts = 0;

	while (true) {
		attempts++;
		try {
			const response = await fetchImpl(`${bgutilPotUrl}/ping`, {
				signal: AbortSignal.timeout(attemptTimeoutMs),
			});
			void response.body?.cancel().catch(() => undefined);
			if (response.ok) {
				return { awake: true, attempts, waitedMs: waitedMs() };
			}
		} catch {
			// A refused or timed-out connection is what a cold sidecar looks like.
		}

		if (now() - start + retryIntervalMs >= maxWaitMs) {
			return { awake: false, attempts, waitedMs: waitedMs() };
		}
		await sleep(retryIntervalMs);
	}
}
