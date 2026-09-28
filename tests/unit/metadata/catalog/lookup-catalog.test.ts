import { afterEach, describe, expect, it, vi } from "vitest";
import {
	candidateCacheKey,
	fetchCatalogCandidates,
	lookupCatalogMetadata,
	searchTerm,
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

	it("drops a Deezer row whose album cannot be read, rather than trust it", async () => {
		// #given — the album call fails; only the search answers
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes("/album/")) {
					return { ok: false, status: 503, json: async () => ({}) };
				}
				return {
					ok: true,
					status: 200,
					json: async () =>
						url.includes("itunes")
							? { results: [] }
							: {
									data: [
										{
											title: "Hello",
											duration: 295,
											artist: { name: "Adele" },
											album: { id: 7, title: "25" },
										},
									],
								},
				};
			}),
		);

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Adele",
			title: "Hello",
		});

		// #then
		expect(candidates).toEqual([]);
	});

	it("asks no album about a row that names another song", async () => {
		// #given
		const fetchMock = vi.fn(async (input: unknown) => ({
			ok: true,
			status: 200,
			json: async () =>
				String(input).includes("itunes")
					? { results: [] }
					: {
							data: [
								{
									title: "Someone Like You",
									duration: 285,
									artist: { name: "Adele" },
									album: { id: 7, title: "21" },
								},
							],
						},
		}));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await fetchCatalogCandidates({ artist: "Adele", title: "Hello" });

		// #then
		expect(
			fetchMock.mock.calls.filter((call) =>
				String(call[0]).includes("/album/"),
			),
		).toEqual([]);
	});

	it("records whose album a Deezer row sits on", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await fetchCatalogCandidates({
			artist: "Flume",
			title: "Never Be Like You feat. Kai",
		});

		// #then
		expect(
			candidates.find((candidate) => candidate.album === "The Lockbox")
				?.albumArtist,
		).toBe("The Amalgamates");
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

	it("writes no label unless asked to enrich", async () => {
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
			undefined,
		);
	});

	it("drops the album when enrichment reveals a compilation", async () => {
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
		const verdict = await lookupCatalogMetadata(
			{ artist: "Klaps", title: "Se Cura", durationSeconds: 286 },
			{ enrich: true },
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				album: undefined,
				label: "Deadline Rec",
				genre: "Electronic",
			},
		});
	});

	it("writes the real single, not a knock-off Deezer files under the artist's name", async () => {
		// #given — recorded: Deezer's same-runtime row sits on The Amalgamates' album
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata(
			{
				artist: "Flume",
				title: "Never Be Like You feat. Kai",
				durationSeconds: 233,
			},
			{ enrich: true },
		);

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
		const verdict = await lookupCatalogMetadata(
			{
				artist: "Flume",
				title: "Never Be Like You feat. Kai",
				durationSeconds: 233,
			},
			{ enrich: true },
		);

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
		const verdict = await lookupCatalogMetadata(
			{
				artist: "Disclosure",
				title: "Latch ft. Sam Smith",
				durationSeconds: 256,
			},
			{ enrich: true },
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				title: "Latch (feat. Sam Smith)",
				album: "Settle (Special Edition)",
			},
		});
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
