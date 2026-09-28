import { describe, expect, it } from "vitest";
import { mergePreviewDetails } from "$lib/merge-preview-details";
import type { VideoPreview } from "$lib/types";

const PREVIEW: VideoPreview = {
	success: true,
	videoTitle: "Disclosure - Latch ft. Sam Smith",
	artist: "Disclosure",
	title: "Latch ft. Sam Smith",
	thumbnail: "https://i.ytimg.com/vi/93ASUImTedo/hqdefault.jpg",
	artwork: "https://is1-ssl.mzstatic.com/preview/300x300bb.jpg",
};

describe("mergePreviewDetails()", () => {
	it("leaves the card as it was when /details answers with nothing", () => {
		// #when
		const merged = mergePreviewDetails(PREVIEW, {});

		// #then
		expect(merged).toEqual(PREVIEW);
	});

	it("adds the duration /details measured", () => {
		// #when
		const merged = mergePreviewDetails(PREVIEW, { duration: 256 });

		// #then
		expect(merged.duration).toBe(256);
	});

	it("shows the catalog's artist and title once the match is confirmed", () => {
		// #when
		const merged = mergePreviewDetails(PREVIEW, {
			artist: "Disclosure",
			title: "Latch (feat. Sam Smith)",
		});

		// #then
		expect([merged.artist, merged.title]).toEqual([
			"Disclosure",
			"Latch (feat. Sam Smith)",
		]);
	});

	it("swaps in the cover of the confirmed match", () => {
		// #when
		const merged = mergePreviewDetails(PREVIEW, {
			artwork: "https://is1-ssl.mzstatic.com/proven/300x300bb.jpg",
		});

		// #then
		expect(merged.artwork).toBe(
			"https://is1-ssl.mzstatic.com/proven/300x300bb.jpg",
		);
	});

	it("keeps the heuristic identity when /details sends empty strings", () => {
		// #when
		const merged = mergePreviewDetails(PREVIEW, { artist: "", title: "" });

		// #then
		expect([merged.artist, merged.title]).toEqual([
			"Disclosure",
			"Latch ft. Sam Smith",
		]);
	});
});
