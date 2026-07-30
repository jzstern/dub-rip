import { describe, expect, it } from "vitest";
import { PROGRESS_STAGES } from "$lib/download-pipeline/progress-stages";

describe("PROGRESS_STAGES", () => {
	it("increases strictly from one stage to the next", () => {
		// #given / #when
		const isStrictlyIncreasing = PROGRESS_STAGES.every(
			(stage, index) => index === 0 || stage > PROGRESS_STAGES[index - 1],
		);

		// #then — a future edit that lets one stage catch up with or overtake
		// another would make the reported progress jump backward mid-download
		expect(isStrictlyIncreasing).toBe(true);
	});

	it("keeps every stage within the 0-100 progress range", () => {
		// #given / #when / #then
		for (const stage of PROGRESS_STAGES) {
			expect(stage).toBeGreaterThanOrEqual(0);
			expect(stage).toBeLessThanOrEqual(100);
		}
	});
});
