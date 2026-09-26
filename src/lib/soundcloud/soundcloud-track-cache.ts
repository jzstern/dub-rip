import type { MediaLink } from "$lib/media-link";
import { createSingleFlightCache } from "$lib/single-flight-cache";
import { fetchSoundCloudTrack, type SoundCloudTrack } from "./soundcloud-track";

const TRACK_TTL_MS = 10 * 60 * 1000;

const cache = createSingleFlightCache<SoundCloudTrack>();

/**
 * One page fetch per track across preview, details and download — the same
 * collapse video-details-cache.ts does for YouTube's yt-dlp extraction.
 */
export function getSoundCloudTrack(link: MediaLink): Promise<SoundCloudTrack> {
	return cache.get(
		link.id,
		() => fetchSoundCloudTrack(link.canonicalUrl),
		TRACK_TTL_MS,
	);
}

export function clearSoundCloudTrackCache(): void {
	cache.clear();
}
