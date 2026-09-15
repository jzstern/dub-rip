// Like bgutil-plugin.test.ts, this file mocks "node:fs" wholesale. Vitest's
// worker-level isolation keeps that from bleeding into adjacent files; re-run
// `vitest --no-isolate` to re-confirm if the worker pool config ever changes.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fsModuleWith } from "./fs-module-mock";
import {
	assetResponse,
	mockLatestRelease,
	PLUGIN_CONTENT,
	PLUGIN_DIGEST,
} from "./github-release-fixture";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const accessSyncMock = vi.hoisted(() => vi.fn());
const statSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const chmodSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () =>
	fsModuleWith({
		existsSync: existsSyncMock,
		readFileSync: readFileSyncMock,
		accessSync: accessSyncMock,
		statSync: statSyncMock,
		writeFileSync: writeFileSyncMock,
		chmodSync: chmodSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
		mkdirSync: mkdirSyncMock,
	}),
);

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

const PINNED_BGUTIL_VERSION = "2.0.0";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BAKED_BINARY = join(process.cwd(), "bin", "yt-dlp");
const BAKED_PLUGIN_DIR = join(process.cwd(), "bin", "yt-dlp-plugins");
const BAKED_PLUGIN_ZIP = join(
	BAKED_PLUGIN_DIR,
	"bgutil-ytdlp-pot-provider.zip",
);

function resetMocks(): void {
	vi.resetModules();
	fetchMock.mockReset();
	existsSyncMock.mockReset().mockReturnValue(false);
	accessSyncMock.mockReset();
	statSyncMock.mockReset().mockReturnValue({ mtimeMs: Date.now() });
	writeFileSyncMock.mockReset();
	chmodSyncMock.mockReset();
	renameSyncMock.mockReset();
	unlinkSyncMock.mockReset();
	mkdirSyncMock.mockReset();
	readFileSyncMock.mockReset().mockReturnValue(Buffer.from(PLUGIN_CONTENT));
}

/**
 * The /tmp fallback still resolves `releases/latest` — that freshness is
 * deliberate (see the binary-refresh tests). The bake is a floor beneath it,
 * so these tests assert the fallback keeps working, not that it was replaced.
 */
describe("ensureYtDlpBinary()", () => {
	beforeEach(resetMocks);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns the build-time-baked binary when one is present and executable", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then
		expect(path).toBe(BAKED_BINARY);
	});

	it("returns the baked binary without awaiting any download", async () => {
		// #given a stale baked binary and a download that never settles
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		fetchMock.mockReturnValue(new Promise(() => {}));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then resolving at all proves the caller was not blocked on the fetch
		expect(path).toBe(BAKED_BINARY);
	});

	it("still kicks off a background refresh once the baked binary ages past the TTL, so the pin is a floor and not a ceiling", async () => {
		// #given an image older than the refresh TTL
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		mockLatestRelease(fetchMock);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();
		await vi.waitFor(() => expect(renameSyncMock).toHaveBeenCalled());

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("api.github.com"),
			expect.anything(),
		);
	});

	it("does not refresh a baked binary that is still within the TTL", async () => {
		// #given the common cold start: a container running a freshly built image
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
		mockLatestRelease(fetchMock);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then no GitHub API call and no ~40MB download on every cold start
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ignores a baked binary that is not executable", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		accessSyncMock.mockImplementation(() => {
			throw new Error("EACCES");
		});
		mockLatestRelease(fetchMock);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then
		expect(path).not.toBe(BAKED_BINARY);
	});

	it("falls back to downloading when nothing was baked", async () => {
		// #given
		mockLatestRelease(fetchMock);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("api.github.com"),
			expect.anything(),
		);
	});

	it("marks the downloaded fallback binary executable", async () => {
		// #given
		mockLatestRelease(fetchMock);

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then
		expect(chmodSyncMock).toHaveBeenCalledWith(expect.any(String), 0o755);
	});
});

describe("ensureBgutilPlugin()", () => {
	beforeEach(resetMocks);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns the baked plugin directory when the zip was baked in", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_PLUGIN_ZIP);

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toBe(BAKED_PLUGIN_DIR);
	});

	it("does not hit the network when the baked plugin is used", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_PLUGIN_ZIP);

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await ensureBgutilPlugin();

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls back to downloading the pinned zip when nothing was baked", async () => {
		// #given
		fetchMock.mockResolvedValue(assetResponse(PLUGIN_CONTENT));

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await ensureBgutilPlugin();

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				`bgutil-ytdlp-pot-provider/releases/download/${PINNED_BGUTIL_VERSION}/`,
			),
			expect.any(Object),
		);
	});
});
