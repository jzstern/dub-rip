import { resolveDeployEnvironment } from "./sentry-options";

export function isDebugModeAllowed(
	env: Record<string, string | undefined>,
): boolean {
	return (
		resolveDeployEnvironment(
			env.RAILWAY_ENVIRONMENT_NAME,
			env.SENTRY_ENVIRONMENT,
		) !== "production"
	);
}
