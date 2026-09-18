import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableYtDlpError, parseYtDlpError } from "$lib/yt-dlp-errors";
import {
	AGE_GATE_WITH_COOKIES_HINT,
	BOT_CHECK_WITH_COOKIES_HINT,
	PRIVATE_VIDEO_WITH_COOKIES_HINT,
	REWORDED_BOT_CHECK_WITH_COOKIES_HINT,
} from "./yt-dlp-error-fixtures";

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

	it("treats an unrecognized error as permanent by default", () => {
		// #given
		const message = "ERROR: something bizarre happened";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("does not retry an age-gated video just because yt-dlp appends its cookies hint", () => {
		// #given
		const message = AGE_GATE_WITH_COOKIES_HINT;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("does not retry a private video just because yt-dlp appends its cookies hint", () => {
		// #given
		const message = PRIVATE_VIDEO_WITH_COOKIES_HINT;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});

	it("still retries a bot-check whose sentence was reworded, when only the cookies hint identifies it", () => {
		// #given
		const message = REWORDED_BOT_CHECK_WITH_COOKIES_HINT;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});

	it("still retries a bot-check with the typographic apostrophe and the full cookies hint", () => {
		// #given
		const message = BOT_CHECK_WITH_COOKIES_HINT;

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(true);
	});
});

describe("parseYtDlpError()", () => {
	it("tells the user an age-gated video is age-restricted, not that the service failed to verify", () => {
		// #given
		const message = AGE_GATE_WITH_COOKIES_HINT;

		// #when
		const result = parseYtDlpError(message);

		// #then
		expect(result).toBe(
			"This video is age-restricted and cannot be downloaded.",
		);
	});

	it("tells the user a private video is private, not that the service failed to verify", () => {
		// #given
		const message = PRIVATE_VIDEO_WITH_COOKIES_HINT;

		// #when
		const result = parseYtDlpError(message);

		// #then
		expect(result).toBe("This video is private and cannot be downloaded.");
	});
});
