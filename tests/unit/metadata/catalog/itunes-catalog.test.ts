import { afterEach, describe, expect, it, vi } from "vitest";
import {
	itunesSearchUrl,
	searchITunes,
} from "$lib/metadata/catalog/itunes-catalog";
import { searchTerm } from "$lib/metadata/catalog/lookup-catalog";
import { stubCatalogFetch } from "./catalog-fixtures";

describe("searchITunes()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps a recorded search into candidates", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await searchITunes("Billie Eilish bad guy");

		// #then
		expect(candidates[0]).toEqual({
			source: "itunes",
			artist: "Billie Eilish",
			title: "bad guy",
			album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
			isCompilation: false,
			releaseDate: "2019-03-29",
			durationSeconds: 194,
			genre: "Alternative",
			artworkUrl: expect.stringContaining("600x600bb"),
		});
	});

	it("flags a Various Artists collection as a compilation", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await searchITunes(
			searchTerm({ artist: "Avicii", title: "Levels (Skrillex Remix)" }),
		);

		// #then
		expect(
			candidates.find((candidate) =>
				candidate.album?.startsWith("Body By Jake"),
			)?.isCompilation,
		).toBe(true);
	});

	it("asks for five songs, not one", async () => {
		// #given
		const fetchMock = stubCatalogFetch();

		// #when
		await searchITunes("Adele Hello");

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			itunesSearchUrl("Adele Hello"),
			expect.anything(),
		);
	});

	it("returns nothing for an empty term, without calling out", async () => {
		// #given
		const fetchMock = stubCatalogFetch();

		// #when
		const candidates = await searchITunes("   ");

		// #then
		expect([candidates, fetchMock.mock.calls.length]).toEqual([[], 0]);
	});

	it.each([
		["an HTTP error", { ok: false, status: 503, json: async () => ({}) }],
		[
			"a body that is not a search result",
			{ ok: true, status: 200, json: async () => ({ results: "nope" }) },
		],
		[
			"a body that is not JSON at all",
			{
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError("Unexpected token <");
				},
			},
		],
	])("returns no candidates for %s", async (_name, response) => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response),
		);

		// #when
		const candidates = await searchITunes("Adele Hello");

		// #then
		expect(candidates).toEqual([]);
	});

	it("returns no candidates when the request times out", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("The operation was aborted.", "TimeoutError");
			}),
		);

		// #when
		const candidates = await searchITunes("Adele Hello", { timeout: 10 });

		// #then
		expect(candidates).toEqual([]);
	});

	it("ignores artwork served from anywhere but Apple's CDN", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					results: [
						{
							kind: "song",
							trackName: "Hello",
							artistName: "Adele",
							artworkUrl100: "https://evil.example/100x100bb.jpg",
						},
					],
				}),
			})),
		);

		// #when
		const candidates = await searchITunes("Adele Hello");

		// #then
		expect(candidates[0]?.artworkUrl).toBeUndefined();
	});

	it("skips results that are not songs", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					results: [
						{ kind: "music-video", trackName: "Hello", artistName: "Adele" },
						{ kind: "song", trackName: "Hello", artistName: "Adele" },
					],
				}),
			})),
		);

		// #when
		const candidates = await searchITunes("Adele Hello");

		// #then
		expect(candidates).toHaveLength(1);
	});
});
