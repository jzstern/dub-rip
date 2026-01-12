import { describe, expect, it } from "vitest";
import { extractVideoId, isPlaylistUrl } from "$lib/video-utils";

describe("POST /api/preview/details - validation logic", () => {
	describe("URL validation", () => {
		it("extractVideoId returns null for invalid URLs", () => {
			// #given
			const invalidUrl = "https://vimeo.com/123456";

			// #when
			const result = extractVideoId(invalidUrl);

			// #then
			expect(result).toBeNull();
		});

		it("extractVideoId returns video ID for valid URLs", () => {
			// #given
			const validUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const result = extractVideoId(validUrl);

			// #then
			expect(result).toBe("dQw4w9WgXcQ");
		});

		it("isPlaylistUrl detects playlist parameter", () => {
			// #given
			const playlistUrl = "https://youtube.com/watch?v=abc&list=PLtest123";

			// #when
			const result = isPlaylistUrl(playlistUrl);

			// #then
			expect(result).toBe(true);
		});

		it("isPlaylistUrl detects /playlist path", () => {
			// #given
			const playlistUrl = "https://youtube.com/playlist?list=PLtest123";

			// #when
			const result = isPlaylistUrl(playlistUrl);

			// #then
			expect(result).toBe(true);
		});

		it("isPlaylistUrl returns false for non-playlist URLs", () => {
			// #given
			const videoUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const result = isPlaylistUrl(videoUrl);

			// #then
			expect(result).toBe(false);
		});
	});

	describe("validation requirements", () => {
		it("accepts valid video ID for single video", () => {
			// #given
			const url = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const videoId = extractVideoId(url);
			const isPlaylist = isPlaylistUrl(url);

			// #then
			expect(videoId).toBe("dQw4w9WgXcQ");
			expect(isPlaylist).toBe(false);
		});

		it("accepts playlist URL even without video ID extraction", () => {
			// #given
			const url = "https://youtube.com/playlist?list=PLtest123";

			// #when
			const videoId = extractVideoId(url);
			const containsListParam = url.includes("list=");

			// #then
			expect(videoId).toBeNull();
			expect(containsListParam).toBe(true);
		});

		it("rejects invalid URL without list parameter", () => {
			// #given
			const url = "https://vimeo.com/123456";

			// #when
			const videoId = extractVideoId(url);
			const containsListParam = url.includes("list=");

			// #then
			expect(videoId).toBeNull();
			expect(containsListParam).toBe(false);
		});
	});
});
