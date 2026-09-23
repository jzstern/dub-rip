import { afterEach, describe, expect, it, vi } from "vitest";
import {
	candidateCacheKey,
	fetchCatalogCandidates,
	lookupCatalogMetadata,
} from "$lib/metadata/catalog/lookup-catalog";
import { stubCatalogFetch } from "./catalog-fixtures";

describe("fetchCatalogCandidates()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("searches both catalogs in one pass", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Billie Eilish",
			title: "bad guy",
		});

		// #then
		expect(new Set(candidates.map((candidate) => candidate.source))).toEqual(
			new Set(["itunes", "deezer"]),
		);
	});

	it("asks Deezer for the ISRC alone when the upload carries one", async () => {
		// #given
		const fetchMock = stubCatalogFetch();

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
		});

		// #then
		expect([candidates.length, fetchMock.mock.calls.length]).toEqual([1, 1]);
	});

	it("falls back to searching when the ISRC is unknown", async () => {
		// #given — the ISRC lookup 404s, the searches are recorded
		stubCatalogFetch();

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "ZZZZZ0000000",
		});

		// #then
		expect(candidates.length).toBeGreaterThan(1);
	});
});

describe("lookupCatalogMetadata()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("matches a SoundCloud upload through its own ISRC", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata(
			{
				artist: "Billie Eilish",
				title: "bad guy",
				isrc: "USUM71900764",
				durationSeconds: 194,
			},
			{ enrich: true },
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			via: "isrc",
			metadata: {
				artist: "Billie Eilish",
				title: "bad guy",
				album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
				year: 2019,
				genre: "Alternative",
				label: "Darkroom/Interscope Records",
				isrc: "USUM71900764",
			},
		});
	});

	it("leaves a bootleg edit alone", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Maroon 5",
			title: "Payphone [TWLGHT & SadBois Archive Edit 02]",
			durationSeconds: 231,
		});

		// #then
		expect(verdict).toEqual({
			status: "unmatched",
			reason: "version-mismatch",
		});
	});

	it("leaves a remix alone rather than tag it as the original", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Tame Impala",
			title: "Dracula (JENNIE Remix)",
		});

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("does not fetch an album unless asked to enrich", async () => {
		// #given
		const fetchMock = stubCatalogFetch();

		// #when
		await lookupCatalogMetadata({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
		});

		// #then
		expect(
			fetchMock.mock.calls.filter((call) =>
				String(call[0]).includes("/album/"),
			),
		).toEqual([]);
	});

	it("survives both catalogs failing", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Adele",
			title: "Hello",
		});

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "no-candidates" });
	});

	it("fetches once for repeated lookups when given a cache", async () => {
		// #given
		const fetchMock = stubCatalogFetch();
		const store = new Map<string, unknown>();
		const cache = {
			get: async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
				if (!store.has(key)) store.set(key, await factory());
				return store.get(key) as T;
			},
		};
		const query = { artist: "Billie Eilish", title: "bad guy" };

		// #when — a preview, then a download with the duration known
		await lookupCatalogMetadata(query, { cache });
		const second = await lookupCatalogMetadata(
			{ ...query, durationSeconds: 194 },
			{ cache },
		);

		// #then
		expect([fetchMock.mock.calls.length, second.status]).toEqual([
			2,
			"matched",
		]);
	});
});

describe("candidateCacheKey()", () => {
	it("ignores the punctuation and case an uploader typed", () => {
		// #when
		const key = candidateCacheKey({
			artist: "Billie Eilish",
			title: "Bad Guy",
		});

		// #then
		expect(key).toBe(
			candidateCacheKey({ artist: "billie eilish", title: "bad guy!" }),
		);
	});

	it("keeps a different ISRC in a different bucket", () => {
		// #when
		const key = candidateCacheKey({
			artist: "A",
			title: "B",
			isrc: "USUM71900764",
		});

		// #then
		expect(key).not.toBe(candidateCacheKey({ artist: "A", title: "B" }));
	});
});
