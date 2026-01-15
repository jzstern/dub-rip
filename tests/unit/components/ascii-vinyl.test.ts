import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
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
		it("renders a button element", () => {
			// #given / #when
			render(AsciiVinyl);

			// #then
			const button = screen.getByRole("button");
			expect(button).toBeInTheDocument();
		});

		it("renders pre element with ASCII art", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			const pre = container.querySelector("pre");
			expect(pre).toBeInTheDocument();
			expect(pre?.textContent).toBeTruthy();
		});

		it("displays aria-label for pause when playing", () => {
			// #given / #when
			render(AsciiVinyl);

			// #then
			const button = screen.getByRole("button");
			expect(button).toHaveAttribute("aria-label", "Pause animation");
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

	describe("user interactions", () => {
		it("toggles to paused state on click", async () => {
			// #given
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #when
			await fireEvent.click(button);

			// #then
			expect(button).toHaveAttribute("aria-label", "Play animation");
		});

		it("toggles back to playing state on second click", async () => {
			// #given
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #when
			await fireEvent.click(button);
			await fireEvent.click(button);

			// #then
			expect(button).toHaveAttribute("aria-label", "Pause animation");
		});

		it("responds to mouseenter event", async () => {
			// #given
			const { container } = render(AsciiVinyl);
			const button = screen.getByRole("button");
			const pre = container.querySelector("pre");

			// #when
			await fireEvent.mouseEnter(button);

			// #then
			expect(pre).toHaveClass("text-primary");
		});

		it("responds to mouseleave event", async () => {
			// #given
			const { container } = render(AsciiVinyl);
			const button = screen.getByRole("button");
			const pre = container.querySelector("pre");

			// #when
			await fireEvent.mouseEnter(button);
			await fireEvent.mouseLeave(button);

			// #then
			expect(pre).not.toHaveClass("text-primary");
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
			expect(pre).toHaveClass("transition-all");
		});

		it("applies scale effect on hover", async () => {
			// #given
			const { container } = render(AsciiVinyl);
			const button = screen.getByRole("button");
			const pre = container.querySelector("pre");

			// #when
			await fireEvent.mouseEnter(button);

			// #then
			expect(pre).toHaveClass("scale-105");
		});

		it("applies opacity when paused", async () => {
			// #given
			const { container } = render(AsciiVinyl);
			const button = screen.getByRole("button");
			const pre = container.querySelector("pre");

			// #when
			await fireEvent.click(button);

			// #then
			expect(pre).toHaveClass("opacity-60");
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

	describe("accessibility", () => {
		it("button is keyboard focusable", () => {
			// #given / #when
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #then
			expect(button.tabIndex).not.toBe(-1);
		});

		it("button has cursor-pointer class", () => {
			// #given / #when
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #then
			expect(button).toHaveClass("cursor-pointer");
		});

		it("toggles pause state with Enter key", async () => {
			// #given
			const user = userEvent.setup({
				advanceTimers: vi.advanceTimersByTime,
			});
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #when
			await button.focus();
			await user.keyboard("{Enter}");

			// #then
			expect(button).toHaveAttribute("aria-label", "Play animation");
		});

		it("toggles pause state with Space key", async () => {
			// #given
			const user = userEvent.setup({
				advanceTimers: vi.advanceTimersByTime,
			});
			render(AsciiVinyl);
			const button = screen.getByRole("button");

			// #when
			await button.focus();
			await user.keyboard(" ");

			// #then
			expect(button).toHaveAttribute("aria-label", "Play animation");
		});
	});
});
