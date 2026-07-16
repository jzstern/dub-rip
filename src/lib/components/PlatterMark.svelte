<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();
</script>

<svg
	aria-hidden="true"
	class="platter"
	class:spinning={active}
	width="88"
	height="88"
	viewBox="0 0 96 96"
	xmlns="http://www.w3.org/2000/svg"
>
	<circle cx="48" cy="48" r="45" class="rim" />
	<circle cx="48" cy="48" r="34" class="groove" />
	<circle cx="48" cy="48" r="24" class="groove" />
	<line x1="48" y1="14" x2="48" y2="24" class="index" />
	<circle cx="48" cy="48" r="9" class="hub" />
</svg>

<style>
	.platter {
		color: hsl(var(--foreground));
		transform-origin: center;
	}

	.rim {
		fill: hsl(var(--card));
		stroke: currentColor;
		stroke-width: 2;
	}

	.groove {
		fill: none;
		stroke: currentColor;
		stroke-width: 1;
		opacity: 0.25;
	}

	.index {
		stroke: currentColor;
		stroke-width: 1.5;
		opacity: 0.45;
	}

	.hub {
		fill: hsl(var(--primary));
	}

	.spinning {
		animation: platter-spin 1.8s linear infinite;
	}

	@keyframes platter-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinning {
			animation: none;
		}
	}
</style>
