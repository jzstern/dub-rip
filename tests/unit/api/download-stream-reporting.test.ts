import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: { BGUTIL_POT_URL: "http://pot.internal:4416" },
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

const { tryYtDlpDownloadMock } = vi.hoisted(() => ({
	tryYtDlpDownloadMock: vi.fn(),
}));

vi.mock("$lib/download-pipeline/try-yt-dlp", () => ({
	tryYtDlpDownload: tryYtDlpDownloadMock,
}));

/**
 * Real `node:fs/promises` and a real download-token registry would need a
 * real file at the route's randomly-generated outputPath to exercise the
 * post-download, pre-finalize window below. Mocking `access`/`unlink` lets
 * tests simulate "the .mp3 exists" without knowing that path in advance, and
 * mocking `registerDownload` turns "was a token issued" into something a
 * test can assert on directly — which is the actual leak this guards.
 */
const { accessMock, unlinkMock, registerDownloadMock } = vi.hoisted(() => ({
	accessMock: vi.fn<(path: string) => Promise<void>>(() =>
		Promise.reject(new Error("ENOENT")),
	),
	unlinkMock: vi.fn<(path: string) => Promise<void>>(() => Promise.resolve()),
	registerDownloadMock: vi.fn(() => "fake-token"),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const merged = { ...actual, access: accessMock, unlink: unlinkMock };
	return { ...merged, default: merged };
});

vi.mock("$lib/download-pipeline/download-tokens", () => ({
	registerDownload: registerDownloadMock,
}));

beforeEach(() => {
	accessMock.mockImplementation(() => Promise.reject(new Error("ENOENT")));
	unlinkMock.mockImplementation(() => Promise.resolve(undefined));
	registerDownloadMock.mockClear();
});

/**
 * `afterEach` below calls `vi.resetModules()`, so a `YtDlpQueueFullError`
 * built from a top-level static import would predate the reset and be a
 * different class object than the one +server.ts's fresh dynamic import
 * checks against — `instanceof` would silently fail. Importing fresh here,
 * in the same module-registry epoch as the `+server` import below, keeps
 * them identical.
 */
async function createQueueFullError(): Promise<Error> {
	const { YtDlpQueueFullError } = await import("$lib/yt-dlp-concurrency");
	return new YtDlpQueueFullError();
}

async function runDownloadUntilError(failure: Error): Promise<string> {
	tryYtDlpDownloadMock.mockRejectedValue(failure);

	const { GET } = await import(
		"../../../src/routes/api/download-stream/+server"
	);
	const url = new URL("http://localhost/api/download-stream");
	url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");

	const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
	const reader = response.body?.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (!buffer.includes('"type":"error"')) {
		const chunk = await reader?.read();
		if (!chunk || chunk.done) break;
		buffer += decoder.decode(chunk.value);
	}
	return buffer;
}

describe("GET /api/download-stream - failure reporting policy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("does not file an issue for a video that can never be downloaded", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("leaves a breadcrumb for that user-caused failure instead", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "download",
				message: expect.stringContaining("Download rejected"),
			}),
		);
	});

	it("still shows the user a friendly message for a user-caused failure", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");

		// #when
		const buffer = await runDownloadUntilError(failure);

		// #then
		expect(buffer).toContain("This video is private and cannot be downloaded.");
	});

	it("files an error-level issue for an unclassified failure", async () => {
		// #given
		const failure = new Error("ERROR: something bizarre happened");

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ level: "error" }),
		);
	});

	it("tags an unclassified failure with its category for triage", async () => {
		// #given
		const failure = new Error("ERROR: something bizarre happened");

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({
				tags: expect.objectContaining({ category: "unknown" }),
			}),
		);
	});

	it("downgrades an exhausted transient failure to warning level", async () => {
		// #given — retries are skipped with fake timers so backoff adds no delay
		vi.useFakeTimers();
		try {
			const failure = new Error("HTTP Error 403: Forbidden");
			tryYtDlpDownloadMock.mockRejectedValue(failure);
			const { GET } = await import(
				"../../../src/routes/api/download-stream/+server"
			);
			const url = new URL("http://localhost/api/download-stream");
			url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");

			// #when
			const response = await GET({ url } as unknown as Parameters<
				typeof GET
			>[0]);
			const reader = response.body?.getReader();
			const readAll = (async () => {
				const decoder = new TextDecoder();
				let buffer = "";
				while (!buffer.includes('"type":"error"')) {
					const chunk = await reader?.read();
					if (!chunk || chunk.done) break;
					buffer += decoder.decode(chunk.value);
				}
			})();
			await vi.runAllTimersAsync();
			await readAll;

			// #then
			expect(Sentry.captureException).toHaveBeenCalledWith(
				failure,
				expect.objectContaining({ level: "warning" }),
			);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("GET /api/download-stream - queue-full handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("does not file an issue when the downloader's queue is full", async () => {
		// #given
		const failure = await createQueueFullError();

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("leaves a breadcrumb for a full queue instead", async () => {
		// #given
		const failure = await createQueueFullError();

		// #when
		await runDownloadUntilError(failure);

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "download",
				message: expect.stringContaining("queue is full"),
			}),
		);
	});

	it("tells the user the downloader is busy rather than showing a generic failure", async () => {
		// #given
		const failure = await createQueueFullError();

		// #when
		const buffer = await runDownloadUntilError(failure);

		// #then
		expect(buffer).toContain(
			"The downloader is busy right now. Please try again in a moment.",
		);
	});
});

