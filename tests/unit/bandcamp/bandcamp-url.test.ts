import { describe, expect, it } from "vitest";
import { parseBandcampTrackUrl } from "$lib/bandcamp/bandcamp-url";

describe("parseBandcampTrackUrl()", () => {
	it.each([
		[
			"https://benprunty.bandcamp.com/track/lanius-battle",
			"benprunty/lanius-battle",
		],
		[
			"http://benprunty.bandcamp.com/track/lanius-battle",
			"benprunty/lanius-battle",
		],
		["benprunty.bandcamp.com/track/lanius-battle", "benprunty/lanius-battle"],
		[
			"https://benprunty.bandcamp.com/track/lanius-battle?from=embed&t=1",
			"benprunty/lanius-battle",
		],
		[
			"https://benprunty.bandcamp.com/track/lanius-battle/",
			"benprunty/lanius-battle",
		],
		[
			"https://BenPrunty.Bandcamp.com/track/Lanius-Battle",
			"benprunty/lanius-battle",
		],
		[
			"  https://ben-prunty-2.bandcamp.com/track/lanius_battle-2  ",
			"ben-prunty-2/lanius_battle-2",
		],
	])("accepts %j", (input, id) => {
		// #when
		const ref = parseBandcampTrackUrl(input);

		// #then
		expect(ref).toEqual({
			id,
			canonicalUrl: `https://${id.replace("/", ".bandcamp.com/track/")}`,
		});
	});

	it.each([
		"https://benprunty.bandcamp.com/album/ftl-advanced-edition-soundtrack",
		"https://benprunty.bandcamp.com",
		"https://benprunty.bandcamp.com/track",
		"https://benprunty.bandcamp.com/track/lanius-battle/extra",
		"https://benprunty.bandcamp.com/music/track/lanius-battle",
		"https://www.bandcamp.com/track/lanius-battle",
		"https://daily.bandcamp.com/track/lanius-battle",
		"https://blog.bandcamp.com/track/lanius-battle",
		"https://m.bandcamp.com/track/lanius-battle",
		"https://bandcamp.com/track/lanius-battle",
		"https://music.benprunty.com/track/lanius-battle",
		"https://benprunty.bandcamp.com.evil.com/track/lanius-battle",
		"https://evilbandcamp.com/track/lanius-battle",
		"https://a.b.bandcamp.com/track/lanius-battle",
		"https://-bad.bandcamp.com/track/lanius-battle",
		"https://benprunty.bandcamp.com/track/lanius%20battle",
		"ftp://benprunty.bandcamp.com/track/lanius-battle",
		"javascript://benprunty.bandcamp.com/track/lanius-battle",
		"https://benprunty.bandcamp.com:evil@attacker.example/track/lanius-battle",
		"not a url",
		"",
		"   ",
	])("rejects %j", (input) => {
		// #when
		const ref = parseBandcampTrackUrl(input);

		// #then
		expect(ref).toBeNull();
	});

	it("builds the canonical URL from parsed parts, dropping userinfo and port", () => {
		// #when
		const ref = parseBandcampTrackUrl(
			"https://user:pass@benprunty.bandcamp.com:8443/track/lanius-battle",
		);

		// #then
		expect(ref?.canonicalUrl).toBe(
			"https://benprunty.bandcamp.com/track/lanius-battle",
		);
	});
});
