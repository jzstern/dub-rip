import { describe, expect, it } from "vitest";
import {
	buildSentryOptions,
	resolveDeployEnvironment,
	resolveRelease,
	resolveTracesSampleRate,
} from "$lib/sentry-options";

describe("resolveDeployEnvironment()", () => {
	it("reports Railway's production environment as production", () => {
		// #given
		const railwayEnvironmentName = "production";

		// #when
		const result = resolveDeployEnvironment(railwayEnvironmentName);

		// #then
		expect(result).toBe("production");
	});

	it("reports a PR environment as preview so it never mixes with production", () => {
		// #given
		const railwayEnvironmentName = "dub-rip-pr-42";

		// #when
		const result = resolveDeployEnvironment(railwayEnvironmentName);

		// #then
		expect(result).toBe("preview");
	});

	it("treats a missing Railway environment as development", () => {
		// #when
		const result = resolveDeployEnvironment(undefined);

		// #then
		expect(result).toBe("development");
	});

	it("treats an empty Railway environment as development", () => {
		// #given — Vite's `define` inlines "" when the variable is unset
		const railwayEnvironmentName = "";

		// #when
		const result = resolveDeployEnvironment(railwayEnvironmentName);

		// #then
		expect(result).toBe("development");
	});

	it("lets an explicit override win over Railway inference", () => {
		// #given — a secrets manager naming the environment directly
		const railwayEnvironmentName = "production";
		const override = "staging";

		// #when
		const result = resolveDeployEnvironment(railwayEnvironmentName, override);

		// #then
		expect(result).toBe("staging");
	});

	it("names a local machine via the override when Railway is absent", () => {
		// #when
		const result = resolveDeployEnvironment(undefined, "local");

		// #then
		expect(result).toBe("local");
	});

	it("falls back to Railway inference when the override is blank", () => {
		// #given — an unset Doppler value arrives as an empty string
		const railwayEnvironmentName = "dub-rip-pr-42";

		// #when
		const result = resolveDeployEnvironment(railwayEnvironmentName, "   ");

		// #then
		expect(result).toBe("preview");
	});
});

describe("resolveRelease()", () => {
	it("shortens a commit SHA to a stable release name", () => {
		// #given
		const commitSha = "0123456789abcdef0123456789abcdef01234567";

		// #when
		const result = resolveRelease(commitSha);

		// #then
		expect(result).toBe("dub-rip@0123456789ab");
	});

	it("returns undefined when no commit SHA is available", () => {
		// #when
		const result = resolveRelease(undefined);

		// #then
		expect(result).toBeUndefined();
	});

	it("returns undefined for an empty commit SHA", () => {
		// #when
		const result = resolveRelease("");

		// #then
		expect(result).toBeUndefined();
	});
});

describe("resolveTracesSampleRate()", () => {
	it("samples traces in production", () => {
		// #when
		const result = resolveTracesSampleRate("production");

		// #then
		expect(result).toBeGreaterThan(0);
	});

	it("disables tracing in preview environments to protect the Railway budget", () => {
		// #when
		const result = resolveTracesSampleRate("preview");

		// #then
		expect(result).toBe(0);
	});

	it("disables tracing in development", () => {
		// #when
		const result = resolveTracesSampleRate("development");

		// #then
		expect(result).toBe(0);
	});
});

describe("buildSentryOptions()", () => {
	it("tags production events with environment and release", () => {
		// #given
		const context = {
			dsn: "https://key@o1.ingest.sentry.io/2",
			railwayEnvironmentName: "production",
			commitSha: "abcdef1234567890",
		};

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result).toMatchObject({
			dsn: "https://key@o1.ingest.sentry.io/2",
			environment: "production",
			release: "dub-rip@abcdef123456",
		});
	});

	it("normalizes an empty DSN to undefined so the SDK stays disabled", () => {
		// #given
		const context = { dsn: "" };

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.dsn).toBeUndefined();
	});

	it("leaves release undefined when the build had no commit SHA", () => {
		// #given
		const context = { dsn: "https://key@o1.ingest.sentry.io/2" };

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.release).toBeUndefined();
	});

	it("honours an explicit environment override", () => {
		// #given
		const context = {
			dsn: "https://key@o1.ingest.sentry.io/2",
			railwayEnvironmentName: "production",
			environmentOverride: "local",
		};

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.environment).toBe("local");
	});

	it("stops sampling traces when an override renames production", () => {
		// #given
		const context = {
			dsn: "https://key@o1.ingest.sentry.io/2",
			railwayEnvironmentName: "production",
			environmentOverride: "local",
		};

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.tracesSampleRate).toBe(0);
	});

	it("does not sample traces outside production", () => {
		// #given
		const context = {
			dsn: "https://key@o1.ingest.sentry.io/2",
			railwayEnvironmentName: "dub-rip-pr-7",
		};

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.tracesSampleRate).toBe(0);
	});

	it("disables sendDefaultPii, since there are no user accounts to correlate PII against", () => {
		// #given
		const context = { dsn: "https://key@o1.ingest.sentry.io/2" };

		// #when
		const result = buildSentryOptions(context);

		// #then
		expect(result.sendDefaultPii).toBe(false);
	});
});
