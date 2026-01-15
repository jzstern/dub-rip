import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
	parseArtistAndTitle: vi.fn(),
	sanitizeUploaderAsArtist: vi.fn(),
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
		vi.resetModules();
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

	it("returns 400 for invalid YouTube URL without playlist", async () => {
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

	it("accepts playlist URL even without video ID", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue(null);
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({
				url: "https://youtube.com/playlist?list=PLtest123",
			}),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then - passes validation, returns SSE stream
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
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
		expect(response.headers.get("Connection")).toBe("keep-alive");
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

		// #then - passes validation
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	});

	it("accepts playlist parameter for playlist downloads", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
		const { GET } = await import(
			"../../../src/routes/api/download-stream/+server"
		);
		const event = {
			url: createMockURL({
				url: "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest",
				playlist: "true",
			}),
		} as unknown as Parameters<typeof GET>[0];

		// #when
		const response = await GET(event);

		// #then - passes validation
		expect(response.status).toBe(200);
	});
});
