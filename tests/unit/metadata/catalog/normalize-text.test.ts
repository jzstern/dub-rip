import { describe, expect, it } from "vitest";
import {
	artistDisplayName,
	collapseWhitespace,
	normalizeForMatch,
	normalizeIsrc,
	splitArtistNames,
} from "$lib/metadata/catalog/normalize-text";

describe("normalizeForMatch()", () => {
	it.each([
		["HUMBLE.", "humble"],
		["I Can't Fail", "i cant fail"],
		["I Cant Fail", "i cant fail"],
		["Beyoncé", "beyonce"],
		["Björk", "bjork"],
		["Sigur Rós", "sigur ros"],
		["W&W", "w and w"],
		["Florence + The Machine", "florence and the machine"],
		["  spaced   out  ", "spaced out"],
		["Marea (We’ve Lost Dancing)", "marea weve lost dancing"],
	])("folds %j to %j", (input, expected) => {
		// #when
		const normalized = normalizeForMatch(input);

		// #then
		expect(normalized).toBe(expected);
	});

	it("keeps a voiced kana whole rather than splitting its mark off", () => {
		// #given — NFKD decomposes パ into ハ plus a combining mark. Replacing marks
		// with a space would break the word apart instead of preserving the letter.
		// #when
		const normalized = normalizeForMatch("パート");

		// #then
		expect(normalized).not.toContain(" ");
	});

	it.each([
		["パート", "ハート"],
		["ガゼ", "カゼ"],
	])("keeps %j and %j apart, because a dakuten is a letter and not an accent", (voiced, unvoiced) => {
		// #when
		const normalized = normalizeForMatch(voiced);

		// #then
		expect(normalized).not.toBe(normalizeForMatch(unvoiced));
	});
});

describe("collapseWhitespace()", () => {
	it("caps the length, so a pattern cannot be fed an unbounded run", () => {
		// #when
		const collapsed = collapseWhitespace("x".repeat(5_000));

		// #then
		expect(collapsed).toHaveLength(300);
	});

	it("drops a lone surrogate the uploader typed, wherever it sits", () => {
		// #given — an unpaired surrogate reaching encodeURIComponent throws URIError,
		// which would escape the whole lookup instead of degrading to no candidates
		const stray = `Night \ud800Drive`;

		// #when
		const collapsed = collapseWhitespace(stray);

		// #then
		expect(() => encodeURIComponent(collapsed)).not.toThrow();
	});

	it("keeps a valid surrogate pair intact", () => {
		// #when
		const collapsed = collapseWhitespace("Night 😀 Drive");

		// #then
		expect(collapsed).toBe("Night 😀 Drive");
	});

	it("never cuts a surrogate pair in half", () => {
		// #given — an emoji straddling the cap would leave a lone high surrogate,
		// which throws URIError once the term reaches encodeURIComponent
		const straddling = `${"a".repeat(299)}😀tail`;

		// #when
		const collapsed = collapseWhitespace(straddling);

		// #then
		expect(() => encodeURIComponent(collapsed)).not.toThrow();
	});

	it("collapses a whitespace run to one space", () => {
		// #when
		const collapsed = collapseWhitespace(`a${" ".repeat(200)}b`);

		// #then
		expect(collapsed).toBe("a b");
	});

	it("caps before collapsing, so a run past the cap takes the rest with it", () => {
		// #when — the pattern never sees the run, which is the point of the cap
		const collapsed = collapseWhitespace(`a${" ".repeat(400)}b`);

		// #then
		expect(collapsed).toBe("a");
	});
});

describe("artistDisplayName()", () => {
	it.each([
		["Klaps (BE)", "Klaps"],
		["Sarah (UK)", "Sarah"],
		["Tame Impala", "Tame Impala"],
		["Blink-182", "Blink-182"],
	])("writes %j as %j", (input, expected) => {
		// #when
		const display = artistDisplayName(input);

		// #then
		expect(display).toBe(expected);
	});
});

describe("splitArtistNames()", () => {
	it.each([
		["Tame Impala & JENNIE", ["tame impala", "jennie"]],
		["Macklemore & Ryan Lewis", ["macklemore", "ryan lewis"]],
		[
			"Daft Punk, Pharrell Williams & Nile Rodgers",
			["daft punk", "pharrell williams", "nile rodgers"],
		],
		["Calvin Harris feat. Rihanna", ["calvin harris", "rihanna"]],
		["Avicii", ["avicii"]],
	])("splits %j", (credit, expected) => {
		// #when
		const names = splitArtistNames(credit);

		// #then
		expect(names).toEqual(expected);
	});
});

describe("normalizeIsrc()", () => {
	it.each([
		["USUM71900764", "USUM71900764"],
		["us-um7-19-00764", "USUM71900764"],
		["  usum71900764  ", "USUM71900764"],
	])("reads %j as %j", (input, expected) => {
		// #when
		const isrc = normalizeIsrc(input);

		// #then
		expect(isrc).toBe(expected);
	});

	it.each([undefined, "", "   ", "----"])("gives nothing for %j", (input) => {
		// #when
		const isrc = normalizeIsrc(input);

		// #then
		expect(isrc).toBeUndefined();
	});
});
