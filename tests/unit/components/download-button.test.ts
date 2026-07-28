import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import DownloadButton from "$lib/components/DownloadButton.svelte";

describe("DownloadButton", () => {
	describe("rendering", () => {
		it("displays 'DOWNLOAD' text when not loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			expect(screen.getByText("DOWNLOAD")).toBeInTheDocument();
		});

		it("displays 'DOWNLOADING…' text when loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			expect(screen.getByText("DOWNLOADING…")).toBeInTheDocument();
		});

		it("shows the pulsing working state when loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			expect(screen.getByTestId("download-working")).toHaveClass(
				"motion-safe:animate-pulse",
			);
		});

		it("does not show the working state when not loading", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			expect(screen.queryByTestId("download-working")).not.toBeInTheDocument();
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

		it("disables the button while loading to prevent double submits", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: true, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toBeDisabled();
		});
	});

	describe("styling", () => {
		it("has full width class", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toHaveClass("w-full");
		});

		it("has proper height class", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toHaveClass("h-11");
		});

		it("has press feedback on active state", () => {
			// #given
			const onClick = vi.fn();

			// #when
			render(DownloadButton, {
				props: { loading: false, disabled: false, onClick },
			});

			// #then
			const button = screen.getByRole("button");
			expect(button).toHaveClass("active:scale-[0.98]");
		});
	});
});
