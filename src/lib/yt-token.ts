import { env } from "$env/dynamic/private";

export interface PoTokenResult {
	poToken: string;
	visitorData: string;
}

const CACHE_TTL_MS = 50 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

let cached: { result: PoTokenResult; fetchedAt: number } | null = null;
let inFlight: Promise<PoTokenResult | null> | null = null;

function getServiceUrl(): string | undefined {
	return env.YT_TOKEN_SERVICE_URL;
}

function isCacheValid(): boolean {
	return cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

export function clearCache(): void {
	cached = null;
}

export async function fetchPoToken(): Promise<PoTokenResult | null> {
	if (isCacheValid()) {
		return cached?.result ?? null;
	}

	if (inFlight) return inFlight;

	const serviceUrl = getServiceUrl();
	if (!serviceUrl) return null;

	inFlight = (async () => {
		try {
			const response = await fetch(`${serviceUrl}/token`, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[yt-token] Token service returned ${response.status}`);
				return null;
			}

			const data = await response.json();

			if (!data.poToken || !data.visitorData) {
				console.warn("[yt-token] Token service returned incomplete data");
				return null;
			}

			const result: PoTokenResult = {
				poToken: data.poToken,
				visitorData: data.visitorData,
			};

			cached = { result, fetchedAt: Date.now() };
			console.log("[yt-token] Fetched and cached PO token");
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[yt-token] Failed to fetch token: ${message}`);
			return null;
		} finally {
			inFlight = null;
		}
	})();

	return inFlight;
}
