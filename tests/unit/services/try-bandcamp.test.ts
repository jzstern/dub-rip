import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

import {
	BANDCAMP_FORMAT_SELECTOR,
	buildBandcampDownloadArgs,
} from "$lib/download-pipeline/try-bandcamp";

const INPUT = {
	videoUrl: "https://benprunty.bandcamp.com/track/lanius-battle",
	outputPath: "/tmp/out",
	ffmpegPath: "/usr/bin/ffmpeg",
	debugMode: false,
};

describe("buildBandcampDownloadArgs()", () => {
	it("builds the Bandcamp argv", () => {
		// #when
		const args = buildBandcampDownloadArgs(INPUT);

		// #then
		expect(args).toEqual([
			"https://benprunty.bandcamp.com/track/lanius-battle",
			"-x",
			"--audio-format",
			"mp3",
			"--audio-quality",
			"0",
			"-f",
			BANDCAMP_FORMAT_SELECTOR,
			"--ffmpeg-location",
			"/usr/bin/ffmpeg",
			"--newline",
			"--no-playlist",
			"--no-update",
			"--js-runtimes",
			"node:/usr/bin/node",
			"-o",
			"/tmp/out.%(ext)s",
		]);
	});

	it("never passes bgutil, PO-token or YouTube extractor args", () => {
		// #when
		const argv = buildBandcampDownloadArgs({ ...INPUT, debugMode: true }).join(
			" ",
		);

		// #then
		expect(argv).not.toMatch(
			/--plugin-dirs|--extractor-args|youtube:|youtubepot|bgutil|po_token|fetch_pot/i,
		);
	});

	it("never suppresses warnings", () => {
		// #when
		const args = buildBandcampDownloadArgs({ ...INPUT, debugMode: true });

		// #then
		expect(args).not.toContain("--no-warnings");
	});

	it("adds verbose output and the format list in debug mode", () => {
		// #when
		const args = buildBandcampDownloadArgs({ ...INPUT, debugMode: true });

		// #then
		expect(args.slice(-2)).toEqual(["-v", "--list-formats"]);
	});

	it("leaves debug flags out otherwise", () => {
		// #when
		const args = buildBandcampDownloadArgs(INPUT);

		// #then
		expect(args).not.toEqual(expect.arrayContaining(["-v"]));
	});
});

describe("BANDCAMP_FORMAT_SELECTOR", () => {
	it("prefers the free download's MP3 320, then V0, then the 128 kbps stream", () => {
		expect(BANDCAMP_FORMAT_SELECTOR).toBe(
			"mp3-320/mp3-v0/mp3-128/bestaudio[acodec=mp3]/bestaudio",
		);
	});
});
