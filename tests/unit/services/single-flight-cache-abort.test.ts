import { describe, expect, it, vi } from "vitest";
import { createSingleFlightCache } from "$lib/single-flight-cache";

function slowFetch() {
	let flightSignal: AbortSignal | undefined;
	const fetch = vi.fn((signal: AbortSignal) => {
		flightSignal = signal;
		return new Promise<string>((resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
			setTimeout(() => resolve("value"), 20);
		});
	});
	return { fetch, getSignal: () => flightSignal };
}

describe("createSingleFlightCache() abort signal", () => {
	it("lets the shared fetch finish when only one of two callers aborts", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const { fetch, getSignal } = slowFetch();
		const controller = new AbortController();
		const leaving = cache.get("k", fetch, 60_000, controller.signal);
		const staying = cache.get("k", fetch, 60_000, new AbortController().signal);

		// #when
		controller.abort(new Error("left"));

		// #then
		await expect(leaving).rejects.toThrow("left");
		await expect(staying).resolves.toBe("value");
		expect(getSignal()?.aborted).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("never aborts the fetch while a caller without a signal is waiting", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const { fetch, getSignal } = slowFetch();
		const staying = cache.get("k", fetch, 60_000);
		const controller = new AbortController();
		const leaving = cache.get("k", fetch, 60_000, controller.signal);

		// #when
		controller.abort();
		await leaving.catch(() => {});

		// #then
		await expect(staying).resolves.toBe("value");
		expect(getSignal()?.aborted).toBe(false);
	});

	it("aborts the shared fetch once every caller has left", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const { fetch, getSignal } = slowFetch();
		const first = new AbortController();
		const second = new AbortController();
		const a = cache.get("k", fetch, 60_000, first.signal);
		const b = cache.get("k", fetch, 60_000, second.signal);

		// #when
		first.abort();
		second.abort();

		// #then
		await expect(a).rejects.toBeDefined();
		await expect(b).rejects.toBeDefined();
		expect(getSignal()?.aborted).toBe(true);
	});

	it("starts a fresh fetch for a caller arriving after the flight was aborted", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const { fetch } = slowFetch();
		const controller = new AbortController();
		const abandoned = cache.get("k", fetch, 60_000, controller.signal);
		controller.abort();
		await abandoned.catch(() => {});

		// #when
		const later = cache.get("k", fetch, 60_000);

		// #then
		await expect(later).resolves.toBe("value");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("rejects immediately for an already-aborted signal without fetching", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const { fetch } = slowFetch();
		const controller = new AbortController();
		controller.abort();

		// #when
		const result = cache.get("k", fetch, 60_000, controller.signal);

		// #then
		await expect(result).rejects.toBeDefined();
		expect(fetch).not.toHaveBeenCalled();
	});
});
