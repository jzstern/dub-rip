import { randomBytes } from "node:crypto";
import { access, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { finalizeMp3 } from "$lib/download-pipeline/finalize-mp3";
import { METADATA_PROCESSING_PERCENT } from "$lib/download-pipeline/progress-stages";
import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import { retryWithBackoff } from "$lib/retry";
import { YT_DLP_METHOD } from "$lib/types";
import { getVideoDetails } from "$lib/video-details-cache";
import {
	fetchThumbnailBuffer,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureBgutilPlugin, ensureYtDlpBinary } from "$lib/yt-dlp-binary";
import { YtDlpQueueFullError } from "$lib/yt-dlp-concurrency";
import {
	type ClassifiedYtDlpError,
	classifyYtDlpError,
	isRetryableYtDlpError,
} from "$lib/yt-dlp-errors";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

const QUEUE_FULL_MESSAGE =
	"The downloader is busy right now. Please try again in a moment.";

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Videos that can never be downloaded (private, age-restricted, copyright)
 * are normal operation, not defects, so they stay breadcrumbs — reporting
 * them buried the real failures and burned quota. Transient infrastructure
 * failures have already exhausted every retry by the time they land here, so
 * they're worth a warning; anything unclassified is how new yt-dlp/YouTube
 * breakages announce themselves and gets full error level.
 */
function reportDownloadFailure(
	error: Error,
	classified: ClassifiedYtDlpError,
	videoId: string,
): void {
	if (classified.category === "user") {
		Sentry.addBreadcrumb({
			category: "download",
			level: "info",
			message: `Download rejected: ${classified.message}`,
			data: { videoId },
		});
		return;
	}

	Sentry.captureException(error, {
		level: classified.category === "transient" ? "warning" : "error",
		tags: {
			service: "download-stream",
			operation: "download",
			category: classified.category,
		},
		extra: { videoId },
	});
}

let ytDlpWrap: YtDlpInstance | null = null;
let ytDlpPromise: Promise<YtDlpInstance> | null = null;

async function getYTDlp(): Promise<YtDlpInstance> {
	if (ytDlpWrap) return ytDlpWrap;
	if (ytDlpPromise) return ytDlpPromise;

	ytDlpPromise = (async (): Promise<YtDlpInstance> => {
		try {
			const YTDlpWrapModule = require("yt-dlp-wrap");
			const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
			const binaryPath = await ensureYtDlpBinary();
			ytDlpWrap = new YTDlpWrap(binaryPath) as YtDlpInstance;
			return ytDlpWrap;
		} catch (err) {
			ytDlpPromise = null;
			throw err;
		}
	})();

	return ytDlpPromise;
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

	const normalizedUrl = buildWatchUrl(videoId);
	const abortController = new AbortController();

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

				const detailsPromise: Promise<VideoDetails | null> = getVideoDetails(
					videoId,
					normalizedUrl,
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

				send({ type: "status", message: "Starting download..." });

				if (!env.BGUTIL_POT_URL) {
					send({
						type: "error",
						message:
							"Server is misconfigured: BGUTIL_POT_URL is not set. Downloads cannot run without the bgutil-pot sidecar.",
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
				const bgutilPotUrl = env.BGUTIL_POT_URL;

				await retryWithBackoff(
					() =>
						tryYtDlpDownload({
							videoUrl: normalizedUrl,
							outputPath,
							bgutilPotUrl,
							ffmpegPath: ffmpegInstaller.path,
							pluginDir,
							debugMode,
							ytDlp,
							titleState,
							send,
							signal: abortController.signal,
						}),
					{
						isRetryable: (error) =>
							isRetryableYtDlpError(
								error instanceof Error ? error.message : String(error),
							),
						onRetry: () => {
							send({ type: "status", message: "Retrying download..." });
						},
						signal: abortController.signal,
					},
				);

				const actualFilePath = `${outputPath}.mp3`;

				if (!(await pathExists(actualFilePath))) {
					send({
						type: "error",
						message: "Download completed but file not found",
					});
					Sentry.captureException(
						new Error("yt-dlp exited 0 but produced no output file"),
						{
							tags: {
								service: "download-stream",
								operation: "missing-output-file",
							},
							extra: { videoId },
						},
					);
					closeStream();
					return;
				}

				console.log("Video title:", titleState.videoTitle);
				console.log("Parsed artist:", titleState.artist);
				console.log("Parsed track title:", titleState.trackTitle);

				send({ type: "progress", percent: METADATA_PROCESSING_PERCENT });
				send({ type: "status", message: "Processing metadata..." });

				if (abortController.signal.aborted) {
					// yt-dlp can finish (or get killed and still report a clean close —
					// see try-yt-dlp.ts) after the client has already disconnected. A
					// bare `return` here would skip the catch block's temp-file cleanup
					// below and strand the finished .mp3; throwing routes through it.
					throw abortController.signal.reason ?? new Error("Download aborted");
				}

				const result = await finalizeMp3({
					filePath: actualFilePath,
					videoTitle: titleState.videoTitle,
					artist: titleState.artist,
					trackTitle: titleState.trackTitle,
					downloadMethod: YT_DLP_METHOD,
					videoId,
					detailsPromise,
					thumbnailPromise,
					send,
					signal: abortController.signal,
				});

				// The file is deliberately left on disk: the browser fetches it from
				// /api/download-file next. Ownership passes to the token registry,
				// which unlinks it once transferred or once the token expires.
				send({
					type: "complete",
					filename: result.filename,
					size: result.size,
					token: result.token,
					downloadMethod: result.downloadMethod,
				});

				closeStream();
			} catch (error: unknown) {
				if (abortController.signal.aborted) {
					// The client walked away — normal operation, not a defect. No SSE
					// event either: there is nothing left listening for it, and no
					// closeStream(): cancel() already put the controller in a closed
					// state, so calling close() here would only throw and log noise.
					console.log("Download aborted: client disconnected");
					Sentry.addBreadcrumb({
						category: "download",
						level: "info",
						message: "Download aborted: client disconnected before it finished",
						data: { videoId },
					});
				} else if (error instanceof YtDlpQueueFullError) {
					// Load shedding working as designed, not a defect — a traffic spike
					// would otherwise turn every rejected request into an issue.
					console.warn("Download rejected: yt-dlp queue is full");
					Sentry.addBreadcrumb({
						category: "download",
						level: "info",
						message: "Download rejected: downloader queue is full",
						data: { videoId },
					});
					try {
						send({ type: "error", message: QUEUE_FULL_MESSAGE });
					} catch (sendErr) {
						console.error("Failed to send final error SSE event:", sendErr);
					}
					closeStream();
				} else {
					console.error("Download error:", error);
					const normalizedError =
						error instanceof Error
							? error
							: new Error(`Unknown download error: ${String(error)}`);
					const rawMessage =
						error instanceof Error ? error.message : "Unknown error";
					const classified = classifyYtDlpError(rawMessage);
					reportDownloadFailure(normalizedError, classified, videoId);
					try {
						send({ type: "error", message: classified.message });
					} catch (sendErr) {
						console.error("Failed to send final error SSE event:", sendErr);
					}
					closeStream();
				}

				try {
					// `.mp4` covers the bounded video fallback in the format selector,
					// and `.part` the retry that gave up mid-transfer — both are
					// reachable now in a way they weren't when this list was written.
					const extensions = ["mp3", "webm", "m4a", "mp4"];
					const possibleFiles = extensions.flatMap((ext) => [
						`${outputPath}.${ext}`,
						`${outputPath}.${ext}.part`,
					]);
					for (const file of possibleFiles) {
						if (await pathExists(file)) {
							await unlink(file);
						}
					}
				} catch {}
			}
		},
		cancel() {
			abortController.abort();
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
