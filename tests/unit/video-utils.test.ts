import { describe, expect, it } from "vitest";
import {
	extractVideoId,
	isPlaylistUrl,
	isValidYouTubeUrl,
	parseArtistAndTitle,
} from "$lib/video-utils";

describe("extractVideoId", () => {
	describe("standard watch URLs", () => {
		it("should extract ID from youtube.com/watch?v=", () => {
			expect(
				extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
			).toBe("dQw4w9WgXcQ");
		});

		it("should extract ID with additional query params", () => {
			expect(
				extractVideoId(
					"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
				),
			).toBe("dQw4w9WgXcQ");
		});

		it("should handle URLs without www", () => {
			expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
				"dQw4w9WgXcQ",
			);
		});
	});

	describe("short URLs", () => {
		it("should extract ID from youtu.be/", () => {
			expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
				"dQw4w9WgXcQ",
			);
		});

		it("should handle youtu.be with query params", () => {
			expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe(
				"dQw4w9WgXcQ",
			);
		});
	});

	describe("embed URLs", () => {
		it("should extract ID from youtube.com/embed/", () => {
			expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
				"dQw4w9WgXcQ",
			);
		});

		it("should extract ID from youtube.com/v/", () => {
			expect(extractVideoId("https://www.youtube.com/v/dQw4w9WgXcQ")).toBe(
				"dQw4w9WgXcQ",
			);
		});
	});

	describe("shorts URLs", () => {
		it("should extract ID from youtube.com/shorts/", () => {
			expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
				"dQw4w9WgXcQ",
			);
		});
	});

	describe("invalid URLs", () => {
		it("should return null for non-YouTube URLs", () => {
			expect(extractVideoId("https://vimeo.com/123456789")).toBeNull();
		});

		it("should return null for invalid YouTube URLs", () => {
			expect(extractVideoId("https://youtube.com/")).toBeNull();
		});

		it("should return null for truncated video IDs", () => {
			expect(extractVideoId("https://youtube.com/watch?v=dQw4w9")).toBeNull();
		});

		it("should return null for empty string", () => {
			expect(extractVideoId("")).toBeNull();
		});

		it("should return null for random text", () => {
			expect(extractVideoId("not a url at all")).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should handle IDs with underscores and hyphens", () => {
			expect(extractVideoId("https://youtube.com/watch?v=abc_123-XYZ")).toBe(
				"abc_123-XYZ",
			);
		});
	});
});

describe("isPlaylistUrl", () => {
	it("should detect list= parameter", () => {
		expect(
			isPlaylistUrl(
				"https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sg",
			),
		).toBe(true);
	});

	it("should detect /playlist path", () => {
		expect(
			isPlaylistUrl("https://youtube.com/playlist?list=PLrAXtmErZgOeiKm4sg"),
		).toBe(true);
	});

	it("should return false for non-playlist URLs", () => {
		expect(isPlaylistUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
			false,
		);
	});

	it("should return false for empty string", () => {
		expect(isPlaylistUrl("")).toBe(false);
	});
});

describe("isValidYouTubeUrl", () => {
	it("should return true for valid YouTube URLs", () => {
		expect(isValidYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
			true,
		);
		expect(isValidYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
	});

	it("should return false for invalid URLs", () => {
		expect(isValidYouTubeUrl("https://vimeo.com/123456789")).toBe(false);
		expect(isValidYouTubeUrl("not a url")).toBe(false);
		expect(isValidYouTubeUrl("")).toBe(false);
	});
});

describe("parseArtistAndTitle", () => {
	describe("dash separator", () => {
		it("should parse 'Artist - Title' format", () => {
			const result = parseArtistAndTitle("Queen - Bohemian Rhapsody");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should handle en-dash separator", () => {
			const result = parseArtistAndTitle("Queen – Bohemian Rhapsody");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should handle em-dash separator", () => {
			const result = parseArtistAndTitle("Queen — Bohemian Rhapsody");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});
	});

	describe("colon separator", () => {
		it("should parse 'Artist: Title' format", () => {
			const result = parseArtistAndTitle("Queen: Bohemian Rhapsody");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});
	});

	describe("pipe separator", () => {
		it("should parse 'Artist | Title' format", () => {
			const result = parseArtistAndTitle("Queen | Bohemian Rhapsody");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});
	});

	describe("suffix removal", () => {
		it("should remove (Official Video) suffix", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody (Official Video)",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove (Official Music Video) suffix", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody (Official Music Video)",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove (Music Video) suffix", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody (Music Video)",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove (Official Audio) suffix", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody (Official Audio)",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove (Lyrics) suffix", () => {
			const result = parseArtistAndTitle("Queen - Bohemian Rhapsody (Lyrics)");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove (Lyric) suffix", () => {
			const result = parseArtistAndTitle("Queen - Bohemian Rhapsody (Lyric)");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should remove [Official Video] suffix with brackets", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody [Official Video]",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should handle case-insensitive suffixes", () => {
			const result = parseArtistAndTitle(
				"Queen - Bohemian Rhapsody (OFFICIAL VIDEO)",
			);
			expect(result.title).toBe("Bohemian Rhapsody");
		});
	});

	describe("no pattern match", () => {
		it("should return empty artist for titles without separator", () => {
			const result = parseArtistAndTitle("Bohemian Rhapsody");
			expect(result.artist).toBe("");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should handle empty string", () => {
			const result = parseArtistAndTitle("");
			expect(result.artist).toBe("");
			expect(result.title).toBe("");
		});
	});

	describe("edge cases", () => {
		it("should trim whitespace", () => {
			const result = parseArtistAndTitle("  Queen  -  Bohemian Rhapsody  ");
			expect(result.artist).toBe("Queen");
			expect(result.title).toBe("Bohemian Rhapsody");
		});

		it("should use first separator for multiple separators", () => {
			const result = parseArtistAndTitle("Artist - Title - Remix");
			expect(result.artist).toBe("Artist");
			expect(result.title).toBe("Title - Remix");
		});

		it("should handle artist names with special characters", () => {
			const result = parseArtistAndTitle("AC/DC - Back in Black");
			expect(result.artist).toBe("AC/DC");
			expect(result.title).toBe("Back in Black");
		});
	});
});
