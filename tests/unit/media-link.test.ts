import { describe, expect, it } from "vitest";
import { parseMediaLink } from "$lib/media-link";

describe("parseMediaLink()", () => {
	it("parses a YouTube link to its canonical watch URL", () => {
		// #when
		const link = parseMediaLink("https://youtu.be/dQw4w9WgXcQ?t=42");

		// #then
		expect(link).toEqual({
			kind: "youtube",
			id: "dQw4w9WgXcQ",
			canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		});
	});

	it("parses a SoundCloud track link", () => {
		// #when
		const link = parseMediaLink(
			"https://soundcloud.com/billieeilish/bad-guy?si=abc",
		);

		// #then
		expect(link).toEqual({
			kind: "soundcloud",
			id: "billieeilish/bad-guy",
			canonicalUrl: "https://soundcloud.com/billieeilish/bad-guy",
		});
	});

	it("recognises a SoundCloud share link without resolving it", () => {
		// #when
		const link = parseMediaLink("https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9");

		// #then
		expect(link).toEqual({
			kind: "soundcloud-short-link",
			code: "2iQZMwo9IQ8wLY3vf9",
		});
	});

	it.each([
		"https://soundcloud.com/billieeilish/sets/album",
		"https://vimeo.com/123456",
		"",
	])("rejects %j", (input) => {
		// #when
		const link = parseMediaLink(input);

		// #then
		expect(link).toBeNull();
	});
});
