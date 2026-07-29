// Verified via `vitest --no-isolate`: this file's vi.mock("node:fs") does
// NOT bleed into adjacent test files. Vitest's worker-level isolation
// handles the boundary, but if you ever change vitest config or worker
// pool settings, re-run that command to confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const statSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const chmodSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const overrides = {
		existsSync: existsSyncMock,
		statSync: statSyncMock,
		writeFileSync: writeFileSyncMock,
		chmodSync: chmodSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
		mkdirSync: mkdirSyncMock,
	};
	return {
		...actual,
		default: { ...actual, ...overrides },
		...overrides,
	};
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

	it("refreshes the binary once the cached copy is older than the TTL", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		mockReleaseAndBinaryFetch();

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(renameSyncMock).toHaveBeenCalled();
	});

	it("falls back to the existing cached binary when a refresh download fails", async () => {
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
		expect(renameSyncMock).not.toHaveBeenCalled();
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

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
