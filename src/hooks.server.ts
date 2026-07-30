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

	const normalizeError = (err: unknown): Error =>
		err instanceof Error ? err : new Error(`Non-error thrown: ${String(err)}`);

	const handleFatal = (err: unknown): void => {
		Sentry.captureException(normalizeError(err));
		Sentry.flush(2000).then(
			() => process.exit(1),
			() => process.exit(1),
		);
	};

	/**
	 * An uncaught exception leaves the process in an unknown state — anything
	 * could be half-mutated — so exiting is the only safe response. An
	 * unhandled rejection is a narrower failure: it names one broken promise,
	 * not a broken process. This server holds several concurrent SSE download
	 * streams, and exiting here would kill every one of them for a single
	 * rejection anywhere in the process. Report it and keep running instead.
	 */
	const handleRejection = (err: unknown): void => {
		const normalized = normalizeError(err);
		console.error("Unhandled rejection:", normalized);
		Sentry.captureException(normalized, {
			level: "error",
			tags: { service: "hooks.server", operation: "unhandled-rejection" },
		});
	};

	process.on("uncaughtException", handleFatal);
	process.on("unhandledRejection", handleRejection);

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
