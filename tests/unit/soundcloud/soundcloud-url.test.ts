import { describe, expect, it } from "vitest";
import {
	parseSoundCloudShortLinkCode,
	parseSoundCloudTrackUrl,
} from "$lib/soundcloud/soundcloud-url";

describe("parseSoundCloudTrackUrl()", () => {
	it.each([
		[
			"https://soundcloud.com/wandw/the-chainsmokers-ft-daya-dont-let-me-down-ww-remix-1",
			"wandw/the-chainsmokers-ft-daya-dont-let-me-down-ww-remix-1",
		],
		[
			"https://soundcloud.com/the-concept-band/goldrushed-mastered?in=the-concept-band/sets/the-royal-concept-ep",
			"the-concept-band/goldrushed-mastered",
		],
		["https://m.soundcloud.com/billieeilish/bad-guy", "billieeilish/bad-guy"],
		["soundcloud.com/billieeilish/bad-guy", "billieeilish/bad-guy"],
		[
			"https://www.soundcloud.com/BillieEilish/Bad-Guy/",
			"billieeilish/bad-guy",
		],
		[
			"https://soundcloud.com/ilaytsa/crashout?si=34a274925508434c9b3a072edf87967b&utm_source=clipboard",
			"ilaytsa/crashout",
		],
	])("accepts %j", (input, id) => {
		// #when
		const ref = parseSoundCloudTrackUrl(input);

		// #then
		expect(ref).toEqual({ id, canonicalUrl: `https://soundcloud.com/${id}` });
	});

	it("keeps a private share link's secret token, case intact", () => {
		// #when
		const ref = parseSoundCloudTrackUrl(
			"https://soundcloud.com/jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
		);

		// #then
		expect(ref).toEqual({
			id: "jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
			canonicalUrl:
				"https://soundcloud.com/jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
		});
	});

	it.each([
		"https://soundcloud.com/billieeilish",
		"https://soundcloud.com/billieeilish/sets/when-we-all-fall-asleep",
		"https://soundcloud.com/billieeilish/likes",
		"https://soundcloud.com/discover/sets/charts-top:all-music",
		"https://soundcloud.com/search?q=bad%20guy",
		"https://soundcloud.com/you/likes",
		"https://soundcloud.com/billieeilish/bad-guy/comments",
		"https://soundcloud.com.evil.example/billieeilish/bad-guy",
		"https://evil.example/billieeilish/bad-guy",
		"ftp://soundcloud.com/billieeilish/bad-guy",
		"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
		"not a url",
		"",
	])("rejects %j", (input) => {
		// #when
		const ref = parseSoundCloudTrackUrl(input);

		// #then
		expect(ref).toBeNull();
	});
});

describe("parseSoundCloudShortLinkCode()", () => {
	it("extracts the code from an on.soundcloud.com share link", () => {
		// #when
		const code = parseSoundCloudShortLinkCode(
			"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
		);

		// #then
		expect(code).toBe("2iQZMwo9IQ8wLY3vf9");
	});

	it.each([
		"https://soundcloud.com/billieeilish/bad-guy",
		"https://on.soundcloud.com/a/b",
		"https://on.soundcloud.com/",
	])("rejects %j", (input) => {
		// #when
		const code = parseSoundCloudShortLinkCode(input);

		// #then
		expect(code).toBeNull();
	});
});
