import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	MAX_CONCURRENT_YT_DLP_PROCESSES,
	MAX_QUEUED_YT_DLP_REQUESTS,
	withYtDlpConcurrencyLimit,
	YtDlpQueueFullError,
} from "$lib/yt-dlp-concurrency";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("withYtDlpConcurrencyLimit()", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("runs a single call immediately", async () => {
		// #given
		const fn = vi.fn().mockResolvedValue("done");

		// #when
		const result = await withYtDlpConcurrencyLimit(fn);

		// #then
		expect(result).toBe("done");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("caps concurrent executions at MAX_CONCURRENT_YT_DLP_PROCESSES", async () => {
		// #given
		const gates = Array.from(
			{ length: MAX_CONCURRENT_YT_DLP_PROCESSES + 1 },
			() => deferred<void>(),
		);
		let running = 0;
		let maxObservedRunning = 0;

		const runOne = (index: number) =>
			withYtDlpConcurrencyLimit(async () => {
				running += 1;
				maxObservedRunning = Math.max(maxObservedRunning, running);
				await gates[index].promise;
				running -= 1;
			});

		// #when
		const calls = gates.map((_, index) => runOne(index));
		await new Promise((resolve) => setTimeout(resolve, 0));

		// #then — the extra call past the limit must still be queued, not running
		expect(maxObservedRunning).toBe(MAX_CONCURRENT_YT_DLP_PROCESSES);

		for (const gate of gates) gate.resolve();
		await Promise.all(calls);
	});

	it("queues excess callers and runs them once a slot frees up", async () => {
		// #given
		const order: number[] = [];
		const gates = Array.from(
			{ length: MAX_CONCURRENT_YT_DLP_PROCESSES + 1 },
			() => deferred<void>(),
		);

		const runOne = (index: number) =>
			withYtDlpConcurrencyLimit(async () => {
				order.push(index);
				await gates[index].promise;
			});

		// #when
		const calls = gates.map((_, index) => runOne(index));
		await new Promise((resolve) => setTimeout(resolve, 0));
		const lastIndex = gates.length - 1;
		expect(order).not.toContain(lastIndex);

		gates[0].resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));

		// #then
		expect(order).toContain(lastIndex);

		for (const gate of gates) gate.resolve();
		await Promise.all(calls);
	});

	it("releases the slot when fn rejects, so the next queued caller can run", async () => {
		// #given
		const gates = Array.from({ length: MAX_CONCURRENT_YT_DLP_PROCESSES }, () =>
			deferred<void>(),
		);
		const failing = withYtDlpConcurrencyLimit(async () => {
			throw new Error("boom");
		});

		const runs = gates.map((gate, index) =>
			withYtDlpConcurrencyLimit(async () => {
				await gate.promise;
				return index;
			}),
		);

		// #when
		await expect(failing).rejects.toThrow("boom");
		const waiting = withYtDlpConcurrencyLimit(async () => "queued-slot-ran");
		for (const gate of gates) gate.resolve();
		await Promise.all(runs);

		// #then
		await expect(waiting).resolves.toBe("queued-slot-ran");
	});
});

describe("withYtDlpConcurrencyLimit() queue bound", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects immediately once the queue reaches MAX_QUEUED_YT_DLP_REQUESTS", async () => {
		// #given — fill every concurrency slot and the entire queue behind it
		const backlogSize =
			MAX_CONCURRENT_YT_DLP_PROCESSES + MAX_QUEUED_YT_DLP_REQUESTS;
		const gates = Array.from({ length: backlogSize }, () => deferred<void>());
		const calls = gates.map((gate) =>
			withYtDlpConcurrencyLimit(async () => {
				await gate.promise;
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// #when
		const overflow = withYtDlpConcurrencyLimit(async () => "should not run");

		// #then
		await expect(overflow).rejects.toBeInstanceOf(YtDlpQueueFullError);

		// #cleanup
		for (const gate of gates) gate.resolve();
		await Promise.all(calls);
	});

	it("identifies a full queue by error type rather than by message", async () => {
		// #given
		const backlogSize =
			MAX_CONCURRENT_YT_DLP_PROCESSES + MAX_QUEUED_YT_DLP_REQUESTS;
		const gates = Array.from({ length: backlogSize }, () => deferred<void>());
		const calls = gates.map((gate) =>
			withYtDlpConcurrencyLimit(async () => {
				await gate.promise;
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// #when
		let caught: unknown;
		try {
			await withYtDlpConcurrencyLimit(async () => "should not run");
		} catch (error) {
			caught = error;
		}

		// #then
		expect(caught).toBeInstanceOf(YtDlpQueueFullError);
		expect((caught as Error).name).toBe("YtDlpQueueFullError");

		// #cleanup
		for (const gate of gates) gate.resolve();
		await Promise.all(calls);
	});

	it("still queues normally for callers under the queue cap", async () => {
		// #given — fill every concurrency slot, leaving room in the queue
		const gates = Array.from({ length: MAX_CONCURRENT_YT_DLP_PROCESSES }, () =>
			deferred<void>(),
		);
		const running = gates.map((gate) =>
			withYtDlpConcurrencyLimit(async () => {
				await gate.promise;
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// #when
		const queued = withYtDlpConcurrencyLimit(async () => "queued-slot-ran");
		for (const gate of gates) gate.resolve();
		await Promise.all(running);

		// #then
		await expect(queued).resolves.toBe("queued-slot-ran");
	});
});
