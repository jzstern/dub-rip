import { describe, expect, it } from "vitest";
import { formatDuration } from "$lib/format-duration";

describe("formatDuration", () => {
	it("formats durations under a minute as M:SS", () => {
		// #given
		const seconds = 42;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("0:42");
	});

	it("formats minutes and seconds as M:SS", () => {
		// #given
		const seconds = 212;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("3:32");
	});

	it("formats exactly one hour as H:MM:SS", () => {
		// #given
		const seconds = 3600;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("1:00:00");
	});

	it("formats durations over an hour as H:MM:SS", () => {
		// #given
		const seconds = 4503;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("1:15:03");
	});

	it("returns empty string for zero", () => {
		// #given
		const seconds = 0;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("");
	});

	it("pads single-digit seconds to two digits", () => {
		// #given
		const seconds = 65;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("1:05");
	});

	it("pads single-digit minutes to two digits when hours are present", () => {
		// #given
		const seconds = 3725;

		// #when
		const result = formatDuration(seconds);

		// #then
		expect(result).toBe("1:02:05");
	});
});
