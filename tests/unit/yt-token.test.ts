import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock("youtube-po-token-generator", () => ({
	generate: mockGenerate,
}));

import { clearCache, fetchPoToken } from "$lib/yt-token";

describe("fetchPoToken()", () => {
	// #given
	const mockTokenResult = {
		poToken: "test-po-token-abc123",
		visitorData: "test-visitor-data-xyz789",
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-20T00:00:00Z"));
		mockGenerate.mockReset();
		clearCache();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns token when generation succeeds", async () => {
		// #given
		mockGenerate.mockResolvedValue(mockTokenResult);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResult);
		expect(mockGenerate).toHaveBeenCalledOnce();
	});

	it("returns null when generator returns empty poToken", async () => {
		// #given
		mockGenerate.mockResolvedValue({ poToken: "", visitorData: "data" });

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when generator returns empty visitorData", async () => {
		// #given
		mockGenerate.mockResolvedValue({ poToken: "token", visitorData: "" });

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when generation throws", async () => {
		// #given
		mockGenerate.mockRejectedValue(new Error("jsdom failed"));

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
	});

	it("returns null when generation times out", async () => {
		// #given
		mockGenerate.mockImplementation(
			() => new Promise(() => {}), // never resolves
		);

		// #when
		const resultPromise = fetchPoToken();
		vi.advanceTimersByTime(30_000);
		const result = await resultPromise;

		// #then
		expect(result).toBeNull();
	});

	it("returns cached result on subsequent calls", async () => {
		// #given
		mockGenerate.mockResolvedValue(mockTokenResult);

		// #when
		await fetchPoToken();
		const secondResult = await fetchPoToken();

		// #then
		expect(secondResult).toEqual(mockTokenResult);
		expect(mockGenerate).toHaveBeenCalledOnce();
	});

	it("regenerates after cache expires (50 minutes)", async () => {
		// #given
		mockGenerate.mockResolvedValue(mockTokenResult);
		await fetchPoToken();

		vi.advanceTimersByTime(51 * 60 * 1000);

		const updatedResult = {
			poToken: "new-token",
			visitorData: "new-visitor",
		};
		mockGenerate.mockResolvedValue(updatedResult);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(updatedResult);
		expect(mockGenerate).toHaveBeenCalledTimes(2);
	});

	it("returns stale cache during backoff after failure", async () => {
		// #given
		mockGenerate.mockResolvedValue(mockTokenResult);
		await fetchPoToken();

		vi.advanceTimersByTime(51 * 60 * 1000);
		mockGenerate.mockRejectedValue(new Error("failed"));
		await fetchPoToken();

		// #when - still in backoff period
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResult);
	});

	it("returns null during backoff with no stale cache", async () => {
		// #given
		mockGenerate.mockRejectedValue(new Error("failed"));
		await fetchPoToken();

		// #when - still in backoff period
		const result = await fetchPoToken();

		// #then
		expect(result).toBeNull();
		expect(mockGenerate).toHaveBeenCalledOnce();
	});

	it("retries after backoff period expires", async () => {
		// #given
		mockGenerate.mockRejectedValue(new Error("failed"));
		await fetchPoToken();

		vi.advanceTimersByTime(31_000);
		mockGenerate.mockResolvedValue(mockTokenResult);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResult);
		expect(mockGenerate).toHaveBeenCalledTimes(2);
	});

	it("deduplicates concurrent in-flight requests", async () => {
		// #given
		let resolveGenerate: (value: unknown) => void = () => {};
		mockGenerate.mockReturnValue(
			new Promise((resolve) => {
				resolveGenerate = resolve;
			}),
		);

		// #when
		const first = fetchPoToken();
		const second = fetchPoToken();
		const third = fetchPoToken();

		resolveGenerate(mockTokenResult);

		const results = await Promise.all([first, second, third]);

		// #then
		expect(results).toEqual([
			mockTokenResult,
			mockTokenResult,
			mockTokenResult,
		]);
		expect(mockGenerate).toHaveBeenCalledOnce();
	});

	it("clears backoff state on clearCache", async () => {
		// #given
		mockGenerate.mockRejectedValue(new Error("failed"));
		await fetchPoToken();

		clearCache();
		mockGenerate.mockResolvedValue(mockTokenResult);

		// #when
		const result = await fetchPoToken();

		// #then
		expect(result).toEqual(mockTokenResult);
	});
});
