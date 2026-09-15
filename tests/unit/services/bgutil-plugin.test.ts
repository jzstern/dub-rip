// Verified via `vitest --no-isolate`: this file's vi.mock("node:fs") does
// NOT bleed into adjacent test files. Vitest's worker-level isolation
// handles the boundary, but if you ever change vitest config or worker
// pool settings, re-run that command to confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assetResponse,
	PLUGIN_CONTENT,
	PLUGIN_DIGEST,
} from "./github-release-fixture";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const overrides = {
		existsSync: existsSyncMock,
		readFileSync: readFileSyncMock,
		writeFileSync: writeFileSyncMock,
		mkdirSync: mkdirSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
	};
	return { ...actual, default: { ...actual, ...overrides }, ...overrides };
});

// `ensureBgutilPlugin` now holds the zip to `ASSET_SHA256[BGUTIL_PLUGIN_FILENAME]`,
// and bytes hashing to the real pin cannot be reproduced without the original
// zip — so, as in fetch-yt-dlp.test.ts, swap in a synthetic entry the test
// controls and leave every other export untouched.
vi.mock("../../../scripts/yt-dlp-pin.mjs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../scripts/yt-dlp-pin.mjs")>();
	return {
		...actual,
		ASSET_SHA256: {
			...actual.ASSET_SHA256,
			[actual.BGUTIL_PLUGIN_FILENAME]: PLUGIN_DIGEST,
		},
	};
});

describe("ensureBgutilPlugin()", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		existsSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		mkdirSyncMock.mockReset();
		readFileSyncMock.mockReset();
		renameSyncMock.mockReset();
		unlinkSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("downloads the version-pinned zip to a stable directory and returns that directory path", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/2.0.0/bgutil-ytdlp-pot-provider.zip",
			),
			expect.any(Object),
		);
		expect(renameSyncMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining("bgutil-ytdlp-pot-provider.zip"),
		);
	});

	it("returns the existing directory without re-downloading when the cached zip matches the pin", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(Buffer.from(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("dedupes concurrent calls (single-flight)", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		let resolveFetch!: (v: unknown) => void;
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		const a = ensureBgutilPlugin();
		const b = ensureBgutilPlugin();
		resolveFetch(assetResponse(PLUGIN_CONTENT));
		await Promise.all([a, b]);

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("clears the in-flight promise on failure so a retry is possible", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock
			.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Down" })
			.mockResolvedValueOnce(assetResponse(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await expect(ensureBgutilPlugin()).rejects.toThrow(/503/);
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("re-downloads a cached zip that no longer matches the pin instead of serving it", async () => {
		// #given a successful download, then the /tmp copy goes bad
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValue(assetResponse(PLUGIN_CONTENT));
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await ensureBgutilPlugin();
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(Buffer.from("corrupted on disk"));

		// #when
		await ensureBgutilPlugin();

		// #then the failed check has to force a refetch — answering from the
		// settled in-flight promise would hand back the corrupted copy
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("refuses a zip that does not hash to the pinned digest", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse("substituted zip bytes"));

		// #when / #then
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await expect(ensureBgutilPlugin()).rejects.toThrow(/Digest mismatch/);
	});

	it("leaves nothing on disk when the zip fails verification", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse("substituted zip bytes"));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await expect(ensureBgutilPlugin()).rejects.toThrow();

		// #then — nothing is written, so the existsSync short-circuit at the top
		// of the function cannot serve the rejected zip on a later call
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(renameSyncMock).not.toHaveBeenCalled();
	});

	it("writes the zip to a temp path and renames it into place", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(assetResponse(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await ensureBgutilPlugin();

		// #then the verified bytes never occupy the final path until complete
		const [writtenPath] = writeFileSyncMock.mock.calls[0];
		expect(writtenPath).toMatch(/\.tmp$/);
		expect(renameSyncMock).toHaveBeenCalledWith(
			writtenPath,
			expect.stringContaining("bgutil-ytdlp-pot-provider.zip"),
		);
	});

	it("clears the in-flight promise after a verification failure so a retry is possible", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock
			.mockResolvedValueOnce(assetResponse("substituted zip bytes"))
			.mockResolvedValueOnce(assetResponse(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await expect(ensureBgutilPlugin()).rejects.toThrow(/Digest mismatch/);
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
