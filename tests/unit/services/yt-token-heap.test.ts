import { describe, expect, it } from "vitest";
import {
	classifyHeapState,
	HEAP_PRESSURE_RATIO,
	HEAP_PRESSURE_THROTTLE_MS,
	toMB,
} from "../../../services/yt-token/heap.js";

const MB = 1024 * 1024;

describe("yt-token-service classifyHeapState", () => {
	// #given
	const NOW = 1_700_000_000_000;

	it("reports no pressure when heap is well under threshold", () => {
		// #given
		const usage = {
			heapUsed: 200 * MB,
			heapTotal: 1024 * MB,
			rss: 300 * MB,
		};

		// #when
		const state = classifyHeapState(usage, NOW, 0);

		// #then
		expect(state.underPressure).toBe(false);
	});

	it("does not emit when heap is under threshold", () => {
		// #given
		const usage = { heapUsed: 500 * MB, heapTotal: 1024 * MB, rss: 600 * MB };

		// #when
		const state = classifyHeapState(usage, NOW, 0);

		// #then
		expect(state.shouldEmit).toBe(false);
	});

	it("flags pressure and emits when ratio >= 0.9 and no prior emission", () => {
		// #given
		const usage = { heapUsed: 950 * MB, heapTotal: 1024 * MB, rss: 1000 * MB };

		// #when
		const state = classifyHeapState(usage, NOW, 0);

		// #then
		expect(state.shouldEmit).toBe(true);
	});

	it("flags pressure and reports rounded MB values on emission", () => {
		// #given
		const usage = { heapUsed: 950 * MB, heapTotal: 1024 * MB, rss: 1000 * MB };

		// #when
		const state = classifyHeapState(usage, NOW, 0);

		// #then
		expect(state).toMatchObject({
			underPressure: true,
			heapUsedMB: 950,
			heapTotalMB: 1024,
			rssMB: 1000,
		});
	});

	it("throttles when the last emission happened within the window", () => {
		// #given
		const usage = { heapUsed: 950 * MB, heapTotal: 1024 * MB, rss: 1000 * MB };
		const lastEmittedAt = NOW - 60_000;

		// #when
		const state = classifyHeapState(usage, NOW, lastEmittedAt);

		// #then
		expect(state.shouldEmit).toBe(false);
	});

	it("still reports underPressure=true while throttled", () => {
		// #given
		const usage = { heapUsed: 950 * MB, heapTotal: 1024 * MB, rss: 1000 * MB };
		const lastEmittedAt = NOW - 60_000;

		// #when
		const state = classifyHeapState(usage, NOW, lastEmittedAt);

		// #then
		expect(state.underPressure).toBe(true);
	});

	it("re-emits after the throttle window has elapsed", () => {
		// #given
		const usage = { heapUsed: 950 * MB, heapTotal: 1024 * MB, rss: 1000 * MB };
		const lastEmittedAt = NOW - HEAP_PRESSURE_THROTTLE_MS - 1_000;

		// #when
		const state = classifyHeapState(usage, NOW, lastEmittedAt);

		// #then
		expect(state.shouldEmit).toBe(true);
	});

	it("handles zero heapTotal defensively without dividing by zero", () => {
		// #given
		const usage = { heapUsed: 0, heapTotal: 0, rss: 0 };

		// #when
		const state = classifyHeapState(usage, NOW, 0);

		// #then
		expect(state).toEqual({ underPressure: false, shouldEmit: false });
	});

	it("accepts an override ratio", () => {
		// #given
		const usage = { heapUsed: 600 * MB, heapTotal: 1024 * MB, rss: 700 * MB };

		// #when
		const state = classifyHeapState(usage, NOW, 0, { ratio: 0.5 });

		// #then
		expect(state.underPressure).toBe(true);
	});

	it("exposes the expected default constants", () => {
		// #then
		expect(HEAP_PRESSURE_RATIO).toBe(0.9);
	});

	it("toMB converts bytes to MB with one decimal", () => {
		// #when
		const result = toMB(2.5 * MB);

		// #then
		expect(result).toBe(2.5);
	});
});
