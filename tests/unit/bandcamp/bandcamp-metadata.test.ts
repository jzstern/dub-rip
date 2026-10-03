import { describe, expect, it } from "vitest";
import {
	BANDCAMP_NOT_STREAMABLE_MESSAGE,
	bandcampDetails,
	bandcampRefusal,
	bandcampTitleState,
} from "$lib/bandcamp/bandcamp-metadata";
import type { BandcampTrack } from "$lib/bandcamp/bandcamp-track";

const LANIUS: BandcampTrack = {
	title: "Lanius (Battle)",
	artist: "Ben Prunty",
	bandName: "Ben Prunty",
	albumTitle: "FTL: Advanced Edition Soundtrack",
	releaseDate: "2014-04-03T00:00:00.000Z",
	durationSeconds: 261,
	artworkUrl: "https://f4.bcbits.com/img/a1270682128_16.jpg",
	isStreamable: true,
	hasFreeDownload: true,
};

const COMPILATION_TRACK: BandcampTrack = {
	...LANIUS,
	title: "Kode9 - Black Sun",
	artist: "Various Artists",
	bandName: "Hyperdub",
	albumTitle: "Hyperdub 10.1",
	isrc: "GBBPW1400012",
};

describe("bandcampTitleState()", () => {
	it("uses the artist field when the title carries no artist", () => {
		// #when
		const state = bandcampTitleState(LANIUS);

		// #then
		expect(state).toEqual({
			videoTitle: "Lanius (Battle)",
			artist: "Ben Prunty",
			trackTitle: "Lanius (Battle)",
		});
	});

	it("lets 'Artist - Title' in a label compilation's title win over the artist field", () => {
		// #when
		const state = bandcampTitleState(COMPILATION_TRACK);

		// #then
		expect(state).toEqual({
			videoTitle: "Kode9 - Black Sun",
			artist: "Kode9",
			trackTitle: "Black Sun",
		});
	});

	it("prefers the artist field over a label's band name", () => {
		// #when
		const state = bandcampTitleState({
			...LANIUS,
			title: "Black Sun",
			artist: "Kode9",
			bandName: "Hyperdub",
		});

		// #then
		expect(state.artist).toBe("Kode9");
	});
});

describe("bandcampDetails()", () => {
	it.each([
		[
			"a collab credit on the artist's own account",
			"Ben Prunty & Danny Baranowsky",
			"Ben Prunty",
		],
		[
			"a feature credit on the artist's own account",
			"Ben Prunty feat. Someone",
			"Ben Prunty",
		],
		["an account name with a suffix", "Ben Prunty", "Ben Prunty Music"],
	])("sets no label for %s", (_case, artist, bandName) => {
		// #when
		const details = bandcampDetails({ ...LANIUS, artist, bandName });

		// #then
		expect(details.label).toBeUndefined();
	});

	it("maps year, album and duration for an artist's own release", () => {
		// #when
		const details = bandcampDetails(LANIUS);

		// #then
		expect(details).toEqual({
			year: 2014,
			album: "FTL: Advanced Edition Soundtrack",
			duration: 261,
			label: undefined,
			isrc: undefined,
		});
	});

	it("sets the label and ISRC when a label sells the track", () => {
		// #when
		const details = bandcampDetails(COMPILATION_TRACK);

		// #then
		expect({ label: details.label, isrc: details.isrc }).toEqual({
			label: "Hyperdub",
			isrc: "GBBPW1400012",
		});
	});

	it("treats a band name differing only in case and punctuation as the artist, not a label", () => {
		// #when
		const details = bandcampDetails({
			...LANIUS,
			artist: "Ben Prunty",
			bandName: "BEN-PRUNTY",
		});

		// #then
		expect(details.label).toBeUndefined();
	});

	it.each([
		["no release date", undefined],
		["an implausible year", "0001-01-01T00:00:00.000Z"],
		["a garbled date", "unknown"],
	])("leaves the year unset for %s", (_label, releaseDate) => {
		// #when
		const details = bandcampDetails({ ...LANIUS, releaseDate });

		// #then
		expect(details.year).toBeUndefined();
	});

	it("never sets track or artist, which would override the resolved identity", () => {
		// #when
		const details = bandcampDetails(COMPILATION_TRACK);

		// #then
		expect(Object.keys(details)).not.toContain("artist");
		expect(Object.keys(details)).not.toContain("track");
	});
});

describe("bandcampRefusal()", () => {
	it.each([
		[{ isStreamable: false, hasFreeDownload: true }, null],
		[
			{ isStreamable: false, hasFreeDownload: false },
			BANDCAMP_NOT_STREAMABLE_MESSAGE,
		],
		[{ isStreamable: true, hasFreeDownload: false }, null],
		[{}, null],
	])("refuses %j with %j", (overrides, expected) => {
		// #when
		const refusal = bandcampRefusal({ ...LANIUS, ...overrides });

		// #then
		expect(refusal).toBe(expected);
	});
});
