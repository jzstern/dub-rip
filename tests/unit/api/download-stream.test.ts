import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
	buildWatchUrl: vi.fn((id: string) => `https://www.youtube.com/watch?v=${id}`),
	parseArtistAndTitle: vi
		.fn()
		.mockReturnValue({ artist: "Test Artist", title: "Test Title" }),
	sanitizeUploaderAsArtist: vi.fn().mockReturnValue("Test Artist"),
}));

import { extractVideoId } from "$lib/video-utils";

function createMockURL(params: Record<string, string>): URL {
	const url = new URL("http://localhost/api/download-stream");
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url;
}

describe("GET /api/download-stream - input validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it("returns 400 when URL parameter is missing", async () => {
		// #given
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({}),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toBe("URL parameter required");
	});

	it("returns 400 for invalid YouTube URL", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue(null);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://vimeo.com/123456" }),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toBe("Invalid YouTube URL");
	});

	it("validates video ID to prevent command injection", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue(null);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://youtube.com/watch?v=; rm -rf /" }),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toBe("Invalid YouTube URL");
	});

	it("returns SSE headers for valid YouTube URL", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});

	it("accepts valid youtu.be short URL", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://youtu.be/dQw4w9WgXcQ" }),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	});
});

describe("parseYtDlpError", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureMessage).mockClear();
	});

	it("returns the bgutil-aware retry message for bot-check errors", async () => {
		// #given
		const { parseYtDlpError } = await import("$lib/yt-dlp-errors");
		const botCheckMessage =
			"ERROR: [youtube] abc123: Sign in to confirm you're not a bot. Use --cookies to pass cookies from your browser.";

		// #when
		const result = parseYtDlpError(botCheckMessage);

		// #then
		expect(result).toBe(
			"Download service couldn't verify with YouTube. Please try again in a few minutes.",
		);
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("matches on the 'cookies' keyword (alternate phrasing of bot-check)", async () => {
		// #given
		const { parseYtDlpError } = await import("$lib/yt-dlp-errors");

		// #when
		const result = parseYtDlpError(
			"ERROR: cookies required to access this video",
		);

		// #then
		expect(result).toBe(
			"Download service couldn't verify with YouTube. Please try again in a few minutes.",
		);
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("maps 'Video unavailable' to a clear user message", async () => {
		// #given
		const { parseYtDlpError } = await import("$lib/yt-dlp-errors");

		// #when
		const result = parseYtDlpError("ERROR: Video unavailable");

		// #then
		expect(result).toBe("This video is unavailable or private.");
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("maps age-restricted errors to a clear user message", async () => {
		// #given
		const { parseYtDlpError } = await import("$lib/yt-dlp-errors");

		// #when
		const result = parseYtDlpError("ERROR: age-restricted content");

		// #then
		expect(result).toBe(
			"This video is age-restricted and cannot be downloaded.",
		);
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("falls through to the generic message when nothing matches", async () => {
		// #given
		vi.mocked(Sentry.captureMessage).mockClear();
		const { parseYtDlpError } = await import("$lib/yt-dlp-errors");

		// #when
		const result = parseYtDlpError("ERROR: network blip");

		// #then
		expect(result).toBe("Download failed. Please try a different video.");
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			expect.stringContaining("Unmatched yt-dlp error: ERROR: network blip"),
			expect.objectContaining({ level: "warning" }),
		);
	});
});

describe("GET /api/download-stream - bgutil-pot env requirement", () => {
	// We mock `$env/dynamic/private` rather than `vi.stubEnv` because SvelteKit's
	// $env modules are virtual — they snapshot at module-resolve time, not from
	// process.env at handler-invoke time, so stubEnv would land in the wrong place.
	async function readStreamUntilError(): Promise<string> {
		vi.doMock("$env/dynamic/private", () => ({
			env: { BGUTIL_POT_URL: "" },
		}));
		vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");

		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
		} as unknown as Parameters<typeof GET>[0];

		const response = await GET(event);
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

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.doUnmock("$env/dynamic/private");
	});

	it("emits an SSE error event when BGUTIL_POT_URL is unset", async () => {
		// #given / #when
		const buffer = await readStreamUntilError();

		// #then
		expect(buffer).toMatch(/"type":"error"/);
		expect(buffer).toMatch(/BGUTIL_POT_URL/);
	});

	it("reports the missing bgutil-pot config to Sentry", async () => {
		// #given / #when
		await readStreamUntilError();

		// #then
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			"BGUTIL_POT_URL is unset",
			expect.objectContaining({ level: "error" }),
		);
	});

	it("does not advertise a fast path before starting the download", async () => {
		// #given / #when
		const buffer = await readStreamUntilError();

		// #then — yt-dlp is the only path, so there is nothing to fall back from
		expect(buffer).not.toMatch(/Trying fast download/);
	});

	it("emits the yt-dlp start status before failing", async () => {
		// #given / #when
		const buffer = await readStreamUntilError();

		// #then
		expect(buffer).toMatch(/Starting download/);
	});
});

describe("DownloadMethod", () => {
	it("reports yt-dlp as the only download method", async () => {
		// #given
		const { YT_DLP_METHOD } = await import("$lib/types");

		// #when / #then
		expect(YT_DLP_METHOD).toBe("yt-dlp");
	});
});
