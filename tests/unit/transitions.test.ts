import { afterEach, describe, expect, it, vi } from "vitest";
import { smoothCollapse } from "$lib/transitions";

function makeNode(styles: Record<string, string> = {}): HTMLElement {
	const node = document.createElement("div");
	for (const [prop, value] of Object.entries(styles)) {
		node.style.setProperty(prop, value);
	}
	document.body.appendChild(node);
	return node;
}

function mockReducedMotion(matches: boolean): void {
	vi.stubGlobal(
		"matchMedia",
		vi.fn().mockReturnValue({
			matches,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}),
	);
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("smoothCollapse()", () => {
	describe("opacity target", () => {
		it("fades to full opacity when the element has no explicit opacity", () => {
			// #given
			const node = makeNode();

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.css?.(1, 0)).toContain("opacity: 1");
		});

		it("keeps a deliberately transparent element transparent", () => {
			// #given
			const node = makeNode({ opacity: "0" });

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.css?.(1, 0)).toContain("opacity: 0");
		});

		it("respects a partial opacity as the fade ceiling", () => {
			// #given
			const node = makeNode({ opacity: "0.5" });

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.css?.(1, 0)).toContain("opacity: 0.5");
		});

		it("falls back to full opacity when the computed value is unparseable", () => {
			// #given
			const node = makeNode();
			vi.spyOn(window, "getComputedStyle").mockReturnValue({
				opacity: "",
				height: "10px",
				paddingTop: "0px",
				paddingBottom: "0px",
				marginTop: "0px",
				marginBottom: "0px",
				borderTopWidth: "0px",
				borderBottomWidth: "0px",
			} as unknown as CSSStyleDeclaration);

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.css?.(1, 0)).toContain("opacity: 1");
		});

		it("omits opacity entirely when the caller opts out", () => {
			// #given
			const node = makeNode();

			// #when
			const config = smoothCollapse(node, { opacity: false });

			// #then
			expect(config.css?.(1, 0)).not.toContain("opacity");
		});
	});

	describe("layout collapse", () => {
		it("collapses geometry to zero at the start of the transition", () => {
			// #given
			const node = makeNode();
			vi.spyOn(window, "getComputedStyle").mockReturnValue({
				opacity: "1",
				height: "40px",
				paddingTop: "8px",
				paddingBottom: "8px",
				marginTop: "14px",
				marginBottom: "0px",
				borderTopWidth: "1px",
				borderBottomWidth: "1px",
			} as unknown as CSSStyleDeclaration);

			// #when
			const css = smoothCollapse(node).css?.(0, 1) ?? "";

			// #then
			expect(css).toContain("height: 0px");
		});

		it("restores full geometry at the end of the transition", () => {
			// #given
			const node = makeNode();
			vi.spyOn(window, "getComputedStyle").mockReturnValue({
				opacity: "1",
				height: "40px",
				paddingTop: "8px",
				paddingBottom: "8px",
				marginTop: "14px",
				marginBottom: "0px",
				borderTopWidth: "1px",
				borderBottomWidth: "1px",
			} as unknown as CSSStyleDeclaration);

			// #when
			const css = smoothCollapse(node).css?.(1, 0) ?? "";

			// #then
			expect(css).toContain("height: 40px");
		});

		it("animates the outer margin so surrounding spacing collapses too", () => {
			// #given
			const node = makeNode();
			vi.spyOn(window, "getComputedStyle").mockReturnValue({
				opacity: "1",
				height: "40px",
				paddingTop: "0px",
				paddingBottom: "0px",
				marginTop: "14px",
				marginBottom: "0px",
				borderTopWidth: "0px",
				borderBottomWidth: "0px",
			} as unknown as CSSStyleDeclaration);

			// #when
			const css = smoothCollapse(node).css?.(0.5, 0.5) ?? "";

			// #then
			expect(css).toContain("margin-top: 7px");
		});

		it("hides overflow so clipped content never spills during the collapse", () => {
			// #given
			const node = makeNode();

			// #when
			const css = smoothCollapse(node).css?.(0.5, 0.5) ?? "";

			// #then
			expect(css).toContain("overflow: hidden");
		});
	});

	describe("reduced motion", () => {
		it("skips layout animation when reduced motion is requested", () => {
			// #given
			mockReducedMotion(true);
			const node = makeNode();

			// #when
			const css = smoothCollapse(node).css?.(0.5, 0.5) ?? "";

			// #then
			expect(css).not.toContain("height");
		});

		it("still cross-fades opacity when reduced motion is requested", () => {
			// #given
			mockReducedMotion(true);
			const node = makeNode();

			// #when
			const css = smoothCollapse(node).css?.(1, 0) ?? "";

			// #then
			expect(css).toContain("opacity: 1");
		});

		it("uses a shorter duration when reduced motion is requested", () => {
			// #given
			mockReducedMotion(true);
			const node = makeNode();

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.duration).toBe(140);
		});
	});

	describe("duration", () => {
		it("defaults to the house transition duration", () => {
			// #given
			mockReducedMotion(false);
			const node = makeNode();

			// #when
			const config = smoothCollapse(node);

			// #then
			expect(config.duration).toBe(240);
		});

		it("honors a caller-supplied duration", () => {
			// #given
			mockReducedMotion(false);
			const node = makeNode();

			// #when
			const config = smoothCollapse(node, { duration: 400 });

			// #then
			expect(config.duration).toBe(400);
		});
	});
});
