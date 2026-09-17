import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readdirMock, unlinkMock } = vi.hoisted(() => ({
	readdirMock: vi.fn<(path: string) => Promise<string[]>>(),
	unlinkMock: vi.fn<(path: string) => Promise<void>>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const merged = { ...actual, readdir: readdirMock, unlink: unlinkMock };
	return { ...merged, default: merged };
});

describe("cleanupTempFiles()", () => {
	beforeEach(() => {
		readdirMock.mockReset();
		unlinkMock.mockReset().mockResolvedValue(undefined);
		vi.mocked(Sentry.captureException).mockClear();
	});

	it("deletes every file matching the prefix", async () => {
		// #given
		readdirMock.mockResolvedValue(["abc.mp3", "abc.part-Frag1", "other.mp3"]);

		// #when
		const { cleanupTempFiles } = await import(
			"$lib/download-pipeline/cleanup-temp-files"
		);
		await cleanupTempFiles({ tempDir: "/tmp", prefix: "abc", tags: {} });

		// #then
		expect(unlinkMock).toHaveBeenCalledTimes(2);
	});

	it("continues deleting the remaining files after one unlink fails", async () => {
		// #given — the first file is already gone, but two more remain
		readdirMock.mockResolvedValue(["abc.mp3", "abc.part-Frag1", "abc.ytdl"]);
		unlinkMock
			.mockRejectedValueOnce(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);

		// #when
		const { cleanupTempFiles } = await import(
			"$lib/download-pipeline/cleanup-temp-files"
		);
		await cleanupTempFiles({ tempDir: "/tmp", prefix: "abc", tags: {} });

		// #then
		expect(unlinkMock).toHaveBeenCalledTimes(3);
	});

	it("does not report a temp file that was already gone", async () => {
		// #given
		readdirMock.mockResolvedValue(["abc.mp3"]);
		unlinkMock.mockRejectedValue(
			Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
		);

		// #when
		const { cleanupTempFiles } = await import(
			"$lib/download-pipeline/cleanup-temp-files"
		);
		await cleanupTempFiles({ tempDir: "/tmp", prefix: "abc", tags: {} });

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("reports a cleanup failure other than a file already being gone", async () => {
		// #given
		readdirMock.mockResolvedValue(["abc.mp3"]);
		unlinkMock.mockRejectedValue(
			Object.assign(new Error("EACCES"), { code: "EACCES" }),
		);

		// #when
		const { cleanupTempFiles } = await import(
			"$lib/download-pipeline/cleanup-temp-files"
		);
		await cleanupTempFiles({ tempDir: "/tmp", prefix: "abc", tags: {} });

		// #then
		expect(Sentry.captureException).toHaveBeenCalled();
	});

	it("reports every failing file, not just the first", async () => {
		// #given — two distinct real failures among the leftovers
		readdirMock.mockResolvedValue(["abc.mp3", "abc.part-Frag1"]);
		unlinkMock.mockRejectedValue(
			Object.assign(new Error("EACCES"), { code: "EACCES" }),
		);

		// #when
		const { cleanupTempFiles } = await import(
			"$lib/download-pipeline/cleanup-temp-files"
		);
		await cleanupTempFiles({ tempDir: "/tmp", prefix: "abc", tags: {} });

		// #then
		expect(Sentry.captureException).toHaveBeenCalledTimes(2);
	});
});
