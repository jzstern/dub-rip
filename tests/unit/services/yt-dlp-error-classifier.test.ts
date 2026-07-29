import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableYtDlpError } from "$lib/yt-dlp-errors";

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

	it("treats an unrecognized error as permanent by default", () => {
		// #given
		const message = "ERROR: something bizarre happened";

		// #when
		const result = isRetryableYtDlpError(message);

		// #then
		expect(result).toBe(false);
	});
});
