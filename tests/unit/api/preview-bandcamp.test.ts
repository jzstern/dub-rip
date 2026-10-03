import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBandcampTrackMock, sharedCatalogLookupMock } = vi.hoisted(() => ({
	getBandcampTrackMock: vi.fn(),
	sharedCatalogLookupMock: vi.fn(),
}));

/** Without this the real lookup runs and these tests call iTunes and Deezer. */
const NO_MATCH = {
	verdict: { status: "unmatched" as const, reason: "no-candidates" as const },
};
const mockEnv = vi.hoisted(
	() => ({ BGUTIL_POT_URL: "http://bgutil" }) as Record<string, string>,
);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/bandcamp/bandcamp-track-cache", () => ({
	getBandcampTrack: getBandcampTrackMock,
}));
vi.mock("$lib/artwork", () => ({
	resolveArtworkUrl: vi.fn(async () => "https://store/art.jpg"),
}));
vi.mock("$lib/metadata/catalog/catalog-cache", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("$lib/metadata/catalog/catalog-cache")
	>()),
	sharedCatalogLookup: sharedCatalogLookupMock,
}));
vi.mock("$lib/youtube-metadata", () => ({
	fetchYouTubeMetadata: vi.fn(),
	YouTubeMetadataError: class extends Error {},
}));

import { resolveArtworkUrl } from "$lib/artwork";
import { BANDCAMP_NOT_STREAMABLE_MESSAGE } from "$lib/bandcamp/bandcamp-metadata";
import {
	BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
	type BandcampTrack,
	BandcampTrackError,
} from "$lib/bandcamp/bandcamp-track";
import { fetchYouTubeMetadata } from "$lib/youtube-metadata";
import { POST as previewPOST } from "../../../src/routes/api/preview/+server";
import { POST as detailsPOST } from "../../../src/routes/api/preview/details/+server";

const TRACK_URL = "https://benprunty.bandcamp.com/track/lanius-battle";

const TRACK: BandcampTrack = {
	title: "Lanius (Battle)",
	artist: "Ben Prunty",
	bandName: "Ben Prunty",
	albumTitle: "FTL: Advanced Edition Soundtrack",
	releaseDate: "2014-04-03T00:00:00.000Z",
	durationSeconds: 261,
	artworkUrl: "https://f4.bcbits.com/img/a1270682128_16.jpg",
	isStreamable: true,
	hasFreeDownload: false,
};

/** `never` because the preview and details handlers type their events by different route IDs. */
function eventFor(url: string): never {
	return { request: { json: async () => ({ url }) } } as never;
}

describe("POST /api/preview — Bandcamp", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getBandcampTrackMock.mockResolvedValue(TRACK);
		sharedCatalogLookupMock.mockResolvedValue(NO_MATCH);
	});

	it("previews the resolved identity with the track's own artwork", async () => {
		// #when
		const response = await previewPOST(eventFor(TRACK_URL));

		// #then
		expect(await response.json()).toEqual({
			success: true,
			videoTitle: "Lanius (Battle)",
			artist: "Ben Prunty",
			title: "Lanius (Battle)",
			thumbnail: TRACK.artworkUrl,
			artwork: TRACK.artworkUrl,
			duration: 261,
		});
	});

	it("never searches the stores or YouTube when the track has its own artwork", async () => {
		// #when
		await previewPOST(eventFor(TRACK_URL));

		// #then
		expect({
			stores: vi.mocked(resolveArtworkUrl).mock.calls.length,
			youtube: vi.mocked(fetchYouTubeMetadata).mock.calls.length,
		}).toEqual({ stores: 0, youtube: 0 });
	});

	it("looks the track up by its canonical URL", async () => {
		// #when
		await previewPOST(eventFor(`${TRACK_URL}?from=embed`));

		// #then
		expect(getBandcampTrackMock).toHaveBeenCalledWith({
			kind: "bandcamp",
			id: "benprunty/lanius-battle",
			canonicalUrl: TRACK_URL,
		});
	});

	it("announces 320 kbps for a free download", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({ ...TRACK, hasFreeDownload: true });

		// #when
		const data = await (await previewPOST(eventFor(TRACK_URL))).json();

		// #then
		expect(data.bitrateKbps).toBe(320);
	});

	it("omits the bitrate key for a stream-only track", async () => {
		// #when
		const data = await (await previewPOST(eventFor(TRACK_URL))).json();

		// #then
		expect(Object.keys(data)).not.toContain("bitrateKbps");
	});

	it("searches the stores only when the track has no artwork", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({
			...TRACK,
			artworkUrl: undefined,
		});

		// #when
		const data = await (await previewPOST(eventFor(TRACK_URL))).json();

		// #then
		expect(data).toMatchObject({
			thumbnail: "",
			artwork: "https://store/art.jpg",
		});
	});

	it("refuses a track with streaming turned off with a 422", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({ ...TRACK, isStreamable: false });

		// #when
		const response = await previewPOST(eventFor(TRACK_URL));

		// #then
		expect({ status: response.status, body: await response.json() }).toEqual({
			status: 422,
			body: { error: BANDCAMP_NOT_STREAMABLE_MESSAGE },
		});
	});

	it("answers 404 for an unavailable track", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("gone", true),
		);

		// #when
		const response = await previewPOST(eventFor(TRACK_URL));

		// #then
		expect(response.status).toBe(404);
	});

	it("answers 422 with the custom-domain message", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("redirect", false, BANDCAMP_CUSTOM_DOMAIN_MESSAGE),
		);

		// #when
		const response = await previewPOST(eventFor(TRACK_URL));

		// #then
		expect({ status: response.status, body: await response.json() }).toEqual({
			status: 422,
			body: { error: BANDCAMP_CUSTOM_DOMAIN_MESSAGE },
		});
	});

	it("answers 500 when the track page couldn't be read", async () => {
		// #given
		getBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("Failed to load track info"),
		);

		// #when
		const response = await previewPOST(eventFor(TRACK_URL));

		// #then
		expect({ status: response.status, body: await response.json() }).toEqual({
			status: 500,
			body: { error: "Failed to load preview" },
		});
	});

	it("never prewarms bgutil-pot for Bandcamp", async () => {
		// #given
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await previewPOST(eventFor(TRACK_URL));

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("rejects a Bandcamp album link as unsupported", async () => {
		// #when
		const response = await previewPOST(
			eventFor("https://benprunty.bandcamp.com/album/ftl"),
		);

		// #then
		expect(getBandcampTrackMock).not.toHaveBeenCalled();
		expect(response.status).toBe(400);
	});
});

