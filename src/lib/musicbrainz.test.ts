import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CoverArtResult,
	fetchCoverArt,
	lookupTrack,
	type TrackMetadata,
} from "./musicbrainz";

const FULL_RESPONSE = {
	recordings: [
		{
			title: "Bohemian Rhapsody",
			"artist-credit": [{ name: "Queen" }],
			releases: [
				{
					id: "release-123",
					title: "A Night at the Opera",
					date: "1975-10-31",
					"release-group": { "primary-type": "Album" },
					media: [{ track: [{ number: "11" }] }],
					"label-info": [{ label: { name: "EMI" } }],
				},
			],
			tags: [
				{ name: "rock", count: 10 },
				{ name: "classic rock", count: 5 },
			],
		},
	],
};

const ALBUM_VS_SINGLE_RESPONSE = {
	recordings: [
		{
			title: "Bohemian Rhapsody",
			"artist-credit": [{ name: "Queen" }],
			releases: [
				{
					id: "single-456",
					title: "Bohemian Rhapsody (Single)",
					date: "1975-10-31",
					"release-group": { "primary-type": "Single" },
					media: [{ track: [{ number: "1" }] }],
					"label-info": [{ label: { name: "EMI" } }],
				},
				{
					id: "album-789",
					title: "A Night at the Opera",
					date: "1975-11-21",
					"release-group": { "primary-type": "Album" },
					media: [{ track: [{ number: "11" }] }],
					"label-info": [{ label: { name: "EMI Records" } }],
				},
			],
			tags: [{ name: "rock", count: 8 }],
		},
	],
};

describe("lookupTrack()", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns enriched metadata for a known track", async () => {
		// #given
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify(FULL_RESPONSE), { status: 200 }),
		);

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result).toEqual({
			album: "A Night at the Opera",
			year: "1975",
			genre: "rock",
			trackNumber: "11",
			label: "EMI",
			releaseId: "release-123",
		} satisfies TrackMetadata);
	});

	it("returns null when no recordings match", async () => {
		// #given
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify({ recordings: [] }), { status: 200 }),
		);

		// #when
		const result = await lookupTrack("Unknown", "Nonexistent Song");

		// #then
		expect(result).toBeNull();
	});

	it("returns null on timeout", async () => {
		// #given
		fetchSpy.mockImplementation(
			(_url: string | URL | Request, init?: RequestInit) => {
				return new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (signal) {
						signal.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
						});
					}
				});
			},
		);

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody", 10);

		// #then
		expect(result).toBeNull();
	});

	it("prefers Album release type over Single", async () => {
		// #given
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify(ALBUM_VS_SINGLE_RESPONSE), { status: 200 }),
		);

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result).toEqual({
			album: "A Night at the Opera",
			year: "1975",
			genre: "rock",
			trackNumber: "11",
			label: "EMI Records",
			releaseId: "album-789",
		} satisfies TrackMetadata);
	});

	it("returns null when artist is empty", async () => {
		// #when
		const result = await lookupTrack("", "Bohemian Rhapsody");

		// #then
		expect(result).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns null when title is empty", async () => {
		// #when
		const result = await lookupTrack("Queen", "");

		// #then
		expect(result).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns null when API responds with non-OK status", async () => {
		// #given
		fetchSpy.mockResolvedValue(new Response("", { status: 503 }));

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result).toBeNull();
	});

	it("returns null when fetch throws a network error", async () => {
		// #given
		fetchSpy.mockRejectedValue(new Error("Network unreachable"));

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result).toBeNull();
	});
});

describe("fetchCoverArt()", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns image buffer for a valid release", async () => {
		// #given
		const fakeImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		fetchSpy.mockResolvedValue(
			new Response(fakeImageBytes, {
				status: 200,
				headers: { "Content-Type": "image/png" },
			}),
		);

		// #when
		const result = await fetchCoverArt("release-123");

		// #then
		expect(result).toEqual({
			imageBuffer: Buffer.from(fakeImageBytes),
			mime: "image/png",
		} satisfies CoverArtResult);
	});

	it("returns null on 404", async () => {
		// #given
		fetchSpy.mockResolvedValue(new Response("", { status: 404 }));

		// #when
		const result = await fetchCoverArt("nonexistent-release");

		// #then
		expect(result).toBeNull();
	});

	it("returns null on timeout", async () => {
		// #given
		fetchSpy.mockImplementation(
			(_url: string | URL | Request, init?: RequestInit) => {
				return new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (signal) {
						signal.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
						});
					}
				});
			},
		);

		// #when
		const result = await fetchCoverArt("release-123", 10);

		// #then
		expect(result).toBeNull();
	});
});
