import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as Sentry from "@sentry/sveltekit";
import { resolveAlbumArtImage } from "$lib/artwork";
import { registerDownload } from "$lib/download-pipeline/download-tokens";
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
	videoId: string;
	detailsPromise: Promise<VideoDetails | null>;
	thumbnailPromise: Promise<ThumbnailImage | null>;
	send: (data: Record<string, unknown>) => void;
}

export interface FinalizeMp3Result {
	filename: string;
	size: number;
	token: string;
	downloadMethod: DownloadMethod;
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
		const safeArtist = artist.replace(/[<>:"/\\|?*]/g, "").trim();
		const safeTrack = trackTitle.replace(/[<>:"/\\|?*]/g, "").trim();
		if (safeArtist && safeTrack) {
			return `${safeArtist} - ${safeTrack}.mp3`;
		}
	}
	if (videoTitle) {
		return `${videoTitle.replace(/[<>:"/\\|?*]/g, "_").replace(/_+/g, "_")}.mp3`;
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
}: FinalizeMp3Input): Promise<FinalizeMp3Result> {
	const NodeID3 = require("node-id3");

	try {
		const [details, thumbnail] = await Promise.all([
			detailsPromise,
			thumbnailPromise,
		]);

		const image = await resolveAlbumArtImage({
			artist,
			title: trackTitle || videoTitle,
			videoId,
			fallback: thumbnail,
		});

		const tags = buildID3Tags({
			trackTitle,
			videoTitle,
			artist,
			details,
			image,
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

	send({ type: "progress", percent: 90 });
	send({ type: "status", message: "Preparing download..." });

	const { size } = await stat(filePath);
	const filename = buildDownloadFilename({ artist, trackTitle, videoTitle });
	const token = registerDownload({ filePath, filename, size });

	console.log("Final filename:", filename);

	send({ type: "progress", percent: 95 });

	return { filename, size, token, downloadMethod };
}
