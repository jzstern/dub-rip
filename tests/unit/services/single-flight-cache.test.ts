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

	it("drops the entry stored longest ago once past its size bound", async () => {
		// #given
		const cache = createSingleFlightCache<string>({ maxEntries: 2 });
		await cache.get("a", async () => "A", 60_000);
		await cache.get("b", async () => "B", 60_000);
		await cache.get("c", async () => "C", 60_000);
		const refetch = vi.fn(async () => "A again");

		// #when
		const a = await cache.get("a", refetch, 60_000);

		// #then
		expect(a).toBe("A again");
	});

	it("keeps the newer entries when it evicts", async () => {
		// #given
		const cache = createSingleFlightCache<string>({ maxEntries: 2 });
		await cache.get("a", async () => "A", 60_000);
		await cache.get("b", async () => "B", 60_000);
		await cache.get("c", async () => "C", 60_000);
		const refetch = vi.fn(async () => "B again");

		// #when
		const b = await cache.get("b", refetch, 60_000);

		// #then
		expect(b).toBe("B");
	});

	it("fetches again once an entry has expired", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		await cache.get("k", async () => "old", -1);

		// #when
		const value = await cache.get("k", async () => "new", 60_000);

		// #then
		expect(value).toBe("new");
	});
});
