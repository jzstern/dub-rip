import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";

function mockMatchMedia(reducedMotion: boolean): void {
	vi.stubGlobal(
		"matchMedia",
		vi.fn().mockImplementation((query: string) => ({
			matches: query.includes("prefers-reduced-motion") && reducedMotion,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
}

describe("AsciiVinyl", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			return setTimeout(() => cb(performance.now()), 16) as unknown as number;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			clearTimeout(id);
		});
		mockMatchMedia(false);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
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

		it("provides a screen-reader description", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const description = container.querySelector(".sr-only");
			expect(description?.textContent).toContain("vinyl record");
		});
	});

	describe("vinyl output structure", () => {
		it("generates the polar disc with 13 rows", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");
			const lines = pre?.textContent?.replace(/\n$/, "").split("\n") || [];

			// #then
			expect(lines.length).toBe(13);
		});

		it("each row has 27 columns", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");
			const lines = pre?.textContent?.replace(/\n$/, "").split("\n") || [];

			// #then
			for (const line of lines) {
				expect(line.length).toBe(27);
			}
		});

		it("renders the amber label as highlighted spans", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const labelSpans = container.querySelectorAll("pre .lbl");
			expect(labelSpans.length).toBeGreaterThan(0);
		});

		it("contains the spindle character at the center", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre?.textContent).toContain("·");
		});

		it("contains groove characters", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre?.textContent).toMatch(/[-~=]/);
		});
	});

	describe("state-driven appearance", () => {
		it("marks the idle state by default", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("vinyl--idle");
			expect(pre).not.toHaveClass("vinyl--active");
		});

		it("marks the ready state when a valid link is pasted", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, {
				props: { state: "ready" },
			});
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("vinyl--ready");
		});

		it("marks the active state while downloading", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, {
				props: { state: "active" },
			});
			const pre = container.querySelector("pre");

			// #then
			expect(pre).toHaveClass("vinyl--active");
			expect(pre).not.toHaveClass("vinyl--idle");
		});
	});

	describe("animation lifecycle", () => {
		it("spins continuously even when idle", () => {
			// #given / #when
			render(AsciiVinyl, { props: { state: "idle" } });

			// #then
			expect(window.requestAnimationFrame).toHaveBeenCalled();
		});

		it("cleans up the animation on unmount", () => {
			// #given
			const { unmount } = render(AsciiVinyl);

			// #when
			unmount();

			// #then
			expect(window.cancelAnimationFrame).toHaveBeenCalled();
		});
	});

	describe("reduced motion", () => {
		it("does not start the spin loop when the user prefers reduced motion", () => {
			// #given
			mockMatchMedia(true);

			// #when
			render(AsciiVinyl);

			// #then
			expect(window.requestAnimationFrame).not.toHaveBeenCalled();
		});

		it("still reflects the active state statically", () => {
			// #given
			mockMatchMedia(true);

			// #when
			const { container } = render(AsciiVinyl, {
				props: { state: "active" },
			});

			// #then
			expect(container.querySelector("pre")).toHaveClass("vinyl--active");
		});
	});
});
