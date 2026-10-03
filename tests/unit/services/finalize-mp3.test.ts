import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * finalizeMp3's own network/subprocess dependencies (artwork lookups,
 * NodeID3.write) are mocked out so the cancellation tests below control
 * exactly when the signal aborts relative to them, rather than racing real
 * iTunes/Deezer calls or an ffmpeg crop.
 */
const {
	resolveAlbumArtImageMock,
	resolvePlatformAlbumArtMock,
	registerDownloadMock,
	sharedCatalogLookupMock,
} = vi.hoisted(() => ({
	/** Typed by their inputs so the call arguments can be asserted against. */
	resolveAlbumArtImageMock: vi.fn<(input: unknown) => Promise<null>>(
		async () => null,
	),
	resolvePlatformAlbumArtMock: vi.fn<(input: unknown) => Promise<null>>(
		async () => null,
	),
	registerDownloadMock: vi.fn(() => "fake-token"),
	sharedCatalogLookupMock: vi.fn<
		(...args: unknown[]) => Promise<Record<string, unknown>>
	>(async () => ({
		verdict: { status: "unmatched", reason: "no-candidates" },
	})),
}));

vi.mock("node-id3", () => ({
	write: vi.fn(() => true),
}));

vi.mock("$lib/artwork", () => ({
	resolveAlbumArtImage: resolveAlbumArtImageMock,
	resolvePlatformAlbumArt: resolvePlatformAlbumArtMock,
}));

vi.mock("$lib/video-metadata", () => ({
	buildID3Tags: vi.fn(() => ({})),
}));

vi.mock("$lib/download-pipeline/download-tokens", () => ({
	registerDownload: registerDownloadMock,
}));

/**
 * Without this the real lookup runs and these tests call iTunes and Deezer for
 * real. `releaseCover` is pure, so it keeps its real behaviour.
 */
vi.mock("$lib/metadata/catalog/catalog-cache", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("$lib/metadata/catalog/catalog-cache")
	>()),
	sharedCatalogLookup: sharedCatalogLookupMock,
}));

import {
	buildDownloadFilename,
	type FinalizeMp3Input,
	finalizeMp3,
	sanitizeFilenameSegment,
} from "$lib/download-pipeline/finalize-mp3";
import { YT_DLP_METHOD } from "$lib/types";
import { buildID3Tags } from "$lib/video-metadata";

describe("sanitizeFilenameSegment()", () => {
	it("strips characters that are unsafe in a filesystem path", () => {
		// #given
		const value = 'a<b>c:d"e/f\\g|h?i*j';

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("abcdefghij");
	});

	it("strips ASCII control characters", () => {
		// #given — NUL, unit separator, and DEL, built via fromCharCode so the
		// source file carries no literal control bytes
		const control = String.fromCharCode(0x00, 0x1f, 0x7f);
		const value = `Bad${control}Name${control}With${control}Controls`;

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("BadNameWithControls");
	});

	it("strips a leading dot so the result can't become a hidden file", () => {
		// #given
		const value = "...hidden name";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("hidden name");
	});

	it("strips a leading dot exposed after unsafe characters before it are removed", () => {
		// #given
		const value = "<.hidden";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("hidden");
	});

	it("trims surrounding whitespace", () => {
		// #given
		const value = "  padded title  ";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("padded title");
	});

	it("returns an empty string when every character is unsafe", () => {
		// #given
		const value = "///";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("");
	});

	it("leaves an ordinary title unchanged", () => {
		// #given
		const value = "Never Gonna Give You Up";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe(value);
	});
});

describe("buildDownloadFilename()", () => {
	it("builds 'Artist - Track.mp3' when both are present", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "Rick Astley",
			trackTitle: "Never Gonna Give You Up",
			videoTitle: "Rick Astley - Never Gonna Give You Up (Official Video)",
		});

		// #then
		expect(result).toBe("Rick Astley - Never Gonna Give You Up.mp3");
	});

	it("falls back to the video title when artist or track is missing", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "Some Uploaded Video",
		});

		// #then
		expect(result).toBe("Some Uploaded Video.mp3");
	});

	it("falls back to 'audio.mp3' when nothing is usable", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "",
		});

		// #then
		expect(result).toBe("audio.mp3");
	});

	it("sanitizes unsafe characters out of the artist and track", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "Bad/Artist",
			trackTitle: "Bad*Track",
			videoTitle: "irrelevant",
		});

		// #then
		expect(result).toBe("BadArtist - BadTrack.mp3");
	});

	it("sanitizes a leading dot out of the video title", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: ".hidden-video-title",
		});

		// #then
		expect(result).toBe("hidden-video-title.mp3");
	});

	it("falls back to 'audio.mp3' when the video title sanitizes down to empty", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "///",
		});

		// #then
		expect(result).toBe("audio.mp3");
	});

	it("falls back to the video title when the artist sanitizes down to empty", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "///",
			trackTitle: "Track",
			videoTitle: "Video Title",
		});

		// #then
		expect(result).toBe("Video Title.mp3");
	});
});

