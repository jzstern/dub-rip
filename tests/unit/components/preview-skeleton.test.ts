import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";

describe("PreviewSkeleton", () => {
	describe("rendering", () => {
		it("renders a skeleton loading state with testid", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const skeleton = container.querySelector(
				'[data-testid="preview-skeleton"]',
			);
			expect(skeleton).toBeInTheDocument();
			expect(skeleton).toHaveClass("motion-safe:animate-pulse");
		});

		it("displays placeholder elements for artwork and two text lines", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const placeholders = container.querySelectorAll(".bg-muted");
			expect(placeholders.length).toBe(3);
		});

		it("matches the preview card geometry with a square artwork block", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const artwork = container.querySelector(".h-14.w-14");
			expect(artwork).toBeInTheDocument();
		});

		it("has correct layout structure", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const skeleton = container.querySelector(
				'[data-testid="preview-skeleton"]',
			);
			expect(skeleton).toHaveClass("flex", "items-center");
		});
	});
});
