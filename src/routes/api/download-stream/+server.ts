import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { encodeAndStreamMp3 } from "$lib/download-pipeline/encode-and-stream";
import { tryCobaltDownload } from "$lib/download-pipeline/try-cobalt";
import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import type { DownloadMethod } from "$lib/types";
import {
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
import { ensureBgutilPlugin, ensureYtDlpBinary } from "$lib/yt-dlp-binary";
import { parseYtDlpError } from "$lib/yt-dlp-errors";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

let ytDlpWrap: YtDlpInstance | null = null;
let isInitializing = false;

async function getYTDlp(): Promise<YtDlpInstance> {
	if (ytDlpWrap) return ytDlpWrap;

	while (isInitializing) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	if (ytDlpWrap) return ytDlpWrap;

	isInitializing = true;
	try {
		const YTDlpWrapModule = require("yt-dlp-wrap");
		const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;

		const binaryPath = await ensureYtDlpBinary();
		ytDlpWrap = new YTDlpWrap(binaryPath) as YtDlpInstance;
		return ytDlpWrap;
	} finally {
		isInitializing = false;
	}
}

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
			const outputPath = join(tmpdir(), `${randomId}`);

			try {
				send({ type: "status", message: "Getting video info..." });

				const titleState = {
					videoTitle: "",
					artist: "",
					trackTitle: "",
					uploader: "",
				};

				const detailsPromise: Promise<VideoDetails | null> = fetchVideoDetails(
					videoUrl,
				).catch(() => null);
				const thumbnailPromise: Promise<ThumbnailImage | null> = videoId
					? fetchThumbnailBuffer(videoId).catch(() => null)
					: Promise.resolve(null);

				if (videoId) {
					try {
						const metadata = await fetchYouTubeMetadata(videoId);
						titleState.videoTitle = metadata.videoTitle;
						titleState.artist = metadata.artist;
						titleState.trackTitle = metadata.trackTitle;
						titleState.uploader = metadata.uploader;

						console.log("Got metadata from oEmbed:", {
							videoTitle: titleState.videoTitle,
							artist: titleState.artist,
							trackTitle: titleState.trackTitle,
							uploader: titleState.uploader,
						});

						send({
							type: "info",
							title: titleState.videoTitle,
							artist: titleState.artist,
							track: titleState.trackTitle,
						});
					} catch (err) {
						if (err instanceof YouTubeMetadataError) {
							console.log("oEmbed metadata failed:", err.message);
							if (err.isUnavailable) {
								send({
									type: "error",
									message: "Video not found or unavailable",
								});
								closeStream();
								return;
							}
						} else {
							console.error("Metadata fetch error:", err);
						}
					}
				}

				let actualFilePath = `${outputPath}.mp3`;
				let downloadMethod: DownloadMethod = "yt-dlp";

				send({ type: "status", message: "Trying fast download..." });

				const cobaltResult = await tryCobaltDownload({
					videoUrl,
					outputPath: actualFilePath,
					send,
				});

				if (cobaltResult.ok) {
					downloadMethod = cobaltResult.method;
				} else {
					send({ type: "status", message: "Starting download..." });

					if (!env.BGUTIL_POT_URL) {
						send({
							type: "error",
							message:
								"Server is misconfigured: BGUTIL_POT_URL is not set. The yt-dlp fallback cannot run without the bgutil-pot sidecar.",
						});
						Sentry.captureMessage("BGUTIL_POT_URL is unset", {
							level: "error",
							tags: {
								service: "download-stream",
								operation: "bgutil-pot-config",
							},
						});
						closeStream();
						return;
					}

					const debugMode = url.searchParams.get("debug") === "1";
					const ytDlp = await getYTDlp();
					const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
					const pluginDir = await ensureBgutilPlugin();

					await tryYtDlpDownload({
						videoUrl,
						outputPath,
						bgutilPotUrl: env.BGUTIL_POT_URL,
						ffmpegPath: ffmpegInstaller.path,
						pluginDir,
						debugMode,
						ytDlp,
						titleState,
						send,
					});

					actualFilePath = `${outputPath}.mp3`;
					downloadMethod = "yt-dlp";
				}

				if (!existsSync(actualFilePath)) {
					send({
						type: "error",
						message: "Download completed but file not found",
					});
					controller.close();
					return;
				}

				console.log("Video title:", titleState.videoTitle);
				console.log("Parsed artist:", titleState.artist);
				console.log("Parsed track title:", titleState.trackTitle);

				send({ type: "progress", percent: 78 });
				send({ type: "status", message: "Processing metadata..." });

				const result = await encodeAndStreamMp3({
					filePath: actualFilePath,
					videoTitle: titleState.videoTitle,
					artist: titleState.artist,
					trackTitle: titleState.trackTitle,
					downloadMethod,
					videoId,
					detailsPromise,
					thumbnailPromise,
					send,
				});

				send({
					type: "complete",
					filename: result.filename,
					size: result.size,
					data: result.data,
					downloadMethod: result.downloadMethod,
				});

				try {
					unlinkSync(actualFilePath);
				} catch {}

				closeStream();
			} catch (error: unknown) {
				console.error("Download error:", error);
				const normalizedError =
					error instanceof Error
						? error
						: new Error(`Unknown download error: ${String(error)}`);
				Sentry.captureException(normalizedError, {
					tags: { service: "download-stream", operation: "download" },
					extra: { videoId },
				});
				const rawMessage =
					error instanceof Error ? error.message : "Unknown error";
				const message = parseYtDlpError(rawMessage);
				try {
					send({ type: "error", message });
				} catch (sendErr) {
					console.error("Failed to send final error SSE event:", sendErr);
				}
				closeStream();

				try {
					const possibleFiles = [
						`${outputPath}.mp3`,
						`${outputPath}.webm`,
						`${outputPath}.m4a`,
					];
					for (const file of possibleFiles) {
						if (existsSync(file)) {
							unlinkSync(file);
						}
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
