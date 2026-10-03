import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getBandcampTrackMock,
	execMock,
	waitForBgutilPotMock,
	finalizeMp3Mock,
} = vi.hoisted(() => ({
	getBandcampTrackMock: vi.fn(),
	execMock: vi.fn(),
	waitForBgutilPotMock: vi.fn(),
	finalizeMp3Mock: vi.fn(),
}));
const mockEnv = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/bandcamp/bandcamp-track-cache", () => ({
	getBandcampTrack: getBandcampTrackMock,
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
vi.mock("$lib/download-pipeline/path-exists", () => ({
	pathExists: vi.fn(async () => true),
}));
vi.mock("$lib/download-pipeline/finalize-mp3", () => ({
	finalizeMp3: finalizeMp3Mock,
}));

import { BANDCAMP_NOT_STREAMABLE_MESSAGE } from "$lib/bandcamp/bandcamp-metadata";
import {
	BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
	type BandcampTrack,
	BandcampTrackError,
} from "$lib/bandcamp/bandcamp-track";
import { buildBandcampDownloadArgs } from "$lib/download-pipeline/try-bandcamp";
import { GET } from "../../../src/routes/api/download-stream/+server";

const TRACK_URL = "https://benprunty.bandcamp.com/track/lanius-battle";

const TRACK: BandcampTrack = {
	title: "Lanius (Battle)",
	artist: "Ben Prunty",
	bandName: "Ben Prunty",
	albumTitle: "FTL: Advanced Edition Soundtrack",
	releaseDate: "2014-04-03T00:00:00.000Z",
	durationSeconds: 261,
	artworkUrl: "https://f4.bcbits.com/img/a1270682128_16.jpg",
	isStreamable: true,
	hasFreeDownload: false,
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

function spawnedArgs(): string[] {
	return execMock.mock.calls[0]?.[0] as string[];
}

describe("GET /api/download-stream — Bandcamp", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		execMock.mockImplementation(() => closingProcess());
		getBandcampTrackMock.mockResolvedValue(TRACK);
		finalizeMp3Mock.mockResolvedValue({
			filename: "Ben Prunty - Lanius (Battle).mp3",
			size: 1,
			token: "fake-token",
			downloadMethod: "yt-dlp",
		});
	});

	it("completes without the bgutil-pot sidecar configured", async () => {
		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(events).toContainEqual(
			expect.objectContaining({ type: "complete" }),
		);
	});

	it("never mentions BGUTIL_POT_URL when it is unset", async () => {
		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(JSON.stringify(events)).not.toMatch(/BGUTIL_POT_URL/);
	});

	it("never waits for the bgutil-pot sidecar, even with BGUTIL_POT_URL set", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://pot.internal:4416";

		// #when
		await download(TRACK_URL);

		// #then
		expect(waitForBgutilPotMock).not.toHaveBeenCalled();
	});

	it("runs exactly the Bandcamp builder's argv against the canonical URL", async () => {
		// #when
		await download(
			"https://BenPrunty.bandcamp.com/track/lanius-battle?from=embed",
		);
		const args = spawnedArgs();
		const outputPath = args[args.indexOf("-o") + 1]?.replace(
			/\.%\(ext\)s$/,
			"",
		);

		// #then
		expect(args).toEqual(
			buildBandcampDownloadArgs({
				videoUrl: TRACK_URL,
				outputPath: outputPath ?? "",
				ffmpegPath: args[args.indexOf("--ffmpeg-location") + 1] ?? "",
				debugMode: false,
			}),
		);
	});

	it("passes no bgutil plugin dir to yt-dlp", async () => {
		// #when
		await download(TRACK_URL);

		// #then
		expect(spawnedArgs()).not.toContain("--plugin-dirs");
	});

	it("sends the resolved identity as the info event", async () => {
		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(events).toContainEqual({
			type: "info",
			title: "Lanius (Battle)",
			artist: "Ben Prunty",
			track: "Lanius (Battle)",
		});
	});

	it("keeps the usual status copy for a free download", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({ ...TRACK, hasFreeDownload: true });

		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(events).toContainEqual({
			type: "status",
			message: "Starting download...",
		});
	});

	it("refuses a custom-domain artist without spawning yt-dlp", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("redirect", false, BANDCAMP_CUSTOM_DOMAIN_MESSAGE),
		);

		// #when
		const events = await download(TRACK_URL);

		// #then
		expect({
			refused: events.some(
				(event) =>
					event.type === "error" &&
					event.message === BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
			),
			spawned: execMock.mock.calls.length > 0,
		}).toEqual({ refused: true, spawned: false });
	});

	it("hands finalizeMp3 the track's own artwork tagged as bandcamp", async () => {
		// #when
		await download(TRACK_URL);

		// #then
		expect(finalizeMp3Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				platformArtwork: { source: "bandcamp", artworkUrl: TRACK.artworkUrl },
				uploader: "Ben Prunty",
				sourceUrl: TRACK_URL,
			}),
		);
	});

	it("hands finalizeMp3 the Bandcamp details", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({
			...TRACK,
			bandName: "Hyperdub",
			isrc: "USA2P1412345",
		});

		// #when
		await download(TRACK_URL);
		const { detailsPromise } = finalizeMp3Mock.mock.calls[0]?.[0] ?? {};

		// #then
		expect(await detailsPromise).toEqual({
			year: 2014,
			album: "FTL: Advanced Edition Soundtrack",
			duration: 261,
			label: "Hyperdub",
			isrc: "USA2P1412345",
		});
	});

	it("refuses a track with streaming turned off before spawning yt-dlp", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({ ...TRACK, isStreamable: false });

		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(events).toContainEqual({
			type: "error",
			message: BANDCAMP_NOT_STREAMABLE_MESSAGE,
		});
		expect(execMock).not.toHaveBeenCalled();
	});

	it("reports an unavailable track without spawning yt-dlp", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("gone", true),
		);

		// #when
		const events = await download(TRACK_URL);

		// #then
		expect(events).toContainEqual({
			type: "error",
			message: "Track not found or unavailable",
		});
		expect(execMock).not.toHaveBeenCalled();
	});

	it("still downloads when the track page couldn't be read", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("Failed to load track info"),
		);

		// #when
		await download(TRACK_URL);

		// #then
		expect(execMock).toHaveBeenCalledTimes(1);
	});
});
