import type { VideoDetails } from "$lib/video-metadata";
import {
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";

export interface DownloadTitle {
	videoTitle: string;
	artist: string;
	trackTitle: string;
}

/**
 * The title for a download whose oEmbed lookup failed, taken from the
 * `--dump-json` extraction download-stream already runs alongside it. Never
 * parse it out of the download's own yt-dlp output: that writes to a random
 * hex path, so every filename it prints is the ID, not the video's title.
 *
 * YouTube's structured `track`/`artist` win over the parsed title, matching
 * what `buildID3Tags` writes, so the filename and the tags agree. With no
 * details at all the title stays empty and `buildDownloadFilename`/
 * `buildID3Tags` fall back to their own defaults.
 */
export function titleFromVideoDetails(
	details: VideoDetails | null,
): DownloadTitle {
	const videoTitle = details?.title ?? "";
	const parsed = parseArtistAndTitle(videoTitle);

	return {
		videoTitle,
		artist:
			details?.artist ||
			parsed.artist ||
			sanitizeUploaderAsArtist(details?.uploader ?? ""),
		trackTitle: details?.track || parsed.title,
	};
}
