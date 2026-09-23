import { describe, expect, it } from "vitest";
import {
	identityKey,
	parseTrackTitle,
	sameVersion,
} from "$lib/metadata/catalog/track-version";

describe("parseTrackTitle() base title", () => {
	it.each([
		["bad guy", "bad guy"],
		["Levels (Skrillex Remix)", "Levels"],
		["Levels (Radio Edit)", "Levels"],
		["Enter Sandman (Remastered)", "Enter Sandman"],
		["Bohemian Rhapsody (Official Video Remastered)", "Bohemian Rhapsody"],
		["Get Lucky ft. Pharrell Williams, Nile Rodgers", "Get Lucky"],
		["Get Lucky (feat. Pharrell Williams & Nile Rodgers)", "Get Lucky"],
		["Don't Let Me Down ft. Daya (Hipst3r Edit)", "Don't Let Me Down"],
		["Se Cura - Extended Mix", "Se Cura"],
		["HUMBLE.", "HUMBLE."],
	])("reads %j as %j", (title, base) => {
		// #when
		const parsed = parseTrackTitle(title);

		// #then
		expect(parsed.base).toBe(base);
	});
});

describe("parseTrackTitle() featured credits", () => {
	it.each([
		[
			"Get Lucky ft. Pharrell Williams, Nile Rodgers",
			["Pharrell Williams", "Nile Rodgers"],
		],
		[
			"Get Lucky (feat. Pharrell Williams & Nile Rodgers)",
			["Pharrell Williams", "Nile Rodgers"],
		],
		["Dracula (with JENNIE)", ["JENNIE"]],
		["bad guy", []],
	])("reads the featured artists in %j", (title, featured) => {
		// #when
		const parsed = parseTrackTitle(title);

		// #then
		expect(parsed.featured).toEqual(featured);
	});
});

describe("parseTrackTitle() version classes", () => {
	it.each([
		["Levels (Skrillex Remix)", "identity"],
		["Don't Let Me Down (Hipst3r Edit)", "identity"],
		["Don't Stop The Music (Ed Marquis Bootleg)", "identity"],
		["Talking Body (Trap Remix)", "identity"],
		["Payphone [TWLGHT & SadBois Archive Edit 02]", "identity"],
		["Bohemian Rhapsody (Live Aid)", "identity"],
		["She so Heavy (SneakPreview)", "identity"],
		["Blinding Lights (Instrumental)", "identity"],
		["Levels (Radio Edit)", "length"],
		["Se Cura (Extended Mix)", "length"],
		["Se Cura - Extended Mix", "length"],
		["On My Knees (Original Mix)", "neutral"],
		["Enter Sandman (Remastered)", "neutral"],
		["Enter Sandman (Remastered 2021)", "neutral"],
		["Bohemian Rhapsody (Official Video Remastered)", "neutral"],
		["Hello (Official Music Video)", "neutral"],
	])("classes the version in %j as %s", (title, expected) => {
		// #when
		const parsed = parseTrackTitle(title);

		// #then
		expect(parsed.tags.map((tag) => tag.class)).toEqual([expected]);
	});

	it("names the person credited in a version", () => {
		// #when
		const parsed = parseTrackTitle("Levels (Skrillex Remix)");

		// #then
		expect(parsed.tags).toEqual([
			{ class: "identity", kind: "remix", credit: "skrillex" },
		]);
	});

	it("keeps a remix with no named remixer apart from the original", () => {
		// #when
		const parsed = parseTrackTitle("Talking Body (Trap Remix)");

		// #then
		expect(parsed.tags).toEqual([
			{ class: "identity", kind: "remix", credit: "trap" },
		]);
	});
});

describe("identityKey()", () => {
	it.each([
		["Levels", "Levels (Original Mix)"],
		["Enter Sandman (Remastered)", "Enter Sandman (Remastered 2021)"],
		[
			"Get Lucky ft. Pharrell Williams, Nile Rodgers",
			"Get Lucky (feat. Pharrell Williams & Nile Rodgers)",
		],
		["I Cant Fail", "I Can't Fail"],
		["HUMBLE.", "HUMBLE"],
		["Marea (We've Lost Dancing)", "Marea (We’ve Lost Dancing)"],
	])("gives %j and %j the same key", (left, right) => {
		// #when
		const key = identityKey(parseTrackTitle(left));

		// #then
		expect(key).toBe(identityKey(parseTrackTitle(right)));
	});

	it.each([
		["Dracula (JENNIE Remix)", "Dracula"],
		["Payphone [TWLGHT & SadBois Archive Edit 02]", "Payphone"],
		["Levels (Skrillex Remix)", "Levels (Radio Edit)"],
		["Bohemian Rhapsody", "Bohemian Rhapsody (Live Aid)"],
		["Se Cura", "Se Cura (Extended Mix)"],
	])("gives %j and %j different keys", (left, right) => {
		// #when
		const key = identityKey(parseTrackTitle(left));

		// #then
		expect(key).not.toBe(identityKey(parseTrackTitle(right)));
	});
});

describe("sameVersion()", () => {
	it("separates an identity difference from a length difference", () => {
		// #given
		const upload = parseTrackTitle("Get Lucky ft. Pharrell Williams");
		const candidate = parseTrackTitle(
			"Get Lucky (Radio Edit - feat. Pharrell Williams)",
		);

		// #when
		const result = sameVersion(upload, candidate);

		// #then
		expect(result).toEqual({ identity: true, length: false });
	});

	it("reports an identity difference for a remix against its original", () => {
		// #when
		const result = sameVersion(
			parseTrackTitle("Dracula (JENNIE Remix)"),
			parseTrackTitle("Dracula"),
		);

		// #then
		expect(result).toEqual({ identity: false, length: true });
	});
});
