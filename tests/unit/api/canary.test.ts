import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv: Record<string, string> = {};
vi.mock("$env/dynamic/private", () => ({
	get env() {
		return mockEnv;
	},
}));

const { runCanaryDownloadMock } = vi.hoisted(() => ({
	runCanaryDownloadMock: vi.fn(),
}));
vi.mock("$lib/canary/run-canary-download", () => ({
	runCanaryDownload: runCanaryDownloadMock,
}));

const { startCanaryCheckInMock, finishCanaryCheckInMock } = vi.hoisted(() => ({
	startCanaryCheckInMock: vi.fn(() => "check-in-id"),
	finishCanaryCheckInMock: vi.fn(),
}));
vi.mock("$lib/canary/report-canary-check-in", () => ({
	CANARY_MONITOR_SLUG: "production-canary",
	startCanaryCheckIn: startCanaryCheckInMock,
	finishCanaryCheckIn: finishCanaryCheckInMock,
}));

const REAL_TOKEN = "a-strong-random-canary-token";

function postRequest(authorization?: string): Request {
	const headers = new Headers();
	if (authorization !== undefined) headers.set("authorization", authorization);
	return new Request("http://localhost/api/canary", {
		method: "POST",
		headers,
	});
}

describe("POST /api/canary", () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		runCanaryDownloadMock.mockReset();
		startCanaryCheckInMock.mockClear();
		finishCanaryCheckInMock.mockClear();
	});

	it("returns 404 when CANARY_TOKEN is unset", async () => {
		// #given — mockEnv has no CANARY_TOKEN

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({
			request: postRequest(`Bearer ${REAL_TOKEN}`),
		} as never);

		// #then
		expect(res.status).toBe(404);
	});

	it("never runs the canary download when CANARY_TOKEN is unset", async () => {
		// #given
		const { POST } = await import("../../../src/routes/api/canary/+server");

		// #when
		await POST({ request: postRequest(`Bearer ${REAL_TOKEN}`) } as never);

		// #then
		expect(runCanaryDownloadMock).not.toHaveBeenCalled();
	});

	it("returns 401 when the Authorization header is missing", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({ request: postRequest() } as never);

		// #then
		expect(res.status).toBe(401);
	});

	it("returns 401 when the token is wrong", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({
			request: postRequest("Bearer wrong-token"),
		} as never);

		// #then
		expect(res.status).toBe(401);
	});

	it("returns 401 when the Authorization header is missing the Bearer prefix", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({ request: postRequest(REAL_TOKEN) } as never);

		// #then
		expect(res.status).toBe(401);
	});

	it("accepts a lowercase 'bearer' scheme, since RFC 7235 makes it case-insensitive", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		runCanaryDownloadMock.mockResolvedValue({
			stage: "ok",
			itag: "18",
			durationMs: 1,
			detail: "",
		});

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({
			request: postRequest(`bearer ${REAL_TOKEN}`),
		} as never);

		// #then
		expect(res.status).toBe(200);
	});

	it("never runs the canary download when the token is wrong", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		await POST({ request: postRequest("Bearer wrong-token") } as never);

		// #then
		expect(runCanaryDownloadMock).not.toHaveBeenCalled();
	});

	it("returns 200 with the classification when the token is correct", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		runCanaryDownloadMock.mockResolvedValue({
			stage: "ok",
			itag: "18",
			durationMs: 4000,
			detail: "Downloaded successfully using itag 18",
		});

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({
			request: postRequest(`Bearer ${REAL_TOKEN}`),
		} as never);
		const body = await res.json();

		// #then
		expect(res.status).toBe(200);
		expect(body).toMatchObject({ stage: "ok", itag: "18" });
	});

	it("returns 200 even when the canary classifies a failure, so the workflow stays green", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		runCanaryDownloadMock.mockResolvedValue({
			stage: "media_refused",
			itag: "251",
			durationMs: 2500,
			detail: "The media fetch for itag 251 was refused",
		});

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		const res = await POST({
			request: postRequest(`Bearer ${REAL_TOKEN}`),
		} as never);

		// #then
		expect(res.status).toBe(200);
	});

	it("starts the check-in before running the download", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		const callOrder: string[] = [];
		startCanaryCheckInMock.mockImplementation(() => {
			callOrder.push("start");
			return "check-in-id";
		});
		runCanaryDownloadMock.mockImplementation(async () => {
			callOrder.push("run");
			return { stage: "ok", itag: "18", durationMs: 1, detail: "" };
		});

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		await POST({ request: postRequest(`Bearer ${REAL_TOKEN}`) } as never);

		// #then
		expect(callOrder).toEqual(["start", "run"]);
	});

	it("finishes the same check-in that was started, with the classification", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		startCanaryCheckInMock.mockReturnValue("the-check-in-id");
		const classification = {
			stage: "ok" as const,
			itag: "18",
			durationMs: 1,
			detail: "",
		};
		runCanaryDownloadMock.mockResolvedValue(classification);

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		await POST({ request: postRequest(`Bearer ${REAL_TOKEN}`) } as never);

		// #then
		expect(finishCanaryCheckInMock).toHaveBeenCalledWith(
			"the-check-in-id",
			classification,
		);
	});

	it("never logs the configured token", async () => {
		// #given
		mockEnv.CANARY_TOKEN = REAL_TOKEN;
		runCanaryDownloadMock.mockResolvedValue({
			stage: "ok",
			itag: "18",
			durationMs: 1,
			detail: "",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// #when
		const { POST } = await import("../../../src/routes/api/canary/+server");
		await POST({
			request: postRequest(`Bearer ${REAL_TOKEN}`),
		} as never);
		await POST({ request: postRequest("Bearer wrong-token") } as never);

		// #then
		const allLoggedText = [
			...logSpy.mock.calls,
			...errorSpy.mock.calls,
			...warnSpy.mock.calls,
		]
			.flat()
			.map((arg) => String(arg))
			.join("\n");
		expect(allLoggedText).not.toContain(REAL_TOKEN);

		logSpy.mockRestore();
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});
});