async function createTempMp3(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dub-rip-finalize-"));
	const filePath = join(dir, "track.mp3");
	await writeFile(filePath, "fake mp3 bytes");
	return filePath;
}

function finalizeInputFor(
	filePath: string,
	signal?: AbortSignal,
): FinalizeMp3Input {
	return {
		filePath,
		videoTitle: "Test Video",
		artist: "Test Artist",
		trackTitle: "Test Track",
		downloadMethod: YT_DLP_METHOD,
		videoId: "dQw4w9WgXcQ",
		detailsPromise: Promise.resolve(null),
		thumbnailPromise: Promise.resolve(null),
		send: () => {},
		signal,
	};
}

describe("finalizeMp3() cancellation", () => {
	beforeEach(() => {
		registerDownloadMock.mockClear();
		resolveAlbumArtImageMock.mockReset().mockResolvedValue(null);
	});

	it("does not register a download token when the signal is already aborted", async () => {
		// #given
		const filePath = await createTempMp3();
		const controller = new AbortController();
		controller.abort();

		// #when
		await finalizeMp3(finalizeInputFor(filePath, controller.signal)).catch(
			() => {},
		);

		// #then
		expect(registerDownloadMock).not.toHaveBeenCalled();
	});

	it("does not register a download token when the signal aborts during the artwork/ID3 phase", async () => {
		// #given — resolveAlbumArtImage is the multi-second window (iTunes,
		// Deezer, thumbnail fetch, an ffmpeg crop) this check exists to cover;
		// aborting as a side effect of it settling simulates a disconnect
		// landing mid-phase without needing real timers
		const filePath = await createTempMp3();
		const controller = new AbortController();
		resolveAlbumArtImageMock.mockImplementation(() => {
			controller.abort();
			return Promise.resolve(null);
		});

		// #when
		await finalizeMp3(finalizeInputFor(filePath, controller.signal)).catch(
			() => {},
		);

		// #then
		expect(registerDownloadMock).not.toHaveBeenCalled();
	});

	it("still registers a download token on the ordinary, uncancelled path", async () => {
		// #given
		const filePath = await createTempMp3();
		const controller = new AbortController();

		// #when
		const result = await finalizeMp3(
			finalizeInputFor(filePath, controller.signal),
		);

		// #then — the new check doesn't fire when nothing aborted
		expect(registerDownloadMock).toHaveBeenCalledOnce();
		expect(result.token).toBe("fake-token");
	});

	it("still registers a download token when no signal is passed at all", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		const result = await finalizeMp3(finalizeInputFor(filePath));

		// #then — signal stays optional for any caller that doesn't have one
		expect(result.token).toBe("fake-token");
	});
});

describe("finalizeMp3() tag inputs", () => {
	it("passes the uploader and source URL through to the ID3 tags", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			uploader: "Decaydance Records",
			sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		});

		// #then
		expect(buildID3Tags).toHaveBeenCalledWith(
			expect.objectContaining({
				uploader: "Decaydance Records",
				sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			}),
		);
	});

	it("does not let YouTube's scraped ℗ line outrank the catalog's label", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then
		expect(buildID3Tags).toHaveBeenLastCalledWith(
			expect.objectContaining({ trustPlatformRelease: false }),
		);
	});

	it("lets SoundCloud's own label field outrank the catalog's", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			platformArtwork: {
				source: "soundcloud",
				artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
			},
		});

		// #then
		expect(buildID3Tags).toHaveBeenLastCalledWith(
			expect.objectContaining({ trustPlatformRelease: true }),
		);
	});
});

