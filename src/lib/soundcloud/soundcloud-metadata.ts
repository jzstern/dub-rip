import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";
import type { VideoDetails } from "$lib/video-metadata";
import type { SoundCloudTrack } from "./soundcloud-track";

export const SOUNDCLOUD_PREVIEW_ONLY_MESSAGE =
	"This track is a 30-second SoundCloud Go+ preview and can't be downloaded in full.";
export const SOUNDCLOUD_GEO_BLOCKED_MESSAGE =
	"This track isn't available in the region the downloader runs from.";

function yearOf(isoDate: string | undefined): number | undefined {
	const year = Number.parseInt(isoDate?.slice(0, 4) ?? "", 10);
	return year > 1900 ? year : undefined;
}

/** The same shape the route's title state has had since PR #134. The uploader travels separately. */
export function soundCloudTitleState(track: SoundCloudTrack): DownloadTitle {
	const { artist, trackTitle } = resolveTrackIdentity({
		rawTitle: track.title,
		uploader: track.uploader,
		creditedArtist: track.creditedArtist,
		labelName: track.labelName,
	});
	return { videoTitle: track.title, artist, trackTitle };
}

/**
 * Deliberately omits `track` and `artist`: buildID3Tags prefers those over
 * the resolved identity, and SoundCloud's only candidates for them — the raw
 * upload title and `publisher_metadata.artist` — are what
 * resolveTrackIdentity already weighed, and sometimes rejected.
 */
export function soundCloudDetails(track: SoundCloudTrack): VideoDetails {
	return {
		year: yearOf(track.releaseDate),
		genre: track.genre,
		album: track.albumTitle,
		composer: track.composer,
		duration: track.durationSeconds,
		label: track.labelName,
		isrc: track.isrc,
	};
}

/** Why a track can't be downloaded, known before yt-dlp runs. */
export function soundCloudRefusal(track: SoundCloudTrack): string | null {
	if (track.isPreviewOnly) return SOUNDCLOUD_PREVIEW_ONLY_MESSAGE;
	if (track.isGeoBlocked) return SOUNDCLOUD_GEO_BLOCKED_MESSAGE;
	return null;
}
