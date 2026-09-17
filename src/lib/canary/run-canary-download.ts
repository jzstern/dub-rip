import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "$env/dynamic/private";
import { cleanupTempFiles } from "$lib/download-pipeline/cleanup-temp-files";
import { pathExists } from "$lib/download-pipeline/path-exists";
import { tryYtDlpDownload } from "$lib/download-pipeline/try-yt-dlp";
import { getYTDlp } from "$lib/download-pipeline/yt-dlp-instance";
import { ensureBgutilPlugin } from "$lib/yt-dlp-binary";
import { YtDlpQueueFullError } from "$lib/yt-dlp-concurrency";
import {
	buildQueueFullClassification,
	type CanaryClassification,
	classifyCanaryRun,
} from "./classify-canary-run";

const require = createRequire(import.meta.url);

/** "Me at the zoo" — the first YouTube video, 19s, always public and unlisted-safe to hit on a schedule. */
export const CANARY_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

function elapsedMs(start: number): number {
	return Math.round(performance.now() - start);
}

/**
 * Runs one real download through the exact argv production users get
 * (`tryYtDlpDownload`, unmodified) and classifies the outcome. Never
 * registers a download token and never calls `finalizeMp3` — the file this
 * produces is discarded, not served.
 */
export async function runCanaryDownload(): Promise<CanaryClassification> {
	const start = performance.now();
	const randomId = `canary-${randomBytes(16).toString("hex")}`;
	const tempDir = tmpdir();
	const outputPath = join(tempDir, randomId);
	const bgutilPotUrl = env.BGUTIL_POT_URL;

	if (!bgutilPotUrl) {
		// Reported by the caller's check-in, not here — a second Sentry call for
		// the same incident would double the alert.
		return {
			stage: "unknown",
			itag: null,
			durationMs: elapsedMs(start),
			detail: "BGUTIL_POT_URL is not set",
		};
	}

	let stdout = "";
	const collectStdout = (data: Record<string, unknown>): void => {
		if (data.type === "event") {
			stdout += `[${String(data.eventType)}]${String(data.eventData)}\n`;
		}
	};

	try {
		const [ytDlp, pluginDir] = await Promise.all([
			getYTDlp(),
			ensureBgutilPlugin(),
		]);
		const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

		await tryYtDlpDownload({
			videoUrl: CANARY_VIDEO_URL,
			outputPath,
			bgutilPotUrl,
			ffmpegPath: ffmpegInstaller.path,
			pluginDir,
			debugMode: false,
			ytDlp,
			titleState: { videoTitle: "", artist: "", trackTitle: "", uploader: "" },
			send: collectStdout,
		});

		const succeeded = await pathExists(`${outputPath}.mp3`);
		return classifyCanaryRun({
			succeeded,
			stdout,
			stderr: "",
			durationMs: elapsedMs(start),
		});
	} catch (err) {
		if (err instanceof YtDlpQueueFullError) {
			return buildQueueFullClassification(elapsedMs(start));
		}
		const stderr = err instanceof Error ? err.message : String(err);
		return classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: elapsedMs(start),
		});
	} finally {
		await cleanupTempFiles({
			tempDir,
			prefix: randomId,
			tags: { service: "canary" },
		});
	}
}
