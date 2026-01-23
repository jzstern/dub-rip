import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	YT_TOKEN_SERVICE_URL: "http://localhost:8080",
}));

vi.mock("$env/dynamic/private", () => ({
	env: mockEnv,
}));

import { clearCache, fetchPoToken } from "$lib/yt-token";

describe("fetchPoToken()", () => {
	// #given
	const mockTokenResponse = {
		poToken: "test-po-token-abc123",
		visitorData: "test-visitor-data-xyz789",
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", vi.fn());
		mockEnv.YT_TOKEN_SERVICE_URL = "http://localhost:8080";
		clearCache();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("returns token when service responds successfully", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResponse);
		expect(fetch).toHaveBeenCalledWith(
			"http://localhost:8080/token",
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("returns null when YT_TOKEN_SERVICE_URL is not configured", async () => {
		// #given
		mockEnv.YT_TOKEN_SERVICE_URL = "";

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("returns null when service returns non-ok status", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 503,
		} as Response);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when response is missing poToken", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ visitorData: "data" }),
		} as Response);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when response is missing visitorData", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ poToken: "token" }),
		} as Response);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when fetch throws a network error", async () => {
		// #given
		vi.mocked(fetch).mockRejectedValue(new Error("Connection refused"));

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when fetch times out", async () => {
		// #given
		vi.mocked(fetch).mockRejectedValue(
			new DOMException("Aborted", "AbortError"),
		);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns cached result on subsequent calls", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		// #when
		await fetchPoToken();
		const secondResult = await fetchPoToken();

		// #then
		expect(secondResult).toEqual(mockTokenResponse);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("refetches after cache expires", async () => {
		// #given
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		await fetchPoToken();

		vi.setSystemTime(new Date("2026-01-01T00:51:00Z"));

		const updatedResponse = {
			poToken: "new-token",
			visitorData: "new-visitor",
		};
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(updatedResponse),
		} as Response);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(updatedResponse);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("does not cache failed responses", async () => {
		// #given
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: false,
			status: 500,
		} as Response);

		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		// #when
		await fetchPoToken();
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResponse);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("deduplicates concurrent in-flight requests", async () => {
		// #given
		let resolveResponse: (value: Response) => void = () => {};
		vi.mocked(fetch).mockReturnValue(
			new Promise((resolve) => {
				resolveResponse = resolve;
			}),
		);

		// #when
		const first = fetchPoToken();
		const second = fetchPoToken();
		const third = fetchPoToken();

		resolveResponse({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		const results = await Promise.all([first, second, third]);

		// #then
		expect(results).toEqual([
			mockTokenResponse,
			mockTokenResponse,
			mockTokenResponse,
		]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
