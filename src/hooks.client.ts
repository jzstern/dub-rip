import * as Sentry from "@sentry/sveltekit";
import { handleErrorWithSentry } from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";
import {
	buildSentryOptions,
	DENIED_CLIENT_URLS,
	IGNORED_CLIENT_ERRORS,
} from "$lib/sentry-options";

/**
 * `PUBLIC_SENTRY_ENVIRONMENT` is read at runtime, so a secrets-manager change
 * takes effect on the next boot without a rebuild. The Railway fallbacks are
 * build-time constants Vite inlines (see `vite.config.ts`), because the browser
 * cannot read Railway's runtime environment itself.
 */
Sentry.init({
	...buildSentryOptions({
		dsn: env.PUBLIC_SENTRY_DSN,
		railwayEnvironmentName: __RAILWAY_ENVIRONMENT_NAME__,
		commitSha: __RAILWAY_COMMIT_SHA__,
		environmentOverride: env.PUBLIC_SENTRY_ENVIRONMENT,
	}),
	ignoreErrors: IGNORED_CLIENT_ERRORS,
	denyUrls: DENIED_CLIENT_URLS,
});

export const handleError = handleErrorWithSentry();
