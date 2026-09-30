import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "$lib/metadata/catalog/catalog-candidate";
import {
	candidateCacheKey,
	clearDeezerAlbumCache,
	fetchCatalogCandidates,
	lookupCatalogMetadata,
	searchTerm,
	vouchedCandidates,
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

	it("asks the ISRC and both searches together, so an unrelated ISRC cannot suppress them", async () => {
		// #given
		const fetchMock = stubCatalogFetch();

		// #when
		await fetchCatalogCandidates({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
		});

		// #then
		expect(
			fetchMock.mock.calls.filter(
				(call) => !String(call[0]).includes("/album/"),
			),
		).toHaveLength(3);
	});

	it("still returns search results when the ISRC is unknown", async () => {
		// #given — the fabricated ISRC is expected to be absent from the fixtures
		stubCatalogFetch({ allowMissing: ["ZZZZZ0000000"] });

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "ZZZZZ0000000",
		});

		// #then
		expect(candidates.length).toBeGreaterThan(1);
	});

	it("throws when no catalog can be reached, rather than reporting an empty result", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		// #when
		const attempt = fetchCatalogCandidates({ artist: "Adele", title: "Hello" });

		// #then — an outage reported as "no such track" would outlive the outage
		await expect(attempt).rejects.toThrow(/catalog/i);
	});

	it("keeps searching out of a title we could not classify", () => {
		// #when — "unknown" is the sentinel for an unrecognised bracket, not a word
		const term = searchTerm({
			artist: "Lostin Powers",
			title: "She so Heavy (SneakPreview)",
		});

		// #then
		expect(term).toBe("Lostin Powers She so Heavy sneakpreview");
	});
});

