import { beforeEach, describe, expect, it } from "vitest";
import {
	createProgressSmoother,
	type ProgressSmoother,
} from "$lib/progress-smoothing";

function advance(
	smoother: ProgressSmoother,
	stepMs: number,
	steps: number,
): void {
	for (let i = 0; i < steps; i++) {
		smoother.tick(stepMs);
	}
}

describe("createProgressSmoother()", () => {
	let smoother: ProgressSmoother;

	beforeEach(() => {
		// #given
		smoother = createProgressSmoother();
	});

	it("starts at 0", () => {
		// #then
		expect(smoother.value).toBe(0);
	});

	it("eases toward the target over repeated ticks", () => {
		// #given
		const noTrickle = createProgressSmoother({ trickleGap: 0 });
		noTrickle.setTarget(50);

		// #when
		advance(noTrickle, 16, 300);

		// #then
		expect(noTrickle.value).toBe(50);
	});

	it("does not overshoot the target while easing up", () => {
		// #given
		smoother.setTarget(40);

		// #when
		smoother.tick(16);

		// #then
		expect(smoother.value).toBeLessThanOrEqual(40);
	});

	it("trickles forward during a stall once the target is reached", () => {
		// #given
		smoother.setTarget(20);
		advance(smoother, 16, 120);
		const reached = smoother.value;

		// #when
		advance(smoother, 100, 30);

		// #then
		expect(smoother.value).toBeGreaterThan(reached);
	});

	it("never trickles past target plus the configured gap", () => {
		// #given
		const limited = createProgressSmoother({
			trickleGap: 5,
			trickleCeiling: 99,
		});
		limited.setTarget(20);
		advance(limited, 16, 120);

		// #when
		advance(limited, 1000, 50);

		// #then
		expect(limited.value).toBeLessThanOrEqual(25);
	});

	it("never trickles past the trickle ceiling", () => {
		// #given
		const limited = createProgressSmoother({
			trickleGap: 50,
			trickleCeiling: 90,
		});
		limited.setTarget(80);
		advance(limited, 16, 200);

		// #when
		advance(limited, 1000, 100);

		// #then
		expect(limited.value).toBeLessThanOrEqual(90);
	});

	it("never exceeds 99 via trickle by default", () => {
		// #given
		smoother.setTarget(99);
		advance(smoother, 16, 400);

		// #when
		advance(smoother, 1000, 100);

		// #then
		expect(smoother.value).toBeLessThanOrEqual(99);
	});

	it("is monotonic and never goes backward while the target is unchanged", () => {
		// #given
		smoother.setTarget(60);
		let previous = smoother.value;
		let wentBackward = false;

		// #when
		for (let i = 0; i < 200; i++) {
			smoother.tick(16);
			if (smoother.value < previous) wentBackward = true;
			previous = smoother.value;
		}

		// #then
		expect(wentBackward).toBe(false);
	});

	it("ignores a target lower than the current displayed value", () => {
		// #given
		smoother.setTarget(70);
		advance(smoother, 16, 200);
		const high = smoother.value;

		// #when
		smoother.setTarget(10);
		smoother.tick(16);

		// #then
		expect(smoother.value).toBeGreaterThanOrEqual(high);
	});

	it("reaches 100 when complete() is called", () => {
		// #given
		smoother.setTarget(75);
		advance(smoother, 16, 200);

		// #when
		smoother.complete();

		// #then
		expect(smoother.value).toBe(100);
	});

	it("stops advancing after complete()", () => {
		// #given
		smoother.complete();

		// #when
		smoother.tick(1000);

		// #then
		expect(smoother.value).toBe(100);
	});

	it("clamps a target above 100 down to 100", () => {
		// #given
		smoother.setTarget(150);

		// #when
		advance(smoother, 16, 400);

		// #then
		expect(smoother.value).toBeLessThanOrEqual(100);
	});

	it("clamps a negative target up to 0", () => {
		// #given
		smoother.setTarget(-20);

		// #when
		smoother.tick(16);

		// #then
		expect(smoother.value).toBeGreaterThanOrEqual(0);
	});

	it("resets back to 0", () => {
		// #given
		smoother.setTarget(80);
		advance(smoother, 16, 200);

		// #when
		smoother.reset();

		// #then
		expect(smoother.value).toBe(0);
	});

	it("does not advance on a non-positive deltaMs", () => {
		// #given
		smoother.setTarget(50);
		const before = smoother.value;

		// #when
		smoother.tick(0);

		// #then
		expect(smoother.value).toBe(before);
	});
});
