import * as Sentry from "@sentry/sveltekit";
import {
	type CanaryClassification,
	isCanaryFailure,
} from "./classify-canary-run";

export const CANARY_MONITOR_SLUG = "production-canary";

/**
 * Sentry-side config for the cron monitor, upserted from code on every
 * check-in (`captureCheckIn`'s second argument) rather than hand-configured
 * in the dashboard.
 *
 * `checkinMargin` is sized against GitHub, not Sentry: scheduled workflows at
 * the top of the hour queue behind everyone else's, and the first three runs
 * (2026-09-18) started 3h57m, 4h52m and 4h06m after their 00:00/06:00/12:00
 * UTC slots. At the original 30 minutes each of those slots was reported
 * missed, and since a missed check-in counts toward `failureIssueThreshold`,
 * one real failure plus one late run opened an issue. 480 minutes clears the
 * worst delay seen by ~3 hours while a canary that has stopped running is
 * still flagged the same day. That is wider than Sentry's own advice that the
 * margin not exceed the schedule interval (6h here) — deliberately, since the
 * delay being absorbed is itself about that long.
 *
 * `@sentry/sveltekit` re-exports `captureCheckIn` but, unlike most of its
 * API, not the `MonitorConfig` type it takes (checked against
 * `@sentry/node`'s and `@sentry/sveltekit`'s own `.d.ts` re-export lists) —
 * so this is left untyped and checked structurally at the call site instead
 * of importing the type from the transitive `@sentry/core` dependency.
 */
export const CANARY_MONITOR_CONFIG = {
	schedule: { type: "crontab", value: "0 */6 * * *" },
	checkinMargin: 480,
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
 * can tell Sentry Crons *that* a run failed but not *how*. `captureMessage`
 * looked like the fix but isn't: it creates its own Issue immediately, on the
 * very first failure, regardless of `failureIssueThreshold` — so the very
 * signal meant to carry the stage would have opened an issue a full cycle
 * before the monitor's own 2-consecutive-failure threshold ever did,
 * reintroducing the "two issues for one incident" problem `reportDownloadFailure`
 * exists to avoid for real downloads. `Sentry.logger` is a separate telemetry
 * stream — searchable, carries the same stage/itag/detail context, but never
 * creates or contributes to an Issue — so the check-in's `failureIssueThreshold`
 * stays the only thing that decides when this becomes an alert. A skip (see
 * `isCanaryFailure`) finishes the check-in `"ok"` and logs nothing, the same
 * way a full queue never becomes a Sentry issue for a real download.
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

	const attributes = {
		service: "canary",
		stage: classification.stage,
		itag: classification.itag,
		detail: classification.detail,
		durationMs: classification.durationMs,
	};
	const message = `Production canary failed: ${classification.stage}`;

	// `unknown` is how new yt-dlp/YouTube breakages announce themselves — same
	// reasoning as classifyYtDlpError's category levels.
	if (classification.stage === "unknown") {
		Sentry.logger.error(message, attributes);
	} else {
		Sentry.logger.warn(message, attributes);
	}
}
