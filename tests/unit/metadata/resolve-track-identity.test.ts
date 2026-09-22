import { describe, expect, it } from "vitest";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";

describe("resolveTrackIdentity()", () => {
	it("takes the artist from the title when it names one", () => {
		// #given — a premiere channel upload credited to the channel itself
		const input = {
			rawTitle: "Premiere | THISO - Back The F Up",
			uploader: "TTC Records",
			creditedArtist: "The Techno Community",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({ artist: "THISO", trackTitle: "Back The F Up" });
	});

	it("prefers the title's artist over a platform credit that names the label", () => {
		// #given
		const input = {
			rawTitle: "Prospa, Cloonee & Sybil - Free Your Mind",
			uploader: "CircoLoco Records",
			creditedArtist: "CircoLoco Records",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({
			artist: "Prospa, Cloonee & Sybil",
			trackTitle: "Free Your Mind",
		});
	});

	it("falls back to the platform credit when the title names no artist", () => {
		// #given — uploaded by the label, credited to the performer
		const input = {
			rawTitle: "Go Down Deh (feat. Shaggy And Sean Paul)",
			uploader: "VP RECORDS",
			creditedArtist: "Spice",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({
			artist: "Spice",
			trackTitle: "Go Down Deh (feat. Shaggy And Sean Paul)",
		});
	});

	it("falls back to the uploader when nothing else names an artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Funky Fresh [Free Download]",
			uploader: "Sluggy Beats",
		});

		// #then
		expect(identity).toEqual({
			artist: "Sluggy Beats",
			trackTitle: "Funky Fresh",
		});
	});

	it("swaps a reversed title whose right side is the credited artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Dracula - Tame Impala (JENNIE Remix)",
			uploader: "ANNA",
			creditedArtist: "Tame Impala, JENNIE",
		});

		// #then
		expect(identity).toEqual({
			artist: "Tame Impala",
			trackTitle: "Dracula (JENNIE Remix)",
		});
	});

	it("swaps a reversed title whose right side is the uploader's name", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle:
				"BIG BOOTIE MIX, VOL. 27: Chicago Concert Premiere - Two Friends",
			uploader: "Two Friends Mixes",
		});

		// #then
		expect(identity).toEqual({
			artist: "Two Friends",
			trackTitle: "BIG BOOTIE MIX, VOL. 27: Chicago Concert Premiere",
		});
	});

	it("swaps a YouTube 'Title - Artist' upload from the artist's channel", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Hello - Adele",
			uploader: "AdeleVEVO",
		});

		// #then
		expect(identity).toEqual({ artist: "Adele", trackTitle: "Hello" });
	});

	it("does not swap when the left side is also a known artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "The Chainsmokers - Coldplay",
			uploader: "Coldplay",
			creditedArtist: "The Chainsmokers",
		});

		// #then
		expect(identity).toEqual({
			artist: "The Chainsmokers",
			trackTitle: "Coldplay",
		});
	});

	it("keeps a hyphenated artist whole (D1)", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Jay-Z - Empire State Of Mind ft. Alicia Keys",
			uploader: "JayZVEVO",
		});

		// #then
		expect(identity).toEqual({
			artist: "Jay-Z",
			trackTitle: "Empire State Of Mind ft. Alicia Keys",
		});
	});

	it("cleans a title that has no separator and names the channel's artist (D3, D5)", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Hello (Official Music Video)",
			uploader: "AdeleVEVO",
		});

		// #then
		expect(identity).toEqual({ artist: "Adele", trackTitle: "Hello" });
	});
});
