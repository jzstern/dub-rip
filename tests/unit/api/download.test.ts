import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
}));

import { extractVideoId } from "$lib/video-utils";

function createMockRequest(body: unknown): Request {
	return new Request("http://localhost/api/download", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/download - input validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it("returns 400 when URL is missing", async () => {
		// #given
		const { POST } = await import("../../../src/routes/api/download/+server");
		const event = {
			request: createMockRequest({}),
		} as unknown as Parameters<typeof POST>[0];

		// #when
		const response = await POST(event);
		const data = await response.json();

		// #then
		expect(response.status).toBe(400);
		expect(data.error).toBe("YouTube URL is required");
	});

	it("returns 400 when URL is empty string", async () => {
		// #given
		const { POST } = await import("../../../src/routes/api/download/+server");
		const event = {
			request: createMockRequest({ url: "" }),
		} as unknown as Parameters<typeof POST>[0];

		// #when
		const response = await POST(event);
		const data = await response.json();

		// #then
		expect(response.status).toBe(400);
		expect(data.error).toBe("YouTube URL is required");
	});

	it("returns 400 for invalid YouTube URL", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue(null);
		const { POST } = await import("../../../src/routes/api/download/+server");
		const event = {
			request: createMockRequest({ url: "https://vimeo.com/123456" }),
		} as unknown as Parameters<typeof POST>[0];

		// #when
		const response = await POST(event);
		const data = await response.json();

		// #then
		expect(response.status).toBe(400);
		expect(data.error).toBe("Invalid YouTube URL");
	});

	it("validates video ID before processing to prevent injection", async () => {
		// #given
		vi.mocked(extractVideoId).mockReturnValue(null);
		const { POST } = await import("../../../src/routes/api/download/+server");
		const event = {
			request: createMockRequest({
				url: "https://youtube.com/watch?v=; rm -rf /",
			}),
		} as unknown as Parameters<typeof POST>[0];

		// #when
		const response = await POST(event);
		const data = await response.json();

		// #then
		expect(response.status).toBe(400);
		expect(data.error).toBe("Invalid YouTube URL");
	});
});
