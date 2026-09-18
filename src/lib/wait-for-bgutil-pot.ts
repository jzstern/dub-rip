const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;
const DEFAULT_RETRY_INTERVAL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 20_000;

export interface WaitForBgutilPotOptions {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	createTimeoutSignal?: (ms: number) => AbortSignal;
	attemptTimeoutMs?: number;
	retryIntervalMs?: number;
	/** No new attempt starts once this much time has passed since the first. */
	maxWaitMs?: number;
	/** Ends the wait — even an attempt in flight — once it aborts: a caller that has left has nothing to wait for. */
	signal?: AbortSignal;
	/** Called once, after the first ping that did not answer, so the caller can say the sidecar is starting. */
	onWaiting?: () => void;
}

export interface WaitForBgutilPotResult {
	awake: boolean;
	attempts: number;
	waitedMs: number;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// The answer is already decided; a body that won't close changes nothing.
	}
}

function notifyWaiting(onWaiting: (() => void) | undefined): void {
	try {
		onWaiting?.();
	} catch {
		// A status update that can't be delivered (the client is gone) must not
		// end the wait it is describing.
	}
}

/**
 * Ends the pause between attempts as soon as `signal` aborts. The abandoned
 * timer still runs out on its own, which is harmless at this length.
 */
function sleepUnlessAborted(
	sleep: (ms: number) => Promise<void>,
	ms: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!signal) return sleep(ms);
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		const onAbort = () => resolve();
		signal.addEventListener("abort", onAbort, { once: true });
		void sleep(ms).then(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}

/**
 * Wakes the sleeping bgutil-pot sidecar and waits until it answers `/ping`.
 *
 * The sidecar is a serverless Railway service, so the first use after a quiet
 * spell starts it cold — measured at 3–9 s until it listens. The yt-dlp
 * bgutil plugin checks `/ping` once, with a 5 s timeout, and caches a failure
 * for 60 s, so a cold start makes the sidecar look unavailable for the whole
 * run: no PO token, and YouTube bot-checks the `web` player request.
 * `POST /api/preview` nudges the sidecar awake while the user reads the
 * preview, but that ping is fire-and-forget with a 2 s timeout, so a click
 * inside the cold start still lands on a booting sidecar. Both the download
 * route and the production canary wait here first, so neither starts yt-dlp
 * against it.
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
		createTimeoutSignal = AbortSignal.timeout,
		attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
		retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
		maxWaitMs = DEFAULT_MAX_WAIT_MS,
		signal,
		onWaiting,
	} = options;

	const pingUrl = `${bgutilPotUrl.replace(/\/+$/, "")}/ping`;
	const start = now();
	const waitedMs = (): number => Math.round(now() - start);
	let attempts = 0;

	while (!signal?.aborted) {
		attempts++;
		const attemptTimeout = createTimeoutSignal(attemptTimeoutMs);
		try {
			const response = await fetchImpl(pingUrl, {
				signal: signal
					? AbortSignal.any([signal, attemptTimeout])
					: attemptTimeout,
			});
			void discardBody(response);
			if (response.ok) {
				return { awake: true, attempts, waitedMs: waitedMs() };
			}
		} catch {
			// A refused or timed-out connection is what a cold sidecar looks like.
		}

		if (signal?.aborted) break;
		if (now() - start + retryIntervalMs >= maxWaitMs) break;
		if (attempts === 1) notifyWaiting(onWaiting);
		await sleepUnlessAborted(sleep, retryIntervalMs, signal);
	}

	return { awake: false, attempts, waitedMs: waitedMs() };
}
