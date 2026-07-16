import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";

describe("AsciiVinyl", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			return setTimeout(() => cb(performance.now()), 16) as unknown as number;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			clearTimeout(id);
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("rendering", () => {
		it("renders pre element with ASCII art", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const pre = container.querySelector("pre");
			expect(pre).toBeInTheDocument();
			expect(pre?.textContent).toBeTruthy();
		});

		it("is decorative with no interactive controls", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("button")).not.toBeInTheDocument();
			expect(container.querySelector("pre")).toHaveAttribute(
				"aria-hidden",
				"true",
			);
		});
	});

	describe("vinyl output structure", () => {
		it("generates vinyl with correct number of rows", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");
			const lines = pre?.textContent?.split("\n") || [];

			// #then
			expect(lines.length).toBe(35);
		});

		it("each row has consistent character count", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");
			const lines = pre?.textContent?.split("\n") || [];

			// #then
			const expectedLength = 35;
			for (const line of lines) {
				expect(line.length).toBe(expectedLength);
			}
		});

		it("contains spindle character at center", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre?.textContent).toContain("◉");
		});

		it("contains edge circle characters", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre?.textContent).toContain("○");
		});

		it("contains label characters", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre?.textContent).toContain("█");
			expect(pre?.textContent).toContain("▓");
		});
	});

	describe("active state", () => {
		it("applies the highlight effect when active", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: true } });
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("text-primary");
			expect(pre).toHaveClass("scale-105");
		});

		it("does not apply the highlight effect when inactive", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: false } });
			const pre = container.querySelector("pre");

			// #then
			expect(pre).not.toHaveClass("text-primary");
			expect(pre).not.toHaveClass("scale-105");
		});
	});

	describe("styling", () => {
		it("has font-mono class on pre element", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("font-mono");
		});

		it("has transition classes for smooth effects", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("transition-[transform,color]");
		});

		it("disables text selection", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("select-none");
		});
	});

	describe("animation lifecycle", () => {
		it("starts animation on mount", () => {
			// #given / #when
			render(AsciiVinyl);

			// #then
			expect(window.requestAnimationFrame).toHaveBeenCalled();
		});

		it("cleans up animation on unmount", () => {
			// #given
			const { unmount } = render(AsciiVinyl);

			// #when
			unmount();

			// #then
			expect(window.cancelAnimationFrame).toHaveBeenCalled();
		});
	});
});
