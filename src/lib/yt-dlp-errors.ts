import * as Sentry from "@sentry/sveltekit";

export interface ClassifiedYtDlpError {
	message: string;
	retryable: boolean;
}

interface ErrorRule {
	pattern: RegExp;
	message: string;
	retryable: boolean;
}

const BOT_CHECK_MESSAGE =
	"Download service couldn't verify with YouTube. Please try again in a few minutes.";

const ERROR_RULES: ErrorRule[] = [
	{
		pattern: /sign in to confirm you're not a bot|cookies/,
		message: BOT_CHECK_MESSAGE,
		retryable: true,
	},
	{
		pattern: /video unavailable/,
		message: "This video is unavailable or private.",
		retryable: false,
	},
	{
		pattern: /age-restricted|confirm your age|verify your age/,
		message: "This video is age-restricted and cannot be downloaded.",
		retryable: false,
	},
	{
		pattern: /copyright/,
		message: "This video is blocked due to copyright restrictions.",
		retryable: false,
	},
	{
		pattern: /private/,
		message: "This video is private and cannot be downloaded.",
		retryable: false,
	},
	{
		pattern: /http error 403|403 forbidden|status code 403/,
		message: BOT_CHECK_MESSAGE,
		retryable: true,
	},
	{
		pattern: /timed? ?out|etimedout/,
		message: "The request to YouTube timed out. Please try again.",
		retryable: true,
	},
	{
		pattern:
			/econnreset|econnrefused|enotfound|network error|socket hang up|fetch failed/,
		message:
			"A network error occurred while contacting YouTube. Please try again.",
		retryable: true,
	},
];

const GENERIC_ERROR: ClassifiedYtDlpError = {
	message: "Download failed. Please try a different video.",
	retryable: false,
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
			return { message: rule.message, retryable: rule.retryable };
		}
	}
	return GENERIC_ERROR;
}

/**
 * Unmatched errors are reported to Sentry only here — the terminal,
 * user-facing path — not in `classifyYtDlpError`, which retry logic calls
 * once per attempt and would otherwise report the same failure several
 * times per download.
 */
export function parseYtDlpError(errorMessage: string): string {
	const classified = classifyYtDlpError(errorMessage);
	if (classified !== GENERIC_ERROR) {
		return classified.message;
	}
	Sentry.captureMessage(
		`Unmatched yt-dlp error: ${errorMessage.slice(0, 500)}`,
		{
			level: "warning",
			tags: { service: "yt-dlp-errors", operation: "unmatched-fallthrough" },
		},
	);
	return classified.message;
}

export function isRetryableYtDlpError(errorMessage: string): boolean {
	return classifyYtDlpError(errorMessage).retryable;
}
