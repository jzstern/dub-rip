import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function parseArtistAndTitle(videoTitle: string) {
	// Common patterns: "Artist - Title", "Artist: Title", "Artist | Title"
	const patterns = [
		/^(.+?)\s*[-–—]\s*(.+)$/, // Artist - Title
		/^(.+?)\s*:\s*(.+)$/, // Artist: Title
		/^(.+?)\s*\|\s*(.+)$/, // Artist | Title
	];

	for (const pattern of patterns) {
		const match = videoTitle.match(pattern);
		if (match) {
			const artist = match[1].trim();
			let title = match[2].trim();

			// Remove common suffixes from title
			title = title.replace(/\s*\((?:Official\s+)?(?:Music\s+)?Video\)/gi, "");
			title = title.replace(
				/\s*\((?:Official\s+)?(?:Audio|Lyric(?:s)?)\)/gi,
				"",
			);
			title = title.replace(/\s*\[(?:Official\s+)?(?:Music\s+)?Video\]/gi, "");

			return { artist, title };
		}
	}

	// If no pattern matches, return title as-is with no artist
	return { artist: "", title: videoTitle };
}

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
		/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}
	return null;
}

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
		const isPlaylist = url.includes("list=") || url.includes("/playlist");

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
