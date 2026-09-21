import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import { YOUTUBE_EXTRACTOR_ARG } from "$lib/yt-dlp-binary";

/**
 * The canary's whole value is that it runs the argv real users get. This pins
 * that argv element-for-element, so moving the SoundCloud path in beside it
 * can't change a single YouTube flag unnoticed.
 */
const EXPECTED_YOUTUBE_ARGV = [
	"https://www.youtube.com/watch?v=q9lZ4p5YRkY",
	"-x",
	"--audio-format",
	"mp3",
	"--audio-quality",
	"128K",
	"-f",
	"bestaudio[protocol^=m3u8]/bestaudio[vcodec=none]/bestaudio/18/best[height<=360]/best",
	"--concurrent-fragments",
	"4",
	"--ffmpeg-location",
	"/usr/bin/ffmpeg",
	"--newline",
	"--no-playlist",
	"--no-update",
	"--js-runtimes",
	"node:/usr/bin/node",
	"--plugin-dirs",
	"/tmp/yt-dlp-plugins",
	"--extractor-args",
	YOUTUBE_EXTRACTOR_ARG,
	"--extractor-args",
	"youtubepot-bgutilhttp:base_url=http://bgutil-pot.railway.internal:4416",
	"-o",
	"/tmp/out.%(ext)s",
];

async function captureArgs(debugMode: boolean): Promise<string[]> {
	let captured: string[] = [];
	const ytDlp = {
		exec: (args: string[]) => {
			captured = args;
			return {
				on(event: string, callback: (code: number) => void) {
					if (event === "close") queueMicrotask(() => callback(0));
				},
			};
		},
	} as unknown as YtDlpInstance;

	await tryYtDlpDownload({
		videoUrl: "https://www.youtube.com/watch?v=q9lZ4p5YRkY",
		outputPath: "/tmp/out",
		bgutilPotUrl: "http://bgutil-pot.railway.internal:4416",
		ffmpegPath: "/usr/bin/ffmpeg",
		pluginDir: "/tmp/yt-dlp-plugins",
		debugMode,
		ytDlp,
		send: () => {},
	});
	return captured;
}

describe("tryYtDlpDownload() argv characterization", () => {
	it("passes exactly the production YouTube argv", async () => {
		// #when
		const args = await captureArgs(false);

		// #then
		expect(args).toEqual(EXPECTED_YOUTUBE_ARGV);
	});

	it("appends only the debug flags in debug mode", async () => {
		// #when
		const args = await captureArgs(true);

		// #then
		expect(args).toEqual([...EXPECTED_YOUTUBE_ARGV, "-v", "--list-formats"]);
	});
});