describe("POST /api/preview/details — Bandcamp", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getBandcampTrackMock.mockResolvedValue(TRACK);
		sharedCatalogLookupMock.mockResolvedValue(NO_MATCH);
	});

	it("queries the catalog with the track's own ISRC and duration", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({ ...TRACK, isrc: "USA2P1412345" });

		// #when
		await detailsPOST(eventFor(TRACK_URL));

		// #then
		expect(sharedCatalogLookupMock).toHaveBeenCalledWith(
			{
				artist: "Ben Prunty",
				title: "Lanius (Battle)",
				isrc: "USA2P1412345",
				durationSeconds: 261,
			},
			{ timeout: 4000 },
		);
	});

	it("returns the duration from the cached track, with no yt-dlp run", async () => {
		// #when
		const response = await detailsPOST(eventFor(TRACK_URL));

		// #then
		expect(await response.json()).toEqual({ success: true, duration: 261 });
	});

	it("returns 200 with no duration field when the page had no duration", async () => {
		// #given
		getBandcampTrackMock.mockResolvedValue({
			...TRACK,
			durationSeconds: undefined,
		});

		// #when
		const response = await detailsPOST(eventFor(TRACK_URL));

		// #then
		expect({ status: response.status, body: await response.json() }).toEqual({
			status: 200,
			body: { success: true },
		});
	});

	describe("on a catalog match", () => {
		const MATCHED = {
			verdict: {
				status: "matched" as const,
				via: "isrc" as const,
				candidate: {
					source: "deezer" as const,
					artist: "Ben Prunty",
					title: "Lanius (Battle)",
				},
				metadata: {
					artist: "Ben Prunty",
					title: "Lanius (Battle)",
					artworkUrl: "https://is1-ssl.mzstatic.com/proven/600x600bb.jpg",
					source: "itunes" as const,
				},
			},
		};

		it("keeps the track's own cover on the card, since the file gets that cover", async () => {
			// #given
			sharedCatalogLookupMock.mockResolvedValue(MATCHED);

			// #when
			const data = await (await detailsPOST(eventFor(TRACK_URL))).json();

			// #then
			expect(data).toEqual({
				success: true,
				duration: 261,
				artist: "Ben Prunty",
				title: "Lanius (Battle)",
			});
		});

		it("supplies the catalog cover when the track has none of its own", async () => {
			// #given
			getBandcampTrackMock.mockResolvedValue({
				...TRACK,
				artworkUrl: undefined,
			});
			sharedCatalogLookupMock.mockResolvedValue(MATCHED);

			// #when
			const data = await (await detailsPOST(eventFor(TRACK_URL))).json();

			// #then
			expect(data.artwork).toBe(
				"https://is1-ssl.mzstatic.com/proven/300x300bb.jpg",
			);
		});
	});
});
