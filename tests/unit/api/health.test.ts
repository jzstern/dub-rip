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
