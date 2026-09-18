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

import { DEFAULT_MAX_ATTEMPTS } from "../../../src/lib/retry";
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
});

describe("fetchVideoDetails - retry policy", () => {
	const WATCH_PAGE_429_FAILURE = new Error(
		"Command failed: /tmp/yt-dlp --dump-json\nWARNING: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.",
	);
	const PLAIN_BOT_CHECK_FAILURE = new Error(
		"Command failed: /tmp/yt-dlp --dump-json\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.",
	);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs yt-dlp once when the bot-check came with a watch-page 429", async () => {
		// #given
		const failure = WATCH_PAGE_429_FAILURE;

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(execFileMock).toHaveBeenCalledTimes(1);
	});

	it("still reports that single 429-backed failure at warning level", async () => {
		// #given
		const failure = WATCH_PAGE_429_FAILURE;

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("retries a bot-check without a watch-page 429 up to the attempt limit", async () => {
		// #given
		const failure = PLAIN_BOT_CHECK_FAILURE;

		// #when
		await fetchAndSettle(failure);

		// #then
		expect(execFileMock).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
	});
});
