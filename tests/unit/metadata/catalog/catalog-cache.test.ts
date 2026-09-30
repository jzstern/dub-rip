import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cardSizedArtwork,
	clearCatalogCandidateCache,
	releaseCover,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import type { CatalogCandidate } from "$lib/metadata/catalog/catalog-candidate";
import { stubCatalogFetch } from "./catalog-fixtures";

/** One Deezer row for "Adele — Hello", enough for the judge to reason about. */
function deezerSearchBody() {
	return {
		data: [
			{
				title: "Hello",
				duration: 295,
				artist: { name: "Adele" },
				album: {
					id: 1,
					title: "25",
					cover_xl: "https://e-cdns-images.dzcdn.net/600x600bb.jpg",
				},
			},
		],
	};
}

function itunesSearchBody() {
	return {
		results: [
			{
				kind: "song",
				trackName: "Hello",
				artistName: "Adele",
				collectionName: "25",
				releaseDate: "2015-11-20T00:00:00Z",
				primaryGenreName: "Pop",
				trackTimeMillis: 295_000,
				artworkUrl100: "https://is1-ssl.mzstatic.com/100x100bb.jpg",
			},
		],
	};
}

/** The album a Deezer row is checked against before it is judged. */
function deezerAlbumBody() {
	return { artist: { name: "Adele" }, label: "XL Recordings" };
}

function stubStores(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (input: unknown) => {
		const url = String(input);
		return {
			ok: true,
			status: 200,
			json: async () =>
				url.includes("itunes")
					? itunesSearchBody()
					: url.includes("/album/")
						? deezerAlbumBody()
						: deezerSearchBody(),
		};
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const QUERY = { artist: "Adele", title: "Hello" };

function searchesIn(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
	return fetchMock.mock.calls.filter(
		(call) => !String(call[0]).includes("/album/"),
	);
}

describe("sharedCatalogLookup()", () => {
	beforeEach(() => {
		clearCatalogCandidateCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches candidates once for two lookups of the same track", async () => {
		// #given — a preview, then /details, for one track
		const fetchMock = stubStores();

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });
		await sharedCatalogLookup(
			{ ...QUERY, durationSeconds: 295 },
			{ timeout: 4000 },
		);

		// #then — two searches in total, not four: the duration does not change the key
		expect(searchesIn(fetchMock)).toHaveLength(2);
	});

	it("judges the later lookup on the evidence it has, not the earlier one's", async () => {
		// #given
		stubStores();

		// #when — the preview has no duration; /details supplies it
		const preview = await sharedCatalogLookup(QUERY, { timeout: 4000 });
		const details = await sharedCatalogLookup(
			{ ...QUERY, durationSeconds: 295 },
			{ timeout: 4000 },
		);

		// #then — the same cached candidates, a stronger verdict
		expect([preview.verdict.status, details.verdict.status]).toEqual([
			"matched",
			"matched",
		]);
	});

	it("forgets an outage, so the next request retries", async () => {
		// #given
		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then — four calls: two attempts of two searches, nothing remembered
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("answers unmatched when no catalog can be reached", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		// #when
		const { verdict } = await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "no-candidates" });
	});

	it("remembers a genuine empty answer", async () => {
		// #given — the stores answered, and had nothing
		const fetchMock = vi.fn(async (input: unknown) => ({
			ok: true,
			status: 200,
			json: async () =>
				String(input).includes("itunes") ? { results: [] } : { data: [] },
		}));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("never calls out for a track with no artist and no title", async () => {
		// #given
		const fetchMock = stubStores();

		// #when
		const { verdict } = await sharedCatalogLookup(
			{ artist: "", title: "  " },
			{ timeout: 4000 },
		);

		// #then
		expect([verdict.status, fetchMock.mock.calls.length]).toEqual([
			"unmatched",
			0,
		]);
	});

	it("lets the download reuse the searches the preview made", async () => {
		// #given — a preview, then the download for the same track
		const fetchMock = stubStores();
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #when
		await sharedCatalogLookup(
			{ ...QUERY, durationSeconds: 295 },
			{ timeout: 6000 },
		);

		// #then — two searches in all, and no album call without an ISRC
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("gives no verdict on half the evidence when one catalog is down", async () => {
		// #given — iTunes is throttled; Deezer answers
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes("itunes")) {
					return { ok: false, status: 403, json: async () => ({}) };
				}
				return { ok: true, status: 200, json: async () => deezerSearchBody() };
			}),
		);

		// #when
		const { verdict } = await sharedCatalogLookup(
			{ ...QUERY, durationSeconds: 295 },
			{ timeout: 4000 },
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("names the song, but no release, when the release's album check fails", async () => {
		// #given — the searches answer; the album of the row carrying the ISRC does not
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes("/album/") || url.includes("/track/isrc")) {
					return { ok: false, status: 503, json: async () => ({}) };
				}
				const deezer = {
					data: [{ ...deezerSearchBody().data[0], isrc: "GBBKS1500214" }],
				};
				return {
					ok: true,
					status: 200,
					json: async () =>
						url.includes("itunes") ? itunesSearchBody() : deezer,
				};
			}),
		);

		// #when
		const { verdict } = await sharedCatalogLookup(
			{ ...QUERY, durationSeconds: 295, isrc: "GBBKS1500214" },
			{ timeout: 4000 },
		);

		// #then
		expect(
			verdict.status === "matched" && [
				verdict.metadata.artist,
				verdict.metadata.album,
			],
		).toEqual(["Adele", undefined]);
	});

	it("judges the same way whichever query filled the cache", async () => {
		// #given — a lyric channel's title shares the official upload's cache key
		stubCatalogFetch();
		const official = {
			artist: "Flume",
			title: "Never Be Like You feat. Kai",
			durationSeconds: 233,
		};
		const alone = await sharedCatalogLookup(official, { timeout: 4000 });
		clearCatalogCandidateCache();
		await sharedCatalogLookup(
			{ artist: "Flume", title: "Never Be Like You Kai" },
			{ timeout: 4000 },
		);

		// #when
		const afterAnother = await sharedCatalogLookup(official, { timeout: 4000 });

		// #then
		expect(afterAnother.verdict).toEqual(alone.verdict);
	});

	it("starts fresh after the cache is cleared", async () => {
		// #given
		const fetchMock = stubStores();
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #when
		clearCatalogCandidateCache();
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(searchesIn(fetchMock)).toHaveLength(4);
	});
});

