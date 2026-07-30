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
const { resolveAlbumArtImageMock, registerDownloadMock } = vi.hoisted(() => ({
	resolveAlbumArtImageMock: vi.fn(() => Promise.resolve(null)),
	registerDownloadMock: vi.fn(() => "fake-token"),
}));

vi.mock("node-id3", () => ({
	write: vi.fn(() => true),
}));

vi.mock("$lib/artwork", () => ({
	resolveAlbumArtImage: resolveAlbumArtImageMock,
}));

vi.mock("$lib/video-metadata", () => ({
	buildID3Tags: vi.fn(() => ({})),
}));

vi.mock("$lib/download-pipeline/download-tokens", () => ({
	registerDownload: registerDownloadMock,
}));

import {
	buildDownloadFilename,
	type FinalizeMp3Input,
	finalizeMp3,
	sanitizeFilenameSegment,
} from "$lib/download-pipeline/finalize-mp3";
import { YT_DLP_METHOD } from "$lib/types";

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
