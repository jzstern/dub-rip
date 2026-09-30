import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as Sentry from "@sentry/sveltekit";
import {
	resolveAlbumArtImage,
	resolveSoundCloudAlbumArt,
	type SoundCloudArtwork,
} from "$lib/artwork";
import { registerDownload } from "$lib/download-pipeline/download-tokens";
import {
	ID3_TAGS_WRITTEN_PERCENT,
	PREPARING_DOWNLOAD_PERCENT,
} from "$lib/download-pipeline/progress-stages";
import {
	releaseCover,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import type { CanonicalMetadata } from "$lib/metadata/catalog/catalog-candidate";
import type { DownloadMethod } from "$lib/types";
import {
	buildID3Tags,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";

const require = createRequire(import.meta.url);

export interface FinalizeMp3Input {
	filePath: string;
	videoTitle: string;
	artist: string;
	trackTitle: string;
	downloadMethod: DownloadMethod;
	/** YouTube video ID, or SoundCloud `user/slug`; also Sentry context. */
	videoId: string;
	detailsPromise: Promise<VideoDetails | null>;
	thumbnailPromise: Promise<ThumbnailImage | null>;
	send: (data: Record<string, unknown>) => void;
	signal?: AbortSignal;
	uploader?: string;
	sourceUrl?: string;
	/** Present only for SoundCloud; selects its cover-art order. */
	soundCloudArtwork?: SoundCloudArtwork;
}

export interface FinalizeMp3Result {
	filename: string;
	size: number;
	token: string;
	downloadMethod: DownloadMethod;
}

const FILENAME_UNSAFE_CHARS = '<>:"/\\|?*';

/**
 * One budget for the searches and the album call together — the candidates are
 * usually cached by now. The cover fetch that follows keeps its own.
 */
const DOWNLOAD_CATALOG_TIMEOUT_MS = 6000;

function isUnsafeFilenameChar(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return code <= 0x1f || code === 0x7f || FILENAME_UNSAFE_CHARS.includes(char);
}

/**
 * Strips everything that can't safely round-trip through a filesystem path
 * or, downstream, an HTTP Content-Disposition header: the reserved
 * `<>:"/\|?*` set, ASCII control characters, and a leading dot (which would
 * otherwise produce a hidden file). Iterates by code point rather than a
 * regex, matching `buildContentDisposition` in download-file's +server.ts,
 * since Biome's control-character rule flags a control-char range even when
 * it's the intended match.
 */
export function sanitizeFilenameSegment(value: string): string {
	let sanitized = "";
	for (const char of value) {
		if (!isUnsafeFilenameChar(char)) sanitized += char;
	}
	return sanitized.replace(/^\.+/, "").trim();
}

export function buildDownloadFilename({
	artist,
	trackTitle,
	videoTitle,
}: {
	artist: string;
	trackTitle: string;
	videoTitle: string;
}): string {
	if (artist && trackTitle) {
		const safeArtist = sanitizeFilenameSegment(artist);
		const safeTrack = sanitizeFilenameSegment(trackTitle);
		if (safeArtist && safeTrack) {
			return `${safeArtist} - ${safeTrack}.mp3`;
		}
	}
	if (videoTitle) {
		const safeTitle = sanitizeFilenameSegment(videoTitle);
		if (safeTitle) {
			return `${safeTitle}.mp3`;
		}
	}
	return "audio.mp3";
}

export async function finalizeMp3({
	filePath,
	videoTitle,
	artist,
	trackTitle,
	downloadMethod,
	videoId,
	detailsPromise,
	thumbnailPromise,
	send,
	signal,
	uploader,
	sourceUrl,
	soundCloudArtwork,
}: FinalizeMp3Input): Promise<FinalizeMp3Result> {
	const NodeID3 = require("node-id3");
	/** Declared out here because the filename is built after the try block. */
	let canonical: CanonicalMetadata | undefined;

	try {
		const [details, thumbnail] = await Promise.all([
			detailsPromise,
			thumbnailPromise,
		]);

		/**
		 * Queried with the heuristic identity, never with `details.track` or
		 * `details.artist`, so the preview, `/details` and this stage share one
		 * cache key and one set of candidates. By now the duration is in hand,
		 * which is the evidence a preview could not have.
		 */
		const lookup = signal?.aborted
			? undefined
			: await sharedCatalogLookup(
					{
						artist,
						title: trackTitle,
						isrc: details?.isrc,
						durationSeconds: details?.duration,
					},
					{ timeout: DOWNLOAD_CATALOG_TIMEOUT_MS },
				);
		if (lookup?.verdict.status === "matched")
			canonical = lookup.verdict.metadata;

		/**
		 * The cover of the release the upload's ISRC proved; otherwise the cover
		 * is searched for exactly as it is today, with the upload's own identity,
		 * so it matches the one the preview card showed.
		 */
		const preferredArtwork = lookup ? releaseCover(lookup) : undefined;

		const coverTitle = trackTitle || videoTitle;
		const image = soundCloudArtwork
			? await resolveSoundCloudAlbumArt({
					artist,
					title: coverTitle,
					artwork: soundCloudArtwork,
					...(preferredArtwork ? { preferredArtwork } : {}),
				})
			: await resolveAlbumArtImage({
					artist,
					title: coverTitle,
					videoId,
					fallback: thumbnail,
					...(preferredArtwork ? { preferredArtwork } : {}),
				});

		const tags = buildID3Tags({
			trackTitle,
			videoTitle,
			artist,
			details,
			image,
			uploader,
			sourceUrl,
			canonical,
			/** SoundCloud's label field is a distributor's; YouTube's is a scraped ℗ line. */
			trustPlatformRelease: Boolean(soundCloudArtwork),
		});

		const { image: _image, ...tagsForLog } = tags;
		console.log("Writing ID3 tags:", {
			...tagsForLog,
			image: image ? `[${image.buffer.byteLength} bytes]` : "none",
		});

		const success = NodeID3.write(tags, filePath);
		if (success !== true) {
			const error =
				success instanceof Error
					? success
					: new Error("NodeID3.write returned non-true value");
			console.error("ID3 write failed:", error);
			Sentry.captureException(error, {
				tags: { service: "download-stream", operation: "id3-write" },
				extra: { videoId, tags: tagsForLog },
			});
		} else {
			console.log("ID3 write success");
		}
	} catch (err) {
		console.error("Metadata processing error:", err);
		const normalizedError =
			err instanceof Error
				? err
				: new Error(`ID3 processing failed: ${String(err)}`);
		Sentry.captureException(normalizedError, {
			tags: { service: "download-stream", operation: "id3-write" },
			extra: { videoId },
		});
	}

	send({ type: "progress", percent: ID3_TAGS_WRITTEN_PERCENT });
	send({ type: "status", message: "Preparing download..." });

	const { size } = await stat(filePath);
	/**
	 * Narrow `||` rather than reading `tags`, whose title and artist fall back to
	 * "Unknown Title" / "Unknown Artist" — deriving from those would turn today's
	 * `audio.mp3` into `Unknown Artist - Unknown Title.mp3`.
	 */
	const filename = buildDownloadFilename({
		artist: canonical?.artist || artist,
		trackTitle: canonical?.title || trackTitle,
		videoTitle,
	});

	if (signal?.aborted) {
		// The artwork/ID3 work above this line is wasted if the client is gone,
		// but that's cheap to accept. Registering a token — and pinning this
		// file in /tmp for the full TTL — for a client that is provably never
		// coming back is the leak this check exists to prevent.
		throw signal.reason ?? new Error("Download aborted");
	}

	const token = registerDownload({ filePath, filename, size });

	console.log("Final filename:", filename);

	send({ type: "progress", percent: PREPARING_DOWNLOAD_PERCENT });

	return { filename, size, token, downloadMethod };
}
