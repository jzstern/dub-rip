import { createRequire } from "node:module";
import * as Sentry from "@sentry/sveltekit";
import { resolveAlbumArtImage } from "$lib/artwork";
import type { DownloadMethod } from "$lib/types";
import {
	buildID3Tags,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";

const require = createRequire(import.meta.url);

export interface EncodeAndStreamInput {
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

export interface EncodeAndStreamResult {
	filename: string;
	size: number;
	data: string;
	downloadMethod: DownloadMethod;
}

export async function encodeAndStreamMp3({
	filePath,
	videoTitle,
	artist,
	trackTitle,
	downloadMethod,
	videoId,
	detailsPromise,
	thumbnailPromise,
	send,
}: EncodeAndStreamInput): Promise<EncodeAndStreamResult> {
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

	send({ type: "progress", percent: 85 });
	send({ type: "status", message: "Preparing download..." });

	const fs = await import("node:fs/promises");
	const stats = await fs.stat(filePath);

	send({ type: "progress", percent: 88 });

	const fileContent = await fs.readFile(filePath);
	const base64Data = Buffer.from(fileContent).toString("base64");

	send({ type: "progress", percent: 95 });

	let finalFilename: string;
	if (artist && trackTitle) {
		const safeArtist = artist.replace(/[<>:"/\\|?*]/g, "").trim();
		const safeTrack = trackTitle.replace(/[<>:"/\\|?*]/g, "").trim();
		if (safeArtist && safeTrack) {
			finalFilename = `${safeArtist} - ${safeTrack}.mp3`;
		} else {
			finalFilename = `${(videoTitle || "audio")
				.replace(/[<>:"/\\|?*]/g, "_")
				.replace(/_+/g, "_")}.mp3`;
		}
	} else if (videoTitle) {
		finalFilename =
			videoTitle.replace(/[<>:"/\\|?*]/g, "_").replace(/_+/g, "_") + ".mp3";
	} else {
		finalFilename = "audio.mp3";
	}

	console.log("Final filename:", finalFilename);

	return {
		filename: finalFilename,
		size: stats.size,
		data: base64Data,
		downloadMethod,
	};
}
