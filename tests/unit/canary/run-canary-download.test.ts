import * as Sentry from "@sentry/sveltekit";
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

const { waitForBgutilPotMock } = vi.hoisted(() => ({
	waitForBgutilPotMock: vi.fn(),
}));
vi.mock("$lib/canary/wait-for-bgutil-pot", () => ({
	waitForBgutilPot: waitForBgutilPotMock,
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
		vi.mocked(Sentry.logger.warn).mockClear();
		vi.mocked(Sentry.captureException).mockClear();
		vi.mocked(Sentry.captureMessage).mockClear();
		vi.spyOn(console, "info")
			.mockReset()
			.mockImplementation(() => undefined);
		vi.spyOn(console, "warn")
			.mockReset()
			.mockImplementation(() => undefined);
		waitForBgutilPotMock
			.mockReset()
			.mockResolvedValue({ awake: true, attempts: 1, waitedMs: 0 });
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

	it("wakes the sidecar at BGUTIL_POT_URL before starting the download", async () => {
		// #given
		const callOrder: string[] = [];
		waitForBgutilPotMock.mockImplementation(async () => {
			callOrder.push("wake");
			return { awake: true, attempts: 1, waitedMs: 0 };
		});
		tryYtDlpDownloadMock.mockImplementation(async () => {
			callOrder.push("download");
		});

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(callOrder).toEqual(["wake", "download"]);
	});

	it("passes the configured sidecar URL to the wake", async () => {
		// #given
		tryYtDlpDownloadMock.mockResolvedValue(undefined);

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(waitForBgutilPotMock).toHaveBeenCalledWith(
			"http://bgutil.internal:4416",
		);
	});

	it("still runs the download when the sidecar never answered", async () => {
		// #given
		waitForBgutilPotMock.mockResolvedValue({
			awake: false,
			attempts: 30,
			waitedMs: 20_000,
		});
		tryYtDlpDownloadMock.mockResolvedValue(undefined);

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(tryYtDlpDownloadMock).toHaveBeenCalledTimes(1);
	});

	it("does not wake the sidecar when BGUTIL_POT_URL is unset", async () => {
		// #given
		delete mockEnv.BGUTIL_POT_URL;

		// #when
		const { runCanaryDownload } = await import(
			"$lib/canary/run-canary-download"
		);
		await runCanaryDownload();

		// #then
		expect(waitForBgutilPotMock).not.toHaveBeenCalled();
	});

	describe("when the sidecar never answers", () => {
		const unanswered = { awake: false, attempts: 30, waitedMs: 20_000 };

		beforeEach(() => {
			waitForBgutilPotMock.mockResolvedValue(unanswered);
			tryYtDlpDownloadMock.mockResolvedValue(undefined);
		});

		it("logs the failed wake to the Sentry log stream with its context", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(Sentry.logger.warn).toHaveBeenCalledWith(
				"Production canary could not wake bgutil-pot",
				{ service: "canary", awake: false, attempts: 30, waitedMs: 20_000 },
			);
		});

		it("warns on the console rather than logging at info level", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(console.warn).toHaveBeenCalledTimes(1);
		});

		it("does not log the failed wake at info level", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(console.info).not.toHaveBeenCalled();
		});

		it("never opens a Sentry issue for the failed wake", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(Sentry.captureException).not.toHaveBeenCalled();
			expect(Sentry.captureMessage).not.toHaveBeenCalled();
		});
	});

	describe("when the sidecar answers", () => {
		beforeEach(() => {
			tryYtDlpDownloadMock.mockResolvedValue(undefined);
		});

		it("keeps the Sentry log stream quiet", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(Sentry.logger.warn).not.toHaveBeenCalled();
		});

		it("does not warn on the console", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(console.warn).not.toHaveBeenCalled();
		});

		it("notes the wake with a single info line", async () => {
			// #when
			const { runCanaryDownload } = await import(
				"$lib/canary/run-canary-download"
			);
			await runCanaryDownload();

			// #then
			expect(console.info).toHaveBeenCalledTimes(1);
		});
	});
});
