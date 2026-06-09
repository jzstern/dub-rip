import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, readFileMock, writeFileMock, unlinkMock } = vi.hoisted(
	() => ({
		execFileMock: vi.fn(),
		readFileMock: vi.fn(),
		writeFileMock: vi.fn(),
		unlinkMock: vi.fn(),
	}),
);

vi.mock("node:child_process", () => ({
	default: { execFile: (...args: unknown[]) => execFileMock(...args) },
	execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("node:fs/promises", () => ({
	readFile: (...args: unknown[]) => readFileMock(...args),
	writeFile: (...args: unknown[]) => writeFileMock(...args),
	unlink: (...args: unknown[]) => unlinkMock(...args),
}));

vi.mock("@ffmpeg-installer/ffmpeg", () => ({
	default: { path: "/fake/ffmpeg" },
	path: "/fake/ffmpeg",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
	fetchOfficialArtwork,
	fetchOfficialArtworkUrl,
	fetchThumbnailBuffer,
	resolveCoverArt,
	squareCropToBuffer,
} from "../../src/lib/artwork";

function mockExecFileSuccess(): void {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			cb?: (err: Error | null, res: { stdout: string; stderr: string }) => void,
		) => {
			if (cb) cb(null, { stdout: "", stderr: "" });
		},
	);
}

function jsonResponse(body: unknown) {
	return {
		ok: true,
		json: () => Promise.resolve(body),
	};
}

function imageResponse(byteLength: number) {
	return {
		ok: true,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(byteLength)),
	};
}

describe("fetchOfficialArtwork", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns upscaled artwork buffer on iTunes hit", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce(
				jsonResponse({
					results: [{ artworkUrl100: "https://art/abc/100x100bb.jpg" }],
				}),
			)
			.mockResolvedValueOnce(imageResponse(16));

		// #when
		const result = await fetchOfficialArtwork("Artist", "Song");

		// #then
		expect(result?.byteLength).toBe(16);
	});

	it("requests the 600x600 upscaled artwork URL", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce(
				jsonResponse({
					results: [{ artworkUrl100: "https://art/abc/100x100bb.jpg" }],
				}),
			)
			.mockResolvedValueOnce(imageResponse(16));

		// #when
		await fetchOfficialArtwork("Artist", "Song");

		// #then
		expect(mockFetch).toHaveBeenLastCalledWith(
			"https://art/abc/600x600bb.jpg",
			expect.any(Object),
		);
	});

	it("returns null when iTunes has no results", async () => {
		// #given
		mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

		// #when
		const result = await fetchOfficialArtwork("Nobody", "Nothing");

		// #then
		expect(result).toBeNull();
	});

	it("returns null on network error without throwing", async () => {
		// #given
		mockFetch.mockRejectedValueOnce(new Error("network down"));

		// #when
		const result = await fetchOfficialArtwork("Artist", "Song");

		// #then
		expect(result).toBeNull();
	});

	it("returns null when search term is empty", async () => {
		// #when
		const result = await fetchOfficialArtwork("", "");

		// #then
		expect(result).toBeNull();
	});
});

describe("fetchOfficialArtworkUrl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the upscaled artwork URL on iTunes hit", async () => {
		// #given
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				results: [{ artworkUrl100: "https://art/abc/100x100bb.jpg" }],
			}),
		);

		// #when
		const result = await fetchOfficialArtworkUrl("Artist", "Song");

		// #then
		expect(result).toBe("https://art/abc/600x600bb.jpg");
	});

	it("honors a custom artwork size", async () => {
		// #given
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				results: [{ artworkUrl100: "https://art/abc/100x100bb.jpg" }],
			}),
		);

		// #when
		const result = await fetchOfficialArtworkUrl("Artist", "Song", {
			size: 300,
		});

		// #then
		expect(result).toBe("https://art/abc/300x300bb.jpg");
	});

	it("returns null when iTunes has no results", async () => {
		// #given
		mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

		// #when
		const result = await fetchOfficialArtworkUrl("Nobody", "Nothing");

		// #then
		expect(result).toBeNull();
	});

	it("returns null when the search term is empty", async () => {
		// #when
		const result = await fetchOfficialArtworkUrl("", "");

		// #then
		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("returns null on network error without throwing", async () => {
		// #given
		mockFetch.mockRejectedValueOnce(new Error("offline"));

		// #when
		const result = await fetchOfficialArtworkUrl("Artist", "Song");

		// #then
		expect(result).toBeNull();
	});
});

describe("fetchThumbnailBuffer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns buffer for a successful fetch", async () => {
		// #given
		mockFetch.mockResolvedValueOnce(imageResponse(24));

		// #when
		const result = await fetchThumbnailBuffer("https://thumb/x.jpg");

		// #then
		expect(result?.byteLength).toBe(24);
	});

	it("returns null on network error without throwing", async () => {
		// #given
		mockFetch.mockRejectedValueOnce(new Error("boom"));

		// #when
		const result = await fetchThumbnailBuffer("https://thumb/x.jpg");

		// #then
		expect(result).toBeNull();
	});
});

describe("squareCropToBuffer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the ffmpeg-produced buffer", async () => {
		// #given
		mockExecFileSuccess();
		writeFileMock.mockResolvedValue(undefined);
		unlinkMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));

		// #when
		const result = await squareCropToBuffer(Buffer.from([0x00]));

		// #then
		expect(result).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
	});

	it("cleans up both temp files even when ffmpeg fails", async () => {
		// #given
		writeFileMock.mockResolvedValue(undefined);
		unlinkMock.mockResolvedValue(undefined);
		execFileMock.mockImplementation(
			(_bin: string, _args: string[], cb?: (err: Error) => void) => {
				if (cb) cb(new Error("ffmpeg failed"));
			},
		);

		// #when
		await expect(squareCropToBuffer(Buffer.from([0x00]))).rejects.toThrow();

		// #then
		expect(unlinkMock).toHaveBeenCalledTimes(2);
	});
});

describe("resolveCoverArt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeFileMock.mockResolvedValue(undefined);
		unlinkMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue(Buffer.from([0xaa]));
		mockExecFileSuccess();
	});

	it("prefers iTunes artwork when available", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce(
				jsonResponse({
					results: [{ artworkUrl100: "https://art/abc/100x100bb.jpg" }],
				}),
			)
			.mockResolvedValueOnce(imageResponse(16));

		// #when
		const result = await resolveCoverArt({
			artist: "Artist",
			title: "Song",
			thumbnailUrl: "https://thumb/x.jpg",
		});

		// #then
		expect(result?.source).toBe("itunes");
	});

	it("falls back to a square-cropped thumbnail when iTunes misses", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce(jsonResponse({ results: [] }))
			.mockResolvedValueOnce(imageResponse(32));

		// #when
		const result = await resolveCoverArt({
			artist: "Artist",
			title: "Song",
			thumbnailUrl: "https://thumb/x.jpg",
		});

		// #then
		expect(result?.source).toBe("thumbnail");
	});

	it("returns null when both iTunes and thumbnail fail", async () => {
		// #given
		mockFetch
			.mockResolvedValueOnce(jsonResponse({ results: [] }))
			.mockRejectedValueOnce(new Error("thumb down"));

		// #when
		const result = await resolveCoverArt({
			artist: "Artist",
			title: "Song",
			thumbnailUrl: "https://thumb/x.jpg",
		});

		// #then
		expect(result).toBeNull();
	});
});
