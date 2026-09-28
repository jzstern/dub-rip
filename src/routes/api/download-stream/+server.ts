import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { cleanupTempFiles } from "$lib/download-pipeline/cleanup-temp-files";
import { finalizeMp3 } from "$lib/download-pipeline/finalize-mp3";
import { pathExists } from "$lib/download-pipeline/path-exists";
import {
	prepareDownload,
	sendTitleInfo,
} from "$lib/download-pipeline/prepare-download";
import { METADATA_PROCESSING_PERCENT } from "$lib/download-pipeline/progress-stages";
import { titleFromVideoDetails } from "$lib/download-pipeline/title-from-video-details";
import { getYTDlp } from "$lib/download-pipeline/yt-dlp-instance";
import { type MediaLinkKind, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import { resolveMediaLink } from "$lib/resolve-media-link";
import { retryWithBackoff } from "$lib/retry";
import { YT_DLP_METHOD } from "$lib/types";
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
	source: MediaLinkKind,
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
			source,
		},
		extra: { videoId },
	});
}

export const GET: RequestHandler = async ({ url }) => {
	const videoUrl = url.searchParams.get("url");

	if (!videoUrl) {
		return new Response("URL parameter required", { status: 400 });
	}

	const link = await resolveMediaLink(videoUrl);
	if (!link) {
		return new Response(UNSUPPORTED_LINK_MESSAGE, { status: 400 });
	}

	const videoId = link.id;
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
				const prepared = await prepareDownload(
					link,
					send,
					abortController.signal,
				);
				if (!prepared) {
					closeStream();
					return;
				}
				const { titleState } = prepared;

				const debugMode = url.searchParams.get("debug") === "1";
				const ytDlp = await getYTDlp();
				const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

				await retryWithBackoff(
					() =>
						prepared.runAttempt({
							outputPath,
							ffmpegPath: ffmpegInstaller.path,
							debugMode,
							ytDlp,
							signal: abortController.signal,
						}),
					{
						isRetryable: (error) =>
							isRetryableYtDlpError(
								error instanceof Error ? error.message : String(error),
								link.kind,
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
						titleFromVideoDetails(await prepared.detailsPromise),
					);
					if (titleState.videoTitle) sendTitleInfo(send, titleState);
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
					detailsPromise: prepared.detailsPromise,
					thumbnailPromise: prepared.thumbnailPromise,
					send,
					signal: abortController.signal,
					uploader: prepared.uploader,
					sourceUrl: link.canonicalUrl,
					soundCloudArtwork: prepared.soundCloudArtwork,
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
					const classified = classifyYtDlpError(rawMessage, link.kind);
					reportDownloadFailure(
						normalizedError,
						classified,
						videoId,
						link.kind,
					);
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
