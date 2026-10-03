import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import {
	normalizeName,
	resolveTrackIdentity,
} from "$lib/metadata/resolve-track-identity";
import type { VideoDetails } from "$lib/video-metadata";
import type { BandcampTrack } from "./bandcamp-track";

export const BANDCAMP_NOT_STREAMABLE_MESSAGE =
	"The artist only lets people who buy this track hear it, so it can't be downloaded here.";

function yearOf(isoDate: string | undefined): number | undefined {
	const year = Number.parseInt(isoDate?.slice(0, 4) ?? "", 10);
	return year > 1900 ? year : undefined;
}

/**
 * Bandcamp's artist field is set by whoever sells the track, so it is the
 * credit — but a label's compilation often leaves it as the label or
 * "Various Artists" and puts "Artist - Title" in the title, which the title
 * parse catches first.
 */
export function bandcampTitleState(track: BandcampTrack): DownloadTitle {
	const { artist, trackTitle } = resolveTrackIdentity({
		rawTitle: track.title,
		uploader: track.bandName,
		creditedArtist: track.artist,
		labelName: bandcampLabel(track),
	});
	return { videoTitle: track.title, artist, trackTitle };
}

/**
 * The selling account is a label when it isn't the artist. Containment, not
 * equality, in both directions: an artist's own account names collabs
 * ("Ben Prunty & X" on `benprunty`) and its handle can carry a suffix
 * ("Ben Prunty Music"), and neither is a label.
 */
function bandcampLabel(track: BandcampTrack): string | undefined {
	const band = normalizeName(track.bandName);
	const artist = normalizeName(track.artist);
	if (!band || !artist) return undefined;
	return band.includes(artist) || artist.includes(band)
		? undefined
		: track.bandName;
}

/**
 * Omits `track` and `artist` for the same reason soundCloudDetails does:
 * buildID3Tags prefers them over the resolved identity, which already
 * weighed the raw title and the artist field.
 */
export function bandcampDetails(track: BandcampTrack): VideoDetails {
	return {
		year: yearOf(track.releaseDate),
		album: track.albumTitle,
		duration: track.durationSeconds,
		label: bandcampLabel(track),
		isrc: track.isrc,
	};
}

/**
 * Why a track can't be downloaded, known before yt-dlp runs. A track with
 * streaming off can still be a free download, and yt-dlp reads the
 * free-download page independently of the stream.
 */
export function bandcampRefusal(track: BandcampTrack): string | null {
	return track.isStreamable || track.hasFreeDownload
		? null
		: BANDCAMP_NOT_STREAMABLE_MESSAGE;
}
