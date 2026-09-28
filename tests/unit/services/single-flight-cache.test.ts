import { describe, expect, it, vi } from "vitest";
import { createSingleFlightCache } from "$lib/single-flight-cache";

describe("createSingleFlightCache()", () => {
	it("does not cache a rejection, so the next call fetches again", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const fetch = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("ok");

		// #when
		await cache.get("k", fetch, 60_000).catch(() => {});
		const second = await cache.get("k", fetch, 60_000);

		// #then
		expect(second).toBe("ok");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps keys independent", async () => {
		// #given
		const cache = createSingleFlightCache<string>();

		// #when
		const [a, b] = await Promise.all([
			cache.get("a", async () => "A", 60_000),
			cache.get("b", async () => "B", 60_000),
		]);

		// #then
		expect([a, b]).toEqual(["A", "B"]);
	});
});
