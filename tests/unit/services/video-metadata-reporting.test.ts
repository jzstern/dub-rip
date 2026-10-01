import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
}));
vi.mock("node:child_process", () => ({
	default: {
		execFile: (...args: unknown[]) => execFileMock(...args),
	},
	execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureYtDlpBinary: vi.fn().mockResolvedValue("/tmp/yt-dlp"),
	buildBgutilPotArgs: vi.fn().mockResolvedValue([]),
	buildJsRuntimeArgs: vi.fn().mockReturnValue([]),
}));

const limiterRejection = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("../../../src/lib/yt-dlp-concurrency", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../../src/lib/yt-dlp-concurrency")
		>();
	return {
		...actual,
		withYtDlpConcurrencyLimit: <T>(fn: () => Promise<T>) =>
			limiterRejection.error
				? Promise.reject(limiterRejection.error)
				: actual.withYtDlpConcurrencyLimit(fn),
	};
});

import { fetchVideoDetails } from "../../../src/lib/video-metadata";

function mockExecFileError(err: Error) {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null) => void,
		) => {
			cb(err);
		},
	);
}

/**
 * Bot-check and 403 failures are retryable, so the call only reports once the
 * backoff is exhausted. Fake timers skip the waiting without changing what the
 * classifier sees.
 */
async function fetchAndSettle(failure: Error): Promise<void> {
	mockExecFileError(failure);
	vi.useFakeTimers();
	try {
		const pending = fetchVideoDetails("https://youtu.be/abc");
		await vi.runAllTimersAsync();
		await pending;
	} finally {
		vi.useRealTimers();
	}
}

describe("fetchVideoDetails - failure reporting policy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		limiterRejection.error = null;
	});

	it("does not file an issue for a video that can never be downloaded", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("leaves a breadcrumb for that user-caused failure instead", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "video-metadata",
				level: "info",
			}),
		);
	});

	it("downgrades an exhausted bot-check to warning level", async () => {
		// #given — the exact failure production reported as an error-level issue
		const failure = new Error(
			"Command failed: /tmp/yt-dlp --dump-json\nERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser",
		);

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("tags a transient failure with its category for triage", async () => {
		// #given
		const failure = new Error("HTTP Error 403: Forbidden");

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({
				tags: expect.objectContaining({ category: "transient" }),
			}),
		);
	});

	it("still files an error-level issue for an unclassified failure", async () => {
		// #given
		const failure = new Error("ERROR: something bizarre happened");

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ level: "error" }),
		);
	});

	it("returns null regardless of how the failure was classified", async () => {
		// #given
		const failure = new Error("ERROR: This video is private");
		mockExecFileError(failure);

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toBeNull();
	});

	it("does not file an issue when the downloader's queue is full", async () => {
		// #given
		const { YtDlpQueueFullError } = await import(
			"../../../src/lib/yt-dlp-concurrency"
		);
		limiterRejection.error = new YtDlpQueueFullError();

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details).toBeNull();
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("leaves a breadcrumb for a full queue instead", async () => {
		// #given
		const { YtDlpQueueFullError } = await import(
			"../../../src/lib/yt-dlp-concurrency"
		);
		limiterRejection.error = new YtDlpQueueFullError();

		// #when
		await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "video-metadata",
				message: expect.stringContaining("queue is full"),
			}),
		);
	});
});
