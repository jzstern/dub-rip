import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";
import type { DownloadMethod } from "$lib/types";
import {
	extractVideoId,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

let ytDlpWrap: ReturnType<typeof Object> | null = null;
let isInitializing = false;

async function getYTDlp(): Promise<ReturnType<typeof Object>> {
	if (ytDlpWrap) return ytDlpWrap;

	while (isInitializing) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	if (ytDlpWrap) return ytDlpWrap;

	isInitializing = true;
	try {
		const YTDlpWrapModule = require("yt-dlp-wrap");
		const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
		const binaryPath = join(tmpdir(), "yt-dlp");

		ytDlpWrap = new YTDlpWrap(binaryPath);

		if (!existsSync(binaryPath)) {
			console.log("Downloading yt-dlp binary...");
			await YTDlpWrap.downloadFromGithub(binaryPath);
		}

		return ytDlpWrap;
	} finally {
		isInitializing = false;
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const videoUrl = url.searchParams.get("url");
	const downloadPlaylist = url.searchParams.get("playlist") === "true";

	if (!videoUrl) {
		return new Response("URL parameter required", { status: 400 });
	}

	const videoId = extractVideoId(videoUrl);
	if (!videoId && !videoUrl.includes("list=")) {
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
							if (err.isNotFound) {
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
				let cobaltFailed = false;

				if (!downloadPlaylist) {
					send({ type: "status", message: "Starting download..." });

					try {
						const downloadUrl = await requestCobaltAudio(videoUrl, 20000);
						console.log("[Cobalt] Got download URL");

						send({ type: "progress", percent: 10 });

						const audioBuffer = await fetchCobaltAudio(downloadUrl, 55000);
						console.log(
							"[Cobalt] Downloaded audio, size:",
							audioBuffer.byteLength,
						);

						send({ type: "progress", percent: 80 });

						writeFileSync(actualFilePath, Buffer.from(audioBuffer));
						downloadMethod = "cobalt";
						console.log("[Cobalt] Download successful");
					} catch (err) {
						cobaltFailed = true;
						if (err instanceof CobaltError) {
							console.log(
								"[Cobalt] Failed, falling back to yt-dlp:",
								err.message,
							);
						} else {
							const errMsg =
								err instanceof Error ? err.message : "Unknown error";
							console.log("[Cobalt] Failed, falling back to yt-dlp:", errMsg);
						}
					}
				}

				if (downloadPlaylist || cobaltFailed) {
					send({ type: "status", message: "Downloading with yt-dlp..." });

					const ytDlp = await getYTDlp();
					const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

					const args = [
						videoUrl,
						"-x",
						"--audio-format",
						"mp3",
						"--audio-quality",
						"0",
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
					];

					if (!downloadPlaylist) {
						args.push("--no-playlist");
					}

					args.push("-o", `${outputPath}.%(ext)s`);

					const downloadProcess = ytDlp.exec(args);

					downloadProcess.on(
						"progress",
						(progress: Record<string, unknown>) => {
							send({
								type: "progress",
								percent: (progress.percent as number) || 0,
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
						send({ type: "error", message: error.message });
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

				send({ type: "status", message: "Processing metadata..." });

				const NodeID3 = require("node-id3");

				try {
					const tags = {
						title: trackTitle || videoTitle,
						artist: artist || "Unknown Artist",
						albumArtist: artist || "Unknown Artist",
					};

					console.log("Writing ID3 tags:", tags);

					const success = NodeID3.write(tags, actualFilePath);
					console.log("ID3 write success:", success);
				} catch (err) {
					console.error("Metadata processing error:", err);
				}

				send({ type: "status", message: "Preparing download..." });

				const fs = await import("node:fs/promises");
				const stats = await fs.stat(actualFilePath);
				const fileContent = await fs.readFile(actualFilePath);

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

				console.log("Final filename:", finalFilename);

				send({
					type: "complete",
					filename: finalFilename,
					size: stats.size,
					data: Buffer.from(fileContent).toString("base64"),
					downloadMethod,
				});

				try {
					unlinkSync(actualFilePath);
				} catch {}

				closeStream();
			} catch (error: unknown) {
				console.error("Download error:", error);
				const message =
					error instanceof Error ? error.message : "Unknown error";
				send({ type: "error", message });
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
