export type CanonicalEnvironment = "development" | "preview" | "production";

/**
 * The three canonical values are what Railway inference produces. An explicit
 * override may name anything Sentry accepts (e.g. "staging"), so the type stays
 * open while keeping autocomplete for the common cases.
 */
export type DeployEnvironment = CanonicalEnvironment | (string & {});

export interface SentryRuntimeContext {
	dsn?: string;
	railwayEnvironmentName?: string;
	commitSha?: string;
	environmentOverride?: string;
}

export interface SentryOptions {
	dsn: string | undefined;
	environment: DeployEnvironment;
	release: string | undefined;
	tracesSampleRate: number;
	enableLogs: boolean;
	sendDefaultPii: boolean;
}

const RELEASE_SHA_LENGTH = 12;
const PRODUCTION_TRACES_SAMPLE_RATE = 0.2;
const RAILWAY_PRODUCTION_ENVIRONMENT = "production";

/**
 * An explicit `SENTRY_ENVIRONMENT` wins, so a secrets manager (Doppler) can
 * name the environment directly without depending on the host.
 *
 * Otherwise this infers from Railway, which always sets
 * RAILWAY_ENVIRONMENT_NAME. Every non-production Railway environment is a PR
 * preview (`dub-rip-pr-<number>`), and those inherit production's variables —
 * including the DSN — so without this split their errors would be
 * indistinguishable from real production incidents. Absent both signals we're
 * not on Railway at all, which means local or CI.
 */
export function resolveDeployEnvironment(
	railwayEnvironmentName?: string,
	environmentOverride?: string,
): DeployEnvironment {
	const explicit = environmentOverride?.trim();
	if (explicit) return explicit;
	if (!railwayEnvironmentName) return "development";
	return railwayEnvironmentName === RAILWAY_PRODUCTION_ENVIRONMENT
		? "production"
		: "preview";
}

/**
 * Sentry groups issues by release and resolves minified frames against the
 * source maps uploaded for that exact release name, so this must match the
 * `release.name` the Vite plugin uploads under.
 */
export function resolveRelease(commitSha?: string): string | undefined {
	if (!commitSha) return undefined;
	return `dub-rip@${commitSha.slice(0, RELEASE_SHA_LENGTH)}`;
}

/**
 * Traces are sampled in production only. PR preview environments are the
 * dominant Railway cost in this project and their performance data is never
 * looked at, and a DSN exported on a dev machine shouldn't spend transaction
 * quota either.
 */
export function resolveTracesSampleRate(
	environment: DeployEnvironment,
): number {
	return environment === "production" ? PRODUCTION_TRACES_SAMPLE_RATE : 0;
}

/**
 * Browser noise that is never actionable: benign layout notifications and
 * errors thrown inside extensions or injected page scripts we don't control.
 */
export const IGNORED_CLIENT_ERRORS: (string | RegExp)[] = [
	"ResizeObserver loop limit exceeded",
	"ResizeObserver loop completed with undelivered notifications",
	/Non-Error promise rejection captured with value: Object Not Found Matching Id/,
];

export const DENIED_CLIENT_URLS: RegExp[] = [
	/extensions\//i,
	/^chrome:\/\//i,
	/^chrome-extension:\/\//i,
	/^moz-extension:\/\//i,
	/^safari-(web-)?extension:\/\//i,
];

export function buildSentryOptions({
	dsn,
	railwayEnvironmentName,
	commitSha,
	environmentOverride,
}: SentryRuntimeContext): SentryOptions {
	const environment = resolveDeployEnvironment(
		railwayEnvironmentName,
		environmentOverride,
	);

	return {
		dsn: dsn || undefined,
		environment,
		release: resolveRelease(commitSha),
		tracesSampleRate: resolveTracesSampleRate(environment),
		enableLogs: true,
		/**
		 * This app has no user accounts, so there is nothing to correlate an IP
		 * address, cookie, or request header against — attaching them would be
		 * pure liability (and GDPR-relevant) with no debugging benefit. Leave
		 * this false; only revisit it alongside an actual accounts feature that
		 * would give the data somewhere to point.
		 */
		sendDefaultPii: false,
	};
}
