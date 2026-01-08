import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json } from "@sveltejs/kit";
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
		// Use require for CommonJS module
		const YTDlpWrapModule = require("yt-dlp-wrap");
		const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
		const binaryPath = join(tmpdir(), "yt-dlp");

		ytDlpWrap = new YTDlpWrap(binaryPath);

		if (!existsSync(binaryPath)) {
			console.log("Downloading yt-dlp binary...");
			await YTDlpWrap.downloadFromGithub(binaryPath);
		}

		return ytDlpWrap;
	} catch (err) {
		console.error("Error initializing yt-dlp:", err);
		throw err;
	} finally {
		isInitializing = false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const randomId = randomBytes(16).toString("hex");
	const outputPath = join(tmpdir(), `${randomId}`);

	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: "YouTube URL is required" }, { status: 400 });
		}

		console.log("Processing URL:", url);

		// Get or initialize yt-dlp
		const ytDlp = await getYTDlp();
		console.log("yt-dlp initialized");

		// Get video info first
		let videoInfo;
		try {
			videoInfo = await ytDlp.getVideoInfo(url);
			console.log("Video info retrieved:", videoInfo.title);
		} catch (err) {
			console.error("Failed to get video info:", err);
			return json(
				{ error: "Invalid YouTube URL or video not available" },
				{ status: 400 },
			);
		}

		// Download with best audio quality and embed metadata
		console.log("Starting download...");
		try {
			// Use require for ffmpeg
			const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
			console.log("ffmpeg path:", ffmpegInstaller.path);

			const downloadProcess = ytDlp.exec([
				url,
				"-x", // Extract audio
				"--audio-format",
				"mp3",
				"--audio-quality",
				"0", // Best quality
				"--embed-thumbnail", // Embed artwork
				"--add-metadata", // Add metadata
				"--cookies-from-browser",
				"chrome", // Use Chrome cookies to bypass bot detection
				"--ffmpeg-location",
				ffmpegInstaller.path,
				"--newline", // Output progress on new lines
				"--no-warnings",
				"-o",
				`${outputPath}.%(ext)s`,
			]);

			downloadProcess.on("progress", (progress: { percent: number; currentSpeed: string; eta: string }) => {
				console.log(
					"Download progress:",
					`${progress.percent}%`,
					progress.currentSpeed,
					progress.eta,
				);
			});

			downloadProcess.on("ytDlpEvent", (eventType: string, eventData: string) => {
				console.log("yt-dlp event:", eventType, eventData);
			});

			downloadProcess.on("error", (error: Error) => {
				console.error("Download process error:", error);
			});

			downloadProcess.on("close", () => {
				console.log("Download process closed");
			});

			// Wait for download to complete
			await new Promise((resolve, reject) => {
				downloadProcess.on("close", resolve);
				downloadProcess.on("error", reject);
			});

			console.log("Download completed successfully");
		} catch (err: any) {
			console.error("Download failed:", err);
			console.error("Error stack:", err.stack);
			return json(
				{ error: `Failed to download and process audio: ${err.message}` },
				{ status: 500 },
			);
		}

		// The actual filename after download
		const actualFilePath = `${outputPath}.mp3`;

		// Check if file exists
		if (!existsSync(actualFilePath)) {
			console.error("File not found after download:", actualFilePath);
			return json(
				{ error: "Download completed but file not found" },
				{ status: 500 },
			);
		}

		// Get file size for Content-Length header
		const fs = await import("node:fs/promises");
		const stats = await fs.stat(actualFilePath);
		console.log("File ready:", actualFilePath, "Size:", stats.size);

		// Create readable stream
		const fileStream = createReadStream(actualFilePath);

		// Clean up file after streaming
		fileStream.on("end", () => {
			try {
				unlinkSync(actualFilePath);
				console.log("Cleaned up temp file");
			} catch (err) {
				console.error("Error deleting temp file:", err);
			}
		});

		fileStream.on("error", (err) => {
			console.error("Stream error:", err);
			try {
				unlinkSync(actualFilePath);
			} catch {}
		});

		// Generate a safe filename from the video title
		const safeTitle = videoInfo.title
			.replace(/[^a-z0-9]/gi, "_")
			.replace(/_+/g, "_")
			.toLowerCase();

		return new Response(fileStream as any, {
			headers: {
				"Content-Type": "audio/mpeg",
				"Content-Length": stats.size.toString(),
				"Content-Disposition": `attachment; filename="${safeTitle}.mp3"`,
			},
		});
	} catch (error) {
		console.error("Unexpected error:", error);

		// Clean up any partial files
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		return json(
			{ error: `Failed to download audio: ${errorMessage}` },
			{ status: 500 },
		);
	}
};
