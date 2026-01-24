import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CoverArtResult,
	fetchCoverArt,
	fetchThumbnailArt,
	lookupTrack,
	type TrackMetadata,
} from "./musicbrainz";

const SEARCH_RESPONSE = {
	recordings: [
		{
			id: "recording-001",
			title: "Bohemian Rhapsody",
			"artist-credit": [{ name: "Queen" }],
			releases: [
				{
					id: "release-123",
					title: "A Night at the Opera",
					date: "1975-10-31",
					"release-group": { "primary-type": "Album" },
					media: [{ track: [{ number: "11" }] }],
				},
			],
		},
	],
};

const TAGS_RESPONSE = {
	tags: [
		{ name: "rock", count: 10 },
		{ name: "classic rock", count: 5 },
	],
};

const LABELS_RESPONSE = {
	"label-info": [{ label: { name: "EMI" } }],
};

const ALBUM_VS_SINGLE_SEARCH_RESPONSE = {
	recordings: [
		{
			id: "recording-002",
			title: "Bohemian Rhapsody",
			"artist-credit": [{ name: "Queen" }],
			releases: [
				{
					id: "single-456",
					title: "Bohemian Rhapsody (Single)",
					date: "1975-10-31",
					"release-group": { "primary-type": "Single" },
					media: [{ track: [{ number: "1" }] }],
				},
				{
					id: "album-789",
					title: "A Night at the Opera",
					date: "1975-11-21",
					"release-group": { "primary-type": "Album" },
					media: [{ track: [{ number: "11" }] }],
				},
			],
		},
	],
};

const ALBUM_TAGS_RESPONSE = {
	tags: [{ name: "rock", count: 8 }],
};

const ALBUM_LABELS_RESPONSE = {
	"label-info": [{ label: { name: "EMI Records" } }],
};

function mockSearchWithLookups(
	fetchSpy: ReturnType<typeof vi.spyOn>,
	searchResponse: object,
	tagsResponse: object,
	labelsResponse: object,
): void {
	fetchSpy.mockResolvedValueOnce(
		new Response(JSON.stringify(searchResponse), { status: 200 }),
	);
	fetchSpy.mockResolvedValueOnce(
		new Response(JSON.stringify(tagsResponse), { status: 200 }),
	);
	fetchSpy.mockResolvedValueOnce(
		new Response(JSON.stringify(labelsResponse), { status: 200 }),
	);
}

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
		mockSearchWithLookups(
			fetchSpy,
			SEARCH_RESPONSE,
			TAGS_RESPONSE,
			LABELS_RESPONSE,
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

	it("calls recording tags and release labels endpoints", async () => {
		// #given
		mockSearchWithLookups(
			fetchSpy,
			SEARCH_RESPONSE,
			TAGS_RESPONSE,
			LABELS_RESPONSE,
		);

		// #when
		await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[1][0]).toContain("/recording/recording-001");
		expect(fetchSpy.mock.calls[1][0]).toContain("inc=tags");
		expect(fetchSpy.mock.calls[2][0]).toContain("/release/release-123");
		expect(fetchSpy.mock.calls[2][0]).toContain("inc=labels");
	});

	it("returns null when no recordings match", async () => {
		// #given
		fetchSpy.mockResolvedValueOnce(
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
		mockSearchWithLookups(
			fetchSpy,
			ALBUM_VS_SINGLE_SEARCH_RESPONSE,
			ALBUM_TAGS_RESPONSE,
			ALBUM_LABELS_RESPONSE,
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

	it("returns empty genre when tags lookup fails", async () => {
		// #given
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }),
		);
		fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify(LABELS_RESPONSE), { status: 200 }),
		);

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result?.genre).toBe("");
		expect(result?.label).toBe("EMI");
	});

	it("returns empty label when labels lookup fails", async () => {
		// #given
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }),
		);
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify(TAGS_RESPONSE), { status: 200 }),
		);
		fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result?.genre).toBe("rock");
		expect(result?.label).toBe("");
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
		fetchSpy.mockResolvedValueOnce(new Response("", { status: 503 }));

		// #when
		const result = await lookupTrack("Queen", "Bohemian Rhapsody");

		// #then
		expect(result).toBeNull();
	});

	it("returns null when fetch throws a network error", async () => {
		// #given
		fetchSpy.mockRejectedValueOnce(new Error("Network unreachable"));

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

describe("fetchThumbnailArt()", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns thumbnail buffer for a valid video ID", async () => {
		// #given
		const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		fetchSpy.mockResolvedValue(
			new Response(fakeImageBytes, {
				status: 200,
				headers: { "Content-Type": "image/jpeg" },
			}),
		);

		// #when
		const result = await fetchThumbnailArt("dQw4w9WgXcQ");

		// #then
		expect(result).toEqual({
			imageBuffer: Buffer.from(fakeImageBytes),
			mime: "image/jpeg",
		} satisfies CoverArtResult);
	});

	it("returns null on network error", async () => {
		// #given
		fetchSpy.mockRejectedValue(new Error("Network unreachable"));

		// #when
		const result = await fetchThumbnailArt("dQw4w9WgXcQ");

		// #then
		expect(result).toBeNull();
	});
});
