import { generate } from "youtube-po-token-generator";

export interface PoTokenResult {
	poToken: string;
	visitorData: string;
}

export const CACHE_TTL_MS = 50 * 60 * 1000;
export const GENERATION_TIMEOUT_MS = 30_000;
export const FAILURE_BACKOFF_MS = 30_000;
const MAX_STALE_MS = CACHE_TTL_MS * 2;

let cached: { result: PoTokenResult; fetchedAt: number } | null = null;
let lastFailedAt = 0;
let inFlight: Promise<PoTokenResult | null> | null = null;
let activeGeneration: Promise<PoTokenResult> | null = null;

function isCacheValid(): boolean {
	return cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

function isCacheUsable(): boolean {
	return cached !== null && Date.now() - cached.fetchedAt < MAX_STALE_MS;
}

export function clearCache(): void {
	cached = null;
	lastFailedAt = 0;
	activeGeneration = null;
}

async function generateWithTimeout(): Promise<PoTokenResult> {
	if (!activeGeneration) {
		activeGeneration = generate();
		const thisGeneration = activeGeneration;
		thisGeneration.then(
			() => {
				if (activeGeneration === thisGeneration) activeGeneration = null;
			},
			() => {
				if (activeGeneration === thisGeneration) activeGeneration = null;
			},
		);
	}

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
		return await Promise.race([activeGeneration, timeoutPromise]);
	} finally {
		if (controller.id !== undefined) clearTimeout(controller.id);
	}
}

export async function fetchPoToken(): Promise<PoTokenResult | null> {
	if (isCacheValid()) {
		return cached?.result ?? null;
	}

	if (inFlight) return inFlight;

	const hasFailure = lastFailedAt !== 0;
	const inBackoff =
		hasFailure && Date.now() - lastFailedAt < FAILURE_BACKOFF_MS;

	if (inBackoff) {
		if (isCacheUsable()) {
			console.log("[yt-token] In backoff period, returning stale token");
			return cached?.result ?? null;
		}
		return null;
	}

	inFlight = (async () => {
		try {
			const result = await generateWithTimeout();

			if (!result.poToken || !result.visitorData) {
				console.warn("[yt-token] Generator returned incomplete data");
				lastFailedAt = Date.now();
				if (isCacheUsable()) {
					console.log("[yt-token] Returning stale cached token");
					return cached?.result ?? null;
				}
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
			if (isCacheUsable()) {
				console.log("[yt-token] Returning stale cached token");
				return cached?.result ?? null;
			}
			return null;
		} finally {
			inFlight = null;
		}
	})();

	return inFlight;
}
