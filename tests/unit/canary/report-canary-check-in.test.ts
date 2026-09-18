import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CANARY_MONITOR_CONFIG,
	CANARY_MONITOR_SLUG,
	finishCanaryCheckIn,
	startCanaryCheckIn,
} from "$lib/canary/report-canary-check-in";

describe("CANARY_MONITOR_CONFIG", () => {
	it("waits longer than the worst GitHub cron delay seen in production before calling a check-in missed", () => {
		// #given the 06:00 UTC slot of 2026-09-18 did not run until 10:52 UTC
		const worstObservedDelayMinutes = 4 * 60 + 52;

		// #then
		expect(CANARY_MONITOR_CONFIG.checkinMargin).toBeGreaterThan(
			worstObservedDelayMinutes,
		);
	});

	it("still flags a canary that has stopped running within a day", () => {
		// #given
		const oneDayMinutes = 24 * 60;

		// #then
		expect(CANARY_MONITOR_CONFIG.checkinMargin).toBeLessThanOrEqual(
			oneDayMinutes,
		);
	});
});

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
		vi.mocked(Sentry.logger.warn).mockClear();
		vi.mocked(Sentry.logger.error).mockClear();
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

	it("does not log a diagnostic for a skipped run", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "queue_full",
			itag: null,
			durationMs: 0,
			detail: "Skipped: the yt-dlp queue was full",
		});

		// #then
		expect(Sentry.logger.warn).not.toHaveBeenCalled();
		expect(Sentry.logger.error).not.toHaveBeenCalled();
	});

	it("never captures a Sentry message or exception for a failure, since that would create a separate issue on the very first failure", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then — only a Sentry Log entry, never an event; failureIssueThreshold
		// on the check-in itself is the only thing allowed to open an issue
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

	it("logs the diagnostic with the failure stage as a structured attribute", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.logger.warn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ stage: "media_refused" }),
		);
	});

	it("logs an unknown failure at the error log level, since that is how new breakages announce themselves", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "unknown",
			itag: null,
			durationMs: 500,
			detail: "Unrecognized failure",
		});

		// #then
		expect(Sentry.logger.error).toHaveBeenCalled();
	});

	it("logs a recognized infra failure stage at the warn log level, not error", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.logger.warn).toHaveBeenCalled();
		expect(Sentry.logger.error).not.toHaveBeenCalled();
	});

	it("logs a page_rate_limited failure at the warn log level, not error", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "page_rate_limited",
			itag: null,
			durationMs: 1500,
			detail: "YouTube rate-limited the watch page with HTTP 429",
		});

		// #then
		expect(Sentry.logger.warn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ stage: "page_rate_limited" }),
		);
		expect(Sentry.logger.error).not.toHaveBeenCalled();
	});

	it("includes the itag and detail in the logged attributes for a triage-ready log entry", () => {
		// #when
		finishCanaryCheckIn("abc-123", {
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #then
		expect(Sentry.logger.warn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				itag: "251",
				detail: "The media fetch for itag 251 was refused",
				durationMs: 2500,
			}),
		);
	});
});
