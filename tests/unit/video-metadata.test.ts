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
	buildBgutilPotArgs: vi.fn().mockResolvedValue([]),
	buildJsRuntimeArgs: vi.fn().mockReturnValue([]),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { buildBgutilPotArgs } from "$lib/yt-dlp-binary";
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

	it("exposes the video title and uploader, the download's title fallback", async () => {
		// #given
		mockExecFileJson({
			title: "Daft Punk - One More Time (Official Video)",
			uploader: "Daft Punk",
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toMatchObject({
			title: "Daft Punk - One More Time (Official Video)",
			uploader: "Daft Punk",
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

	it("attaches bgutil-pot args returned by buildBgutilPotArgs", async () => {
		// #given
		vi.mocked(buildBgutilPotArgs).mockResolvedValueOnce([
			"--plugin-dirs",
			"/tmp/yt-dlp-plugins",
		]);
		mockExecFileJson({ upload_date: "20200101" });

		// #when
		await fetchVideoDetails("https://youtu.be/abc");

		// #then
		const passedArgs = execFileMock.mock.calls[0][1] as string[];
		expect(passedArgs).toContain("--plugin-dirs");
	});

	it("keeps yt-dlp warnings, the only place a missing PO token is reported", async () => {
		// #given
		mockExecFileJson({ upload_date: "20200101" });

		// #when
		await fetchVideoDetails("https://youtu.be/abc");

		// #then
		const passedArgs = execFileMock.mock.calls[0][1] as string[];
		expect(passedArgs).not.toContain("--no-warnings");
	});

	it("suppresses the version-age notice, which is expected against a pinned binary", async () => {
		// #given
		mockExecFileJson({ upload_date: "20200101" });

		// #when
		await fetchVideoDetails("https://youtu.be/abc");

		// #then
		const passedArgs = execFileMock.mock.calls[0][1] as string[];
		expect(passedArgs).toContain("--no-update");
	});

	it("extracts and rounds duration from dump-json output", async () => {
		// #given
		mockExecFileJson({ duration: 245.4 });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.duration).toBe(245);
	});

	it("omits duration when the field is absent from yt-dlp output", async () => {
		// #given
		mockExecFileJson({ upload_date: "20200101" });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.duration).toBeUndefined();
	});

	it("retries once on a transient failure and succeeds on the next attempt", async () => {
		// #given
		vi.useFakeTimers();
		try {
			let callCount = 0;
			execFileMock.mockImplementation(
				(
					_bin: string,
					_args: string[],
					_opts: unknown,
					cb: (
						err: Error | null,
						res?: { stdout: string; stderr: string },
					) => void,
				) => {
					callCount += 1;
					if (callCount === 1) {
						cb(new Error("Sign in to confirm you're not a bot"));
					} else {
						cb(null, {
							stdout: JSON.stringify({ duration: 200 }),
							stderr: "",
						});
					}
				},
			);

			// #when
			const promise = fetchVideoDetails("https://youtu.be/abc");
			await vi.runAllTimersAsync();
			const details = await promise;

			// #then
			expect(details?.duration).toBe(200);
			expect(execFileMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retry a permanent failure", async () => {
		// #given
		mockExecFileError(new Error("ERROR: Video unavailable"));

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toBeNull();
		expect(execFileMock).toHaveBeenCalledTimes(1);
	});

	it("takes the label from a YouTube Music ℗ line", async () => {
		// #given
		mockExecFileJson({
			duration: 194,
			description:
				"Provided to YouTube by Interscope\n\nbad guy · Billie Eilish\n\n℗ 2019 Darkroom/Interscope Records\n\nReleased on: 2019-03-29",
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.label).toBe("Darkroom/Interscope Records");
	});

	it("falls back to the 'Provided to YouTube by' distributor", async () => {
		// #given
		mockExecFileJson({
			duration: 194,
			description: "Provided to YouTube by Believe SAS\n\nTrack · Artist",
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.label).toBe("Believe SAS");
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

describe("buildID3Tags() with a proven catalog match", () => {
	const HEURISTIC = {
		trackTitle: "Hello (Official Music Video)",
		videoTitle: "Adele - Hello (Official Music Video)",
		artist: "AdeleVEVO",
		image: null,
	};

	const CANONICAL = {
		artist: "Adele",
		title: "Hello",
		album: "25",
		year: 2015,
		genre: "Pop",
		label: "XL Recordings",
		isrc: "GBBKS1500214",
		source: "itunes" as const,
	};

	it("outranks both the yt-dlp details and the parsed title", () => {
		// #when — details carries a worse answer for every field the catalog knows
		const tags = buildID3Tags({
			...HEURISTIC,
			details: {
				track: "Hello (Official Music Video)",
				artist: "AdeleVEVO",
				album: "Hello (Official Music Video)",
				year: 2016,
				genre: "Music",
			},
			canonical: CANONICAL,
		});

		// #then
		expect(tags).toMatchObject({
			title: "Hello",
			artist: "Adele",
			album: "25",
			year: "2015",
			genre: "Pop",
		});
	});

	it("is ignored entirely when there was no match", () => {
		// #when
		const tags = buildID3Tags({
			...HEURISTIC,
			details: { track: "Hello", artist: "Adele", album: "25" },
			canonical: undefined,
		});

		// #then — today's behaviour, unchanged
		expect(tags).toMatchObject({
			title: "Hello",
			artist: "Adele",
			album: "25",
		});
	});

	it("falls through to the details album when a compilation left it empty", () => {
		// #given — a match whose album was dropped, because it was a Various Artists set
		const canonical = { ...CANONICAL, album: undefined };

		// #when
		const tags = buildID3Tags({
			...HEURISTIC,
			details: { album: "Deadline Records Va 05" },
			canonical,
		});

		// #then
		expect(tags.album).toBe("Deadline Records Va 05");
	});

	it("keeps SoundCloud's own label over the catalog's", () => {
		// #when — a distributor filled in label_name for this exact upload
		const tags = buildID3Tags({
			...HEURISTIC,
			details: { label: "Darkroom/Interscope Records" },
			canonical: CANONICAL,
			trustPlatformLabel: true,
		});

		// #then
		expect(tags.publisher).toBe("Darkroom/Interscope Records");
	});

	it("lets the catalog label beat YouTube's scraped copyright line", () => {
		// #when
		const tags = buildID3Tags({
			...HEURISTIC,
			details: { label: "2015 XL Recordings Ltd under exclusive licence" },
			canonical: CANONICAL,
			trustPlatformLabel: false,
		});

		// #then
		expect(tags.publisher).toBe("XL Recordings");
	});

	it("keeps the platform's own ISRC ahead of the catalog's", () => {
		// #when — details.isrc only ever comes from SoundCloud's publisher metadata
		const tags = buildID3Tags({
			...HEURISTIC,
			details: { isrc: "USUM71900764" },
			canonical: CANONICAL,
		});

		// #then
		expect(tags.ISRC).toBe("USUM71900764");
	});

	it("writes the catalog ISRC when the platform supplied none", () => {
		// #when
		const tags = buildID3Tags({
			...HEURISTIC,
			details: null,
			canonical: CANONICAL,
		});

		// #then
		expect(tags.ISRC).toBe("GBBKS1500214");
	});

	it("reads the remixer off the canonical title, not the upload's", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Levels (Official Video)",
			videoTitle: "Avicii - Levels (Official Video)",
			artist: "Avicii",
			image: null,
			details: null,
			canonical: {
				...CANONICAL,
				artist: "Avicii",
				title: "Levels (Skrillex Remix)",
			},
		});

		// #then
		expect(tags.remixArtist).toBe("Skrillex");
	});
});
