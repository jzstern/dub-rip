import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mutable env carrier — tests write here before importing the module.
// vi.mock is hoisted, so the factory captures this reference and each
// fresh import sees the current value.
const mockEnv: Record<string, string> = {};
const mockPublicEnv: Record<string, string> = {};

vi.mock("$env/dynamic/private", () => ({
	get env() {
		return mockEnv;
	},
}));

vi.mock("$env/dynamic/public", () => ({
	get env() {
		return mockPublicEnv;
	},
}));

function createEvent(search = "") {
	return { url: new URL(`http://localhost/api/health${search}`) } as never;
}

describe("GET /api/health", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.resetModules();
		// Clear env between tests
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		for (const key of Object.keys(mockPublicEnv)) delete mockPublicEnv[key];
	});

	describe("default request (liveness only)", () => {
		it("does not fetch bgutil-pot", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			await GET(createEvent());

			// #then
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("returns 200 even though bgutil-pot was never contacted", async () => {
			// #given — no fetch mock configured to succeed; a probe here would fail
			mockEnv.BGUTIL_POT_URL = "http://b";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());

			// #then
			expect(res.status).toBe(200);
		});

		it("reports bgutil-pot as configured without contacting it", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.checks.bgutil_pot).toEqual({
				configured: true,
				url: "http://b",
			});
		});

		it("flags a missing BGUTIL_POT_URL as not configured", async () => {
			// #given — mockEnv is empty (cleared in beforeEach)

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.checks.bgutil_pot).toEqual({ configured: false, url: null });
		});

		it("no longer reports a cobalt check", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.checks).not.toHaveProperty("cobalt");
		});

		it("ignores an unrecognized probe value and still skips the fetch", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			await GET(createEvent("?probe=cobalt"));

			// #then
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("?probe=bgutil (opt-in deep probe)", () => {
		it("fetches the bgutil-pot /ping endpoint", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";
			fetchMock.mockResolvedValue({ ok: true, status: 200 });

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			await GET(createEvent("?probe=bgutil"));

			// #then
			expect(fetchMock).toHaveBeenCalledWith(
				"http://b/ping",
				expect.objectContaining({ method: "HEAD" }),
			);
		});

		it("returns 200 when bgutil-pot responds", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";
			fetchMock.mockResolvedValue({ ok: true, status: 200 });

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent("?probe=bgutil"));
			const body = await res.json();

			// #then
			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.checks.bgutil_pot.ok).toBe(true);
		});

		it("returns 503 when bgutil-pot is unreachable", async () => {
			// #given
			mockEnv.BGUTIL_POT_URL = "http://b";
			fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent("?probe=bgutil"));
			const body = await res.json();

			// #then
			expect(res.status).toBe(503);
			expect(body.checks.bgutil_pot.error).toMatch(/ECONNREFUSED/);
		});

		it("flags a missing BGUTIL_POT_URL as 'not configured' and returns 503", async () => {
			// #given — mockEnv is empty (cleared in beforeEach)

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent("?probe=bgutil"));
			const body = await res.json();

			// #then
			expect(res.status).toBe(503);
			expect(body.checks.bgutil_pot.error).toBe("not configured");
		});
	});

	describe("sentry diagnostics (reported regardless of probe)", () => {
		it("reports the resolved Sentry environment so a deploy can be verified", async () => {
			// #given
			mockEnv.RAILWAY_ENVIRONMENT_NAME = "dub-rip-pr-42";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.serverEnvironment).toBe("preview");
		});

		it("reports production when Railway says so", async () => {
			// #given
			mockEnv.RAILWAY_ENVIRONMENT_NAME = "production";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.serverEnvironment).toBe("production");
		});

		it("lets an explicit override rename the environment", async () => {
			// #given
			mockEnv.RAILWAY_ENVIRONMENT_NAME = "production";
			mockEnv.SENTRY_ENVIRONMENT = "staging";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.serverEnvironment).toBe("staging");
		});

		it("lets PUBLIC_SENTRY_ENVIRONMENT override the browser environment", async () => {
			// #given
			mockPublicEnv.PUBLIC_SENTRY_ENVIRONMENT = "preview";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.browserEnvironment).toBe("preview");
		});

		it("surfaces server/browser drift rather than hiding it", async () => {
			// #given — the failure mode this endpoint exists to catch
			mockEnv.SENTRY_ENVIRONMENT = "production";
			mockPublicEnv.PUBLIC_SENTRY_ENVIRONMENT = "development";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.serverEnvironment).not.toBe(
				body.sentry.browserEnvironment,
			);
		});

		it("reports whether browser-side reporting is actually configured", async () => {
			// #given
			mockPublicEnv.PUBLIC_SENTRY_DSN = "https://k@o1.ingest.sentry.io/2";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.browserEnabled).toBe(true);
		});

		it("reports whether server-side reporting is actually configured", async () => {
			// #given — no SENTRY_DSN set

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const body = await res.json();

			// #then
			expect(body.sentry.serverEnabled).toBe(false);
		});

		it("never exposes the DSN itself", async () => {
			// #given
			mockEnv.SENTRY_DSN = "https://secret@o1.ingest.sentry.io/2";

			// #when
			const { GET } = await import("../../../src/routes/api/health/+server");
			const res = await GET(createEvent());
			const raw = JSON.stringify(await res.json());

			// #then
			expect(raw).not.toContain("secret");
		});
	});
});

describe("HEAD /api/health", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.resetModules();
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		for (const key of Object.keys(mockPublicEnv)) delete mockPublicEnv[key];
	});

	it("never fetches bgutil-pot", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";

		// #when
		const { HEAD } = await import("../../../src/routes/api/health/+server");
		await HEAD(createEvent());

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("never fetches bgutil-pot even when a deep-probe query string is present", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";

		// #when
		const { HEAD } = await import("../../../src/routes/api/health/+server");
		await HEAD(createEvent("?probe=bgutil"));

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("mirrors the default liveness status", async () => {
		// #when
		const { HEAD } = await import("../../../src/routes/api/health/+server");
		const res = await HEAD(createEvent());

		// #then
		expect(res.status).toBe(200);
	});
});
