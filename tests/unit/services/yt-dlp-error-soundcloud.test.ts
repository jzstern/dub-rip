import { describe, expect, it } from "vitest";
import { classifyYtDlpError, isRetryableYtDlpError } from "$lib/yt-dlp-errors";

describe("classifyYtDlpError() for SoundCloud", () => {
	it.each([
		[
			"ERROR: [soundcloud] x: Unable to download JSON metadata: HTTP Error 404: Not Found",
			"user",
			false,
		],
		[
			"ERROR: [soundcloud] x: This video is not available from your location due to geo restriction",
			"user",
			false,
		],
		[
			"ERROR: [soundcloud] x: HTTP Error 429: Too Many Requests",
			"transient",
			false,
		],
		["ERROR: [soundcloud] x: HTTP Error 403: Forbidden", "transient", true],
		["ERROR: [soundcloud] x: The read operation timed out", "transient", true],
	] as const)("classifies %j as %s (retryable: %s)", (message, category, retryable) => {
		// #when
		const classified = classifyYtDlpError(message, "soundcloud");

		// #then
		expect({
			category: classified.category,
			retryable: classified.retryable,
		}).toEqual({
			category,
			retryable,
		});
	});

	it("names SoundCloud, not YouTube, in its messages", () => {
		// #when
		const classified = classifyYtDlpError(
			"ERROR: HTTP Error 403: Forbidden",
			"soundcloud",
		);

		// #then
		expect(classified.message).toMatch(/SoundCloud/);
	});

	it("leaves a format error unknown so a real SoundCloud format change reaches Sentry", () => {
		// #when
		const classified = classifyYtDlpError(
			"ERROR: [soundcloud] 62986583: Requested format is not available",
			"soundcloud",
		);

		// #then
		expect(classified).toEqual({
			message: "Download failed. Please try a different track.",
			retryable: false,
			category: "unknown",
		});
	});

	it("classifies a DRM-protected track as an expected user-side failure, not the generic unknown message", () => {
		// #given
		const stderr =
			"WARNING: [soundcloud] 597146499: hls_mp3 format not found\nERROR: [soundcloud] 597146499: This video is DRM protected";

		// #when
		const classified = classifyYtDlpError(stderr, "soundcloud");

		// #then
		expect(classified).toEqual({
			message: "SoundCloud won't allow this track to be downloaded.",
			retryable: false,
			category: "user",
		});
		expect(classified.message).not.toBe(
			"Download failed. Please try a different track.",
		);
	});

	it.each([
		"ERROR: [youtube] q9lZ4p5YRkY: Sign in to confirm you’re not a bot.",
		"ERROR: HTTP Error 403: Forbidden",
		"ERROR: something new",
	])("classifies %j for YouTube exactly as before", (message) => {
		// #when
		const explicit = classifyYtDlpError(message, "youtube");
		const defaulted = classifyYtDlpError(message);

		// #then
		expect(explicit).toEqual(defaulted);
		expect(isRetryableYtDlpError(message, "youtube")).toBe(
			isRetryableYtDlpError(message),
		);
	});
});
