/**
 * Video parsing utilities for YouTube URLs and metadata
 */

/**
 * Parse artist and title from a video title string
 * Common patterns: "Artist - Title", "Artist: Title", "Artist | Title"
 */
export function parseArtistAndTitle(videoTitle: string): {
	artist: string;
	title: string;
} {
	const patterns = [
		/^(.+?)\s*[-–—]\s*(.+)$/, // Artist - Title (various dash types)
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

/**
 * Sanitize YouTube uploader/channel name for use as artist fallback
 * Strips " - Topic" suffix used by YouTube Music auto-generated channels
 */
export function sanitizeUploaderAsArtist(uploader: string): string {
	return uploader.replace(/\s*-\s*Topic$/i, "").trim();
}

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractVideoId(url: string): string | null {
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

/**
 * Check if a URL contains playlist parameters
 */
export function isPlaylistUrl(url: string): boolean {
	return url.includes("list=") || url.includes("/playlist");
}

/**
 * Validate a YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
	return extractVideoId(url) !== null;
}
