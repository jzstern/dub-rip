import { createSingleFlightCache } from "./single-flight-cache";
import { fetchVideoDetails, type VideoDetails } from "./video-metadata";

export const DEFAULT_VIDEO_DETAILS_TTL_MS = 10 * 60 * 1000;

const cache = createSingleFlightCache<VideoDetails | null>();

export interface GetVideoDetailsOptions {
	ttlMs?: number;
	timeout?: number;
}

/**
 * Get-or-fetch cache for yt-dlp video details, keyed by videoId.
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
export function getVideoDetails(
	videoId: string,
	videoUrl: string,
	options: GetVideoDetailsOptions = {},
): Promise<VideoDetails | null> {
	return cache.get(
		videoId,
		() => fetchVideoDetails(videoUrl, options.timeout),
		options.ttlMs ?? DEFAULT_VIDEO_DETAILS_TTL_MS,
	);
}

export function clearVideoDetailsCache(): void {
	cache.clear();
}
