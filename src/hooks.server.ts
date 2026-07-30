import * as Sentry from "@sentry/sveltekit";
import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";
import { env } from "$env/dynamic/private";
import { buildSentryOptions } from "$lib/sentry-options";

Sentry.init(
	buildSentryOptions({
		dsn: env.SENTRY_DSN,
		railwayEnvironmentName: env.RAILWAY_ENVIRONMENT_NAME,
		commitSha: env.RAILWAY_GIT_COMMIT_SHA,
		environmentOverride: env.SENTRY_ENVIRONMENT,
	}),
);

const PROCESS_HANDLER_TAG = Symbol.for("dub-rip.process-error-handlers");

/**
 * Node emits `warning` for routine things — deprecations fire on nearly every
 * boot — so reporting all of them turns Sentry into a changelog and burns
 * quota. Only warnings that signal a real defect are worth an issue; the rest
 * ride along as breadcrumbs on whatever error actually happens.
 */
const REPORTED_WARNING_NAMES = new Set([
	"MaxListenersExceededWarning",
	"UnhandledPromiseRejectionWarning",
]);

interface TaggedGlobal {
	[PROCESS_HANDLER_TAG]?: true;
}

export function registerProcessErrorHandlers(): void {
	const tagged = globalThis as TaggedGlobal;
	if (tagged[PROCESS_HANDLER_TAG]) return;
	tagged[PROCESS_HANDLER_TAG] = true;

	const handle = (err: unknown): void => {
		const normalized =
			err instanceof Error
				? err
				: new Error(`Non-error thrown: ${String(err)}`);
		Sentry.captureException(normalized);
		Sentry.flush(2000).then(
			() => process.exit(1),
			() => process.exit(1),
		);
	};

	process.on("uncaughtException", handle);
	process.on("unhandledRejection", handle);

	process.on("warning", (warning) => {
		if (REPORTED_WARNING_NAMES.has(warning.name)) {
			Sentry.captureException(warning, {
				level: "warning",
				tags: { service: "hooks.server", operation: "process-warning" },
			});
			return;
		}
		Sentry.addBreadcrumb({
			category: "process.warning",
			level: "warning",
			message: `${warning.name}: ${warning.message}`,
		});
	});
}

registerProcessErrorHandlers();

import("$lib/yt-dlp-binary")
	.then(({ ensureYtDlpBinary, ensureBgutilPlugin }) => {
		ensureYtDlpBinary().catch((err) =>
			Sentry.captureException(err, {
				tags: { service: "hooks.server", operation: "prewarm-ytdlp" },
			}),
		);
		ensureBgutilPlugin().catch((err) =>
			Sentry.captureException(err, {
				tags: { service: "hooks.server", operation: "prewarm-bgutil" },
			}),
		);
	})
	.catch((err) => {
		console.error("Failed to import yt-dlp-binary for prewarm:", err);
	});

// If you have custom handlers, make sure to place them after `sentryHandle()` in the `sequence` function.
export const handle = sequence(sentryHandle());

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
