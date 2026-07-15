import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";

describe("AsciiVinyl", () => {
	afterEach(() => {
		cleanup();
	});

	describe("rendering", () => {
		it("renders the geometric record mark", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const svg = container.querySelector("svg");
			expect(svg).toBeInTheDocument();
			expect(svg?.querySelectorAll("circle").length).toBeGreaterThanOrEqual(4);
		});

		it("is decorative with no interactive controls", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("button")).not.toBeInTheDocument();
			expect(container.querySelector("svg")).toHaveAttribute(
				"aria-hidden",
				"true",
			);
		});
	});

	describe("active state", () => {
		it("applies the fast-spin state when active", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: true } });

			// #then
			expect(container.querySelector("g.spin")).toHaveClass("active");
		});

		it("does not apply the fast-spin state when inactive", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: false } });

			// #then
			expect(container.querySelector("g.spin")).not.toHaveClass("active");
		});
	});

	describe("styling", () => {
		it("disables text selection", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("svg")).toHaveClass("select-none");
		});

		it("rotates around the mark center", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const group = container.querySelector("g.spin") as SVGGElement;
			expect(group.style.transformOrigin).toBe("60px 60px");
		});
	});
});