describe("finalizeMp3() SoundCloud cover art", () => {
	it("uses the SoundCloud artwork order when SoundCloud artwork is given", async () => {
		// #given
		const filePath = await createTempMp3();
		resolveAlbumArtImageMock.mockClear();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			platformArtwork: {
				source: "soundcloud",
				artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
			},
		});

		// #then
		expect(resolvePlatformAlbumArtMock).toHaveBeenCalledWith({
			artist: "Test Artist",
			title: "Test Track",
			artwork: {
				source: "soundcloud",
				artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
			},
		});
		expect(resolveAlbumArtImageMock).not.toHaveBeenCalled();
	});
});

describe("finalizeMp3() with a proven catalog match", () => {
	const MATCHED = {
		verdict: {
			status: "matched",
			via: "isrc",
			candidate: { source: "deezer", artist: "Adele", title: "Hello" },
			metadata: {
				artist: "Adele",
				title: "Hello",
				album: "25",
				artworkUrl: "https://e-cdns-images.dzcdn.net/1000x1000-000000.jpg",
				source: "deezer",
			},
		},
	};
	/** What a YouTube upload gets: the song, proven, and no release. */
	const SONG_ONLY = {
		verdict: {
			...MATCHED.verdict,
			via: "duration",
			metadata: { artist: "Adele", title: "Hello", source: "deezer" },
		},
	};

	beforeEach(() => {
		registerDownloadMock.mockClear();
		resolveAlbumArtImageMock.mockReset().mockResolvedValue(null);
		resolvePlatformAlbumArtMock.mockReset().mockResolvedValue(null);
		sharedCatalogLookupMock.mockReset().mockResolvedValue({
			verdict: { status: "unmatched", reason: "no-candidates" },
		});
	});

	it("queries with the heuristic identity plus the evidence the download has", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			detailsPromise: Promise.resolve({
				duration: 295,
				isrc: "GBBKS1500214",
			}),
		});

		// #then — the same artist and title the preview queried, so the key matches
		expect(sharedCatalogLookupMock).toHaveBeenCalledWith(
			{
				artist: "Test Artist",
				title: "Test Track",
				isrc: "GBBKS1500214",
				durationSeconds: 295,
			},
			{ timeout: 6000 },
		);
	});

	it("names the file after the canonical identity", async () => {
		// #given
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockResolvedValue(MATCHED);

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then
		expect(registerDownloadMock).toHaveBeenCalledWith(
			expect.objectContaining({ filename: "Adele - Hello.mp3" }),
		);
	});

	it("keeps the upload's title in the filename when the match carries none", async () => {
		// #given — the catalog credits other guests, so only its artist is written
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockResolvedValue({
			verdict: {
				...SONG_ONLY.verdict,
				metadata: { artist: "Adele", source: "deezer" },
			},
		});

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then
		expect(registerDownloadMock).toHaveBeenCalledWith(
			expect.objectContaining({ filename: "Adele - Test Track.mp3" }),
		);
	});

	it("hands the proven cover to the artwork resolver", async () => {
		// #given
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockResolvedValue(MATCHED);

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then — the sleeve of the release the upload's ISRC proved
		expect(resolveAlbumArtImageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				preferredArtwork: {
					url: "https://e-cdns-images.dzcdn.net/1000x1000-000000.jpg",
					source: "deezer",
				},
			}),
		);
	});

	it("passes no preferred cover for a match that proved no release", async () => {
		// #given
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockResolvedValue(SONG_ONLY);

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then
		expect(resolveAlbumArtImageMock.mock.calls[0]?.[0]).not.toHaveProperty(
			"preferredArtwork",
		);
	});

	it("searches for the cover with the upload's own identity, as today", async () => {
		// #given — the catalog corrects the identity, but proves no release
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockResolvedValue(SONG_ONLY);

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then — so the file carries the cover the preview card showed
		expect(resolveAlbumArtImageMock).toHaveBeenCalledWith(
			expect.objectContaining({ artist: "Test Artist", title: "Test Track" }),
		);
	});

	it("passes no preferred cover when nothing matched", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3(finalizeInputFor(filePath));

		// #then
		expect(resolveAlbumArtImageMock.mock.calls[0]?.[0]).not.toHaveProperty(
			"preferredArtwork",
		);
	});

	it("still delivers the file when the lookup fails outright", async () => {
		// #given
		const filePath = await createTempMp3();
		sharedCatalogLookupMock.mockRejectedValue(new Error("catalog exploded"));

		// #when
		const result = await finalizeMp3(finalizeInputFor(filePath));

		// #then — the heuristic filename, and a download that still happens
		expect([result.filename, result.token]).toEqual([
			"Test Artist - Test Track.mp3",
			"fake-token",
		]);
	});
});
