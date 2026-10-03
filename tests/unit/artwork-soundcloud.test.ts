import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlatformAlbumArt } from "$lib/artwork";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
const image = () => ({ ok: true, status: 200, arrayBuffer: async () => JPEG });
const searchResult = (body: unknown) => ({
	ok: true,
	status: 200,
	json: async () => body,
});

describe("resolvePlatformAlbumArt()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the upload's own artwork before any store search", async () => {
		// #given
		const fetchMock = vi.fn(async (_url: string) => image());
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolvePlatformAlbumArt({
			artist: "The Chainsmokers",
			title: "Don't Let Me Down (W&W Remix)",
			artwork: {
				source: "soundcloud",
				artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
			},
		});

		// #then
		expect(art?.buffer.byteLength).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://i1.sndcdn.com/artworks-x-t500x500.jpg",
		);
	});

	it("uses a cover the match proved before searching any store", async () => {
		// #given — an upload with no cover of its own, and a verified match
		const fetchMock = vi.fn(async (_url: string) => image());
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolvePlatformAlbumArt({
			artist: "blk.",
			title: "I Cant Fail",
			artwork: {
				source: "soundcloud",
				avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
			},
			preferredArtwork: {
				url: "https://is1-ssl.mzstatic.com/proven/600x600bb.jpg",
				source: "itunes",
			},
		});

		// #then — one fetch, for the proven cover, and no store search
		expect(art?.buffer.byteLength).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://is1-ssl.mzstatic.com/proven/600x600bb.jpg",
		);
	});

	it("still puts the upload's own artwork ahead of a proven cover", async () => {
		// #given — SoundCloud is mostly edits and unreleased tracks, so the
		// uploader's own cover is the one the user expects to get
		const fetchMock = vi.fn(async (_url: string) => image());
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await resolvePlatformAlbumArt({
			artist: "blk.",
			title: "I Cant Fail",
			artwork: {
				source: "soundcloud",
				artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
			},
			preferredArtwork: {
				url: "https://is1-ssl.mzstatic.com/proven/600x600bb.jpg",
				source: "itunes",
			},
		});

		// #then
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://i1.sndcdn.com/artworks-x-t500x500.jpg",
		);
	});

	it("falls through to the stores when the proven cover is dead", async () => {
		// #given
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes("mzstatic.com/proven")) {
				return { ok: false, status: 404, arrayBuffer: async () => JPEG };
			}
			if (url.includes("itunes.apple.com")) {
				return searchResult({
					results: [
						{ artworkUrl100: "https://is1-ssl.mzstatic.com/100x100bb.jpg" },
					],
				});
			}
			return image();
		});
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolvePlatformAlbumArt({
			artist: "blk.",
			title: "I Cant Fail",
			artwork: {
				source: "soundcloud",
				avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
			},
			preferredArtwork: {
				url: "https://is1-ssl.mzstatic.com/proven/600x600bb.jpg",
				source: "itunes",
			},
		});

		// #then — a dead CDN URL must not cost the track its cover
		expect(art?.buffer.byteLength).toBe(3);
		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
	});

	it("searches the stores only when the upload has no artwork", async () => {
		// #given
		const fetchMock = vi.fn(async (url: string) =>
			url.includes("itunes.apple.com")
				? searchResult({
						results: [
							{ artworkUrl100: "https://is1-ssl.mzstatic.com/a/100x100bb.jpg" },
						],
					})
				: image(),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolvePlatformAlbumArt({
			artist: "Billie Eilish",
			title: "bad guy",
			artwork: {
				source: "soundcloud",
				avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
			},
		});

		// #then
		expect(art).not.toBeNull();
		expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
			"https://i1.sndcdn.com/avatars-x-t500x500.jpg",
		);
	});

	it("falls back to the uploader's avatar last", async () => {
		// #given
		const fetchMock = vi.fn(async (url: string) =>
			url.includes("itunes.apple.com")
				? searchResult({ results: [] })
				: url.includes("api.deezer.com")
					? searchResult({ data: [] })
					: image(),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolvePlatformAlbumArt({
			artist: "Unknown",
			title: "Bootleg",
			artwork: {
				source: "soundcloud",
				avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
			},
		});

		// #then
		expect(art).not.toBeNull();
		expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
			"https://i1.sndcdn.com/avatars-x-t500x500.jpg",
		);
	});
});
