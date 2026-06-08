import { createRequire } from "node:module";
import { json } from "@sveltejs/kit";
import { extractVideoId } from "$lib/video-utils";
import { ensureYtDlpBinary, getYtDlpBinaryPath } from "$lib/yt-dlp-binary";
import type { RequestHandler } from "./$types";

const require = createRequire(import.meta.url);

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;

let ytDlpWrap: unknown = null;
let isInitializing = false;

async function getYTDlp(): Promise<unknown> {
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
		ytDlpWrap = new YTDlpWrap(binaryPath);
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

		const binaryPath = getYtDlpBinaryPath();
		const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

		const result = await execFilePromise(
			binaryPath,
			[
				"--skip-download",
				"--no-warnings",
				"--no-playlist",
				"--print",
				"%(duration)s",
				normalizedUrl,
			],
			{ timeout: DURATION_EXTRACTION_TIMEOUT_MS },
		);

		const duration = Number.parseInt(result.stdout.trim(), 10);
		if (Number.isNaN(duration)) {
			throw new Error("Could not parse duration from yt-dlp output");
		}

		return json({
			success: true,
			duration,
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Preview details error:", message);

		return json(
			{
				error: "Failed to load details",
			},
			{ status: 500 },
		);
	}
};
