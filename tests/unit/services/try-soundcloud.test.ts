import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

import {
	buildSoundCloudDownloadArgs,
	SOUNDCLOUD_FORMAT_SELECTOR,
} from "$lib/download-pipeline/try-soundcloud";

describe("buildSoundCloudDownloadArgs()", () => {
	it("builds the SoundCloud argv with no bgutil or YouTube extractor args", () => {
		// #when
		const args = buildSoundCloudDownloadArgs({
			videoUrl: "https://soundcloud.com/billieeilish/bad-guy",
			outputPath: "/tmp/out",
			ffmpegPath: "/usr/bin/ffmpeg",
			debugMode: false,
		});

		// #then
		expect(args).toEqual([
			"https://soundcloud.com/billieeilish/bad-guy",
			"-x",
			"--audio-format",
			"mp3",
			"--audio-quality",
			"128K",
			"-f",
			SOUNDCLOUD_FORMAT_SELECTOR,
			"--concurrent-fragments",
			"4",
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

	it("prefers MP3 and refuses Go+ preview snippets", () => {
		expect(SOUNDCLOUD_FORMAT_SELECTOR).toBe(
			"bestaudio[acodec=mp3][format_id!*=preview]/bestaudio[format_id!*=preview]",
		);
	});
});
