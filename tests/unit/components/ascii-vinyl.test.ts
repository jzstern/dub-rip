import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";

describe("AsciiVinyl (reel-to-reel deck)", () => {
	afterEach(() => {
		cleanup();
	});

	describe("rendering", () => {
		it("renders an SVG reel deck", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("svg")).toBeInTheDocument();
		});

		it("is decorative with no interactive controls", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector("button")).not.toBeInTheDocument();
			expect(container.querySelector(".reel-deck")).toHaveAttribute(
				"aria-hidden",
				"true",
			);
		});
	});

	describe("deck structure", () => {
		it("renders two reels", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelectorAll(".reel").length).toBe(2);
		});

		it("renders spokes on each reel", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelectorAll(".spoke").length).toBe(12);
		});

		it("renders the standby LED", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".led")).toBeInTheDocument();
		});

		it("renders the tape path between reels", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".tape")).toBeInTheDocument();
		});
	});

	describe("active state", () => {
		it("marks the deck active while downloading", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: true } });

			// #then
			expect(container.querySelector(".reel-deck")).toHaveAttribute(
				"data-active",
				"true",
			);
		});

		it("marks the deck idle when not downloading", () => {
			// #given / #when
			const { container } = render(AsciiVinyl, { props: { active: false } });

			// #then
			expect(container.querySelector(".reel-deck")).toHaveAttribute(
				"data-active",
				"false",
			);
		});
	});

	describe("styling", () => {
		it("disables text selection", () => {
			// #given / #when
			const { container } = render(AsciiVinyl);

			// #then
			expect(container.querySelector(".reel-deck")).toHaveClass("select-none");
		});
	});
});
