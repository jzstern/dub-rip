export const HEAP_PRESSURE_RATIO = 0.9;
export const HEAP_PRESSURE_THROTTLE_MS = 5 * 60 * 1000;

const BYTES_PER_MB = 1024 * 1024;

/**
 * @param {number} bytes
 * @returns {number}
 */
export function toMB(bytes) {
	return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/**
 * @typedef {{ heapUsed: number; heapTotal: number; rss?: number }} MemoryUsageLike
 * @typedef {{ ratio?: number; throttleMs?: number }} ClassifyOptions
 * @typedef {{
 *   underPressure: boolean;
 *   shouldEmit: boolean;
 *   usedRatio?: number;
 *   heapUsedMB?: number;
 *   heapTotalMB?: number;
 *   rssMB?: number;
 * }} HeapState
 */

/**
 * @param {MemoryUsageLike} usage
 * @param {number} now
 * @param {number} lastEmittedAt
 * @param {ClassifyOptions} [options]
 * @returns {HeapState}
 */
export function classifyHeapState(usage, now, lastEmittedAt, options = {}) {
	const ratio = options.ratio ?? HEAP_PRESSURE_RATIO;
	const throttleMs = options.throttleMs ?? HEAP_PRESSURE_THROTTLE_MS;

	const { heapUsed, heapTotal, rss } = usage;
	if (!heapTotal || heapTotal <= 0) {
		return { underPressure: false, shouldEmit: false };
	}

	const usedRatio = heapUsed / heapTotal;
	const underPressure = usedRatio >= ratio;
	const throttled = lastEmittedAt > 0 && now - lastEmittedAt < throttleMs;
	const shouldEmit = underPressure && !throttled;

	return {
		underPressure,
		shouldEmit,
		usedRatio,
		heapUsedMB: toMB(heapUsed),
		heapTotalMB: toMB(heapTotal),
		rssMB: toMB(rss ?? 0),
	};
}
