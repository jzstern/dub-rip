import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("$lib/video-utils", () => ({
	parseArtistAndTitle: vi.fn(),
	sanitizeUploaderAsArtist: vi.fn(),
}));

import {
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "../../src/lib/youtube-metadata";

describe("fetchYouTubeMetadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("successful metadata fetch", () => {
		it("returns parsed metadata for valid video", async () => {
			// #given
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
						thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
					}),
			});

			// #when
			const result = await fetchYouTubeMetadata("dQw4w9WgXcQ");

			// #then
			expect(result.videoTitle).toBe("Rick Astley - Never Gonna Give You Up");
			expect(result.artist).toBe("Rick Astley");
			expect(result.trackTitle).toBe("Never Gonna Give You Up");
			expect(result.uploader).toBe("RickAstleyVEVO");
			expect(result.thumbnailUrl).toBe(
				"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
			);
		});

		it("falls back to uploader when artist is empty", async () => {
			// #given
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "",
				title: "Some Video",
			});
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("Channel Name");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						title: "Some Video",
						author_name: "Channel Name - Topic",
					}),
			});

			// #when
			const result = await fetchYouTubeMetadata("abc123XYZ12");

			// #then
			expect(result.artist).toBe("Channel Name");
		});

		it("uses default thumbnail when not provided", async () => {
			// #given
			vi.mocked(parseArtistAndTitle).mockReturnValue({
				artist: "Artist",
				title: "Title",
			});
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						title: "Artist - Title",
						author_name: "",
					}),
			});

			// #when
			const result = await fetchYouTubeMetadata("testVideo123");

			// #then
			expect(result.thumbnailUrl).toBe(
				"https://i.ytimg.com/vi/testVideo123/hqdefault.jpg",
			);
		});

		it("encodes video ID in request URL", async () => {
			// #given
			vi.mocked(parseArtistAndTitle).mockReturnValue({ artist: "", title: "" });
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ title: "", author_name: "" }),
			});

			// #when
			await fetchYouTubeMetadata("test-id_123");

			// #then
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("test-id_123"),
				expect.any(Object),
			);
		});
	});

	describe("error handling", () => {
		it("throws YouTubeMetadataError with isNotFound for 401", async () => {
			// #given
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
			});

			// #when/#then
			await expect(fetchYouTubeMetadata("private123")).rejects.toThrow(
				YouTubeMetadataError,
			);

			try {
				await fetchYouTubeMetadata("private123");
			} catch (err) {
				expect(err).toBeInstanceOf(YouTubeMetadataError);
				expect((err as YouTubeMetadataError).isNotFound).toBe(true);
			}
		});

		it("throws YouTubeMetadataError with isNotFound for 403", async () => {
			// #given
			mockFetch.mockResolvedValue({
				ok: false,
				status: 403,
			});

			// #when/#then
			try {
				await fetchYouTubeMetadata("blocked123");
			} catch (err) {
				expect(err).toBeInstanceOf(YouTubeMetadataError);
				expect((err as YouTubeMetadataError).isNotFound).toBe(true);
			}
		});

		it("throws YouTubeMetadataError with isNotFound for 404", async () => {
			// #given
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
			});

			// #when/#then
			try {
				await fetchYouTubeMetadata("notfound123");
			} catch (err) {
				expect(err).toBeInstanceOf(YouTubeMetadataError);
				expect((err as YouTubeMetadataError).isNotFound).toBe(true);
			}
		});

		it("throws YouTubeMetadataError without isNotFound for 500", async () => {
			// #given
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
			});

			// #when/#then
			try {
				await fetchYouTubeMetadata("server500");
			} catch (err) {
				expect(err).toBeInstanceOf(YouTubeMetadataError);
				expect((err as YouTubeMetadataError).isNotFound).toBe(false);
			}
		});

		it("throws YouTubeMetadataError on network failure", async () => {
			// #given
			mockFetch.mockRejectedValue(new Error("Network error"));

			// #when/#then
			await expect(fetchYouTubeMetadata("networkErr")).rejects.toThrow(
				YouTubeMetadataError,
			);
		});

		it("throws timeout error when request takes too long", async () => {
			// #given
			const abortError = new Error("Aborted");
			abortError.name = "AbortError";
			mockFetch.mockRejectedValue(abortError);

			// #when/#then
			try {
				await fetchYouTubeMetadata("slowVideo", 100);
			} catch (err) {
				expect(err).toBeInstanceOf(YouTubeMetadataError);
				expect((err as YouTubeMetadataError).message).toContain("timed out");
			}
		});
	});

	describe("API request format", () => {
		it("calls YouTube oEmbed endpoint with correct URL format", async () => {
			// #given
			vi.mocked(parseArtistAndTitle).mockReturnValue({ artist: "", title: "" });
			vi.mocked(sanitizeUploaderAsArtist).mockReturnValue("");

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ title: "", author_name: "" }),
			});

			// #when
			await fetchYouTubeMetadata("dQw4w9WgXcQ");

			// #then
			expect(mockFetch).toHaveBeenCalledWith(
				"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json",
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
		});
	});
});
