// Verified via `vitest --no-isolate`: this file's vi.mock("node:fs") does
// NOT bleed into adjacent test files. Vitest's worker-level isolation
// handles the boundary, but if you ever change vitest config or worker
// pool settings, re-run that command to confirm.
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("node:fs", async () => {
	// As in baked-binaries.test.ts: `importOriginal()` hands back an empty
	// namespace for node builtins under this Vite config, so `fs.constants`
	// would be undefined and the baked branch's executable check would fail
	// for the wrong reason. CommonJS resolution returns the genuine module.
	const realFs = createRequire(import.meta.url)("node:fs");
	const overrides = {
		existsSync: existsSyncMock,
		accessSync: accessSyncMock,
		statSync: statSyncMock,
		writeFileSync: writeFileSyncMock,
		chmodSync: chmodSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
		mkdirSync: mkdirSyncMock,
	};
	return { ...realFs, ...overrides, default: { ...realFs, ...overrides } };
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BAKED_BINARY = join(process.cwd(), "bin", "yt-dlp");

function mockReleaseAndBinaryFetch() {
	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					assets: [
						{
							name: "yt-dlp_macos",
							browser_download_url: "https://example.com/yt-dlp_macos",
						},
						{
							name: "yt-dlp_linux",
							browser_download_url: "https://example.com/yt-dlp_linux",
						},
					],
				}),
		})
		.mockResolvedValueOnce({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
		});
}

describe("ensureYtDlpBinary() refresh behavior", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		existsSyncMock.mockReset();
		accessSyncMock.mockReset();
		statSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		chmodSyncMock.mockReset();
		renameSyncMock.mockReset();
		unlinkSyncMock.mockReset();
		mkdirSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("downloads the binary when none is cached", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		mockReleaseAndBinaryFetch();

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then
		expect(path).toMatch(/yt-dlp$/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(renameSyncMock).toHaveBeenCalled();
	});

	it("returns the cached binary without re-downloading when it is fresh", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() });

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then
		expect(path).toMatch(/yt-dlp$/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns the stale cached binary immediately and refreshes it in the background", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		mockReleaseAndBinaryFetch();

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then — caller is never blocked on the refresh
		expect(path).toMatch(/yt-dlp$/);
		await vi.waitFor(() => expect(renameSyncMock).toHaveBeenCalled());
	});

	it("keeps the cached binary when a background refresh fails", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			text: () => Promise.resolve(""),
		});

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then — degrades gracefully instead of throwing
		expect(path).toMatch(/yt-dlp$/);
		await vi.waitFor(() => expect(unlinkSyncMock).toHaveBeenCalled());
		expect(renameSyncMock).not.toHaveBeenCalled();
	});

	it("does not re-attempt a failed refresh within the retry cooldown", async () => {
		// #given — first background refresh fails
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			text: () => Promise.resolve(""),
		});
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		// #when — a second request arrives while still inside the cooldown
		await ensureYtDlpBinary();

		// #then — no new refresh is started
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes a baked binary only once it has aged past the TTL", async () => {
		// #given a container whose only binary is the one baked into its image
		existsSyncMock.mockImplementation((p: string) => p === BAKED_BINARY);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
		mockReleaseAndBinaryFetch();
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");

		// #when the image is newer than the TTL
		await ensureYtDlpBinary();

		// #then the bake is trusted, exactly as a fresh /tmp binary would be
		expect(fetchMock).not.toHaveBeenCalled();

		// #when the same instance stays up until the bake ages past the TTL
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		await ensureYtDlpBinary();

		// #then it picks up upstream extraction fixes like any stale binary
		await vi.waitFor(() => expect(renameSyncMock).toHaveBeenCalled());
	});

	it("propagates the error when there is no cached binary to fall back to", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			text: () => Promise.resolve(""),
		});

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(/503/);
	});

	it("dedupes concurrent refresh calls (single-flight)", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		let resolveRelease!: (value: unknown) => void;
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRelease = resolve;
			}),
		);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
		});

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const first = ensureYtDlpBinary();
		const second = ensureYtDlpBinary();
		resolveRelease({
			ok: true,
			json: () =>
				Promise.resolve({
					assets: [
						{
							name: "yt-dlp_macos",
							browser_download_url: "https://example.com/yt-dlp_macos",
						},
						{
							name: "yt-dlp_linux",
							browser_download_url: "https://example.com/yt-dlp_linux",
						},
					],
				}),
		});
		await Promise.all([first, second]);

		// #then — one shared background refresh, not one per caller
		await vi.waitFor(() => expect(renameSyncMock).toHaveBeenCalledTimes(1));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