describe("vouchedCandidates()", () => {
	const QUERY = { artist: "Adele", title: "Hello" };

	function deezerRow(
		overrides: Partial<CatalogCandidate> = {},
	): CatalogCandidate {
		return {
			source: "deezer",
			artist: "Adele",
			title: "Hello",
			album: "25",
			albumId: "7",
			durationSeconds: 295,
			...overrides,
		};
	}

	function stubAlbums(
		answer: (url: string) => { ok: boolean; status: number; body: unknown },
	): ReturnType<typeof vi.fn> {
		const fetchMock = vi.fn(async (input: unknown) => {
			const { ok, status, body } = answer(String(input));
			return { ok, status, json: async () => body };
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	const ADELE_ALBUM = {
		ok: true,
		status: 200,
		body: { artist: { name: "Adele" }, record_type: "album" },
	};

	beforeEach(() => {
		clearDeezerAlbumCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("drops a Deezer row whose album cannot be read, rather than trust it", async () => {
		// #given
		stubAlbums(() => ({ ok: false, status: 503, body: {} }));

		// #when
		const vouched = await vouchedCandidates(QUERY, [deezerRow()], 1000);

		// #then — the lookup fails closed rather than judge without the row
		expect(vouched).toBeNull();
	});

	it("asks again on the next lookup, so a failed check is never an answer", async () => {
		// #given — the first album call fails, the second succeeds
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ADELE_ALBUM.body,
			});
		vi.stubGlobal("fetch", fetchMock);
		await vouchedCandidates(QUERY, [deezerRow()], 1000);

		// #when
		const vouched = await vouchedCandidates(QUERY, [deezerRow()], 1000);

		// #then
		expect(vouched?.map((row) => row.albumArtist)).toEqual(["Adele"]);
	});

	it("drops a row whose album answers without saying whose it is", async () => {
		// #given
		stubAlbums(() => ({ ok: true, status: 200, body: { title: "25" } }));

		// #when
		const vouched = await vouchedCandidates(QUERY, [deezerRow()], 1000);

		// #then
		expect(vouched).toBeNull();
	});

	it("asks no album about a row that names another song", async () => {
		// #given
		const fetchMock = stubAlbums(() => ADELE_ALBUM);

		// #when
		await vouchedCandidates(
			QUERY,
			[deezerRow({ title: "Someone Like You", albumId: "8" })],
			1000,
		);

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("checks at most three albums, taking the catalog's top rows", async () => {
		// #given — five releases of the same song
		stubAlbums(() => ADELE_ALBUM);
		const rows = ["1", "2", "3", "4", "5"].map((albumId, rank) =>
			deezerRow({ albumId, rank }),
		);

		// #when
		const vouched = await vouchedCandidates(QUERY, rows, 1000);

		// #then
		expect(vouched?.map((row) => row.albumId)).toEqual(["1", "2", "3"]);
	});

	it("spends its album checks on the upload's version, not on live takes of it", async () => {
		// #given — three live takes rank above the studio release
		stubAlbums(() => ADELE_ALBUM);
		const liveTakes = ["1", "2", "3"].map((albumId, rank) =>
			deezerRow({ title: "Hello (Live)", albumId, rank }),
		);
		const studio = deezerRow({ albumId: "4", rank: 3 });

		// #when
		const vouched = await vouchedCandidates(
			QUERY,
			[...liveTakes, studio],
			1000,
		);

		// #then
		expect(vouched?.find((row) => row.albumId === "4")?.albumArtist).toBe(
			"Adele",
		);
	});

	it("asks for an album once, however many lookups need it", async () => {
		// #given
		const fetchMock = stubAlbums(() => ADELE_ALBUM);
		await vouchedCandidates(QUERY, [deezerRow()], 1000);

		// #when
		await vouchedCandidates(
			{ ...QUERY, durationSeconds: 295 },
			[deezerRow()],
			1000,
		);

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("passes iTunes rows through, which carry their collection's credit", async () => {
		// #given
		const fetchMock = stubAlbums(() => ADELE_ALBUM);
		const itunesRow = deezerRow({ source: "itunes", albumId: undefined });

		// #when
		const vouched = await vouchedCandidates(QUERY, [itunesRow], 1000);

		// #then
		expect([vouched, fetchMock.mock.calls.length]).toEqual([[itunesRow], 0]);
	});

	it("records whose album a Deezer row sits on", async () => {
		// #given
		stubCatalogFetch();
		const query = { artist: "Flume", title: "Never Be Like You feat. Kai" };

		// #when
		const vouched = await vouchedCandidates(
			query,
			await fetchCatalogCandidates(query),
			5000,
		);

		// #then
		expect(
			vouched?.find((candidate) => candidate.album === "The Lockbox")
				?.albumArtist,
		).toBe("The Amalgamates");
	});
});

describe("lookupCatalogMetadata()", () => {
	beforeEach(() => {
		clearDeezerAlbumCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("matches a SoundCloud upload through its own ISRC", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
			durationSeconds: 194,
		});

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

	it("takes a proven Deezer release's label from the album it checked", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
		});

		// #then
		expect(verdict.status === "matched" && verdict.metadata.label).toBe(
			"Darkroom/Interscope Records",
		);
	});

	it("fails closed when either catalog cannot be searched", async () => {
		// #given — Deezer answers; iTunes is down
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				if (String(input).includes("itunes")) throw new Error("network down");
				return {
					ok: true,
					status: 200,
					json: async () => ({
						data: [
							{
								title: "Hello",
								duration: 295,
								artist: { name: "Adele" },
								album: { id: 7, title: "25" },
							},
						],
					}),
				};
			}),
		);

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Adele",
			title: "Hello",
			durationSeconds: 295,
		});

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("writes only the artist and title of a track found on a compilation", async () => {
		// #given — the recorded search matches, but its album is a Various Artists set
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.includes("itunes.apple.com")) {
				return { ok: true, status: 200, json: async () => ({ results: [] }) };
			}
			if (url.includes("/album/")) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						artist: { name: "Various Artists" },
						label: "Deadline Rec",
						record_type: "compile",
						genres: { data: [{ name: "Electronic" }] },
					}),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{
							title: "Se Cura",
							duration: 286,
							artist: { name: "Klaps" },
							album: { id: 42, title: "Deadline Records Va 05" },
						},
					],
				}),
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Klaps",
			title: "Se Cura",
			durationSeconds: 286,
		});

		// #then
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Klaps",
			title: "Se Cura",
			source: "deezer",
		});
	});

	it("writes the real single, not a knock-off Deezer files under the artist's name", async () => {
		// #given — recorded: Deezer's same-runtime row sits on The Amalgamates' album
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Flume",
			title: "Never Be Like You feat. Kai",
			durationSeconds: 233,
		});

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				album: "Never Be Like You (feat. Kai) - Single",
				source: "itunes",
			},
		});
	});

	it("takes no ISRC or label from the knock-offs beside the real single", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Flume",
			title: "Never Be Like You feat. Kai",
			durationSeconds: 233,
		});

		// #then
		expect(
			verdict.status === "matched" && [
				verdict.metadata.isrc,
				verdict.metadata.label,
			],
		).toEqual([undefined, undefined]);
	});

	it("keeps a feature Deezer files outside the title", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Disclosure",
			title: "Latch ft. Sam Smith",
			durationSeconds: 256,
		});

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { title: "Latch (feat. Sam Smith)" },
		});
	});

	it("keeps the recording's year over a Deezer album dated with a Jan 1 placeholder", async () => {
		// #given — iTunes dates the release 1972; Deezer's album says 1970-01-01
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				const body = url.includes("itunes")
					? {
							results: [
								{
									kind: "song",
									trackName: "Stuck In The Middle With You",
									artistName: "Stealers Wheel",
									collectionName: "Stealers Wheel",
									releaseDate: "1972-11-01T00:00:00Z",
									trackTimeMillis: 208_000,
								},
							],
						}
					: url.includes("/album/")
						? {
								artist: { name: "Stealers Wheel" },
								label: "A&M",
								release_date: "1970-01-01",
							}
						: {
								data: [
									{
										title: "Stuck In The Middle With You",
										duration: 208,
										artist: { name: "Stealers Wheel" },
										album: { id: 5, title: "Stealers Wheel" },
									},
								],
							};
				return { ok: true, status: 200, json: async () => body };
			}),
		);

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			durationSeconds: 209,
		});

		// #then
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(1972);
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

	it("does not cache an outage, so the next request retries", async () => {
		// #given
		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});
		vi.stubGlobal("fetch", fetchMock);
		const store = new Map<string, unknown>();
		const cache = {
			get: async (
				key: string,
				fetchValue: () => Promise<
					Awaited<ReturnType<typeof fetchCatalogCandidates>>
				>,
			) => {
				if (!store.has(key)) store.set(key, await fetchValue());
				return store.get(key) as Awaited<
					ReturnType<typeof fetchCatalogCandidates>
				>;
			},
		};
		const query = { artist: "Adele", title: "Hello" };

		// #when
		await lookupCatalogMetadata(query, { cache });
		await lookupCatalogMetadata(query, { cache });

		// #then — two attempts, four calls: nothing was remembered
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("fetches once for repeated lookups when given a cache", async () => {
		// #given
		const fetchMock = stubCatalogFetch();
		const store = new Map<string, unknown>();
		const cache = {
			get: async (
				key: string,
				fetchValue: () => Promise<
					Awaited<ReturnType<typeof fetchCatalogCandidates>>
				>,
			) => {
				if (!store.has(key)) store.set(key, await fetchValue());
				return store.get(key) as Awaited<
					ReturnType<typeof fetchCatalogCandidates>
				>;
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
		const searches = fetchMock.mock.calls.filter(
			(call) => !String(call[0]).includes("/album/"),
		);
		expect([searches.length, second.status]).toEqual([2, "matched"]);
	});
});

describe("candidateCacheKey()", () => {
	it("shares an entry between titles that search identically", () => {
		// #when — the bracketed noise is dropped from the search term
		const key = candidateCacheKey({
			artist: "Queen",
			title: "Bohemian Rhapsody (Official Video Remastered)",
		});

		// #then
		expect(key).toBe(
			candidateCacheKey({ artist: "Queen", title: "Bohemian Rhapsody" }),
		);
	});

	it("separates titles whose version changes what is searched for", () => {
		// #when
		const key = candidateCacheKey({
			artist: "Avicii",
			title: "Levels (Skrillex Remix)",
		});

		// #then
		expect(key).not.toBe(
			candidateCacheKey({ artist: "Avicii", title: "Levels" }),
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
