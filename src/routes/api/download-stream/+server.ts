import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";
import {
	type CoverArtResult,
	fetchCoverArt,
	fetchThumbnailArt,
	lookupTrack,
	type TrackMetadata,
} from "$lib/musicbrainz";
import type { DownloadMethod } from "$lib/types";
import {
	extractVideoId,
	formatBytes,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureYtDlpBinary } from "$lib/yt-dlp-binary";
import { fetchPoToken } from "$lib/yt-token";
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

function parseYtDlpError(errorMessage: string): string {
	const lowerMessage = errorMessage.toLowerCase();
	if (
		lowerMessage.includes("sign in to confirm you're not a bot") ||
		lowerMessage.includes("cookies")
	) {
		return "This video requires authentication. Please try a different video or try again later.";
	}
	if (lowerMessage.includes("video unavailable")) {
		return "This video is unavailable or private.";
	}
	if (
		lowerMessage.includes("age-restricted") ||
		lowerMessage.includes("confirm your age") ||
		lowerMessage.includes("verify your age")
	) {
		return "This video is age-restricted and cannot be downloaded.";
	}
	if (lowerMessage.includes("copyright")) {
		return "This video is blocked due to copyright restrictions.";
	}
	if (lowerMessage.includes("private")) {
		return "This video is private and cannot be downloaded.";
	}
	return "Download failed. Please try a different video.";
}

interface EnrichmentResult {
	metadata: TrackMetadata | null;
	artwork: CoverArtResult | null;
}

async function enrichMetadata(
	artist: string,
	title: string,
	videoId: string,
): Promise<EnrichmentResult> {
	try {
		const metadata = await lookupTrack(artist, title);

		let artwork: CoverArtResult | null = null;
		if (metadata?.releaseId) {
			artwork = await fetchCoverArt(metadata.releaseId);
		}
		if (!artwork) {
			artwork = await fetchThumbnailArt(videoId);
		}

		return { metadata, artwork };
	} catch (err) {
		console.error("MusicBrainz enrichment failed:", err);
		return { metadata: null, artwork: null };
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

				let enrichmentPromise: Promise<EnrichmentResult> = Promise.resolve({
					metadata: null,
					artwork: null,
				});

				if (artist && trackTitle) {
					enrichmentPromise = enrichMetadata(artist, trackTitle, videoId);
				} else if (videoId) {
					enrichmentPromise = enrichMetadata("", "", videoId);
				}

				let actualFilePath = `${outputPath}.mp3`;
				let downloadMethod: DownloadMethod = "yt-dlp";
				let cobaltFailed = false;

				send({ type: "status", message: "Trying fast download..." });

				try {
					const downloadUrl = await requestCobaltAudio(videoUrl, 20000);
					console.log("[Cobalt] Got download URL");

					send({ type: "progress", percent: 5 });

					const audioBuffer = await fetchCobaltAudio(
						downloadUrl,
						55000,
						(p) => {
							if (p.totalBytes) {
								send({
									type: "progress",
									percent: Math.round(5 + (p.percent / 100) * 70),
								});
							} else {
								const pseudo = Math.min(
									70,
									Math.log10(1 + p.bytesReceived) * 10,
								);
								send({
									type: "progress",
									percent: Math.round(5 + pseudo),
								});
								send({
									type: "status",
									message: `Downloading... (${formatBytes(p.bytesReceived)})`,
								});
							}
						},
					);
					console.log(
						"[Cobalt] Downloaded audio, size:",
						audioBuffer.byteLength,
					);

					if (audioBuffer.byteLength === 0) {
						throw new CobaltError(
							"Cobalt returned empty content (video may be blocked)",
						);
					}

					send({ type: "progress", percent: 75 });

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
						const errMsg = err instanceof Error ? err.message : "Unknown error";
						console.log("[Cobalt] Failed, falling back to yt-dlp:", errMsg);
					}
				}

				if (cobaltFailed) {
					send({ type: "status", message: "Starting download..." });

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
						"--no-playlist",
						"-o",
						`${outputPath}.%(ext)s`,
					];

					const tokenResult = await fetchPoToken();
					if (tokenResult) {
						const safeTokenChars = /^[A-Za-z0-9._\-+/=%]+$/;
						if (
							safeTokenChars.test(tokenResult.poToken) &&
							safeTokenChars.test(tokenResult.visitorData)
						) {
							args.push(
								"--extractor-args",
								`youtube:po_token=web+${tokenResult.poToken};visitor_data=${tokenResult.visitorData}`,
							);
						} else {
							console.warn(
								"[yt-token] Token contained unexpected characters, skipping",
							);
						}
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

									if (artist && trackTitle) {
										enrichmentPromise = enrichMetadata(
											artist,
											trackTitle,
											videoId,
										);
									}
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
						send({ type: "error", message: parseYtDlpError(error.message) });
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

				const enrichment = await enrichmentPromise;

				if (enrichment.metadata) {
					send({
						type: "metadata",
						metadata: {
							album: enrichment.metadata.album,
							year: enrichment.metadata.year,
							genre: enrichment.metadata.genre,
							trackNumber: enrichment.metadata.trackNumber,
							label: enrichment.metadata.label,
							hasArtwork: enrichment.artwork !== null,
						},
					});
				}

				const NodeID3 = require("node-id3");

				try {
					const tags: Record<string, unknown> = {
						title: trackTitle || videoTitle,
						artist: artist || "Unknown Artist",
						albumArtist: artist || "Unknown Artist",
					};

					if (enrichment.metadata) {
						if (enrichment.metadata.album)
							tags.album = enrichment.metadata.album;
						if (enrichment.metadata.year) tags.year = enrichment.metadata.year;
						if (enrichment.metadata.genre)
							tags.genre = enrichment.metadata.genre;
						if (enrichment.metadata.trackNumber)
							tags.trackNumber = enrichment.metadata.trackNumber;
						if (enrichment.metadata.label)
							tags.publisher = enrichment.metadata.label;
					}

					if (enrichment.artwork) {
						tags.image = {
							mime: enrichment.artwork.mime,
							type: { id: 3, name: "front cover" },
							description: "Cover",
							imageBuffer: enrichment.artwork.imageBuffer,
						};
					}

					console.log("Writing ID3 tags:", {
						...tags,
						image: tags.image ? "(artwork included)" : undefined,
					});
					const success = NodeID3.write(tags, actualFilePath);
					if (success !== true) {
						const error =
							success instanceof Error
								? success
								: new Error("NodeID3.write returned non-true value");
						console.error("ID3 write failed:", error);
						Sentry.captureException(error, {
							tags: { service: "download-stream", operation: "id3-write" },
							extra: { videoId, tags },
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
				const stats = await fs.stat(actualFilePath);

				send({ type: "progress", percent: 88 });

				const fileContent = await fs.readFile(actualFilePath);
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
					data: base64Data,
					downloadMethod,
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
