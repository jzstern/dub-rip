import { fetchVideoDetails, type VideoDetails } from "./video-metadata";

export const DEFAULT_VIDEO_DETAILS_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
	value: VideoDetails;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<VideoDetails | null>>();

export interface GetVideoDetailsOptions {
	ttlMs?: number;
	timeout?: number;
}

/**
 * Get-or-fetch cache for yt-dlp video details, keyed by YouTube videoId.
 *
 * A single user download currently costs ~3 yt-dlp extractions (preview
 * duration, fetchVideoDetails, the download itself), each re-solving
 * YouTube's JS challenge and re-minting a PO token from scratch. Routing
 * every details lookup through this cache collapses repeat/near-simultaneous
 * requests for the same video — and a preview followed by a download within
 * the TTL — toward a single extraction.
 *
 * In-flight requests for the same videoId are deduped (single-flight): a
 * second caller while an extraction is running awaits the same promise
 * rather than starting a new subprocess. Failures are never cached, so a
 * failed extraction is retried on the very next request.
 */
export async function getVideoDetails(
	videoId: string,
	videoUrl: string,
	options: GetVideoDetailsOptions = {},
): Promise<VideoDetails | null> {
	const ttlMs = options.ttlMs ?? DEFAULT_VIDEO_DETAILS_TTL_MS;

	const cached = cache.get(videoId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const existing = inFlight.get(videoId);
	if (existing) {
		return existing;
	}

	const promise = fetchVideoDetails(videoUrl, options.timeout)
		.then((value) => {
			if (value) {
				cache.set(videoId, { value, expiresAt: Date.now() + ttlMs });
			}
			return value;
		})
		.finally(() => {
			inFlight.delete(videoId);
		});

	inFlight.set(videoId, promise);
	return promise;
}

export function clearVideoDetailsCache(): void {
	cache.clear();
	inFlight.clear();
}
