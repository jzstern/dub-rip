import { generate } from "youtube-po-token-generator";

export interface PoTokenResult {
	poToken: string;
	visitorData: string;
}

const CACHE_TTL_MS = 50 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 30_000;
const FAILURE_BACKOFF_MS = 30_000;

let cached: { result: PoTokenResult; fetchedAt: number } | null = null;
let lastFailedAt = 0;
let inFlight: Promise<PoTokenResult | null> | null = null;

function isCacheValid(): boolean {
	return cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

export function clearCache(): void {
	cached = null;
	lastFailedAt = 0;
}

async function generateWithTimeout(): Promise<PoTokenResult> {
	const controller = {
		id: undefined as ReturnType<typeof setTimeout> | undefined,
	};
	const timeoutPromise = new Promise<never>((_, reject) => {
		controller.id = setTimeout(
			() => reject(new Error("Token generation timed out")),
			GENERATION_TIMEOUT_MS,
		);
	});

	try {
		return await Promise.race([generate(), timeoutPromise]);
	} finally {
		if (controller.id !== undefined) clearTimeout(controller.id);
	}
}

export async function fetchPoToken(): Promise<PoTokenResult | null> {
	if (isCacheValid()) {
		return cached?.result ?? null;
	}

	if (inFlight) return inFlight;

	if (lastFailedAt && Date.now() - lastFailedAt < FAILURE_BACKOFF_MS) {
		if (cached) {
			console.log("[yt-token] In backoff period, returning stale token");
			return cached.result;
		}
		return null;
	}

	inFlight = (async () => {
		try {
			const result = await generateWithTimeout();

			if (!result.poToken || !result.visitorData) {
				console.warn("[yt-token] Generator returned incomplete data");
				lastFailedAt = Date.now();
				return null;
			}

			cached = { result, fetchedAt: Date.now() };
			lastFailedAt = 0;
			console.log("[yt-token] Generated and cached PO token");
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[yt-token] Token generation failed: ${message}`);
			lastFailedAt = Date.now();
			if (cached) {
				console.log("[yt-token] Returning stale cached token");
				return cached.result;
			}
			return null;
		} finally {
			inFlight = null;
		}
	})();

	return inFlight;
}
