import { describe, expect, it } from "vitest";
import { tokensMatch } from "$lib/canary/tokens-match";

describe("tokensMatch()", () => {
	it("returns true when both tokens are identical", () => {
		// #given
		const token = "a-strong-random-token";

		// #when
		const result = tokensMatch(token, token);

		// #then
		expect(result).toBe(true);
	});

	it("returns false when tokens differ", () => {
		// #given
		const provided = "wrong-token";
		const expected = "a-strong-random-token";

		// #when
		const result = tokensMatch(provided, expected);

		// #then
		expect(result).toBe(false);
	});

	it("returns false without throwing when tokens differ in length", () => {
		// #given
		const provided = "short";
		const expected = "a-much-longer-expected-token-value";

		// #when
		const result = tokensMatch(provided, expected);

		// #then
		expect(result).toBe(false);
	});

	it("returns false when the provided token is empty", () => {
		// #given
		const provided = "";
		const expected = "a-strong-random-token";

		// #when
		const result = tokensMatch(provided, expected);

		// #then
		expect(result).toBe(false);
	});

	it("returns true when both tokens are empty", () => {
		// #given — defensive: never actually reachable in the route since an
		// unset CANARY_TOKEN returns 404 before comparison ever runs

		// #when
		const result = tokensMatch("", "");

		// #then
		expect(result).toBe(true);
	});
});
