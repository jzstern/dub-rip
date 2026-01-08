import * as Sentry from "@sentry/sveltekit";

Sentry.init({
	dsn: "https://3f1867afa7618d7a2665e18f293fba22@o4510677108064256.ingest.us.sentry.io/4510677112913920",

	tracesSampleRate: 1.0,

	// Enable logs to be sent to Sentry
	enableLogs: true,

	// uncomment the line below to enable Spotlight (https://spotlightjs.com)
	// spotlight: import.meta.env.DEV,
});
