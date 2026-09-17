import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv: Record<string, string> = {};
vi.mock("$env/dynamic/private", () => ({
	get env() {
		return mockEnv;
	},
}));

const { tryYtDlpDownloadMock } = vi.hoisted(() => ({
	tryYtDlpDownloadMock: vi.fn(),
}));
vi.mock("$lib/download-pipeline/try-yt-dlp", () => ({
	tryYtDlpDownload: tryYtDlpDownloadMock,
}));

const { getYTDlpMock } = vi.hoisted(() => ({
	getYTDlpMock: vi.fn(() => Promise.resolve({})),
}));
vi.mock("$lib/download-pipeline/yt-dlp-instance", () => ({
	getYTDlp: getYTDlpMock,
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureBgutilPlugin: vi.fn(() => Promise.resolve("/tmp/yt-dlp-plugins")),
}));

const { cleanupTempFilesMock } = vi.hoisted(() => ({
	cleanupTempFilesMock: vi.fn(() => Promise.resolve()),
}));
vi.mock("$lib/download-pipeline/cleanup-temp-files", () => ({
	cleanupTempFiles: cleanupTempFilesMock,
}));

const { pathExistsMock } = vi.hoisted(() => ({
	pathExistsMock: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("$lib/download-pipeline/path-exists", () => ({
	pathExists: pathExistsMock,
}));

const { registerDownloadMock } = vi.hoisted(() => ({
	registerDownloadMock: vi.fn(() => "fake-token"),
}));
vi.mock("$lib/download-pipeline/download-tokens", () => ({
	registerDownload: registerDownloadMock,
}));

const { finalizeMp3Mock } = vi.hoisted(() => ({
	finalizeMp3Mock: vi.fn(),
}));
vi.mock("$lib/download-pipeline/finalize-mp3", () => ({
	finalizeMp3: finalizeMp3Mock,
}));

function emitEvent(
	send: (data: Record<string, unknown>) => void,
	eventType: string,
	eventData: string,
) {
	send({ type: "event", eventType, eventData });
}

describe("runCanaryDownload()", () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		mockEnv.BGUTIL_POT_URL = "http://bgutil.internal:4416";
		tryYtDlpDownloadMock.mockReset();
		getYTDlpMock.mockClear();
		cleanupTempFilesMock.mockClear();
		pathExistsMock.mockReset().mockResolvedValue(true);
		registerDownloadMock.mockClear();
		finalizeMp3Mock.mockClear();
	});

	it("classifies a completed download as ok and reports the itag it used", async () => {
		// #given
		tryYtDlpDownloadMock.mockImplementation(async ({ send }) => {
			emitEvent(send, "info", " id: Downloading 1 format(s): 18");
		});

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		const result = await runCanaryDownload();

		// #then
		expect(result.stage).toBe("ok");
		expect(result.itag).toBe("18");
	});

	it("classifies a queue-full rejection as a skip, not a failure", async () => {
		// #given
		const { YtDlpQueueFullError } = await import("$lib/yt-dlp-concurrency");
		tryYtDlpDownloadMock.mockRejectedValue(new YtDlpQueueFullError());

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		const result = await runCanaryDownload();

		// #then
		expect(result.stage).toBe("queue_full");
	});

	it("classifies the failure stage from accumulated stdout and the rejection message", async () => {
		// #given — media_refused signature: a format was chosen but never had a
		// Destination:, and the rejection embeds the real stderr text (mirroring
		// how yt-dlp-wrap's own 'error' event carries it in production)
		tryYtDlpDownloadMock.mockImplementation(async ({ send }) => {
			emitEvent(send, "info", " id: Downloading 1 format(s): 251");
			throw new Error(
				"\nError code: 1\n\nStderr:\nERROR: unable to download video data: HTTP Error 403: Forbidden",
			);
		});

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		const result = await runCanaryDownload();

		// #then
		expect(result.stage).toBe("media_refused");
	});

	it("returns an unknown classification without crashing when BGUTIL_POT_URL is unset", async () => {
		// #given
		delete mockEnv.BGUTIL_POT_URL;

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		const result = await runCanaryDownload();

		// #then
		expect(result.stage).toBe("unknown");
	});

	it("never calls tryYtDlpDownload when BGUTIL_POT_URL is unset", async () => {
		// #given
		delete mockEnv.BGUTIL_POT_URL;

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(tryYtDlpDownloadMock).not.toHaveBeenCalled();
	});

	it("cleans up every temp file for the run even when the download fails", async () => {
		// #given
		tryYtDlpDownloadMock.mockRejectedValue(new Error("boom"));

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(cleanupTempFilesMock).toHaveBeenCalledWith(
			expect.objectContaining({ tags: { service: "canary" } }),
		);
	});

	it("never registers a download token", async () => {
		// #given
		tryYtDlpDownloadMock.mockImplementation(async ({ send }) => {
			emitEvent(send, "info", " id: Downloading 1 format(s): 18");
		});

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(registerDownloadMock).not.toHaveBeenCalled();
	});

	it("never calls finalizeMp3", async () => {
		// #given
		tryYtDlpDownloadMock.mockImplementation(async ({ send }) => {
			emitEvent(send, "info", " id: Downloading 1 format(s): 18");
		});

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(finalizeMp3Mock).not.toHaveBeenCalled();
	});
});
