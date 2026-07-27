import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { json } from "@sveltejs/kit";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";
import {
	buildBgutilPotArgs,
	buildJsRuntimeArgs,
	ensureYtDlpBinary,
} from "$lib/yt-dlp-binary";
import type { RequestHandler } from "./$types";

const execFilePromise = promisify(execFile);

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;

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

		const binaryPath = await ensureYtDlpBinary();
		const normalizedUrl = buildWatchUrl(videoId);

		const result = await execFilePromise(
			binaryPath,
			[
				"--skip-download",
				"--no-warnings",
				"--no-playlist",
				"--print",
				"%(duration)s",
				...buildJsRuntimeArgs(),
				...(await buildBgutilPotArgs()),
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
