import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";

describe("AsciiVinyl", () => {
	afterEach(() => {
		cleanup();
	});

	describe("rendering", () => {
		it("renders the luminous disc structure", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".disc-face")).toBeInTheDocument();
			expect(container.querySelector(".disc-aura")).toBeInTheDocument();
			expect(container.querySelector(".disc-core")).toBeInTheDocument();
		});

		it("is decorative with no interactive controls", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("button")).not.toBeInTheDocument();
			expect(
				container.querySelector('[aria-hidden="true"]'),
			).toBeInTheDocument();
		});
	});

	describe("active state", () => {
		it("applies the active effect when downloading", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: true } });

			// #then
			expect(container.querySelector(".disc--active")).toBeInTheDocument();
		});

		it("does not apply the active effect when idle", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: false } });

			// #then
			expect(container.querySelector(".disc--active")).not.toBeInTheDocument();
		});

		it("defaults to inactive when no prop is provided", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".disc--active")).not.toBeInTheDocument();
		});
	});

	describe("styling", () => {
		it("spins the disc face", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".disc-face")).toHaveClass("disc-spin");
		});
	});
});
