import { delimiter } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	FfmpegNotFoundError,
	type FfmpegResolverDeps,
	findFfmpeg,
} from "../../src/lib/ffmpeg-path";

function makeDeps(overrides: Partial<FfmpegResolverDeps> = {}) {
	return {
		env: { PATH: ["/usr/local/bin", "/usr/bin"].join(delimiter) },
		platform: "linux" as const,
		isExecutable: vi.fn(() => false),
		loadBundledPath: vi.fn(() => null),
		...overrides,
	};
}

describe("findFfmpeg()", () => {
	it("uses FFMPEG_PATH when it points at an executable", () => {
		// #given
		const deps = makeDeps({
			env: { FFMPEG_PATH: "/opt/ffmpeg", PATH: "/usr/bin" },
			isExecutable: vi.fn(() => true),
		});

		// #when
		const result = findFfmpeg(deps);

		// #then
		expect(result).toEqual({ path: "/opt/ffmpeg", source: "env" });
	});

	it("prefers FFMPEG_PATH over an ffmpeg on PATH", () => {
		// #given
		const deps = makeDeps({
			env: { FFMPEG_PATH: "/opt/ffmpeg", PATH: "/usr/bin" },
			isExecutable: vi.fn(() => true),
		});

		// #when
		const result = findFfmpeg(deps);

		// #then
		expect(result.source).toBe("env");
	});

	it("throws instead of falling through when FFMPEG_PATH is not executable", () => {
		// #given
		const deps = makeDeps({
			env: { FFMPEG_PATH: "/nope/ffmpeg", PATH: "/usr/bin" },
			isExecutable: vi.fn((path: string) => path === "/usr/bin/ffmpeg"),
		});

		// #when
		const act = () => findFfmpeg(deps);

		// #then
		expect(act).toThrow(/FFMPEG_PATH is set to "\/nope\/ffmpeg"/);
	});

	it("finds ffmpeg on PATH, honouring directory order", () => {
		// #given
		const deps = makeDeps({
			isExecutable: vi.fn(
				(path: string) =>
					path === "/usr/local/bin/ffmpeg" || path === "/usr/bin/ffmpeg",
			),
		});

		// #when
		const result = findFfmpeg(deps);

		// #then
		expect(result).toEqual({ path: "/usr/local/bin/ffmpeg", source: "path" });
	});

	it("looks for ffmpeg.exe on Windows", () => {
		// #given
		const isExecutable = vi.fn((path: string) => path.endsWith("ffmpeg.exe"));
		const deps = makeDeps({
			platform: "win32",
			env: { PATH: "C:\\ffmpeg" },
			isExecutable,
		});

		// #when
		const result = findFfmpeg(deps);

		// #then
		expect(result.path.endsWith("ffmpeg.exe")).toBe(true);
	});

	it("falls back to ffmpeg-static when PATH has no ffmpeg", () => {
		// #given
		const deps = makeDeps({
			isExecutable: vi.fn((path: string) => path === "/app/ffmpeg-static"),
			loadBundledPath: vi.fn(() => "/app/ffmpeg-static"),
		});

		// #when
		const result = findFfmpeg(deps);

		// #then
		expect(result).toEqual({
			path: "/app/ffmpeg-static",
			source: "ffmpeg-static",
		});
	});

	it("does not load ffmpeg-static when PATH already has ffmpeg", () => {
		// #given
		const loadBundledPath = vi.fn(() => "/app/ffmpeg-static");
		const deps = makeDeps({
			isExecutable: vi.fn((path: string) => path === "/usr/bin/ffmpeg"),
			loadBundledPath,
		});

		// #when
		findFfmpeg(deps);

		// #then
		expect(loadBundledPath).not.toHaveBeenCalled();
	});

	it("skips an ffmpeg-static path whose binary was never downloaded", () => {
		// #given
		const deps = makeDeps({
			loadBundledPath: vi.fn(() => "/app/ffmpeg-static"),
		});

		// #when
		const act = () => findFfmpeg(deps);

		// #then
		expect(act).toThrow(FfmpegNotFoundError);
	});

	it("throws a message naming every way to fix it when nothing is found", () => {
		// #given
		const deps = makeDeps({ env: {} });

		// #when
		const act = () => findFfmpeg(deps);

		// #then
		expect(act).toThrow(/FFMPEG_PATH.*RAILPACK_DEPLOY_APT_PACKAGES/s);
	});
});
