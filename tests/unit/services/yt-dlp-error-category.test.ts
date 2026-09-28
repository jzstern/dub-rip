import { describe, expect, it } from "vitest";
import { classifyYtDlpError } from "$lib/yt-dlp-errors";
import {
	AGE_GATE_WITH_COOKIES_HINT,
	BOT_CHECK_WITH_COOKIES_HINT,
	PRIVATE_VIDEO_WITH_COOKIES_HINT,
	REWORDED_BOT_CHECK_WITH_COOKIES_HINT,
} from "./yt-dlp-error-fixtures";

describe("classifyYtDlpError() reporting category", () => {
	it("categorizes an unavailable video as a user failure", () => {
		// #given
		const message = "ERROR: Video unavailable";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes a private video as a user failure", () => {
		// #given
		const message = "ERROR: This video is private";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes age restriction as a user failure", () => {
		// #given
		const message = "ERROR: age-restricted content";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes a copyright block as a user failure", () => {
		// #given
		const message = "ERROR: blocked on copyright grounds";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes a bot-check as transient infrastructure trouble", () => {
		// #given
		const message = "Sign in to confirm you're not a bot";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes an age-gated video as a user failure even with yt-dlp's cookies hint appended", () => {
		// #given
		const message = AGE_GATE_WITH_COOKIES_HINT;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes a private video as a user failure even with yt-dlp's cookies hint appended", () => {
		// #given
		const message = PRIVATE_VIDEO_WITH_COOKIES_HINT;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("categorizes a bot-check with the typographic apostrophe and the full cookies hint as transient", () => {
		// #given
		const message = BOT_CHECK_WITH_COOKIES_HINT;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes a reworded bot-check as transient when only the cookies hint identifies it", () => {
		// #given
		const message = REWORDED_BOT_CHECK_WITH_COOKIES_HINT;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes an HTTP 403 as transient infrastructure trouble", () => {
		// #given
		const message = "unable to download video data: HTTP Error 403: Forbidden";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes a download whose every fragment was refused as transient infrastructure trouble", () => {
		// #given
		// yt-dlp prints each refused HLS fragment's 403 to stdout and skips it, so
		// an all-refused download reaches stderr only as this line.
		const message =
			"Error code: 1\n\nStderr:\nERROR: The downloaded file is empty\n";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes a network drop as transient infrastructure trouble", () => {
		// #given
		const message = "connect ECONNRESET 1.2.3.4:443";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("categorizes an unrecognized failure as unknown so it always gets reported", () => {
		// #given
		const message = "ERROR: something bizarre happened";

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("unknown");
	});

	it("keeps every user-category failure non-retryable", () => {
		// #given
		const userFailures = [
			"ERROR: Video unavailable",
			"ERROR: This video is private",
			"ERROR: age-restricted content",
			"ERROR: blocked on copyright grounds",
		];

		// #when
		const results = userFailures.map((message) => classifyYtDlpError(message));

		// #then
		expect(results.every((result) => !result.retryable)).toBe(true);
	});

	it("keeps bot-check, 403, timeout, and network failures retryable", () => {
		// #given
		// An all-fragments-refused download is the deliberate exception: it is
		// transient but not retryable, because each retry re-requests every fragment.
		const transientFailures = [
			"Sign in to confirm you're not a bot",
			"HTTP Error 403: Forbidden",
			"Request timed out after 15000ms",
			"connect ECONNRESET 1.2.3.4:443",
		];

		// #when
		const results = transientFailures.map((message) =>
			classifyYtDlpError(message),
		);

		// #then
		expect(results.every((result) => result.retryable)).toBe(true);
	});
});
