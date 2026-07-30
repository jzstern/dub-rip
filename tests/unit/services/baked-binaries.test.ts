// Like bgutil-plugin.test.ts, this file mocks "node:fs" wholesale. Vitest's
// worker-level isolation keeps that from bleeding into adjacent files; re-run
// `vitest --no-isolate` to re-confirm if the worker pool config ever changes.
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const accessSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const chmodSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async () => {
	// `importOriginal()` hands back an empty namespace for node builtins under
	// this Vite config, which would leave `fs.constants` undefined and make the
	// executable check under test silently fail. CommonJS resolution sidesteps
	// the module graph and returns the genuine module.
	const realFs = createRequire(import.meta.url)("node:fs");
	const overrides = {
		existsSync: existsSyncMock,
		accessSync: accessSyncMock,
		writeFileSync: writeFileSyncMock,
		chmodSync: chmodSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
		mkdirSync: mkdirSyncMock,
	};
	return { ...realFs, ...overrides, default: { ...realFs, ...overrides } };
});

const PINNED_BGUTIL_VERSION = "1.3.1";
const BAKED_BINARY = join(process.cwd(), "bin", "yt-dlp");
const BAKED_PLUGIN_DIR = join(process.cwd(), "bin", "yt-dlp-plugins");
const BAKED_PLUGIN_ZIP = join(
	BAKED_PLUGIN_DIR,
	"bgutil-ytdlp-pot-provider.zip",
);

function binaryResponse() {
	return {
		ok: true,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
	};
}

/**
 * The /tmp fallback still resolves `releases/latest` — that freshness is
 * deliberate (see the binary-refresh tests). The bake is a floor beneath it,
 * so these tests assert the fallback keeps working, not that it was replaced.
 */
function releasesApiResponse() {
	return {
		ok: true,
		json: () =>
			Promise.resolve({
				assets: [
					{
						name:
							process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux",
						browser_download_url: "https://example.test/yt-dlp",
					},
				],
			}),
	};
}

function mockLatestReleaseDownload(): void {
	fetchMock.mockImplementation((url: string) =>
		Promise.resolve(
			String(url).includes("api.github.com")
				? releasesApiResponse()
				: binaryResponse(),
		),
	);
}

function resetMocks(): void {
	vi.resetModules();
	fetchMock.mockReset();
	existsSyncMock.mockReset().mockReturnValue(false);
	accessSyncMock.mockReset();
	writeFileSyncMock.mockReset();
	chmodSyncMock.mockReset();
	renameSyncMock.mockReset();
	unlinkSyncMock.mockReset();
	mkdirSyncMock.mockReset();
}

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
		// #given a baked binary and a download that never settles
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		fetchMock.mockReturnValue(new Promise(() => {}));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then resolving at all proves the caller was not blocked on the fetch
		expect(path).toBe(BAKED_BINARY);
	});

	it("still kicks off a background refresh so the pin is a floor, not a ceiling", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		fetchMock.mockResolvedValue(releasesApiResponse());

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("api.github.com"),
			expect.anything(),
		);
	});

	it("ignores a baked binary that is not executable", async () => {
		// #given
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		accessSyncMock.mockImplementation(() => {
			throw new Error("EACCES");
		});
		mockLatestReleaseDownload();

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then
		expect(path).not.toBe(BAKED_BINARY);
	});

	it("falls back to downloading when nothing was baked", async () => {
		// #given
		mockLatestReleaseDownload();

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
		mockLatestReleaseDownload();

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
		fetchMock.mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(8067)),
		});

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