describe("releaseCover()", () => {
	const deezer: CatalogCandidate = {
		source: "deezer",
		artist: "Adele",
		title: "Hello",
		artworkUrl: "https://e-cdns-images.dzcdn.net/deezer.jpg",
	};

	it("gives the proven release's cover, with its source", () => {
		// #when
		const artwork = releaseCover({
			verdict: {
				status: "matched",
				via: "isrc",
				candidate: deezer,
				metadata: {
					artist: "Adele",
					title: "Hello",
					artworkUrl: "https://e-cdns-images.dzcdn.net/deezer.jpg",
					source: "deezer",
				},
			},
		});

		// #then
		expect(artwork).toEqual({
			url: "https://e-cdns-images.dzcdn.net/deezer.jpg",
			source: "deezer",
		});
	});

	it("gives nothing for a match that proved the song but no release", () => {
		// #when — the matched row's own cover may be another release's sleeve
		const artwork = releaseCover({
			verdict: {
				status: "matched",
				via: "duration",
				candidate: deezer,
				metadata: { artist: "Adele", title: "Hello", source: "deezer" },
			},
		});

		// #then
		expect(artwork).toBeUndefined();
	});

	it("gives nothing when nothing matched", () => {
		// #when
		const artwork = releaseCover({
			verdict: { status: "unmatched", reason: "unverified" },
		});

		// #then
		expect(artwork).toBeUndefined();
	});
});

describe("cardSizedArtwork()", () => {
	it.each([
		[
			"an iTunes template",
			"https://is1-ssl.mzstatic.com/image/600x600bb.jpg",
			"https://is1-ssl.mzstatic.com/image/300x300bb.jpg",
		],
		[
			"a Deezer path segment",
			"https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg",
			"https://cdn-images.dzcdn.net/images/cover/abc/300x300-000000-80-0-0.jpg",
		],
	])("downscales %s for the 56 px card", (_name, full, small) => {
		// #when — Deezer is the preferred source on a match, so its form must work too
		const sized = cardSizedArtwork(full);

		// #then
		expect(sized).toBe(small);
	});

	it("leaves a URL it does not recognise alone", () => {
		// #when
		const sized = cardSizedArtwork(
			"https://i1.sndcdn.com/artworks-x-t500x500.jpg",
		);

		// #then
		expect(sized).toBe("https://i1.sndcdn.com/artworks-x-t500x500.jpg");
	});
});
