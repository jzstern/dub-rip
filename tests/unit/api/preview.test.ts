import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/video-utils", () => ({
	extractVideoId: vi.fn(),
}));

vi.mock("$lib/youtube-metadata", () => ({
	fetchYouTubeMetadata: vi.fn(),
	YouTubeMetadataError: class YouTubeMetadataError extends Error {
		constructor(
			message: string,
			public readonly isUnavailable: boolean = false,
		) {
			super(message);
			this.name = "YouTubeMetadataError";
		}
	},
}));

import { extractVideoId } from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
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
			vi.mocked(fetchYouTubeMetadata).mockResolvedValue({
				videoTitle: "Rick Astley - Never Gonna Give You Up",
				artist: "Rick Astley",
				trackTitle: "Never Gonna Give You Up",
				uploader: "RickAstleyVEVO",
				thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
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
		});

		it("uses artist from metadata (uploader fallback handled by utility)", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("abc123XYZ12");
			vi.mocked(fetchYouTubeMetadata).mockResolvedValue({
				videoTitle: "Some Video Title",
				artist: "Channel Name",
				trackTitle: "Some Video Title",
				uploader: "Channel Name - Topic",
				thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ12/hqdefault.jpg",
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
	});

	describe("oEmbed API errors", () => {
		it("returns 404 for private videos", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("privateVideo1");
			vi.mocked(fetchYouTubeMetadata).mockRejectedValue(
				new YouTubeMetadataError("Video is unavailable or private", true),
			);

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

		it("returns 500 for other oEmbed failures", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("serverError1");
			vi.mocked(fetchYouTubeMetadata).mockRejectedValue(
				new YouTubeMetadataError("oEmbed request failed: 500", false),
			);

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
			vi.mocked(fetchYouTubeMetadata).mockRejectedValue(
				new Error("Network error"),
			);

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
			expect(fetchYouTubeMetadata).not.toHaveBeenCalled();
		});

		it("passes extracted video ID to metadata function", async () => {
			// #given
			vi.mocked(extractVideoId).mockReturnValue("safeVideoId1");
			vi.mocked(fetchYouTubeMetadata).mockResolvedValue({
				videoTitle: "Test",
				artist: "",
				trackTitle: "Test",
				uploader: "",
				thumbnailUrl: "https://i.ytimg.com/vi/safeVideoId1/hqdefault.jpg",
			});

			const event = createMockEvent({
				url: "https://youtube.com/watch?v=safeVideoId1&malicious=param",
			});

			// #when
			await POST(event);

			// #then
			expect(fetchYouTubeMetadata).toHaveBeenCalledWith("safeVideoId1");
		});
	});
});
