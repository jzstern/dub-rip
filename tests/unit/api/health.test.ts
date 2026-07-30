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

describe("GET /api/health", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.resetModules();
		// Clear env between tests
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		for (const key of Object.keys(mockPublicEnv)) delete mockPublicEnv[key];
	});

	it("returns 200 when bgutil-pot responds", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.checks.bgutil_pot.ok).toBe(true);
	});

	it("probes the bgutil-pot /ping endpoint", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		await GET({} as never);

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			"http://b/ping",
			expect.objectContaining({ method: "HEAD" }),
		);
	});

	it("no longer reports a cobalt check", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(body.checks).not.toHaveProperty("cobalt");
	});

	it("returns 503 when bgutil-pot is unreachable", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(503);
		expect(body.checks.bgutil_pot.error).toMatch(/ECONNREFUSED/);
	});

	it("reports the resolved Sentry environment so a deploy can be verified", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		mockEnv.RAILWAY_ENVIRONMENT_NAME = "dub-rip-pr-42";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(body.sentry.serverEnvironment).toBe("preview");
	});

	it("reports production when Railway says so", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		mockEnv.RAILWAY_ENVIRONMENT_NAME = "production";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(body.sentry.serverEnvironment).toBe("production");
	});

	it("lets an explicit override rename the environment", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		mockEnv.RAILWAY_ENVIRONMENT_NAME = "production";
		mockEnv.SENTRY_ENVIRONMENT = "staging";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(body.sentry.serverEnvironment).toBe("staging");
	});

	it("reports whether server-side reporting is actually configured", async () => {
		// #given — no SENTRY_DSN set
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(body.sentry.serverEnabled).toBe(false);
	});

	it("never exposes the DSN itself", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = "http://b";
		mockEnv.SENTRY_DSN = "https://secret@o1.ingest.sentry.io/2";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const raw = JSON.stringify(await res.json());

		// #then
		expect(raw).not.toContain("secret");
	});

	it("flags a missing BGUTIL_POT_URL as 'not configured'", async () => {
		// #given — mockEnv is empty (cleared in beforeEach)

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(503);
		expect(body.checks.bgutil_pot.error).toBe("not configured");
	});
});
