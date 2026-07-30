import { quintOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

interface SmoothCollapseParams {
	duration?: number;
	opacity?: boolean;
}

const DEFAULT_DURATION = 240;
const REDUCED_DURATION = 140;
const OPACITY_RAMP = 1.6;

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Grows and shrinks a block along its own height, padding, margin and border so
 * surrounding content glides into place instead of snapping. Under reduced
 * motion it degrades to a plain opacity cross-fade with no layout animation.
 */
export function smoothCollapse(
	node: Element,
	params: SmoothCollapseParams = {},
): TransitionConfig {
	const style = getComputedStyle(node);
	const parsedOpacity = Number.parseFloat(style.opacity);
	const targetOpacity = Number.isFinite(parsedOpacity) ? parsedOpacity : 1;

	if (prefersReducedMotion()) {
		return {
			duration: REDUCED_DURATION,
			css: (t) => `opacity: ${t * targetOpacity}`,
		};
	}

	const height = Number.parseFloat(style.height);
	const paddingTop = Number.parseFloat(style.paddingTop);
	const paddingBottom = Number.parseFloat(style.paddingBottom);
	const marginTop = Number.parseFloat(style.marginTop);
	const marginBottom = Number.parseFloat(style.marginBottom);
	const borderTop = Number.parseFloat(style.borderTopWidth);
	const borderBottom = Number.parseFloat(style.borderBottomWidth);

	const fadeContent = params.opacity ?? true;

	return {
		duration: params.duration ?? DEFAULT_DURATION,
		easing: quintOut,
		css: (t) => {
			const rules = [
				"overflow: hidden",
				`height: ${t * height}px`,
				`padding-top: ${t * paddingTop}px`,
				`padding-bottom: ${t * paddingBottom}px`,
				`margin-top: ${t * marginTop}px`,
				`margin-bottom: ${t * marginBottom}px`,
				`border-top-width: ${t * borderTop}px`,
				`border-bottom-width: ${t * borderBottom}px`,
			];
			if (fadeContent) {
				rules.push(`opacity: ${Math.min(1, t * OPACITY_RAMP) * targetOpacity}`);
			}
			return rules.join(";");
		},
	};
}
