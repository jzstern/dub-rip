/**
 * How a failure should be treated by error reporting:
 * - `user`: the video can never be downloaded (private, age-restricted, …).
 *   Normal operation, not a defect — never worth a Sentry issue.
 * - `transient`: infrastructure trouble (bot-check, 403, timeouts). Worth a
 *   warning once retries are exhausted, since a spike means the deployment
 *   is degraded.
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
	message: string;
	retryable: boolean;
	category: YtDlpErrorCategory;
}

const BOT_CHECK_MESSAGE =
	"Download service couldn't verify with YouTube. Please try again in a few minutes.";

const ERROR_RULES: ErrorRule[] = [
	{
		pattern: /sign in to confirm you're not a bot|cookies/,
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
		pattern: /http error 403|403 forbidden|status code 403/,
		message: BOT_CHECK_MESSAGE,
		retryable: true,
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
 * can never succeed.
 */
export function classifyYtDlpError(errorMessage: string): ClassifiedYtDlpError {
	const lowerMessage = errorMessage.toLowerCase();
	for (const rule of ERROR_RULES) {
		if (rule.pattern.test(lowerMessage)) {
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
