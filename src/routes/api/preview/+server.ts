import { json } from "@sveltejs/kit";
import {
	extractVideoId,
	isPlaylistUrl,
	parseArtistAndTitle,
} from "$lib/video-utils";
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

		// Use YouTube oEmbed API for fast metadata (no API key needed)
		const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
		const response = await fetch(oembedUrl);

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				return json(
					{ error: "Video is unavailable or private" },
					{ status: 404 },
				);
			}
			throw new Error(`oEmbed failed: ${response.status}`);
		}

		const oembed = await response.json();
		const { artist, title } = parseArtistAndTitle(oembed.title);

		// Check if URL contains playlist parameter
		const isPlaylist = isPlaylistUrl(url);

		return json({
			success: true,
			videoTitle: oembed.title,
			artist: artist || oembed.author_name || "",
			title: title || oembed.title,
			thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
			// Duration and playlist info will be lazy-loaded via /api/preview/details
			duration: null,
			playlist: isPlaylist ? { pending: true } : null,
		});
	} catch (error: any) {
		console.error("Preview error:", error.message);

		return json(
			{
				error: "Failed to load preview",
			},
			{ status: 500 },
		);
	}
};
