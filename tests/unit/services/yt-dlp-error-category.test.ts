import { describe, expect, it } from "vitest";
import { classifyYtDlpError, parseYtDlpError } from "$lib/yt-dlp-errors";

const WATCH_PAGE_429_WARNING =
	"WARNING: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)";

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

	it("categorizes a bot-check that came with a watch-page 429 as transient infrastructure trouble", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.`;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("transient");
	});

	it("keeps the bot-check user message for a bot-check that came with a watch-page 429", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.`;

		// #when
		const result = parseYtDlpError(message);

		// #then
		expect(result).toBe(
			"Download service couldn't verify with YouTube. Please try again in a few minutes.",
		);
	});

	it("still categorizes an unavailable video as a user failure when a watch-page 429 warning sits beside it", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Video unavailable`;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("still categorizes an age-restricted video as a user failure when a watch-page 429 warning sits beside it", () => {
		// #given
		// Opens with the same "Sign in to confirm" words as the bot-check, so it
		// guards the 429 rule against matching on those alone.
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.`;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.category).toBe("user");
	});

	it("keeps a watch-page 429 beside an unavailable video non-retryable", () => {
		// #given
		const message = `${WATCH_PAGE_429_WARNING}\nERROR: [youtube] abc: Video unavailable`;

		// #when
		const result = classifyYtDlpError(message);

		// #then
		expect(result.retryable).toBe(false);
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
		const results = userFailures.map(classifyYtDlpError);

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
		const results = transientFailures.map(classifyYtDlpError);

		// #then
		expect(results.every((result) => result.retryable)).toBe(true);
	});
});
