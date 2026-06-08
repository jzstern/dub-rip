import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mutable env carrier — tests write here before importing the module.
// vi.mock is hoisted, so the factory captures this reference and each
// fresh import sees the current value.
const mockEnv: Record<string, string> = {};

vi.mock("$env/dynamic/private", () => ({
	get env() {
		return mockEnv;
	},
}));

describe("GET /api/health", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.resetModules();
		// Clear env between tests
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	});

	it("returns 200 when both downstream services respond", async () => {
		// #given
		mockEnv.COBALT_API_URL = "http://c";
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock.mockResolvedValue({ ok: true, status: 200 });

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.checks.cobalt.ok).toBe(true);
		expect(body.checks.bgutil_pot.ok).toBe(true);
	});

	it("returns 503 when bgutil-pot is unreachable", async () => {
		// #given
		mockEnv.COBALT_API_URL = "http://c";
		mockEnv.BGUTIL_POT_URL = "http://b";
		fetchMock
			.mockResolvedValueOnce({ ok: true, status: 200 })
			.mockRejectedValueOnce(new Error("ECONNREFUSED"));

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(503);
		expect(body.checks.bgutil_pot.error).toMatch(/ECONNREFUSED/);
	});

	it("flags missing env vars as 'not configured'", async () => {
		// #given — mockEnv is empty (cleared in beforeEach)

		// #when
		const { GET } = await import("../../../src/routes/api/health/+server");
		const res = await GET({} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(503);
		expect(body.checks.cobalt.error).toBe("not configured");
		expect(body.checks.bgutil_pot.error).toBe("not configured");
	});
});
