import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CoverArtResult,
	fetchCoverArt,
	fetchThumbnailArt,
	lookupTrack,
	type TrackMetadata,
} from "./musicbrainz";

const MUSICBRAINZ_RECORDING_RESPONSE = {
	recordings: [
		{
			title: "Starlight",
			"artist-credit": [{ name: "Muse" }],
			releases: [
				{
					id: "release-abc-123",
					title: "Black Holes and Revelations",
					date: "2006-07-03",
					"release-group": { "primary-type": "Album" },
					media: [{ track: [{ number: "2" }] }],
					"label-info": [{ label: { name: "Helium 3" } }],
				},
			],
			tags: [
				{ name: "alternative rock", count: 12 },
				{ name: "space rock", count: 4 },
			],
		},
	],
};

const FAKE_COVER_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const FAKE_THUMBNAIL_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

describe("metadata enrichment integration", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("MusicBrainz match with cover art", () => {
		it("returns track metadata with album, year, and genre", async () => {
			// #given
			fetchSpy.mockResolvedValueOnce(
				new Response(JSON.stringify(MUSICBRAINZ_RECORDING_RESPONSE), {
					status: 200,
				}),
			);

			// #when
			const metadata = await lookupTrack("Muse", "Starlight");

			// #then
			expect(metadata).toEqual({
				album: "Black Holes and Revelations",
				year: "2006",
				genre: "alternative rock",
				trackNumber: "2",
				label: "Helium 3",
				releaseId: "release-abc-123",
			} satisfies TrackMetadata);
		});

		it("fetches cover art using the returned releaseId", async () => {
			// #given
			fetchSpy.mockResolvedValueOnce(
				new Response(JSON.stringify(MUSICBRAINZ_RECORDING_RESPONSE), {
					status: 200,
				}),
			);
			fetchSpy.mockResolvedValueOnce(
				new Response(FAKE_COVER_BYTES, {
					status: 200,
					headers: { "Content-Type": "image/png" },
				}),
			);

			// #when
			const metadata = await lookupTrack("Muse", "Starlight");
			expect(metadata).not.toBeNull();
			const coverArt = await fetchCoverArt(metadata?.releaseId ?? "");

			// #then
			expect(coverArt).toEqual({
				imageBuffer: Buffer.from(FAKE_COVER_BYTES),
				mime: "image/png",
			} satisfies CoverArtResult);
		});
	});

	describe("no MusicBrainz match with YouTube thumbnail fallback", () => {
		it("returns null when MusicBrainz has no recordings", async () => {
			// #given
			fetchSpy.mockResolvedValueOnce(
				new Response(JSON.stringify({ recordings: [] }), { status: 200 }),
			);

			// #when
			const metadata = await lookupTrack("Unknown Artist", "Unknown Track");

			// #then
			expect(metadata).toBeNull();
		});

		it("falls back to YouTube thumbnail when lookup returns null", async () => {
			// #given
			fetchSpy.mockResolvedValueOnce(
				new Response(JSON.stringify({ recordings: [] }), { status: 200 }),
			);
			fetchSpy.mockResolvedValueOnce(
				new Response(FAKE_THUMBNAIL_BYTES, {
					status: 200,
					headers: { "Content-Type": "image/jpeg" },
				}),
			);

			// #when
			const metadata = await lookupTrack("Unknown Artist", "Unknown Track");
			const thumbnail = await fetchThumbnailArt("dQw4w9WgXcQ");

			// #then
			expect(metadata).toBeNull();
			expect(thumbnail).toEqual({
				imageBuffer: Buffer.from(FAKE_THUMBNAIL_BYTES),
				mime: "image/jpeg",
			} satisfies CoverArtResult);
		});
	});
});