describe("GET /api/download-stream - missing output file", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("reports yt-dlp exiting 0 with no output file, since that's otherwise invisible", async () => {
		// #given — tryYtDlpDownload "succeeds" but never produces a file at outputPath
		tryYtDlpDownloadMock.mockResolvedValue(undefined);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const url = new URL("http://localhost/api/download-stream");
		url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");

		// #when
		const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let done = false;
		while (!done) {
			const chunk = await reader?.read();
			if (!chunk || chunk.done) {
				done = true;
				break;
			}
			buffer += decoder.decode(chunk.value);
		}

		// #then
		expect(buffer).toContain("Download completed but file not found");
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({
					service: "download-stream",
					operation: "missing-output-file",
				}),
				extra: expect.objectContaining({ videoId: "dQw4w9WgXcQ" }),
			}),
		);
	});
});

describe("GET /api/download-stream - cancellation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("aborts the signal passed to tryYtDlpDownload when the stream is canceled", async () => {
		// #given — an in-flight download that never resolves on its own
		let receivedSignal: AbortSignal | undefined;
		tryYtDlpDownloadMock.mockImplementation(
			({ signal }: { signal?: AbortSignal }) => {
				receivedSignal = signal;
				return new Promise(() => {});
			},
		);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const url = new URL("http://localhost/api/download-stream");
		url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");
		const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
		await vi.waitFor(() => expect(receivedSignal).toBeDefined());

		// #when
		await response.body?.cancel();

		// #then
		expect(receivedSignal?.aborted).toBe(true);
	});

	it("reports an aborted download as a breadcrumb, never an exception", async () => {
		// #given — tryYtDlpDownload rejects once its signal aborts, mirroring what
		// killing the real child process would do
		tryYtDlpDownloadMock.mockImplementation(
			({ signal }: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(new Error("killed")));
				}),
		);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const url = new URL("http://localhost/api/download-stream");
		url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");
		const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);

		// #when
		await response.body?.cancel();
		await vi.waitFor(() => expect(Sentry.addBreadcrumb).toHaveBeenCalled());

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "download",
				message: expect.stringContaining("aborted"),
			}),
		);
	});

	it("does not register a download token when the client disconnects between download-complete and finalize", async () => {
		// #given — yt-dlp's in-flight call only settles after the test has had a
		// chance to cancel, mirroring a client that disconnects while the
		// already-running download is finishing up on its own
		let resolveDownload: () => void = () => {};
		tryYtDlpDownloadMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveDownload = resolve;
				}),
		);
		accessMock.mockImplementation((path: string) =>
			path.endsWith(".mp3")
				? Promise.resolve()
				: Promise.reject(new Error("ENOENT")),
		);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const url = new URL("http://localhost/api/download-stream");
		url.searchParams.set("url", "https://youtube.com/watch?v=dQw4w9WgXcQ");
		const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
		await vi.waitFor(() => expect(tryYtDlpDownloadMock).toHaveBeenCalled());

		// #when — the client disconnects, then the already-in-flight yt-dlp call
		// resolves successfully anyway
		await response.body?.cancel();
		resolveDownload();
		await vi.waitFor(() => expect(unlinkMock).toHaveBeenCalled());

		// #then — no token for a client that is provably gone, and the finished
		// file is cleaned up rather than left pinned in /tmp for the full TTL
		expect(registerDownloadMock).not.toHaveBeenCalled();
		expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining(".mp3"));
	});
});
