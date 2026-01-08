import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";

Sentry.init({
	dsn: env.SENTRY_DSN,

	tracesSampleRate: 1.0,

	// Enable logs to be sent to Sentry
	enableLogs: true,

	// uncomment the line below to enable Spotlight (https://spotlightjs.com)
	// spotlight: import.meta.env.DEV,
});
