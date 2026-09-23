import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSoundCloudTrackMock, execMock, waitForBgutilPotMock } = vi.hoisted(
	() => ({
		getSoundCloudTrackMock: vi.fn(),
		execMock: vi.fn(),
		waitForBgutilPotMock: vi.fn(),
	}),
);
const mockEnv = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/soundcloud/soundcloud-track-cache", () => ({
	getSoundCloudTrack: getSoundCloudTrackMock,
}));
vi.mock("$lib/download-pipeline/yt-dlp-instance", () => ({
	getYTDlp: async () => ({ exec: execMock }),
}));
vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: () => ["--js-runtimes", "node:/usr/bin/node"],
	ensureYtDlpBinary: async () => "/tmp/yt-dlp",
	ensureBgutilPlugin: async () => "/tmp/yt-dlp-plugins",
}));
vi.mock("$lib/wait-for-bgutil-pot", () => ({
	waitForBgutilPot: waitForBgutilPotMock,
}));

import { SOUNDCLOUD_FORMAT_SELECTOR } from "$lib/download-pipeline/try-soundcloud";
import { SOUNDCLOUD_PREVIEW_ONLY_MESSAGE } from "$lib/soundcloud/soundcloud-metadata";
import {
	type SoundCloudTrack,
	SoundCloudTrackError,
} from "$lib/soundcloud/soundcloud-track";
import { GET } from "../../../src/routes/api/download-stream/+server";

const TRACK: SoundCloudTrack = {
	title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
	uploader: "MERCILESS",
	creditedArtist: "blk.",
	artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
	durationSeconds: 201,
	isPreviewOnly: false,
	isGeoBlocked: false,
};

function closingProcess() {
	return {
		on(event: string, callback: (code: number) => void) {
			if (event === "close") queueMicrotask(() => callback(0));
		},
	};
}

async function download(link: string): Promise<Record<string, unknown>[]> {
	const url = new URL(
		`http://localhost/api/download-stream?url=${encodeURIComponent(link)}`,
	);
	const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
	const body = await response.text();
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

describe("GET /api/download-stream — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		execMock.mockImplementation(() => closingProcess());
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("downloads without the bgutil-pot sidecar configured", async () => {
		// #when
		const events = await download(
			"https://soundcloud.com/mercilessbeats/i-cant-fail",
		);

		// #then
		expect(execMock).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(events)).not.toMatch(/BGUTIL_POT_URL/);
	});

	it("never waits for the bgutil-pot sidecar, even with BGUTIL_POT_URL set", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://pot.internal:4416";

		// #when
		await download("https://soundcloud.com/mercilessbeats/i-cant-fail");

		// #then
		expect(waitForBgutilPotMock).not.toHaveBeenCalled();
	});

	it("runs the SoundCloud argv against the canonical URL", async () => {
		// #when
		await download(
			"https://m.soundcloud.com/mercilessbeats/i-cant-fail?si=abc",
		);
		const args = execMock.mock.calls[0]?.[0] as string[];

		// #then
		expect(args[0]).toBe("https://soundcloud.com/mercilessbeats/i-cant-fail");
		expect(args).toContain(SOUNDCLOUD_FORMAT_SELECTOR);
		expect(args).not.toContain("--plugin-dirs");
	});

	it("sends the resolved identity as the info event", async () => {
		// #when
		const events = await download(
			"https://soundcloud.com/mercilessbeats/i-cant-fail",
		);

		// #then
		expect(events).toContainEqual({
			type: "info",
			title: TRACK.title,
			artist: "blk.",
			track: "I Cant Fail",
		});
	});

	it("refuses a Go+ preview before spawning yt-dlp", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({ ...TRACK, isPreviewOnly: true });

		// #when
		const events = await download(
			"https://soundcloud.com/mercilessbeats/i-cant-fail",
		);

		// #then
		expect(events).toContainEqual({
			type: "error",
			message: SOUNDCLOUD_PREVIEW_ONLY_MESSAGE,
		});
		expect(execMock).not.toHaveBeenCalled();
	});

	it("reports an unavailable track without spawning yt-dlp", async () => {
		// #given
		getSoundCloudTrackMock.mockRejectedValue(
			new SoundCloudTrackError("gone", true),
		);

		// #when
		const events = await download("https://soundcloud.com/mercilessbeats/gone");

		// #then
		expect(events).toContainEqual({
			type: "error",
			message: "Track not found or unavailable",
		});
		expect(execMock).not.toHaveBeenCalled();
	});
});
