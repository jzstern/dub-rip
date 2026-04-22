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
	const botCheckMessage =
		"ERROR: [youtube] abc123: Sign in to confirm you're not a bot. Use --cookies to pass cookies from your browser.";

	it("returns the generic auth message when poToken is available", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError(botCheckMessage, true);

		// #then
		expect(result).toBe(
			"This video requires authentication. Please try a different video or try again later.",
		);
	});

	it("returns the 'service unavailable' message when poToken is missing", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError(botCheckMessage, false);

		// #then
		expect(result).toBe(
			"Download service is temporarily unavailable (anti-bot token missing). Please try again in a few minutes.",
		);
	});

	it("defaults to the auth message when poTokenAvailable is not provided (backward compat)", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError(botCheckMessage);

		// #then
		expect(result).toBe(
			"This video requires authentication. Please try a different video or try again later.",
		);
	});

	it("matches on the 'cookies' keyword and still honors poTokenAvailable=false", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError(
			"ERROR: cookies required to access this video",
			false,
		);

		// #then
		expect(result).toBe(
			"Download service is temporarily unavailable (anti-bot token missing). Please try again in a few minutes.",
		);
	});

	it("is unaffected by poTokenAvailable for non-bot-check errors (video unavailable)", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError("ERROR: Video unavailable", false);

		// #then
		expect(result).toBe("This video is unavailable or private.");
	});

	it("is unaffected by poTokenAvailable for age-restricted errors", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError("ERROR: age-restricted content", false);

		// #then
		expect(result).toBe(
			"This video is age-restricted and cannot be downloaded.",
		);
	});

	it("falls through to the generic message when nothing matches", async () => {
		// #given
		const { parseYtDlpError } = await import(
			"../../../src/routes/api/download-stream/+server"
		);

		// #when
		const result = parseYtDlpError("ERROR: network blip", false);

		// #then
		expect(result).toBe("Download failed. Please try a different video.");
	});
});
