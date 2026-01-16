import { json } from "@sveltejs/kit";
import {
	extractVideoId,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
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

		return json({
			success: true,
			videoTitle: oembed.title,
			artist: artist || sanitizeUploaderAsArtist(oembed.author_name || ""),
			title: title || oembed.title,
			thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
			duration: null,
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
