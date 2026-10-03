import { describe, expect, it } from "vitest";
import { classifyYtDlpError } from "$lib/yt-dlp-errors";

describe("classifyYtDlpError() for Bandcamp", () => {
	it.each([
		[
			"ERROR: [Bandcamp] lanius-battle: Unable to download webpage: HTTP Error 404: Not Found",
			"user",
			false,
		],
		[
			"ERROR: [Bandcamp] lanius-battle: Unable to download webpage: HTTP Error 410: Gone",
			"user",
			false,
		],
		[
			"ERROR: [Bandcamp] lanius-battle: HTTP Error 429: Too Many Requests",
			"transient",
			false,
		],
		["ERROR: [Bandcamp] x: HTTP Error 403: Forbidden", "transient", true],
		["ERROR: The downloaded file is empty", "transient", false],
		["ERROR: [Bandcamp] x: The read operation timed out", "transient", true],
		[
			"ERROR: [Bandcamp] x: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known> (ENOTFOUND)",
			"transient",
			true,
		],
		["ERROR: [Bandcamp] x: Connection reset (ECONNRESET)", "transient", true],
	] as const)("classifies %j as %s (retryable: %s)", (message, category, retryable) => {
		// #when
		const classified = classifyYtDlpError(message, "bandcamp");

		// #then
		expect({
			category: classified.category,
			retryable: classified.retryable,
		}).toEqual({ category, retryable });
	});

	it("tells the user a 404 track was removed from Bandcamp", () => {
		// #when
		const classified = classifyYtDlpError(
			"ERROR: [Bandcamp] x: HTTP Error 404: Not Found",
			"bandcamp",
		);

		// #then
		expect(classified.message).toBe("This track was removed from Bandcamp.");
	});

	it.each([
		"ERROR: HTTP Error 403: Forbidden",
		"ERROR: HTTP Error 429: Too Many Requests",
		"ERROR: The read operation timed out",
		"ERROR: socket hang up",
	])("names Bandcamp, not YouTube, for %j", (message) => {
		// #when
		const classified = classifyYtDlpError(message, "bandcamp");

		// #then
		expect(classified.message).toMatch(/Bandcamp/);
	});

	it("leaves a format error unknown so a real Bandcamp change reaches Sentry", () => {
		// #when
		const classified = classifyYtDlpError(
			"ERROR: [Bandcamp] lanius-battle: Requested format is not available",
			"bandcamp",
		);

		// #then
		expect(classified).toEqual({
			message: "Download failed. Please try a different track.",
			retryable: false,
			category: "unknown",
		});
	});

	it.each([
		"ERROR: [youtube] q9lZ4p5YRkY: Sign in to confirm you’re not a bot.",
		"ERROR: [youtube] x: Private video. Sign in if you've been granted access",
		"ERROR: [youtube] x: This video is age-restricted",
	])("applies none of YouTube's rules to %j", (message) => {
		// #when
		const classified = classifyYtDlpError(message, "bandcamp");

		// #then
		expect(classified.category).toBe("unknown");
	});
});
