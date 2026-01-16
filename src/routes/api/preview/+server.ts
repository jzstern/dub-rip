import { json } from "@sveltejs/kit";
import { extractVideoId, isPlaylistUrl } from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const videoId = extractVideoId(url);
		if (!videoId) {
			return json({ error: "Invalid YouTube URL" }, { status: 400 });
		}

		const metadata = await fetchYouTubeMetadata(videoId);
		const isPlaylist = isPlaylistUrl(url);

		return json({
			success: true,
			videoTitle: metadata.videoTitle,
			artist: metadata.artist,
			title: metadata.trackTitle,
			thumbnail: metadata.thumbnailUrl,
			duration: null,
			playlist: isPlaylist ? { pending: true } : null,
		});
	} catch (error) {
		if (error instanceof YouTubeMetadataError) {
			console.error("Preview error:", error.message);
			if (error.isUnavailable) {
				return json(
					{ error: "Video is unavailable or private" },
					{ status: 404 },
				);
			}
		} else {
			const message = error instanceof Error ? error.message : "Unknown error";
			console.error("Preview error:", message);
		}

		return json({ error: "Failed to load preview" }, { status: 500 });
	}
};
