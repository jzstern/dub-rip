<script lang="ts">
let paused = $state(false);

function toggle() {
	paused = !paused;
}
</script>

<button
	type="button"
	class="group relative block cursor-pointer border-none bg-transparent p-0 focus:outline-none"
	onclick={toggle}
	aria-label={paused ? "Play animation" : "Pause animation"}
>
	<svg
		viewBox="0 0 120 120"
		class="h-28 w-28 select-none text-foreground transition-transform duration-300 group-hover:scale-105"
		role="img"
		aria-hidden="true"
	>
		<g class="spin" class:paused style:transform-origin="60px 60px">
			<circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="4" />
			<circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="2" />
			<circle cx="60" cy="60" r="36" fill="none" stroke="currentColor" stroke-width="2" />
			<circle cx="60" cy="60" r="22" fill="hsl(var(--accent))" />
			<rect x="58" y="2" width="4" height="20" fill="hsl(var(--accent))" />
			<circle cx="60" cy="60" r="4" fill="hsl(var(--background))" />
		</g>
	</svg>
</button>

<style>
	.spin {
		animation: spin 5s linear infinite;
	}
	.group:hover .spin {
		animation-duration: 1.8s;
	}
	.spin.paused {
		animation-play-state: paused;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
