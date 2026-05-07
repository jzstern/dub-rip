import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
}));
vi.mock("node:child_process", () => ({
	default: {
		execFile: (...args: unknown[]) => execFileMock(...args),
	},
	execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureYtDlpBinary: vi.fn().mockResolvedValue("/tmp/yt-dlp"),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
	buildID3Tags,
	fetchThumbnailBuffer,
	fetchVideoDetails,
} from "../../src/lib/video-metadata";

function mockExecFileJson(json: unknown) {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null, res: { stdout: string; stderr: string }) => void,
		) => {
			cb(null, { stdout: JSON.stringify(json), stderr: "" });
		},
	);
}

function mockExecFileError(err: Error) {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null) => void,
		) => {
			cb(err);
		},
	);
}

describe("fetchVideoDetails", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("extracts year from upload_date when release info missing", async () => {
		// #given
		mockExecFileJson({ upload_date: "20190815", categories: ["Music"] });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.year).toBe(2019);
	});

	it("prefers release_year over upload_date", async () => {
		// #given
		mockExecFileJson({
			upload_date: "20220101",
			release_year: 1985,
			categories: ["Music"],
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.year).toBe(1985);
	});

	it("falls back to first category when explicit genre absent", async () => {
		// #given
		mockExecFileJson({ categories: ["Entertainment", "Comedy"] });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.genre).toBe("Entertainment");
	});

	it("prefers explicit genre over categories", async () => {
		// #given
		mockExecFileJson({ genre: "Rock", categories: ["Music"] });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.genre).toBe("Rock");
	});

	it("exposes album, composer, track, artist when present", async () => {
		// #given
		mockExecFileJson({
			track: "Song Name",
			artist: "Artist Name",
			album: "Album Name",
			album_artist: "Album Artist",
			composer: "Composer Name",
			bpm: 128,
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toMatchObject({
			track: "Song Name",
			artist: "Artist Name",
			album: "Album Name",
			albumArtist: "Album Artist",
			composer: "Composer Name",
			bpm: 128,
		});
	});

	it("returns null when yt-dlp fails (non-fatal)", async () => {
		// #given
		mockExecFileError(new Error("yt-dlp crashed"));

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toBeNull();
	});

	it("ignores invalid year values", async () => {
		// #given
		mockExecFileJson({ upload_date: "1800" });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.year).toBeUndefined();
	});
});

describe("fetchThumbnailBuffer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns maxresdefault when available", async () => {
		// #given
		const buffer = new ArrayBuffer(8);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			headers: new Map([["content-type", "image/jpeg"]]),
			arrayBuffer: () => Promise.resolve(buffer),
		});

		// #when
		const result = await fetchThumbnailBuffer("abc123");

		// #then
		expect(result?.mime).toBe("image/jpeg");
		expect(result?.buffer.byteLength).toBe(8);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
			expect.any(Object),
		);
	});

	it("falls back to hqdefault when maxresdefault fails", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce({ ok: false, status: 404 })
			.mockResolvedValueOnce({
				ok: true,
				headers: new Map([["content-type", "image/jpeg"]]),
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(12)),
			});

		// #when
		const result = await fetchThumbnailBuffer("abc123");

		// #then
		expect(result?.buffer.byteLength).toBe(12);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns null when all candidates fail", async () => {
		// #given
		mockFetch.mockResolvedValue({ ok: false, status: 404 });

		// #when
		const result = await fetchThumbnailBuffer("abc123");

		// #then
		expect(result).toBeNull();
	});

	it("returns null on zero-byte response", async () => {
		// #given
		mockFetch.mockResolvedValue({
			ok: true,
			headers: new Map([["content-type", "image/jpeg"]]),
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
		});

		// #when
		const result = await fetchThumbnailBuffer("abc123");

		// #then
		expect(result).toBeNull();
	});
});

describe("buildID3Tags", () => {
	it("falls back to video title and Unknown Artist when data sparse", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "",
			videoTitle: "Some Video",
			artist: "",
			details: null,
			image: null,
		});

		// #then
		expect(tags).toMatchObject({
			title: "Some Video",
			artist: "Unknown Artist",
			performerInfo: "Unknown Artist",
			album: "Some Video",
			composer: "Unknown Artist",
		});
		expect(tags.image).toBeUndefined();
		expect(tags.year).toBeUndefined();
		expect(tags.genre).toBeUndefined();
	});

	it("prefers yt-dlp track/artist over parsed oEmbed values", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Parsed Track",
			videoTitle: "Video Title",
			artist: "Parsed Artist",
			details: {
				track: "Real Track",
				artist: "Real Artist",
				album: "Real Album",
				albumArtist: "Real Album Artist",
				composer: "Real Composer",
				year: 2020,
				genre: "Pop",
				bpm: 128,
			},
			image: null,
		});

		// #then
		expect(tags).toMatchObject({
			title: "Real Track",
			artist: "Real Artist",
			album: "Real Album",
			performerInfo: "Real Album Artist",
			composer: "Real Composer",
			year: "2020",
			genre: "Pop",
			bpm: "128",
		});
	});

	it("derives album from title and composer from artist when missing", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Track",
			videoTitle: "Video",
			artist: "Artist",
			details: null,
			image: null,
		});

		// #then
		expect(tags.album).toBe("Track");
		expect(tags.composer).toBe("Artist");
	});

	it("attaches APIC image block when thumbnail buffer present", () => {
		// #given
		const buffer = Buffer.from([0xff, 0xd8, 0xff]);

		// #when
		const tags = buildID3Tags({
			trackTitle: "Track",
			videoTitle: "Video",
			artist: "Artist",
			details: null,
			image: { buffer, mime: "image/jpeg" },
		});

		// #then
		expect(tags.image).toEqual({
			mime: "image/jpeg",
			type: { id: 3, name: "front cover" },
			description: "Cover",
			imageBuffer: buffer,
		});
	});

	it("rounds fractional BPM to integer string", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Track",
			videoTitle: "Video",
			artist: "Artist",
			details: { bpm: 127.8 },
			image: null,
		});

		// #then
		expect(tags.bpm).toBe("128");
	});
});
