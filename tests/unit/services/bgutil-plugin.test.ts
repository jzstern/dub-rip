// Verified via `vitest --no-isolate`: this file's vi.mock("node:fs") does
// NOT bleed into adjacent test files. Vitest's worker-level isolation
// handles the boundary, but if you ever change vitest config or worker
// pool settings, re-run that command to confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		default: {
			...actual,
			existsSync: existsSyncMock,
			writeFileSync: writeFileSyncMock,
			mkdirSync: mkdirSyncMock,
		},
		existsSync: existsSyncMock,
		writeFileSync: writeFileSyncMock,
		mkdirSync: mkdirSyncMock,
	};
});

describe("ensureBgutilPlugin()", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		existsSyncMock.mockReset();
		writeFileSyncMock.mockReset();
		mkdirSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("downloads the version-pinned zip to a stable directory and returns that directory path", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(8067)),
		});

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/1.3.1/bgutil-ytdlp-pot-provider.zip",
			),
			expect.any(Object),
		);
		expect(writeFileSyncMock).toHaveBeenCalledWith(
			expect.stringContaining("bgutil-ytdlp-pot-provider.zip"),
			expect.any(Buffer),
		);
	});

	it("returns the existing directory without re-downloading when the zip is already present", async () => {
		// #given
		existsSyncMock.mockReturnValue(true);

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
		resolveFetch({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(8067)),
		});
		await Promise.all([a, b]);

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("clears the in-flight promise on failure so a retry is possible", async () => {
		// #given
		existsSyncMock.mockReturnValue(false);
		fetchMock
			.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Down" })
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(8067)),
			});

		// #when
		const { ensureBgutilPlugin } = await import("$lib/yt-dlp-binary");
		await expect(ensureBgutilPlugin()).rejects.toThrow(/503/);
		const dir = await ensureBgutilPlugin();

		// #then
		expect(dir).toMatch(/yt-dlp-plugins$/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
