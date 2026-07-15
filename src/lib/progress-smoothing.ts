export interface ProgressSmootherOptions {
	trickleCeiling?: number;
	easeRate?: number;
	trickleGap?: number;
	trickleRate?: number;
}

export interface ProgressSmoother {
	setTarget(percent: number): void;
	tick(deltaMs: number): number;
	complete(): void;
	reset(): void;
	readonly value: number;
}

const DEFAULT_TRICKLE_CEILING = 99;
const DEFAULT_EASE_RATE = 4;
const DEFAULT_TRICKLE_GAP = 8;
const DEFAULT_TRICKLE_RATE = 0.6;
const MAX_VALUE = 100;
const MIN_VALUE = 0;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function createProgressSmoother(
	opts: ProgressSmootherOptions = {},
): ProgressSmoother {
	const trickleCeiling = clamp(
		opts.trickleCeiling ?? DEFAULT_TRICKLE_CEILING,
		MIN_VALUE,
		MAX_VALUE,
	);
	const easeRate = Math.max(0, opts.easeRate ?? DEFAULT_EASE_RATE);
	const trickleGap = Math.max(0, opts.trickleGap ?? DEFAULT_TRICKLE_GAP);
	const trickleRate = Math.max(0, opts.trickleRate ?? DEFAULT_TRICKLE_RATE);

	let displayed = MIN_VALUE;
	let target = MIN_VALUE;
	let completed = false;

	function setTarget(percent: number): void {
		if (completed) return;
		const next = clamp(percent, MIN_VALUE, MAX_VALUE);
		if (next > target) target = next;
	}

	function tick(deltaMs: number): number {
		if (completed) return displayed;
		if (deltaMs <= 0) return displayed;

		const seconds = deltaMs / 1000;

		if (displayed < target) {
			const factor = 1 - Math.exp(-easeRate * seconds);
			displayed = displayed + (target - displayed) * factor;
			if (target - displayed < 0.05) displayed = target;
			return displayed;
		}

		const trickleLimit = Math.min(target + trickleGap, trickleCeiling);
		if (displayed < trickleLimit) {
			const remaining = trickleLimit - displayed;
			displayed =
				displayed + remaining * (1 - Math.exp(-trickleRate * seconds));
			if (trickleLimit - displayed < 0.05) displayed = trickleLimit;
		}

		return displayed;
	}

	function complete(): void {
		completed = true;
		target = MAX_VALUE;
		displayed = MAX_VALUE;
	}

	function reset(): void {
		displayed = MIN_VALUE;
		target = MIN_VALUE;
		completed = false;
	}

	return {
		setTarget,
		tick,
		complete,
		reset,
		get value(): number {
			return displayed;
		},
	};
}
