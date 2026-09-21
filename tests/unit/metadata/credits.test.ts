import { describe, expect, it } from "vitest";
import { extractRemixer, resolveLabel } from "$lib/metadata/credits";

describe("extractRemixer()", () => {
	it.each([
		["Don't Let Me Down (W&W Remix)", "W&W"],
		["Don't Let Me Down ft. Daya (Hipst3r Edit)", "Hipst3r"],
		["A LITTLE BIT (Bassurgence Flip)", "Bassurgence"],
		["Don't Stop The Music (Ed Marquis Bootleg)", "Ed Marquis"],
		["Something Just Like This (Alesso Remix)", "Alesso"],
		["Spring (DROPIXX & ARAYSEN Remix)", "DROPIXX & ARAYSEN"],
	])("finds the remixer in %j", (title, expected) => {
		// #when
		const remixer = extractRemixer(title);

		// #then
		expect(remixer).toBe(expected);
	});

	it.each([
		"Trapped (Radio Edit)",
		"On My Knees (Original Mix)",
		"Choosin Texas (Remix Feat. Don Toliver)",
		"Levels",
		"Talking Body (Trap Remix)",
		"Anthem (Festival Edit)",
		"Song (Deluxe Edit)",
		"Song (Acapella Edit)",
		"Song (A Cappella Edit)",
		"Song (Super Clean Edit)",
	])("names nobody for %j", (title) => {
		// #when
		const remixer = extractRemixer(title);

		// #then
		expect(remixer).toBeUndefined();
	});

	it("reports a credited name with its whitespace runs collapsed", () => {
		// #when
		const remixer = extractRemixer("Spring (DROPIXX  &\u3000ARAYSEN   Remix)");

		// #then
		expect(remixer).toBe("DROPIXX & ARAYSEN");
	});

	it.each([
		["ASCII spaces", " "],
		["em spaces", "\u2003"],
		["ideographic spaces", "\u3000"],
	])("returns quickly for an unclosed bracket before a long run of %s", (_name, space) => {
		// #given
		const uploaderControlledTrack = `(${space.repeat(2000)}x`;
		const startedAt = performance.now();

		// #when
		extractRemixer(uploaderControlledTrack);

		// #then
		expect(performance.now() - startedAt).toBeLessThan(100);
	});
});

describe("resolveLabel()", () => {
	it("prefers the platform's label field", () => {
		// #when
		const label = resolveLabel({
			platformLabel: "Warner Records",
			titleLabel: "Other Records",
			uploader: "VP RECORDS",
			artist: "Mac Miller",
		});

		// #then
		expect(label).toBe("Warner Records");
	});

	it("falls back to a label named in the title", () => {
		// #when
		const label = resolveLabel({
			titleLabel: "Reboot Records",
			uploader: "MERCILESS",
			artist: "blk.",
		});

		// #then
		expect(label).toBe("Reboot Records");
	});

	it("treats a label-named uploader as the label when it isn't the artist", () => {
		// #when
		const label = resolveLabel({
			uploader: "Decaydance Records",
			artist: "Gym Class Heroes",
		});

		// #then
		expect(label).toBe("Decaydance Records");
	});

	it("does not treat an ordinary channel as a label", () => {
		// #when
		const label = resolveLabel({ uploader: "Soul Music", artist: "Miyagi" });

		// #then
		expect(label).toBeUndefined();
	});
});
