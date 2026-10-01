import { describe, expect, it, vi } from "vitest";
import {
	MAX_CONCURRENT_YT_DLP_PROCESSES,
	MAX_QUEUED_YT_DLP_REQUESTS,
	withYtDlpConcurrencyLimit,
	YtDlpQueueFullError,
} from "$lib/yt-dlp-concurrency";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function fillSlots() {
	const gates = Array.from({ length: MAX_CONCURRENT_YT_DLP_PROCESSES }, () =>
		deferred<void>(),
	);
	const running = gates.map((gate) =>
		withYtDlpConcurrencyLimit(async () => {
			await gate.promise;
		}),
	);
	return {
		release: async () => {
			for (const gate of gates) gate.resolve();
			await Promise.all(running);
		},
	};
}

describe("withYtDlpConcurrencyLimit() abort signal", () => {
	it("rejects immediately with the reason when already aborted", async () => {
		// #given
		const controller = new AbortController();
		const reason = new Error("gone");
		controller.abort(reason);
		const fn = vi.fn().mockResolvedValue("ran");

		// #when
		const result = withYtDlpConcurrencyLimit(fn, controller.signal);

		// #then
		await expect(result).rejects.toBe(reason);
		expect(fn).not.toHaveBeenCalled();
	});

	it("removes an aborted waiter from the queue without running it", async () => {
		// #given
		const slots = fillSlots();
		const controller = new AbortController();
		const fn = vi.fn().mockResolvedValue("ran");
		const waiting = withYtDlpConcurrencyLimit(fn, controller.signal);
		const reason = new Error("client disconnected");

		// #when
		controller.abort(reason);

		// #then
		await expect(waiting).rejects.toBe(reason);
		await slots.release();
		expect(fn).not.toHaveBeenCalled();
	});

	it("frees a queue position so a full queue accepts new work again", async () => {
		// #given
		const slots = fillSlots();
		const controllers = Array.from(
			{ length: MAX_QUEUED_YT_DLP_REQUESTS },
			() => new AbortController(),
		);
		const settled = controllers.map((controller) =>
			withYtDlpConcurrencyLimit(async () => "ran", controller.signal).catch(
				() => "aborted",
			),
		);
		await expect(
			withYtDlpConcurrencyLimit(async () => "overflow"),
		).rejects.toBeInstanceOf(YtDlpQueueFullError);

		// #when
		controllers[0].abort();
		const replacement = withYtDlpConcurrencyLimit(async () => "replacement");

		// #then
		await slots.release();
		await expect(replacement).resolves.toBe("replacement");
		expect((await Promise.all(settled))[0]).toBe("aborted");
	});

	it("does not corrupt slot counts when a running holder's signal aborts", async () => {
		// #given
		const controller = new AbortController();
		const gate = deferred<void>();
		const holder = withYtDlpConcurrencyLimit(async () => {
			await gate.promise;
			return "finished";
		}, controller.signal);

		// #when
		controller.abort();
		gate.resolve();
		await expect(holder).resolves.toBe("finished");

		// #then
		const gates = Array.from(
			{ length: MAX_CONCURRENT_YT_DLP_PROCESSES + 1 },
			() => deferred<void>(),
		);
		let running = 0;
		let peak = 0;
		const calls = gates.map((g) =>
			withYtDlpConcurrencyLimit(async () => {
				running += 1;
				peak = Math.max(peak, running);
				await g.promise;
				running -= 1;
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(peak).toBe(MAX_CONCURRENT_YT_DLP_PROCESSES);
		for (const g of gates) g.resolve();
		await Promise.all(calls);
	});

	it("still runs a waiter whose signal never aborts", async () => {
		// #given
		const slots = fillSlots();
		const controller = new AbortController();
		const waiting = withYtDlpConcurrencyLimit(
			async () => "ran",
			controller.signal,
		);

		// #when
		await slots.release();

		// #then
		await expect(waiting).resolves.toBe("ran");
	});
});
