import { existsSync } from "node:fs";
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
		const YTDlpWrapModule = require("yt-dlp-wrap");
		const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
		const binaryPath = join(tmpdir(), "yt-dlp");

		ytDlpWrap = new YTDlpWrap(binaryPath);

		if (!existsSync(binaryPath)) {
			await YTDlpWrap.downloadFromGithub(binaryPath);
		}

		return ytDlpWrap;
	} finally {
		isInitializing = false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const _ytDlp = await getYTDlp();

		const { exec } = require("node:child_process");
		const { promisify } = require("node:util");
		const execPromise = promisify(exec);

		const binaryPath = join(tmpdir(), "yt-dlp");

		// Check if URL is a playlist
		const isPlaylist = url.includes("list=") || url.includes("/playlist");

		let playlistInfo = null;
		let duration = null;

		if (isPlaylist) {
			// Get playlist info (limit to first 10 entries to avoid buffer overflow)
			const playlistResult = await execPromise(
				`"${binaryPath}" --cookies-from-browser chrome --flat-playlist --dump-json --no-warnings --playlist-end 10 "${url}"`,
				{ maxBuffer: 1024 * 1024 * 10 },
			);

			// Get the first video for duration
			const videoResult = await execPromise(
				`"${binaryPath}" --cookies-from-browser chrome --dump-json --no-warnings --no-playlist "${url}"`,
			);

			const videoInfo = JSON.parse(videoResult.stdout);
			duration = videoInfo.duration;

			// Parse playlist entries
			const entries = playlistResult.stdout.trim().split("\n").filter(Boolean);
			const playlistData = entries.map((line: string) => JSON.parse(line));

			const firstEntry = playlistData[0];

			playlistInfo = {
				title:
					firstEntry?.playlist_title || videoInfo.playlist_title || "Playlist",
				count:
					firstEntry?.n_entries ||
					firstEntry?.playlist_count ||
					playlistData.length,
				uploader: firstEntry?.uploader || videoInfo.uploader || "",
			};
		} else {
			const result = await execPromise(
				`"${binaryPath}" --cookies-from-browser chrome --dump-json --no-warnings "${url}"`,
			);
			const videoInfo = JSON.parse(result.stdout);
			duration = videoInfo.duration;
		}

		return json({
			success: true,
			duration,
			playlist: playlistInfo,
		});
	} catch (error: any) {
		console.error("Preview details error:", error.message);

		return json(
			{
				error: "Failed to load details",
			},
			{ status: 500 },
		);
	}
};
