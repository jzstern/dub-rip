import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
	isPlaylistUrl: vi.fn(),
	parseArtistAndTitle: vi.fn(),
	sanitizeUploaderAsArtist: vi.fn(),
}));

import {
	extractVideoId,
	isPlaylistUrl,
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import { POST } from "../../../src/routes/api/preview/+server";

function createMockRequest(body: Record<string, unknown>): Request {
	return {
		json: () => Promise.resolve(body),
	} as unknown as Request;
}

function createMockEvent(body: Record<string, unknown>) {
	return {
		request: createMockRequest(body),
	} as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/preview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("input validation", () => {
		it("returns 400 when URL is missing", async () => {
			// #given
			const event = createMockEvent({});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(400);
			expect(data.error).toBe("URL is required");
		});

		it("returns 400 when URL is empty string", async () => {
			// #given
			const event = createMockEvent({ url: "" });

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(400);
			expect(data.error).toBe("URL is required");
		});

		it("returns 400 for invalid YouTube URL", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue(null);
			const event = createMockEvent({ url: "https://vimeo.com/123456" });

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(400);
			expect(data.error).toBe("Invalid YouTube URL");
		});
	});

	describe("successful preview", () => {
		it("returns video preview for valid URL", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
			vi.mocked(isPlaylistUrl).mockReturnValue(false);
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "Rick Astley",
				title: "Never Gonna Give You Up",
			});
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("RickAstleyVEVO");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						title: "Rick Astley - Never Gonna Give You Up",
						author_name: "RickAstleyVEVO",
					}),
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.videoTitle).toBe("Rick Astley - Never Gonna Give You Up");
			expect(data.artist).toBe("Rick Astley");
			expect(data.title).toBe("Never Gonna Give You Up");
			expect(data.thumbnail).toBe(
				"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
			);
			expect(data.duration).toBeNull();
			expect(data.playlist).toBeNull();
		});

		it("falls back to uploader name when artist is empty", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("abc123XYZ12");
			vi.mocked(isPlaylistUrl).mockReturnValue(false);
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "",
				title: "Some Video Title",
			});
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("Channel Name");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						title: "Some Video Title",
						author_name: "Channel Name - Topic",
					}),
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=abc123XYZ12",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(data.artist).toBe("Channel Name");
		});

		it("marks playlist URLs with pending flag", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("dQw4w9WgXcQ");
			vi.mocked(isPlaylistUrl).mockReturnValue(true);
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "Artist",
				title: "Title",
			});

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						title: "Artist - Title",
						author_name: "Artist",
					}),
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest123",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(data.playlist).toEqual({ pending: true });
		});
	});

	describe("oEmbed API errors", () => {
		it("returns 404 for private videos (401 from oEmbed)", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("privateVideo1");

			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=privateVideo1",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(404);
			expect(data.error).toBe("Video is unavailable or private");
		});

		it("returns 404 for unavailable videos (403 from oEmbed)", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("unavailable1");

			mockFetch.mockResolvedValue({
				ok: false,
				status: 403,
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=unavailable1",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(404);
			expect(data.error).toBe("Video is unavailable or private");
		});

		it("returns 500 for other oEmbed failures", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("serverError1");

			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=serverError1",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(500);
			expect(data.error).toBe("Failed to load preview");
		});

		it("returns 500 when fetch throws", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("networkError1");

			mockFetch.mockRejectedValue(new Error("Network error"));

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=networkError1",
			});

			// #when
			const response = await POST(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(500);
			expect(data.error).toBe("Failed to load preview");
		});
	});

	describe("security", () => {
		it("validates video ID before making external request", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue(null);
			const event = createMockEvent({
				url: "https://youtube.com/watch?v=; rm -rf /",
			});

			// #when
			await POST(event);

			// #then
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("constructs oEmbed URL with extracted video ID only", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("safeVideoId1");
			vi.mocked(isPlaylistUrl).mockReturnValue(false);
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "",
				title: "Test",
			});
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ title: "Test", author_name: "" }),
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=safeVideoId1&malicious=param",
			});

			// #when
			await POST(event);

			// #then
			expect(mockFetch).toHaveBeenCalledWith(
				"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=safeVideoId1&format=json",
			);
		});
	});
});
