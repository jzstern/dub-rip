import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractVideoId } from "$lib/video-utils";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

let ytDlpWrap: any = null;
let isInitializing = false;

async function getYTDlp() {
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

function parseArtistAndTitle(videoTitle: string) {
	// Common patterns: "Artist - Title", "Artist: Title", "Artist | Title"
	const patterns = [
		/^(.+?)\s*[-–—]\s*(.+)$/, // Artist - Title
		/^(.+?)\s*:\s*(.+)$/, // Artist: Title
		/^(.+?)\s*\|\s*(.+)$/, // Artist | Title
	];

	for (const pattern of patterns) {
		const match = videoTitle.match(pattern);
		if (match) {
			const artist = match[1].trim();
			let title = match[2].trim();

			// Remove common suffixes from title
			title = title.replace(/\s*\((?:Official\s+)?(?:Music\s+)?Video\)/gi, "");
			title = title.replace(
				/\s*\((?:Official\s+)?(?:Audio|Lyric(?:s)?)\)/gi,
				"",
			);
			title = title.replace(/\s*\[(?:Official\s+)?(?:Music\s+)?Video\]/gi, "");

			return { artist, title };
		}
	}

	// If no pattern matches, return title as-is with no artist
	return { artist: "", title: videoTitle };
}

export const GET: RequestHandler = async ({ url }) => {
	const videoUrl = url.searchParams.get("url");
	const downloadPlaylist = url.searchParams.get("playlist") === "true";

	if (!videoUrl) {
		return new Response("URL parameter required", { status: 400 });
	}

	// Validate URL to prevent command injection
	const videoId = extractVideoId(videoUrl);
	if (!videoId && !videoUrl.includes("list=")) {
		return new Response("Invalid YouTube URL", { status: 400 });
	}

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			let isClosed = false;

			const send = (data: any) => {
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
				send({ type: "status", message: "Initializing..." });

				const ytDlp = await getYTDlp();
				send({ type: "status", message: "Getting video info..." });

				// Get video info first to extract title
				// Using execFile with array arguments prevents command injection
				const { execFile } = require("node:child_process");
				const { promisify } = require("node:util");
				const execFilePromise = promisify(execFile);
				const binaryPath = join(tmpdir(), "yt-dlp");

				let videoTitle = "";
				let artist = "";
				let trackTitle = "";

				try {
					const result = await execFilePromise(
						binaryPath,
						[
							"--cookies-from-browser",
							"chrome",
							"--print",
							"%(title)s",
							"--no-warnings",
							videoUrl,
						],
						{ timeout: 30000 },
					);
					videoTitle = result.stdout.trim();
					console.log("Got video title from yt-dlp:", videoTitle);

					const parsed = parseArtistAndTitle(videoTitle);
					artist = parsed.artist;
					trackTitle = parsed.title;
					console.log("Parsed - Artist:", artist, "Title:", trackTitle);

					send({
						type: "info",
						title: videoTitle,
						artist: artist,
						track: trackTitle,
					});
				} catch (err) {
					console.error("Failed to get video title:", err);
					// Continue anyway, we'll try to extract from events
				}

				send({ type: "status", message: "Starting download..." });

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
					"--cookies-from-browser",
					"chrome",
					"--ffmpeg-location",
					ffmpegInstaller.path,
					"--newline",
					"--no-warnings",
					"--parse-metadata",
					"%(title)s:%(meta_title)s",
					"--parse-metadata",
					"%(artist)s:%(meta_artist)s",
				];

				// Add --no-playlist flag if not downloading entire playlist
				if (!downloadPlaylist) {
					args.push("--no-playlist");
				}

				args.push("-o", `${outputPath}.%(ext)s`);

				const downloadProcess = ytDlp.exec(args);

				downloadProcess.on("progress", (progress: any) => {
					send({
						type: "progress",
						percent: progress.percent || 0,
						speed: progress.currentSpeed || "",
						eta: progress.eta || "",
					});
				});

				downloadProcess.on(
					"ytDlpEvent",
					(eventType: string, eventData: string) => {
						console.log("yt-dlp event:", eventType, "|", eventData);

						// Extract title from destination event or other events
						if (!videoTitle) {
							// Try Destination event
							if (eventType === "Destination") {
								const match = eventData.match(/\/([^/]+)\.\w+$/);
								if (match) {
									videoTitle = match[1].replace(/_/g, " ");
									console.log(
										"Extracted videoTitle from Destination:",
										videoTitle,
									);
								}
							}
							// Also try to extract from the output filename
							else if (
								eventData.includes(".mp3") ||
								eventData.includes(".webm")
							) {
								const match = eventData.match(/([^/]+)\.\w+/);
								if (match) {
									videoTitle = match[1].replace(/_/g, " ");
									console.log(
										"Extracted videoTitle from event data:",
										videoTitle,
									);
								}
							}

							if (videoTitle) {
								const parsed = parseArtistAndTitle(videoTitle);
								artist = parsed.artist;
								trackTitle = parsed.title;
								console.log("Parsed - Artist:", artist, "Title:", trackTitle);
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

				const actualFilePath = `${outputPath}.mp3`;

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

				// Use node-id3 to set proper metadata
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
					// Continue with original file if metadata processing fails
				}

				send({ type: "status", message: "Preparing download..." });

				const fs = await import("node:fs/promises");
				const stats = await fs.stat(actualFilePath);
				const fileContent = await fs.readFile(actualFilePath);

				// Format filename as "Artist - Title.mp3"
				let finalFilename;
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
				});

				// Clean up
				try {
					unlinkSync(actualFilePath);
				} catch {}

				closeStream();
			} catch (error: any) {
				console.error("Download error:", error);
				send({ type: "error", message: error.message || "Unknown error" });
				closeStream();

				// Clean up
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
