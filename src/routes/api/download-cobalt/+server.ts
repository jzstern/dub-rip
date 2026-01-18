import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";
import {
	extractVideoId,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import { ensureYtDlpBinary } from "$lib/yt-dlp-binary";
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
				send({ type: "status", message: "Initializing..." });

				const binaryPath = await ensureYtDlpBinary();
				send({ type: "status", message: "Getting video info..." });

				const { execFile } = require("node:child_process");
				const { promisify } = require("node:util");
				const execFilePromise = promisify(execFile);

				let videoTitle = "";
				let artist = "";
				let trackTitle = "";
				let uploader = "";

				try {
					const result = await execFilePromise(
						binaryPath,
						["--print", "%(title)s\n%(uploader)s", "--no-warnings", videoUrl],
						{ timeout: 15000 },
					);
					const lines = result.stdout.trim().split("\n");
					videoTitle = lines[0] || "";
					uploader = lines[1] || "";
					console.log("[Cobalt] Got video title:", videoTitle);
					console.log("[Cobalt] Got uploader:", uploader);

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
				} catch (err) {
					console.error("[Cobalt] Failed to get video metadata:", err);
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
					const tags = {
						title: trackTitle || videoTitle,
						artist: artist || "Unknown Artist",
						albumArtist: artist || "Unknown Artist",
					};

					console.log("[Cobalt] Writing ID3 tags:", tags);
					NodeID3.write(tags, outputPath);
				} catch (err) {
					console.error("[Cobalt] Metadata processing error:", err);
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
