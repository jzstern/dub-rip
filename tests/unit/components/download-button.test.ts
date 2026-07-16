import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import DownloadButton from "$lib/components/DownloadButton.svelte";

describe("DownloadButton", () => {
	describe("rendering", () => {
		it("displays 'GET' text when not loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			expect(screen.getByText("GET")).toBeInTheDocument();
		});

		it("displays 'REC' text when loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			expect(screen.getByText("REC")).toBeInTheDocument();
		});

		it("shows blinking rec dot when loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			const { container } = render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			const dot = container.querySelector(".rec-dot");
			expect(dot).toBeInTheDocument();
		});

		it("does not show rec dot when not loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			const { container } = render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const dot = container.querySelector(".rec-dot");
			expect(dot).not.toBeInTheDocument();
		});
	});

	describe("interactions", () => {
		it("calls onClick when clicked", async () => {
			// #given
			const onClick = vi.fn();
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #when
			const button = screen.getByRole("button");
			await fireEvent.click(button);

			// #then
			expect(onClick).toHaveBeenCalledOnce();
		});

		it("button is disabled when disabled prop is true", async () => {
			// #given
			const onClick = vi.fn();
			render(DownloadButton, {
				props: { loading: false, disabled: true, onClick },
			});

			// #when
			const button = screen.getByRole("button");

			// #then
			expect(button).toBeDisabled();
		});
	});

	describe("disabled state", () => {
		it("is disabled when disabled prop is true", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: true, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toBeDisabled();
		});

		it("is enabled when disabled prop is false", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).not.toBeDisabled();
		});

		it("loading state does not automatically disable the button", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).not.toBeDisabled();
		});
	});

	describe("styling", () => {
		it("renders as a round hardware button", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toHaveClass("rec-button");
		});

		it("shows the silkscreen caption", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			expect(screen.getByText("PUSH")).toBeInTheDocument();
		});
	});
});
