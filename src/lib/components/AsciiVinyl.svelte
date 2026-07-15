<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();
</script>

<svg
	viewBox="0 0 120 120"
	class="h-28 w-28 select-none text-foreground"
	aria-hidden="true"
>
	<g class="spin" class:active style:transform-origin="60px 60px">
		<circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="4" />
		<circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="2" />
		<circle cx="60" cy="60" r="36" fill="none" stroke="currentColor" stroke-width="2" />
		<circle cx="60" cy="60" r="22" fill="hsl(var(--accent))" />
		<rect x="58" y="2" width="4" height="20" fill="hsl(var(--accent))" />
		<circle cx="60" cy="60" r="4" fill="hsl(var(--background))" />
	</g>
</svg>

<style>
	.spin.active {
		animation: spin 1.4s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin.active {
			animation: none;
		}
	}
</style>
