import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { cleanupTempFiles } from "$lib/download-pipeline/cleanup-temp-files";
import { finalizeMp3 } from "$lib/download-pipeline/finalize-mp3";
import { pathExists } from "$lib/download-pipeline/path-exists";
import { METADATA_PROCESSING_PERCENT } from "$lib/download-pipeline/progress-stages";
import { titleFromVideoDetails } from "$lib/download-pipeline/title-from-video-details";
import { tryYtDlpDownload } from "$lib/download-pipeline/try-yt-dlp";
import { getYTDlp } from "$lib/download-pipeline/yt-dlp-instance";
import { retryWithBackoff } from "$lib/retry";
import { YT_DLP_METHOD } from "$lib/types";
import { getVideoDetails } from "$lib/video-details-cache";
import {
	fetchThumbnailBuffer,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";
import { waitForBgutilPot } from "$lib/wait-for-bgutil-pot";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureBgutilPlugin } from "$lib/yt-dlp-binary";
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

/**
 * Railway's log timestamps put the sidecar's cold start at up to ~9 s (an upper
 * bound; see waitForBgutilPot). A wait well past that is a sidecar that is down,
 * not starting, and holding the user longer would only delay the failure they
 * are going to get.
 */
const SIDECAR_WAKE_CAP_MS = 12_000;

/**
 * A warm sidecar answers in milliseconds. A first ping that answered but took
 * this long is still a cold start worth a log line — a ping can hang for most of
 * its 3 s timeout and then succeed, which needs no second attempt to count.
 */
const SLOW_WAKE_LOG_MS = 250;

/**
 * `POST /api/preview` nudges the sleeping bgutil-pot sidecar awake while the
 * user reads the preview, but that ping is fire-and-forget, so a click before
 * the sidecar listens still reaches yt-dlp while it is booting. yt-dlp then
 * cannot fetch a PO token, YouTube bot-checks the `web` player request, and the
 * failure is indistinguishable from a throttled IP. The retry below used to be
 * the only thing recovering it (2026-09-17 00:59:41: a direct curl of this
 * route with no preview; the first attempt failed, the retry minted a token and
 * succeeded). How often browser users reach this route that early is
 * unmeasured: after a paste the page's first contact with the sidecar is
 * `/api/preview/details`, not this route.
 *
 * Waiting here turns that into a deterministic start. It never fails the
 * download: if the sidecar stays silent the attempt goes ahead anyway and the
 * retry loop is still the safety net.
 */
async function waitForSidecar(
	bgutilPotUrl: string,
	videoId: string,
	signal: AbortSignal,
	send: (data: Record<string, unknown>) => void,
): Promise<void> {
	const wake = await waitForBgutilPot(bgutilPotUrl, {
		maxWaitMs: SIDECAR_WAKE_CAP_MS,
		signal,
		onWaiting: () =>
			send({ type: "status", message: "Waking up the downloader..." }),
	});

	if (wake.awake) {
		if (wake.attempts > 1 || wake.waitedMs >= SLOW_WAKE_LOG_MS) {
			console.info(
				`bgutil-pot answered /ping after ${wake.attempts} attempts, ${wake.waitedMs}ms`,
			);
		}
		return;
	}
	if (signal.aborted) return;

	const summary = `${wake.attempts} attempts, ${wake.waitedMs}ms`;
	console.warn(
		`bgutil-pot did not answer /ping before the download: ${summary}`,
	);
	Sentry.addBreadcrumb({
		category: "download",
		level: "warning",
		message: "bgutil-pot did not answer /ping before the download started",
		data: { videoId, attempts: wake.attempts, waitedMs: wake.waitedMs },
	});
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
			const tempDir = tmpdir();
			const outputPath = join(tempDir, randomId);

			try {
				send({ type: "status", message: "Getting video info..." });

				if (env.BGUTIL_POT_URL) {
					await waitForSidecar(
						env.BGUTIL_POT_URL,
						videoId,
						abortController.signal,
						send,
					);
					if (abortController.signal.aborted) {
						throw (
							abortController.signal.reason ?? new Error("Download aborted")
						);
					}
				}

				const titleState = {
					videoTitle: "",
					artist: "",
					trackTitle: "",
				};
				const sendTitleInfo = () => {
					send({
						type: "info",
						title: titleState.videoTitle,
						artist: titleState.artist,
						track: titleState.trackTitle,
					});
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

						console.log("Got metadata from oEmbed:", {
							videoTitle: titleState.videoTitle,
							artist: titleState.artist,
							trackTitle: titleState.trackTitle,
							uploader: metadata.uploader,
						});

						sendTitleInfo();
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

				if (!titleState.videoTitle) {
					Object.assign(
						titleState,
						titleFromVideoDetails(await detailsPromise),
					);
					if (titleState.videoTitle) sendTitleInfo();
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

				await cleanupTempFiles({
					tempDir,
					prefix: randomId,
					tags: { service: "download-stream" },
					extra: { videoId },
				});
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
