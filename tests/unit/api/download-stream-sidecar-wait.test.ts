import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const POT_URL = "http://pot.internal:4416";

const { envMock, waitForBgutilPotMock, tryYtDlpDownloadMock } = vi.hoisted(
	() => ({
		envMock: { BGUTIL_POT_URL: undefined as string | undefined },
		waitForBgutilPotMock: vi.fn(),
		tryYtDlpDownloadMock: vi.fn(),
	}),
);

vi.mock("$env/dynamic/private", () => ({ env: envMock }));

vi.mock("$lib/wait-for-bgutil-pot", () => ({
	waitForBgutilPot: waitForBgutilPotMock,
}));

vi.mock("$lib/download-pipeline/try-yt-dlp", () => ({
	tryYtDlpDownload: tryYtDlpDownloadMock,
}));

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(() => "dQw4w9WgXcQ"),
	buildWatchUrl: vi.fn((id: string) => `https://www.youtube.com/watch?v=${id}`),
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureYtDlpBinary: vi.fn(() => Promise.resolve("/tmp/yt-dlp")),
	ensureBgutilPlugin: vi.fn(() => Promise.resolve("/tmp/yt-dlp-plugins")),
}));

vi.mock("$lib/video-details-cache", () => ({
	getVideoDetails: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("$lib/video-metadata", () => ({
	fetchThumbnailBuffer: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("$lib/youtube-metadata", () => ({
	fetchYouTubeMetadata: vi.fn(() =>
		Promise.resolve({
			videoTitle: "Test Video",
			artist: "Test Artist",
			trackTitle: "Test Title",
			uploader: "Test Uploader",
			thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
		}),
	),
	YouTubeMetadataError: class YouTubeMetadataError extends Error {},
}));

/**
 * The route's post-download `pathExists` and its temp-file cleanup both hit the
 * real filesystem; these stand in for "no output file" and "nothing left behind"
 * so a resolved `tryYtDlpDownload` ends the stream with a plain error event.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const merged = {
		...actual,
		access: () => Promise.reject(new Error("ENOENT")),
		readdir: () => Promise.resolve([] as string[]),
		unlink: () => Promise.resolve(undefined),
	};
	return { ...merged, default: merged };
});

type WakeOptions = {
	maxWaitMs?: number;
	signal?: AbortSignal;
	onWaiting?: () => void;
};

const AWAKE = { awake: true, attempts: 1, waitedMs: 0 };

async function startDownload(): Promise<Response> {
	const { GET } = await import(
		"../../../src/routes/api/download-stream/+server"
	);
	const url = new URL("http://localhost/api/download-stream");
	url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");
	return GET({ url } as unknown as Parameters<typeof GET>[0]);
}

async function readEvents(
	response: Response,
): Promise<Array<Record<string, unknown>>> {
	const reader = response.body?.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const chunk = await reader?.read();
		if (!chunk || chunk.done) break;
		buffer += decoder.decode(chunk.value);
	}
	return buffer
		.split("\n\n")
		.filter((frame) => frame.startsWith("data: "))
		.map((frame) => JSON.parse(frame.slice("data: ".length)));
}

function statusMessages(events: Array<Record<string, unknown>>): unknown[] {
	return events.filter((e) => e.type === "status").map((e) => e.message);
}

describe("GET /api/download-stream - waiting for the bgutil-pot sidecar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		envMock.BGUTIL_POT_URL = POT_URL;
		waitForBgutilPotMock.mockResolvedValue(AWAKE);
		tryYtDlpDownloadMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("waits for the configured sidecar, bounded, and hands the wait the request's abort signal", async () => {
		// #when
		await readEvents(await startDownload());

		// #then
		expect(waitForBgutilPotMock).toHaveBeenCalledWith(
			POT_URL,
			expect.objectContaining({
				maxWaitMs: 12_000,
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("does not start yt-dlp until the sidecar has answered", async () => {
		// #given a sidecar that is still starting
		let sidecarAnswers: (result: typeof AWAKE) => void = () => {};
		waitForBgutilPotMock.mockReturnValue(
			new Promise((resolve) => {
				sidecarAnswers = resolve;
			}),
		);
		const response = await startDownload();
		await vi.waitFor(() => expect(waitForBgutilPotMock).toHaveBeenCalled());

		// #when it has not answered yet
		await new Promise((resolve) => setTimeout(resolve, 20));

		// #then
		expect(tryYtDlpDownloadMock).not.toHaveBeenCalled();

		sidecarAnswers(AWAKE);
		await readEvents(response);
	});

	it("starts yt-dlp once the sidecar has answered", async () => {
		// #when
		await readEvents(await startDownload());

		// #then
		expect(tryYtDlpDownloadMock).toHaveBeenCalledTimes(1);
	});

	it("tells the client the downloader is waking up, after the first status and before the download starts", async () => {
		// #given
		waitForBgutilPotMock.mockImplementation(
			async (_url: string, options: WakeOptions) => {
				options.onWaiting?.();
				return { awake: true, attempts: 3, waitedMs: 1_200 };
			},
		);

		// #when
		const events = await readEvents(await startDownload());

		// #then
		expect(statusMessages(events).slice(0, 3)).toEqual([
			"Getting video info...",
			"Waking up the downloader...",
			"Starting download...",
		]);
	});

	it("says nothing about waking up when the sidecar answers straight away", async () => {
		// #when
		const events = await readEvents(await startDownload());

		// #then
		expect(statusMessages(events)).not.toContain("Waking up the downloader...");
	});

	it("still attempts the download when the sidecar never answered, leaving the retry loop to cope", async () => {
		// #given
		waitForBgutilPotMock.mockResolvedValue({
			awake: false,
			attempts: 24,
			waitedMs: 12_000,
		});

		// #when
		await readEvents(await startDownload());

		// #then
		expect(tryYtDlpDownloadMock).toHaveBeenCalledTimes(1);
	});

	it("leaves a breadcrumb for a sidecar that never answered, so a later failure carries that context", async () => {
		// #given
		waitForBgutilPotMock.mockResolvedValue({
			awake: false,
			attempts: 24,
			waitedMs: 12_000,
		});

		// #when
		await readEvents(await startDownload());

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "download",
				level: "warning",
				data: expect.objectContaining({ attempts: 24, waitedMs: 12_000 }),
			}),
		);
	});

	it("leaves no breadcrumb when the sidecar answered", async () => {
		// #when
		await readEvents(await startDownload());

		// #then
		expect(Sentry.addBreadcrumb).not.toHaveBeenCalledWith(
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("does not file a Sentry message for a sidecar that never answered", async () => {
		// #given
		waitForBgutilPotMock.mockResolvedValue({
			awake: false,
			attempts: 24,
			waitedMs: 12_000,
		});

		// #when
		await readEvents(await startDownload());

		// #then a cold sidecar is normal operation, so the only trace is the
		// breadcrumb — the route's one captureMessage is the unset-URL config error
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("does not wait, and still reports the misconfiguration, when BGUTIL_POT_URL is unset", async () => {
		// #given
		envMock.BGUTIL_POT_URL = undefined;

		// #when
		const events = await readEvents(await startDownload());

		// #then
		expect(waitForBgutilPotMock).not.toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining("BGUTIL_POT_URL"),
		});
	});

	it("does not start yt-dlp when the client leaves while the sidecar is starting", async () => {
		// #given
		let sidecarAnswers: (result: typeof AWAKE) => void = () => {};
		waitForBgutilPotMock.mockReturnValue(
			new Promise((resolve) => {
				sidecarAnswers = resolve;
			}),
		);
		const response = await startDownload();
		await vi.waitFor(() => expect(waitForBgutilPotMock).toHaveBeenCalled());

		// #when the client disconnects, and the wait then ends
		await response.body?.cancel();
		sidecarAnswers({ awake: false, attempts: 1, waitedMs: 30 });
		await new Promise((resolve) => setTimeout(resolve, 20));

		// #then
		expect(tryYtDlpDownloadMock).not.toHaveBeenCalled();
	});
});
