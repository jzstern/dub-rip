import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoDetails } from "$lib/video-metadata";

vi.mock("$env/dynamic/private", () => ({
	env: { BGUTIL_POT_URL: "http://pot.internal:4416" },
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureBgutilPlugin: vi.fn(() => Promise.resolve("/tmp/yt-dlp-plugins")),
}));

// The route pings the bgutil-pot sidecar before it starts yt-dlp; behavior is
// covered in download-stream-sidecar-wait.test.ts, and nothing here should
// depend on a sidecar being reachable.
vi.mock("$lib/wait-for-bgutil-pot", () => ({
	waitForBgutilPot: async () => ({ awake: true, attempts: 1, waitedMs: 0 }),
}));

vi.mock("$lib/download-pipeline/yt-dlp-instance", () => ({
	getYTDlp: vi.fn(() => Promise.resolve({})),
}));

vi.mock("$lib/download-pipeline/try-yt-dlp", () => ({
	tryYtDlpDownload: vi.fn(() => Promise.resolve()),
}));

vi.mock("$lib/download-pipeline/path-exists", () => ({
	pathExists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("$lib/video-metadata", () => ({
	fetchThumbnailBuffer: vi.fn(() => Promise.resolve(null)),
}));

const { getVideoDetailsMock, fetchYouTubeMetadataMock, finalizeMp3Mock } =
	vi.hoisted(() => ({
		getVideoDetailsMock: vi.fn<() => Promise<VideoDetails | null>>(),
		fetchYouTubeMetadataMock: vi.fn(),
		finalizeMp3Mock: vi.fn(),
	}));

vi.mock("$lib/video-details-cache", () => ({
	getVideoDetails: getVideoDetailsMock,
}));

vi.mock("$lib/youtube-metadata", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/youtube-metadata")>()),
	fetchYouTubeMetadata: fetchYouTubeMetadataMock,
}));

vi.mock("$lib/download-pipeline/finalize-mp3", () => ({
	finalizeMp3: finalizeMp3Mock,
}));

import { YouTubeMetadataError } from "$lib/youtube-metadata";

const VIDEO_TITLE = "Daft Punk - One More Time (Official Video)";

async function runDownload(): Promise<Record<string, unknown>[]> {
	const { GET } = await import(
		"../../../src/routes/api/download-stream/+server"
	);
	const url = new URL("http://localhost/api/download-stream");
	url.searchParams.set("url", "https://youtube.com/watch?v=FGBhQbmPwH8");

	const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
	const body = await response.text();
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
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

describe("GET /api/download-stream - title when oEmbed fails", () => {
	beforeEach(() => {
		fetchYouTubeMetadataMock.mockRejectedValue(
			new YouTubeMetadataError("oEmbed request failed: 503"),
		);
	});

	it("tags and names the file from the yt-dlp extraction's title", async () => {
		// #given
		getVideoDetailsMock.mockResolvedValue({
			title: VIDEO_TITLE,
			uploader: "Daft Punk",
		});

		// #when
		await runDownload();

		// #then
		expect(finalizeMp3Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				videoTitle: VIDEO_TITLE,
				artist: "Daft Punk",
				trackTitle: "One More Time",
			}),
		);
	});

	it("shows the user the title it recovered", async () => {
		// #given
		getVideoDetailsMock.mockResolvedValue({
			title: VIDEO_TITLE,
			uploader: "Daft Punk",
		});

		// #when
		const events = await runDownload();

		// #then
		expect(events).toContainEqual({
			type: "info",
			title: VIDEO_TITLE,
			artist: "Daft Punk",
			track: "One More Time",
		});
	});

	it("leaves the title empty when the extraction failed too, so the defaults apply", async () => {
		// #given
		getVideoDetailsMock.mockResolvedValue(null);

		// #when
		await runDownload();

		// #then
		expect(finalizeMp3Mock).toHaveBeenCalledWith(
			expect.objectContaining({ videoTitle: "", artist: "", trackTitle: "" }),
		);
	});
});

describe("GET /api/download-stream - title when oEmbed succeeds", () => {
	it("keeps oEmbed's title rather than the extraction's", async () => {
		// #given
		fetchYouTubeMetadataMock.mockResolvedValue({
			videoTitle: VIDEO_TITLE,
			artist: "Daft Punk",
			trackTitle: "One More Time",
			uploader: "Daft Punk",
			thumbnailUrl: "https://i.ytimg.com/vi/FGBhQbmPwH8/hqdefault.jpg",
		});
		getVideoDetailsMock.mockResolvedValue({
			title: "Some Other Title",
			uploader: "Someone Else",
		});

		// #when
		await runDownload();

		// #then
		expect(finalizeMp3Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				videoTitle: VIDEO_TITLE,
				artist: "Daft Punk",
				trackTitle: "One More Time",
			}),
		);
	});
});
