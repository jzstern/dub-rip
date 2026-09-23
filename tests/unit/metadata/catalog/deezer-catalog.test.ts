import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deezerAlbum,
	deezerTrackByIsrc,
	searchDeezer,
} from "$lib/metadata/catalog/deezer-catalog";
import { searchTerm } from "$lib/metadata/catalog/lookup-catalog";
import { stubCatalogFetch } from "./catalog-fixtures";

describe("searchDeezer()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps a recorded search into candidates, ISRC included", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await searchDeezer("Billie Eilish bad guy");

		// #then
		expect(candidates[0]).toEqual({
			source: "deezer",
			artist: "Billie Eilish",
			title: "bad guy",
			album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
			albumId: expect.any(String),
			releaseDate: undefined,
			durationSeconds: 194,
			isrc: "USUM71900764",
			artworkUrl: expect.stringContaining("dzcdn.net"),
		});
	});

	it("keeps the version in the title, where the matcher looks for it", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidates = await searchDeezer(
			searchTerm({ artist: "Avicii", title: "Levels (Skrillex Remix)" }),
		);

		// #then
		expect(candidates[0]?.title).toBe("Levels (Skrillex Remix)");
	});

	it("treats Deezer's HTTP 200 error body as a failure", async () => {
		// #given — this is how a quota refusal arrives
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					error: {
						type: "Exception",
						message: "Quota limit exceeded",
						code: 4,
					},
				}),
			})),
		);

		// #when
		const candidates = await searchDeezer("Adele Hello");

		// #then
		expect(candidates).toEqual([]);
	});

	it("ignores artwork served from anywhere but Deezer's CDN", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{
							title: "Hello",
							artist: { name: "Adele" },
							album: {
								id: 1,
								title: "25",
								cover_xl: "https://evil.example/x.jpg",
							},
						},
					],
				}),
			})),
		);

		// #when
		const candidates = await searchDeezer("Adele Hello");

		// #then
		expect(candidates[0]?.artworkUrl).toBeUndefined();
	});
});

describe("deezerTrackByIsrc()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("turns an ISRC into a candidate with its release date", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const candidate = await deezerTrackByIsrc("USUM71900764");

		// #then
		expect(candidate).toMatchObject({
			source: "deezer",
			artist: "Billie Eilish",
			title: "bad guy",
			isrc: "USUM71900764",
			releaseDate: "2019-03-29",
			durationSeconds: 194,
		});
	});

	it("returns nothing for an ISRC Deezer does not know", async () => {
		// #given — an unknown ISRC answers 200 with an error body
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ error: { type: "DataException", code: 800 } }),
			})),
		);

		// #when
		const candidate = await deezerTrackByIsrc("ZZZZZ0000000");

		// #then
		expect(candidate).toBeNull();
	});
});

describe("deezerAlbum()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reads the label and genre an album carries", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const album = await deezerAlbum("91598612");

		// #then
		expect(album).toEqual({
			label: "Darkroom/Interscope Records",
			genre: "Alternative",
			releaseDate: "2019-03-29",
			isCompilation: false,
		});
	});

	it("reports a compilation, whose album name would be wrong to write", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					label: "Various",
					record_type: "compile",
					release_date: "2011-12-20",
				}),
			})),
		);

		// #when
		const album = await deezerAlbum("1");

		// #then
		expect(album?.isCompilation).toBe(true);
	});
});
