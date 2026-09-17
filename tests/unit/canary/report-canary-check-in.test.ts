import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CANARY_MONITOR_SLUG,
	finishCanaryCheckIn,
	startCanaryCheckIn,
} from "$lib/canary/report-canary-check-in";

describe("startCanaryCheckIn()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureCheckIn).mockClear();
	});

	it("sends an in_progress check-in for the canary monitor slug", () => {
		// #when
		startCanaryCheckIn();

		// #then
		expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
			expect.objectContaining({
				monitorSlug: CANARY_MONITOR_SLUG,
				status: "in_progress",
			}),
			expect.objectContaining({ schedule: expect.any(Object) }),
		);
	});

	it("returns the check-in id so the caller can finish the same check-in", () => {
		// #given
		vi.mocked(Sentry.captureCheckIn).mockReturnValue("abc-123");

		// #when
		const id = startCanaryCheckIn();

		// #then
		expect(id).toBe("abc-123");
	});
});

describe("finishCanaryCheckIn()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureCheckIn).mockClear();
		vi.mocked(Sentry.captureMessage).mockClear();
	});

	it("finishes the check-in as ok for a successful download", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "ok",
			itag: "18",
			durationMs: 4000,
			detail: "Downloaded successfully using itag 18",
		});

		// #then
		expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
			expect.objectContaining({
				checkInId: "abc-123",
				monitorSlug: CANARY_MONITOR_SLUG,
				status: "ok",
			}),
		);
	});

	it("finishes the check-in as ok for a skipped (queue_full) run, not a failure", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "queue_full",
			itag: null,
			durationMs: 0,
			detail: "Skipped: the yt-dlp queue was full",
		});

		// #then
		expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
			expect.objectContaining({ status: "ok" }),
		);
	});

	it("does not send a diagnostic message for a skipped run", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "queue_full",
			itag: null,
			durationMs: 0,
			detail: "Skipped: the yt-dlp queue was full",
		});

		// #then
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("finishes the check-in as error for a classified failure", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
			expect.objectContaining({ status: "error" }),
		);
	});

	it("tags the diagnostic message with the failure stage", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				tags: expect.objectContaining({ stage: "media_refused" }),
			}),
		);
	});

	it("reports an unknown failure at error level, since that is how new breakages announce themselves", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "unknown",
			itag: null,
			durationMs: 500,
			detail: "Unrecognized failure",
		});

		// #then
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ level: "error" }),
		);
	});

	it("reports a recognized infra failure stage at warning level, not error", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ level: "warning" }),
		);
	});
});
