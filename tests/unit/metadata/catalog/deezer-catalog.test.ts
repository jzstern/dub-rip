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
		expect(candidates?.[0]).toEqual({
			source: "deezer",
			rank: 0,
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
		expect(candidates?.[0]?.title).toBe("Levels (Skrillex Remix)");
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

		// #then — unreachable, not empty: an outage must not be cached as a miss
		expect(candidates).toBeNull();
	});

	it.each([
		["a plaintext scheme", "http://cdn-images.dzcdn.net/x.jpg"],
		["a file scheme", "file://cdn-images.dzcdn.net/etc/passwd"],
		["another host", "https://evil.example/x.jpg"],
		["a lookalike host", "https://cdn-images.dzcdn.net.evil.example/x.jpg"],
	])("ignores artwork at %s", async (_name, coverUrl) => {
		// #given — the allowlist is the only gate the later image fetch has
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
							album: { id: 1, title: "25", cover_xl: coverUrl },
						},
					],
				}),
			})),
		);

		// #when
		const candidates = await searchDeezer("Adele Hello");

		// #then
		expect(candidates?.[0]?.artworkUrl).toBeUndefined();
	});

	it("skips a data element that is not a track object", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						null,
						"not a track",
						{ title: "Hello", artist: { name: "Adele" } },
					],
				}),
			})),
		);

		// #when
		const candidates = await searchDeezer("Adele Hello");

		// #then
		expect(candidates).toHaveLength(1);
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

	it("reports a Various Artists album as a compilation, whatever its record_type", async () => {
		// #given — Deezer leaves many label samplers as ordinary albums
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					label: "Deadline Rec",
					record_type: "album",
					artist: { name: "Various Artists" },
				}),
			})),
		);

		// #when
		const album = await deezerAlbum("1");

		// #then
		expect(album?.isCompilation).toBe(true);
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
