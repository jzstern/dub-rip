import { describe, expect, it } from "vitest";
import { extractVideoId } from "$lib/video-utils";

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
	});

	describe("validation requirements", () => {
		it("accepts valid video ID for single video", () => {
			// #given
			const url = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const videoId = extractVideoId(url);

			// #then
			expect(videoId).toBe("dQw4w9WgXcQ");
		});

		it("rejects invalid URL", () => {
			// #given
			const url = "https://vimeo.com/123456";

			// #when
			const videoId = extractVideoId(url);

			// #then
			expect(videoId).toBeNull();
		});
	});
});
