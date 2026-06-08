import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
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
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.doUnmock("$env/dynamic/private");
		vi.doUnmock("$lib/cobalt");
	});

	// We mock `$env/dynamic/private` rather than `vi.stubEnv` because SvelteKit's
	// $env modules are virtual — they snapshot at module-resolve time, not from
	// process.env at handler-invoke time, so stubEnv would land in the wrong place.
	it("emits an SSE error event when BGUTIL_POT_URL is unset and Cobalt has failed", async () => {
		// #given
		vi.doMock("$env/dynamic/private", () => ({
			env: { BGUTIL_POT_URL: "" },
		}));
		vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
		vi.doMock("$lib/cobalt", () => ({
			CobaltError: class CobaltError extends Error {},
			requestCobaltAudio: vi
				.fn()
				.mockRejectedValue(new Error("simulated cobalt failure")),
			fetchCobaltAudio: vi.fn(),
		}));

		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let sawError = false;
		while (!sawError) {
			const chunk = await reader?.read();
			if (!chunk || chunk.done) break;
			buffer += decoder.decode(chunk.value);
			if (buffer.includes('"type":"error"')) sawError = true;
		}

		// #then
		expect(sawError).toBe(true);
		expect(buffer).toMatch(/BGUTIL_POT_URL/);
	});
});
