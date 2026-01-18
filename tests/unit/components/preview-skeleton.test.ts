import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";

describe("PreviewSkeleton", () => {
	describe("rendering", () => {
		it("renders a skeleton loading state", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const skeleton = container.querySelector(".animate-pulse");
			expect(skeleton).toBeInTheDocument();
		});

		it("displays placeholder elements for thumbnail and text", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const placeholders = container.querySelectorAll(".bg-muted");
			expect(placeholders.length).toBeGreaterThanOrEqual(3);
		});

		it("has correct layout structure", () => {
			// #given / #when
			const { container } = render(PreviewSkeleton);

			// #then
			const flexContainer = container.querySelector(".flex.items-center.gap-3");
			expect(flexContainer).toBeInTheDocument();
		});
	});
});
