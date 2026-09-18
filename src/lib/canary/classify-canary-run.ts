import {
	BOT_CHECK_PATTERN,
	EMPTY_FILE_PATTERN,
	HTTP_403_PATTERN,
} from "$lib/yt-dlp-errors";

/**
 * A canary run's outcome, one level more specific than
 * `YtDlpErrorCategory` — Phase 2's circuit breaker acts differently on
 * `media_refused`/`fragments_refused`/`page_rate_limited` (the egress IP is
 * blocked or throttled) than on `player_bot_check` (a bot-check with no 429,
 * i.e. a client-list problem) or `format_unavailable` (a format-selector
 * problem), so those have to stay distinguishable here.
 */
export type CanaryStage =
	| "ok"
	| "page_rate_limited"
	| "player_bot_check"
	| "media_refused"
	| "fragments_refused"
	| "format_unavailable"
	| "queue_full"
	| "unknown";

export interface CanaryClassification {
	stage: CanaryStage;
	itag: string | null;
	durationMs: number;
	detail: string;
}

export interface ClassifyCanaryRunInput {
	succeeded: boolean;
	stdout: string;
	stderr: string;
	durationMs: number;
}

const DOWNLOADING_FORMAT_PATTERN = /Downloading \d+ format\(s\): (\S+)/;
const DESTINATION_PATTERN = /Destination:/;
const TOTAL_FRAGMENTS_PATTERN = /Total fragments:/;
const FRAGMENT_RETRY_PATTERN = /Retrying fragment|Skipping fragment/;
const FORMAT_UNAVAILABLE_PATTERN =
	/YouTube is forcing SABR streaming for this client|Requested format is not available/i;

// yt-dlp never retries a watch-page 429 and has no visitor data afterwards, so
// the run's ERROR line is always the downstream bot-check, which names no cause.
// Kept local: yt-dlp-errors.ts matches user-facing messages, not this stage.
const WATCH_PAGE_429_PATTERN = /unable to download webpage: http error 429/;

const DETAIL_EXCERPT_LENGTH = 500;

function excerptStderr(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, DETAIL_EXCERPT_LENGTH);
}

export function classifyCanaryRun({
	succeeded,
	stdout,
	stderr,
	durationMs,
}: ClassifyCanaryRunInput): CanaryClassification {
	const itag = DOWNLOADING_FORMAT_PATTERN.exec(stdout)?.[1] ?? null;

	if (succeeded) {
		return {
			stage: "ok",
			itag,
			durationMs,
			detail: itag
				? `Downloaded successfully using itag ${itag}`
				: "Downloaded successfully",
		};
	}

	const combined = `${stdout}\n${stderr}`;
	if (FORMAT_UNAVAILABLE_PATTERN.test(combined)) {
		return {
			stage: "format_unavailable",
			itag,
			durationMs,
			detail: "YouTube reported no downloadable format for this client",
		};
	}

	const hasFormatLine = itag !== null;
	const hasDestination = DESTINATION_PATTERN.test(stdout);
	const hasTotalFragments = TOTAL_FRAGMENTS_PATTERN.test(stdout);
	const hasFragmentRetries = FRAGMENT_RETRY_PATTERN.test(stdout);
	// BOT_CHECK_PATTERN/HTTP_403_PATTERN/EMPTY_FILE_PATTERN come from
	// yt-dlp-errors.ts, which matches them against a lowercased message.
	const lowerStderr = stderr.toLowerCase();

	if (!hasFormatLine && WATCH_PAGE_429_PATTERN.test(lowerStderr)) {
		return {
			stage: "page_rate_limited",
			itag,
			durationMs,
			detail: `YouTube rate-limited the watch page with HTTP 429 before any format was chosen: ${excerptStderr(stderr)}`,
		};
	}

	if (!hasFormatLine && BOT_CHECK_PATTERN.test(lowerStderr)) {
		return {
			stage: "player_bot_check",
			itag,
			durationMs,
			detail: `YouTube refused the player request before any format was chosen: ${excerptStderr(stderr)}`,
		};
	}

	if (
		hasFormatLine &&
		hasTotalFragments &&
		hasDestination &&
		hasFragmentRetries &&
		EMPTY_FILE_PATTERN.test(lowerStderr)
	) {
		return {
			stage: "fragments_refused",
			itag,
			durationMs,
			detail: `Every fragment of itag ${itag ?? "unknown"} was refused`,
		};
	}

	if (hasFormatLine && !hasDestination && HTTP_403_PATTERN.test(lowerStderr)) {
		return {
			stage: "media_refused",
			itag,
			durationMs,
			detail: `The media fetch for itag ${itag ?? "unknown"} was refused`,
		};
	}

	return {
		stage: "unknown",
		itag,
		durationMs,
		detail: stderr.slice(0, DETAIL_EXCERPT_LENGTH) || "Unrecognized failure",
	};
}

export function buildQueueFullClassification(
	durationMs: number,
): CanaryClassification {
	return {
		stage: "queue_full",
		itag: null,
		durationMs,
		detail: "Skipped: the yt-dlp queue was full",
	};
}

const NON_FAILURE_STAGES: readonly CanaryStage[] = ["ok", "queue_full"];

/**
 * `queue_full` sits alongside `ok` because the canary never ran — it queued
 * behind real users and gave up, which says nothing about production's health.
 * The one definition of that set, shared by the Sentry check-in status and the
 * endpoint's response, so the two can't drift when a stage is added.
 */
export function isCanaryFailure(stage: CanaryStage): boolean {
	return !NON_FAILURE_STAGES.includes(stage);
}
