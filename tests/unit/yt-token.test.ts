import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		YT_TOKEN_SERVICE_URL: "http://localhost:8080",
	},
}));

import { clearCache, fetchPoToken } from "$lib/yt-token";

describe("fetchPoToken()", () => {
	// #given
	const mockTokenResponse = {
		poToken: "test-po-token-abc123",
		visitorData: "test-visitor-data-xyz789",
	};

	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		clearCache();
	});

	afterEach(() => {
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
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTokenResponse),
		} as Response);

		await fetchPoToken();

		vi.spyOn(Date, "now").mockReturnValueOnce(Date.now() + 51 * 60 * 1000);

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
});
