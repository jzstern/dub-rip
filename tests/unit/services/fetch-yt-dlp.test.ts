// Like bgutil-plugin.test.ts, this file mocks "node:fs" wholesale. Vitest's
// worker-level isolation keeps that from bleeding into adjacent test files;
// re-run `vitest --no-isolate` to re-confirm if the worker pool config ever
// changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetResponse, digestOf } from "./github-release-fixture";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const rmSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const overrides = {
		existsSync: existsSyncMock,
		readFileSync: readFileSyncMock,
		writeFileSync: writeFileSyncMock,
		renameSync: renameSyncMock,
		rmSync: rmSyncMock,
	};
	return { ...actual, default: { ...actual, ...overrides }, ...overrides };
});

const TEST_ASSET_NAME = "test-fixture-asset";
const PINNED_CONTENT = "pinned fixture bytes for fetch-yt-dlp test";
const PINNED_BYTES = Buffer.from(PINNED_CONTENT, "utf-8");
const PINNED_DIGEST = digestOf(PINNED_CONTENT);

// downloadTo() looks up the expected digest via `ASSET_SHA256[assetName]`.
// The real map only has entries for the actual pinned yt-dlp/plugin assets,
// and reproducing "bytes that hash to the real pin" isn't feasible without
// the exact original binary — so this swaps in a synthetic entry the test
// controls, leaving every other export untouched.
vi.mock("../../../scripts/yt-dlp-pin.mjs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../scripts/yt-dlp-pin.mjs")>();
	return {
		...actual,
		ASSET_SHA256: { ...actual.ASSET_SHA256, [TEST_ASSET_NAME]: PINNED_DIGEST },
	};
});

describe("downloadTo() cache reuse", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		existsSyncMock.mockReset();
		readFileSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		renameSyncMock.mockReset();
		rmSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("skips the network fetch when the file already on disk matches the pinned digest", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(PINNED_BYTES);

		// #when
		const { downloadTo } = await import("../../../scripts/fetch-yt-dlp.mjs");
		const result = await downloadTo(
			"https://example.test/asset",
			"/fake/dest/path",
			TEST_ASSET_NAME,
		);

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(renameSyncMock).not.toHaveBeenCalled();
		expect(result).toEqual({ bytes: PINNED_BYTES.byteLength, reused: true });
	});

	it("refetches when the file on disk exists but its digest does not match the pin", async () => {
		// #given — a stale or corrupted cache entry: present, but wrong bytes
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(Buffer.from("stale cached bytes"));
		fetchMock.mockResolvedValueOnce(assetResponse(PINNED_CONTENT));

		// #when
		const { downloadTo } = await import("../../../scripts/fetch-yt-dlp.mjs");
		const result = await downloadTo(
			"https://example.test/asset",
			"/fake/dest/path",
			TEST_ASSET_NAME,
		);

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(writeFileSyncMock).toHaveBeenCalledWith(
			"/fake/dest/path.partial",
			expect.any(Buffer),
		);
		expect(renameSyncMock).toHaveBeenCalledWith(
			"/fake/dest/path.partial",
			"/fake/dest/path",
		);
		expect(result).toEqual({ bytes: PINNED_BYTES.byteLength, reused: false });
	});

	it("refetches without ever reading the file when nothing exists at the destination", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse(PINNED_CONTENT));

		// #when
		const { downloadTo } = await import("../../../scripts/fetch-yt-dlp.mjs");
		const result = await downloadTo(
			"https://example.test/asset",
			"/fake/dest/path",
			TEST_ASSET_NAME,
		);

		// #then
		expect(readFileSyncMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ bytes: PINNED_BYTES.byteLength, reused: false });
	});

	it("throws instead of installing a fresh download that does not hash to the pin", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse("not the pinned content"));

		// #when / #then
		const { downloadTo } = await import("../../../scripts/fetch-yt-dlp.mjs");
		await expect(
			downloadTo(
				"https://example.test/asset",
				"/fake/dest/path",
				TEST_ASSET_NAME,
			),
		).rejects.toThrow(/Digest mismatch/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});
});

/**
 * The CLI wrapper decides whether to fail the build by testing the error's
 * type, so these pin the type rather than the message. Message text is one
 * reword away from silently flipping a digest mismatch back to a warning.
 */
describe("downloadTo() error classification", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		existsSyncMock.mockReset().mockReturnValue(false);
		readFileSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		renameSyncMock.mockReset();
		rmSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("raises an integrity error when the bytes do not match the pin", async () => {
		// #given
		fetchMock.mockResolvedValueOnce(assetResponse("tampered bytes"));

		// #when / #then
		const { downloadTo, AssetIntegrityError } = await import(
			"../../../scripts/fetch-yt-dlp.mjs"
		);
		await expect(
			downloadTo("https://example.test/asset", "/fake/dest", TEST_ASSET_NAME),
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it("raises an integrity error when no digest was ever recorded for the asset", async () => {
		// #when / #then
		const { downloadTo, AssetIntegrityError } = await import(
			"../../../scripts/fetch-yt-dlp.mjs"
		);
		await expect(
			downloadTo("https://example.test/asset", "/fake/dest", "unpinned-asset"),
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it("does not raise an integrity error when GitHub is unreachable", async () => {
		// #given
		fetchMock.mockRejectedValueOnce(
			new Error("getaddrinfo ENOTFOUND github.com"),
		);

		// #when / #then — an outage must stay fail-open at the CLI boundary
		const { downloadTo, AssetIntegrityError } = await import(
			"../../../scripts/fetch-yt-dlp.mjs"
		);
		await expect(
			downloadTo("https://example.test/asset", "/fake/dest", TEST_ASSET_NAME),
		).rejects.not.toBeInstanceOf(AssetIntegrityError);
	});

	it("does not raise an integrity error when the asset request fails", async () => {
		// #given
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
		});

		// #when / #then
		const { downloadTo, AssetIntegrityError } = await import(
			"../../../scripts/fetch-yt-dlp.mjs"
		);
		await expect(
			downloadTo("https://example.test/asset", "/fake/dest", TEST_ASSET_NAME),
		).rejects.not.toBeInstanceOf(AssetIntegrityError);
	});
});
