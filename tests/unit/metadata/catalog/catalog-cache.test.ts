import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	catalogArtworkUrl,
	clearCatalogCandidateCache,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import type { CatalogCandidate } from "$lib/metadata/catalog/catalog-candidate";

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

function stubStores(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (input: unknown) => ({
		ok: true,
		status: 200,
		json: async () =>
			String(input).includes("itunes")
				? itunesSearchBody()
				: deezerSearchBody(),
	}));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const QUERY = { artist: "Adele", title: "Hello" };

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
		expect(fetchMock).toHaveBeenCalledTimes(2);
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

	it("starts fresh after the cache is cleared", async () => {
		// #given
		const fetchMock = stubStores();
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #when
		clearCatalogCandidateCache();
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});

describe("catalogArtworkUrl()", () => {
	const itunes: CatalogCandidate = {
		source: "itunes",
		artist: "Adele",
		title: "Hello",
		artworkUrl: "https://is1-ssl.mzstatic.com/itunes.jpg",
	};
	const deezer: CatalogCandidate = {
		source: "deezer",
		artist: "Adele",
		title: "Hello",
		artworkUrl: "https://e-cdns-images.dzcdn.net/deezer.jpg",
	};

	it("prefers the cover the match proved", () => {
		// #when
		const url = catalogArtworkUrl({
			verdict: {
				status: "matched",
				via: "agreement",
				candidate: itunes,
				metadata: {
					artist: "Adele",
					title: "Hello",
					artworkUrl: "https://is1-ssl.mzstatic.com/matched.jpg",
					source: "itunes",
				},
			},
			candidates: [itunes, deezer],
		});

		// #then
		expect(url).toBe("https://is1-ssl.mzstatic.com/matched.jpg");
	});

	it("falls back to the iTunes candidate when nothing matched", () => {
		// #when — today's order, from the responses already in memory
		const url = catalogArtworkUrl({
			verdict: { status: "unmatched", reason: "unverified" },
			candidates: [deezer, itunes],
		});

		// #then
		expect(url).toBe(itunes.artworkUrl);
	});

	it("falls back to any candidate's cover when iTunes has none", () => {
		// #when
		const url = catalogArtworkUrl({
			verdict: { status: "unmatched", reason: "unverified" },
			candidates: [{ ...itunes, artworkUrl: undefined }, deezer],
		});

		// #then
		expect(url).toBe(deezer.artworkUrl);
	});

	it("gives nothing when no candidate has a cover", () => {
		// #when
		const url = catalogArtworkUrl({
			verdict: { status: "unmatched", reason: "no-candidates" },
			candidates: [],
		});

		// #then
		expect(url).toBeUndefined();
	});
});
