import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { encodeAndStreamMp3 } from "$lib/download-pipeline/encode-and-stream";
import { tryCobaltDownload } from "$lib/download-pipeline/try-cobalt";
import type { DownloadMethod } from "$lib/types";
import {
	fetchThumbnailBuffer,
	fetchVideoDetails,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import {
	extractVideoId,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureBgutilPlugin, ensureYtDlpBinary } from "$lib/yt-dlp-binary";
import { parseYtDlpError } from "$lib/yt-dlp-errors";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

interface YtDlpProcess {
	on(
		event: "progress",
		callback: (progress: Record<string, unknown>) => void,
	): void;
	on(
		event: "ytDlpEvent",
		callback: (eventType: string, eventData: string) => void,
	): void;
	on(event: "error", callback: (error: Error) => void): void;
	on(event: "close", callback: (code: number) => void): void;
	stderr?: { on(event: string, callback: (data: Buffer) => void): void };
}

interface YtDlpInstance {
	exec(args: string[]): YtDlpProcess;
}

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

				let videoTitle = "";
				let artist = "";
				let trackTitle = "";
				let uploader = "";

				const detailsPromise: Promise<VideoDetails | null> = fetchVideoDetails(
					videoUrl,
				).catch(() => null);
				const thumbnailPromise: Promise<ThumbnailImage | null> = videoId
					? fetchThumbnailBuffer(videoId).catch(() => null)
					: Promise.resolve(null);

				if (videoId) {
					try {
						const metadata = await fetchYouTubeMetadata(videoId);
						videoTitle = metadata.videoTitle;
						artist = metadata.artist;
						trackTitle = metadata.trackTitle;
						uploader = metadata.uploader;

						console.log("Got metadata from oEmbed:", {
							videoTitle,
							artist,
							trackTitle,
							uploader,
						});

						send({
							type: "info",
							title: videoTitle,
							artist: artist,
							track: trackTitle,
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

					const args = [
						videoUrl,
						"-x",
						"--audio-format",
						"mp3",
						"--audio-quality",
						"0",
						"-f",
						"bestaudio/best",
						"--embed-thumbnail",
						"--add-metadata",
						"--ffmpeg-location",
						ffmpegInstaller.path,
						"--newline",
						"--no-warnings",
						"--parse-metadata",
						"%(title)s:%(meta_title)s",
						"--parse-metadata",
						"%(artist)s:%(meta_artist)s",
						"--no-playlist",
						"--plugin-dirs",
						pluginDir,
						// player_client=default,mweb: try yt-dlp's default chain first (web → ios → android
						// → ...) then fall back to mweb. mweb requires a PO token (provided by bgutil-pot)
						// but returns a narrower format set than web; some videos have no `bestaudio`-matching
						// format in mweb's response. Multi-client mode handles both cases.
						"--extractor-args",
						"youtube:player_client=default,mweb",
						"--extractor-args",
						`youtubepot-bgutilhttp:base_url=${env.BGUTIL_POT_URL}`,
						"-o",
						`${outputPath}.%(ext)s`,
					];

					if (debugMode) {
						args.push("-v", "--list-formats");
					}

					const downloadProcess = ytDlp.exec(args);

					downloadProcess.on(
						"progress",
						(progress: Record<string, unknown>) => {
							const rawPercent = Math.min(
								100,
								Math.max(0, (progress.percent as number) || 0),
							);
							send({
								type: "progress",
								percent: Math.round(5 + (rawPercent / 100) * 70),
								speed: (progress.currentSpeed as string) || "",
								eta: (progress.eta as string) || "",
							});
						},
					);

					downloadProcess.on(
						"ytDlpEvent",
						(eventType: string, eventData: string) => {
							console.log("yt-dlp event:", eventType, "|", eventData);

							if (!videoTitle) {
								if (eventType === "Destination") {
									const match = eventData.match(/\/([^/]+)\.\w+$/);
									if (match) {
										videoTitle = match[1].replace(/_/g, " ");
									}
								} else if (
									eventData.includes(".mp3") ||
									eventData.includes(".webm")
								) {
									const match = eventData.match(/([^/]+)\.\w+/);
									if (match) {
										videoTitle = match[1].replace(/_/g, " ");
									}
								}

								if (videoTitle) {
									const parsed = parseArtistAndTitle(videoTitle);
									artist = parsed.artist;
									trackTitle = parsed.title;

									if (!artist && uploader) {
										artist = sanitizeUploaderAsArtist(uploader);
									}

									send({
										type: "info",
										title: videoTitle,
										artist: artist,
										track: trackTitle,
									});
								}
							}

							send({ type: "event", eventType, eventData });
						},
					);

					let errorMessage = "";
					downloadProcess.stderr?.on("data", (data: Buffer) => {
						const text = data.toString();
						console.error("yt-dlp stderr:", text);
						if (text.includes("ERROR:")) {
							errorMessage += text;
						}
					});

					downloadProcess.on("error", (error: Error) => {
						console.error("Download process error:", error);
						send({
							type: "error",
							message: parseYtDlpError(error.message),
						});
					});

					await new Promise((resolve, reject) => {
						downloadProcess.on("close", (code: number) => {
							if (code === 0) {
								resolve(code);
							} else {
								reject(
									new Error(errorMessage || `Process exited with code ${code}`),
								);
							}
						});
						downloadProcess.on("error", reject);
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

				console.log("Video title:", videoTitle);
				console.log("Parsed artist:", artist);
				console.log("Parsed track title:", trackTitle);

				send({ type: "progress", percent: 78 });
				send({ type: "status", message: "Processing metadata..." });

				const result = await encodeAndStreamMp3({
					filePath: actualFilePath,
					videoTitle,
					artist,
					trackTitle,
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
