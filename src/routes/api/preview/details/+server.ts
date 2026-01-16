import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json } from "@sveltejs/kit";
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

		const videoId = extractVideoId(url);
		if (!videoId) {
			return json({ error: "Invalid YouTube URL" }, { status: 400 });
		}

		const _ytDlp = await getYTDlp();

		const { execFile } = require("node:child_process");
		const { promisify } = require("node:util");
		const execFilePromise = promisify(execFile);

		const binaryPath = join(tmpdir(), "yt-dlp");

		const result = await execFilePromise(binaryPath, [
			"--cookies-from-browser",
			"chrome",
			"--dump-json",
			"--no-warnings",
			url,
		]);
		const videoInfo = JSON.parse(result.stdout);

		return json({
			success: true,
			duration: videoInfo.duration,
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
