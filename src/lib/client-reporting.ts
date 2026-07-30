import * as Sentry from "@sentry/sveltekit";

export type ClientOperation =
	| "preview-fetch"
	| "preview-details-fetch"
	| "download-stream-transport"
	| "download-stream-parse"
	| "download-save-file";

interface ReportOptions {
	operation: ClientOperation;
	extra?: Record<string, unknown>;
}

/**
 * Reports a browser-side failure that no server-side handler can see.
 *
 * Every failure path in this app is caught and turned into a friendly
 * message, so `handleErrorWithSentry` — which only fires on errors SvelteKit
 * itself throws during render or navigation — never observes them. Failures
 * the server already reported (an error event it sent us over SSE, a 4xx/5xx
 * it logged on its way out) must use `recordClientBreadcrumb` instead, so a
 * single incident doesn't become two issues.
 */
export function reportClientIssue(
	error: unknown,
	{ operation, extra }: ReportOptions,
): void {
	const normalized =
		error instanceof Error
			? error
			: new Error(`Non-error thrown on client: ${String(error)}`);

	Sentry.captureException(normalized, {
		tags: { service: "client", operation },
		extra,
	});
}

export function recordClientBreadcrumb(
	message: string,
	data?: Record<string, unknown>,
): void {
	Sentry.addBreadcrumb({
		category: "dub-rip",
		level: "info",
		message,
		data,
	});
}
