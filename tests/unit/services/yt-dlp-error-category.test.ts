import { describe, expect, it } from "vitest";
import { classifyYtDlpError } from "$lib/yt-dlp-errors";

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

	it("categorizes an HTTP 403 as transient infrastructure trouble", () => {
		// #given
		const message = "unable to download video data: HTTP Error 403: Forbidden";

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

	it("keeps every transient-category failure retryable", () => {
		// #given
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
