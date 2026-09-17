import * as Sentry from "@sentry/sveltekit";
import {
	type CanaryClassification,
	isCanaryFailure,
} from "./classify-canary-run";

export const CANARY_MONITOR_SLUG = "production-canary";

/**
 * Sentry-side config for the cron monitor, upserted from code on every
 * check-in (`captureCheckIn`'s second argument) rather than hand-configured
 * in the dashboard. GitHub Actions schedules are approximate, so the margin
 * is generous — a false "missed" alert from GH's own scheduling jitter would
 * train the on-call to ignore this monitor.
 *
 * `@sentry/sveltekit` re-exports `captureCheckIn` but, unlike most of its
 * API, not the `MonitorConfig` type it takes (checked against
 * `@sentry/node`'s and `@sentry/sveltekit`'s own `.d.ts` re-export lists) —
 * so this is left untyped and checked structurally at the call site instead
 * of importing the type from the transitive `@sentry/core` dependency.
 */
export const CANARY_MONITOR_CONFIG = {
	schedule: { type: "crontab", value: "0 */6 * * *" },
	checkinMargin: 30,
	maxRuntime: 10,
	timezone: "UTC",
	failureIssueThreshold: 2,
	recoveryThreshold: 2,
} as const;

export function startCanaryCheckIn(): string {
	return Sentry.captureCheckIn(
		{ monitorSlug: CANARY_MONITOR_SLUG, status: "in_progress" },
		CANARY_MONITOR_CONFIG,
	);
}

/**
 * Sentry's check-in payload carries no room for custom tags (it's a fixed
 * `{monitor_slug, status, duration, monitor_config}` shape — verified against
 * `@sentry/core`'s `captureCheckIn` implementation), so the check-in alone
 * can tell Sentry Crons *that* a run failed but not *how*. A single
 * `captureMessage` alongside it — the same "classify, tag, report once"
 * shape `reportDownloadFailure` already uses for real downloads — carries the
 * stage. A skip (see `isCanaryFailure`) finishes the check-in `"ok"` and sends
 * no message, the same way a full queue never becomes a Sentry issue for a
 * real download.
 */
export function finishCanaryCheckIn(
	checkInId: string,
	classification: CanaryClassification,
): void {
	const failed = isCanaryFailure(classification.stage);

	Sentry.captureCheckIn({
		checkInId,
		monitorSlug: CANARY_MONITOR_SLUG,
		status: failed ? "error" : "ok",
		duration: classification.durationMs / 1000,
	});

	if (!failed) return;

	Sentry.captureMessage(`Production canary failed: ${classification.stage}`, {
		// `unknown` is how new yt-dlp/YouTube breakages announce themselves —
		// same reasoning as classifyYtDlpError's category levels.
		level: classification.stage === "unknown" ? "error" : "warning",
		tags: { service: "canary", stage: classification.stage },
		extra: {
			itag: classification.itag,
			detail: classification.detail,
			durationMs: classification.durationMs,
		},
	});
}
