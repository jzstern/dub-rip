/**
 * How a failure should be treated by error reporting:
 * - `user`: the video can never be downloaded (private, age-restricted, …).
 *   Normal operation, not a defect — never worth a Sentry issue.
 * - `transient`: infrastructure trouble (bot-check, 403, timeouts). Worth a
 *   warning once retries are exhausted (or at once, when retrying would only
 *   re-hit a throttled IP), since a spike means the deployment is degraded.
 * - `unknown`: nothing matched, so we don't know what broke and the user got
 *   a generic message. Always worth an issue — these are how new yt-dlp and
 *   YouTube breakages surface.
 */
export type YtDlpErrorCategory = "user" | "transient" | "unknown";

export interface ClassifiedYtDlpError {
	message: string;
	retryable: boolean;
	category: YtDlpErrorCategory;
}

interface ErrorRule {
	pattern: RegExp;
	/** When set, the rule matches only if this also matches the same message. */
	alsoRequires?: RegExp;
	message: string;
	retryable: boolean;
	category: YtDlpErrorCategory;
}

const BOT_CHECK_MESSAGE =
	"Download service couldn't verify with YouTube. Please try again in a few minutes.";

/**
 * yt-dlp writes the message with a typographic apostrophe (U+2019), so an
 * ASCII-only `you're` never matches it. Exported so the production canary's
 * stage classifier (`$lib/canary/classify-canary-run`) can recognize the same
 * signature without re-deriving the regex.
 */
export const BOT_CHECK_PATTERN = /sign in to confirm you['’]re not a bot/;

/**
 * yt-dlp's WARNING for a watch page YouTube answered with 429. yt-dlp never
 * retries that fetch itself, and the bot-check ERROR it goes on to raise names
 * no cause, so this line is the only evidence that the egress IP is throttled.
 * Matched against a lowercased message. Both call sites already hand the
 * classifier all of stderr (yt-dlp-wrap's rejection embeds it, and so does
 * execFile's), so the warning arrives alongside the ERROR without any help.
 */
export const WATCH_PAGE_429_PATTERN =
	/unable to download webpage: http error 429/;

/** Exported for reuse by the canary's stage classifier. */
export const HTTP_403_PATTERN = /http error 403|403 forbidden|status code 403/;

/** Exported for reuse by the canary's stage classifier. */
export const EMPTY_FILE_PATTERN = /the downloaded file is empty/;

const ERROR_RULES: ErrorRule[] = [
	{
		// Not retryable, for the same reason as EMPTY_FILE_PATTERN below: every
		// attempt re-runs a whole extraction (~5 YouTube requests) against an IP
		// YouTube is already answering with 429, and one click once cost four
		// failed runs in under five seconds. A bot-check without the 429 may be a
		// transient client problem, so it stays retryable in the rule below.
		// Deliberately BOT_CHECK_PATTERN alone, not the `cookies` hint the next rule
		// also accepts: yt-dlp appends that hint to age-restriction errors too, and
		// a 429 warning next to a genuine user-category failure must not demote it.
		pattern: BOT_CHECK_PATTERN,
		alsoRequires: WATCH_PAGE_429_PATTERN,
		message: BOT_CHECK_MESSAGE,
		retryable: false,
		category: "transient",
	},
	{
		// `cookies` matches yt-dlp's remediation hint, not the error itself. Until
		// BOT_CHECK_PATTERN learned the typographic apostrophe, that hint was the
		// only thing that ever fired this rule — so were it reworded, a bot-check
		// would fall through to the generic rule and become non-retryable and
		// `unknown`-category. Keep both alternatives.
		pattern: new RegExp(`${BOT_CHECK_PATTERN.source}|cookies`),
		message: BOT_CHECK_MESSAGE,
		retryable: true,
		category: "transient",
	},
	{
		pattern: /video unavailable/,
		message: "This video is unavailable or private.",
		retryable: false,
		category: "user",
	},
	{
		pattern: /age-restricted|confirm your age|verify your age/,
		message: "This video is age-restricted and cannot be downloaded.",
		retryable: false,
		category: "user",
	},
	{
		pattern: /copyright/,
		message: "This video is blocked due to copyright restrictions.",
		retryable: false,
		category: "user",
	},
	{
		pattern: /private/,
		message: "This video is private and cannot be downloaded.",
		retryable: false,
		category: "user",
	},
	{
		pattern: HTTP_403_PATTERN,
		message: BOT_CHECK_MESSAGE,
		retryable: true,
		category: "transient",
	},
	{
		// yt-dlp's catch-all for a fragmented download in which every fragment
		// failed. In production that was YouTube refusing all of them: each 403
		// goes to stdout and the fragment is skipped, so stderr carries only this.
		// Not retryable, unlike the single-request 403 above: every attempt
		// re-requests every fragment, multiplying refused traffic against an egress
		// IP that is likely already flagged, and retries never recovered it.
		pattern: EMPTY_FILE_PATTERN,
		message: BOT_CHECK_MESSAGE,
		retryable: false,
		category: "transient",
	},
	{
		pattern: /timed? ?out|etimedout/,
		message: "The request to YouTube timed out. Please try again.",
		retryable: true,
		category: "transient",
	},
	{
		pattern:
			/econnreset|econnrefused|enotfound|network error|socket hang up|fetch failed/,
		message:
			"A network error occurred while contacting YouTube. Please try again.",
		retryable: true,
		category: "transient",
	},
];

const GENERIC_ERROR: ClassifiedYtDlpError = {
	message: "Download failed. Please try a different video.",
	retryable: false,
	category: "unknown",
};

/**
 * Single source of truth for both user-facing messaging (`parseYtDlpError`)
 * and retry eligibility (`isRetryableYtDlpError`). Only failures that are
 * plausibly transient (bot-check, 403, timeouts, network errors) are
 * retryable — permanent failures (private, age-restricted, copyright,
 * unavailable) are not, so retrying never wastes an attempt on a video that
 * can never succeed. Transient failures that a retry would only repeat
 * against a throttled IP (a bot-check with a watch-page 429, an all-refused
 * fragment download) are the exceptions.
 */
export function classifyYtDlpError(errorMessage: string): ClassifiedYtDlpError {
	const lowerMessage = errorMessage.toLowerCase();
	for (const rule of ERROR_RULES) {
		if (
			rule.pattern.test(lowerMessage) &&
			(!rule.alsoRequires || rule.alsoRequires.test(lowerMessage))
		) {
			return {
				message: rule.message,
				retryable: rule.retryable,
				category: rule.category,
			};
		}
	}
	return GENERIC_ERROR;
}

/**
 * Pure on purpose: retry logic calls the classifier once per attempt, and the
 * download route already reports the failure once from its terminal catch.
 * Reporting from here too produced two Sentry issues per failed download.
 */
export function parseYtDlpError(errorMessage: string): string {
	return classifyYtDlpError(errorMessage).message;
}

export function isRetryableYtDlpError(errorMessage: string): boolean {
	return classifyYtDlpError(errorMessage).retryable;
}
