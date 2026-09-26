import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSoundCloudAlbumArt } from "$lib/artwork";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
const image = () => ({ ok: true, status: 200, arrayBuffer: async () => JPEG });
const searchResult = (body: unknown) => ({
	ok: true,
	status: 200,
	json: async () => body,
});

describe("resolveSoundCloudAlbumArt()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the upload's own artwork before any store search", async () => {
		// #given
		const fetchMock = vi.fn(async (_url: string) => image());
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolveSoundCloudAlbumArt({
			artist: "The Chainsmokers",
			title: "Don't Let Me Down (W&W Remix)",
			artwork: { artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg" },
		});

		// #then
		expect(art?.buffer.byteLength).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://i1.sndcdn.com/artworks-x-t500x500.jpg",
		);
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
		const art = await resolveSoundCloudAlbumArt({
			artist: "Billie Eilish",
			title: "bad guy",
			artwork: { avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg" },
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
		const art = await resolveSoundCloudAlbumArt({
			artist: "Unknown",
			title: "Bootleg",
			artwork: { avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg" },
		});

		// #then
		expect(art).not.toBeNull();
		expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
			"https://i1.sndcdn.com/avatars-x-t500x500.jpg",
		);
	});
});
