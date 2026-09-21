import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TryYtDlpInput } from "$lib/download-pipeline/try-yt-dlp";

vi.mock("$env/dynamic/private", () => ({
	env: { BGUTIL_POT_URL: "http://pot.internal:4416" },
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureBgutilPlugin: vi.fn(() => Promise.resolve("/tmp/yt-dlp-plugins")),
}));

vi.mock("$lib/download-pipeline/yt-dlp-instance", () => ({
	getYTDlp: vi.fn(() => Promise.resolve({})),
}));

vi.mock("$lib/download-pipeline/path-exists", () => ({
	pathExists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("$lib/video-metadata", () => ({
	fetchThumbnailBuffer: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("$lib/video-details-cache", () => ({
	getVideoDetails: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("$lib/youtube-metadata", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/youtube-metadata")>()),
	fetchYouTubeMetadata: vi.fn(() =>
		Promise.resolve({
			videoTitle: "Daft Punk - One More Time",
			artist: "Daft Punk",
			trackTitle: "One More Time",
			uploader: "Daft Punk",
			thumbnailUrl: "https://i.ytimg.com/vi/FGBhQbmPwH8/hqdefault.jpg",
		}),
	),
}));

const { tryYtDlpDownloadMock, finalizeMp3Mock } = vi.hoisted(() => ({
	tryYtDlpDownloadMock: vi.fn<(input: TryYtDlpInput) => Promise<void>>(),
	finalizeMp3Mock: vi.fn(),
}));

vi.mock("$lib/download-pipeline/try-yt-dlp", () => ({
	tryYtDlpDownload: tryYtDlpDownloadMock,
}));

vi.mock("$lib/download-pipeline/finalize-mp3", () => ({
	finalizeMp3: finalizeMp3Mock,
}));

const TEMP_OUTPUT_PATH = "/tmp/3f9a1c7e5b2d4680a1b2c3d4e5f60718.mp3";
const FORMAT_LINE = "[info] FGBhQbmPwH8: Downloading 1 format(s): 234";

async function streamDownload(): Promise<string> {
	const { GET } = await import(
		"../../../src/routes/api/download-stream/+server"
	);
	const url = new URL("http://localhost/api/download-stream");
	url.searchParams.set("url", "https://youtube.com/watch?v=FGBhQbmPwH8");

	const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
	return response.text();
}

function parseEvents(body: string): Record<string, unknown>[] {
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}

function givenYtDlpPrintsRawOutput(): void {
	tryYtDlpDownloadMock.mockImplementation(async ({ send }) => {
		send({ type: "event", eventType: "info", eventData: FORMAT_LINE });
		send({
			type: "event",
			eventType: "ExtractAudio",
			eventData: `Destination: ${TEMP_OUTPUT_PATH}`,
		});
		send({ type: "progress", percent: 50, speed: "1MiB/s", eta: "00:05" });
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	finalizeMp3Mock.mockResolvedValue({
		filename: "audio.mp3",
		size: 1,
		token: "fake-token",
		downloadMethod: "yt-dlp",
	});
});

describe("GET /api/download-stream - raw yt-dlp output", () => {
	it("sends the browser no raw output events", async () => {
		// #given
		givenYtDlpPrintsRawOutput();

		// #when
		const events = parseEvents(await streamDownload());

		// #then
		expect(events.filter((event) => event.type === "event")).toEqual([]);
	});

	it("keeps the temp output path out of the stream", async () => {
		// #given
		givenYtDlpPrintsRawOutput();

		// #when
		const body = await streamDownload();

		// #then
		expect(body).not.toContain(TEMP_OUTPUT_PATH);
	});

	it("still relays download progress", async () => {
		// #given
		givenYtDlpPrintsRawOutput();

		// #when
		const events = parseEvents(await streamDownload());

		// #then
		expect(events).toContainEqual({
			type: "progress",
			percent: 50,
			speed: "1MiB/s",
			eta: "00:05",
		});
	});
});

describe("GET /api/download-stream - failed download", () => {
	it("shows the browser the classified message, not yt-dlp's error text", async () => {
		// #given
		tryYtDlpDownloadMock.mockRejectedValue(
			new Error(
				`ERROR: [youtube] FGBhQbmPwH8: This video is private (${TEMP_OUTPUT_PATH})`,
			),
		);

		// #when
		const body = await streamDownload();

		// #then
		expect(body).not.toContain(TEMP_OUTPUT_PATH);
	});
});
