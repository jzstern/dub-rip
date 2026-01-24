import * as Sentry from "@sentry/sveltekit";
import { parseArtistAndTitle, sanitizeUploaderAsArtist } from "./video-utils";

const DEFAULT_TIMEOUT = 10000;

export interface YouTubeMetadata {
	videoTitle: string;
	artist: string;
	trackTitle: string;
	uploader: string;
	thumbnailUrl: string;
}

export class YouTubeMetadataError extends Error {
	constructor(
		message: string,
		public readonly isUnavailable: boolean = false,
	) {
		super(message);
		this.name = "YouTubeMetadataError";
	}
}

export async function fetchYouTubeMetadata(
	videoId: string,
	timeout: number = DEFAULT_TIMEOUT,
): Promise<YouTubeMetadata> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
		const response = await fetch(oembedUrl, { signal: controller.signal });

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				throw new YouTubeMetadataError("Video is unavailable or private", true);
			}
			if (response.status === 404) {
				throw new YouTubeMetadataError("Video not found", true);
			}
			throw new YouTubeMetadataError(
				`oEmbed request failed: ${response.status}`,
			);
		}

		const oembed = (await response.json()) as {
			title?: string;
			author_name?: string;
			thumbnail_url?: string;
		};

		const videoTitle = oembed.title ?? "";
		const { artist, title } = parseArtistAndTitle(videoTitle);
		const uploader = oembed.author_name ?? "";

		return {
			videoTitle,
			artist: artist || sanitizeUploaderAsArtist(uploader),
			trackTitle: title || videoTitle,
			uploader,
			thumbnailUrl:
				oembed.thumbnail_url ??
				`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
		};
	} catch (error) {
		if (error instanceof YouTubeMetadataError) {
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new YouTubeMetadataError("Metadata request timed out");
			}
			Sentry.captureException(error, {
				tags: { service: "youtube-metadata", operation: "fetch" },
				extra: { videoId },
			});
			throw new YouTubeMetadataError(
				`Failed to fetch metadata: ${error.message}`,
			);
		}
		const unknownError = new Error(`Unknown metadata error: ${String(error)}`);
		Sentry.captureException(unknownError, {
			tags: { service: "youtube-metadata", operation: "fetch" },
			extra: { videoId },
		});
		throw new YouTubeMetadataError("Unknown metadata error");
	} finally {
		clearTimeout(timeoutId);
	}
}
