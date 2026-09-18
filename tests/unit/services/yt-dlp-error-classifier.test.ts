import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableYtDlpError } from "$lib/yt-dlp-errors";

const WATCH_PAGE_429_WARNING =
	"WARNING: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)";

describe("isRetryableYtDlpError()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureMessage).mockClear();
	});

	it("treats a bot-check error as retryable", () => {
		// #given
		const message = "Sign in to confirm you're not a bot";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats a bot-check error as retryable when yt-dlp uses a typographic apostrophe", () => {
		// #given
		// This is the exact wording yt-dlp emits (U+2019, not ASCII "'"), with the
		// "--cookies" remediation hint stripped so the match has to come from the
		// sentence itself rather than from the hint.
		const message =
			"ERROR: [youtube] abc: Sign in to confirm you’re not a bot.";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats an HTTP 403 error as retryable", () => {
		// #given
		const message = "unable to download video data: HTTP Error 403: Forbidden";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats a timeout as retryable", () => {
		// #given
		const message = "Request timed out after 15000ms";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats a network/connection error as retryable", () => {
		// #given
		const message = "connect ECONNRESET 1.2.3.4:443";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats an unavailable-video error as permanent, not retryable", () => {
		// #given
		const message = "ERROR: Video unavailable";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("treats a private-video error as permanent, not retryable", () => {
		// #given
		const message = "ERROR: This video is private";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("treats an age-restricted error as permanent, not retryable", () => {
		// #given
		const message = "ERROR: age-restricted content";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("treats a copyright error as permanent, not retryable", () => {
		// #given
		const message = "ERROR: blocked on copyright grounds";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("does not retry a download whose every fragment was refused, since each attempt re-requests them all", () => {
		// #given
		const message = "ERROR: The downloaded file is empty";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("does not retry a bot-check that came with a watch-page 429, since every attempt re-hits the throttled IP", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.`;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("still retries a bot-check that came with an unrelated warning", () => {
		// #given
		const message =
			"WARNING: [youtube] abc: mweb client https formats require a GVS PO Token\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("matches the 429 warning regardless of its letter case", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING.toUpperCase()}\nERROR: [youtube] abc: SIGN IN TO CONFIRM YOU’RE NOT A BOT.`;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("does not treat an API-call 429 as a watch-page 429", () => {
		// #given
		// Only the watch-page fetch is the signature of an IP-level throttle; a 429
		// on some other request is not evidence that retrying the whole run is futile.
		const message =
			"WARNING: [youtube] abc: Unable to download API page: HTTP Error 429: Too Many Requests\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("treats an unrecognized error as permanent by default", () => {
		// #given
		const message = "ERROR: something bizarre happened";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});
});
