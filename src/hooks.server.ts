import * as Sentry from "@sentry/sveltekit";
import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";
import { env } from "$env/dynamic/private";

Sentry.init({
	dsn: env.SENTRY_DSN,

	tracesSampleRate: 1.0,

	// Enable logs to be sent to Sentry
	enableLogs: true,

	// Enable sending user PII (Personally Identifiable Information)
	// https://docs.sentry.io/platforms/javascript/guides/sveltekit/configuration/options/#sendDefaultPii
	sendDefaultPii: true,
});

const PROCESS_HANDLER_TAG = Symbol.for("dub-rip.process-error-handlers");

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
		Sentry.captureException(warning, {
			level: "warning",
			tags: { service: "hooks.server", operation: "process-warning" },
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
