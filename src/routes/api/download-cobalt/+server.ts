import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { resolveAlbumArtImage } from "$lib/artwork";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";
import {
	buildID3Tags,
	fetchThumbnailBuffer,
	fetchVideoDetails,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import { extractVideoId } from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

export const GET: RequestHandler = async ({ url }) => {
	const videoUrl = url.searchParams.get("url");

	if (!videoUrl) {
		return new Response("URL parameter required", { status: 400 });
	}

	const videoId = extractVideoId(videoUrl);
	if (!videoId) {
		return new Response("Invalid YouTube URL", { status: 400 });
	}

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			let isClosed = false;

			const send = (data: Record<string, unknown>) => {
				if (!isClosed) {
					try {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
						);
					} catch (err) {
						console.error("Failed to send event:", err);
						isClosed = true;
					}
				}
			};

			const closeStream = () => {
				if (!isClosed) {
					isClosed = true;
					try {
						controller.close();
					} catch (err) {
						console.error("Failed to close controller:", err);
					}
				}
			};

			const randomId = randomBytes(16).toString("hex");
			const outputPath = join(tmpdir(), `${randomId}.mp3`);

			try {
				send({ type: "status", message: "Getting video info..." });

				let videoTitle = "";
				let artist = "";
				let trackTitle = "";

				const detailsPromise: Promise<VideoDetails | null> = fetchVideoDetails(
					videoUrl,
				).catch(() => null);
				const thumbnailPromise: Promise<ThumbnailImage | null> =
					fetchThumbnailBuffer(videoId).catch(() => null);

				try {
					const metadata = await fetchYouTubeMetadata(videoId);
					videoTitle = metadata.videoTitle;
					artist = metadata.artist;
					trackTitle = metadata.trackTitle;

					console.log("[Cobalt] Got metadata from oEmbed:", {
						videoTitle,
						artist,
						trackTitle,
					});

					send({
						type: "info",
						title: videoTitle,
						artist: artist,
						track: trackTitle,
					});
				} catch (err) {
					if (err instanceof YouTubeMetadataError) {
						console.log("[Cobalt] oEmbed metadata failed:", err.message);
						if (err.isUnavailable) {
							send({
								type: "error",
								message: "Video not found or unavailable",
							});
							closeStream();
							return;
						}
					} else {
						console.error("[Cobalt] Metadata fetch error:", err);
					}
				}

				send({ type: "status", message: "Requesting audio from Cobalt..." });

				const downloadUrl = await requestCobaltAudio(videoUrl, 20000);
				console.log("[Cobalt] Got download URL");

				send({
					type: "status",
					message: "Downloading audio...",
				});
				send({
					type: "progress",
					percent: 10,
				});

				const audioBuffer = await fetchCobaltAudio(downloadUrl, 55000);
				console.log("[Cobalt] Downloaded audio, size:", audioBuffer.byteLength);

				send({
					type: "progress",
					percent: 80,
				});

				writeFileSync(outputPath, Buffer.from(audioBuffer));

				send({ type: "status", message: "Processing metadata..." });

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
					console.log("[Cobalt] Writing ID3 tags:", {
						...tagsForLog,
						image: image ? `[${image.buffer.byteLength} bytes]` : "none",
					});

					const success = NodeID3.write(tags, outputPath);
					if (success !== true) {
						const error =
							success instanceof Error
								? success
								: new Error("NodeID3.write returned non-true value");
						console.error("[Cobalt] ID3 write failed:", error);
						Sentry.captureException(error, {
							tags: { service: "download-cobalt", operation: "id3-write" },
							extra: { videoId, tags: tagsForLog },
						});
					} else {
						console.log("[Cobalt] ID3 write success");
					}
				} catch (err) {
					console.error("[Cobalt] Metadata processing error:", err);
					const normalizedError =
						err instanceof Error
							? err
							: new Error(`ID3 processing failed: ${String(err)}`);
					Sentry.captureException(normalizedError, {
						tags: { service: "download-cobalt", operation: "id3-write" },
						extra: { videoId },
					});
				}

				send({
					type: "progress",
					percent: 95,
				});

				send({ type: "status", message: "Preparing download..." });

				const fs = await import("node:fs/promises");
				const stats = await fs.stat(outputPath);
				const fileContent = await fs.readFile(outputPath);

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
						videoTitle.replace(/[<>:"/\\|?*]/g, "_").replace(/_+/g, "_") +
						".mp3";
				} else {
					finalFilename = "audio.mp3";
				}

				console.log("[Cobalt] Final filename:", finalFilename);

				send({
					type: "complete",
					filename: finalFilename,
					size: stats.size,
					data: Buffer.from(fileContent).toString("base64"),
					downloadMethod: "cobalt",
				});

				try {
					unlinkSync(outputPath);
				} catch {}

				closeStream();
			} catch (error: unknown) {
				console.error("[Cobalt] Download error:", error);

				let userMessage = "Download failed";
				if (error instanceof CobaltError) {
					if (error.isRateLimit) {
						userMessage =
							"Download service is temporarily busy. Please try again in a moment.";
					} else if (error.isUnavailable) {
						userMessage =
							"Download service is currently unavailable. Please try again later.";
					} else {
						userMessage = error.message;
					}
				} else if (error instanceof Error) {
					userMessage = error.message;
				}

				send({ type: "error", message: userMessage });
				closeStream();

				try {
					if (existsSync(outputPath)) {
						unlinkSync(outputPath);
					}
				} catch {}
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
};
