<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();
</script>

<div class="flex items-center gap-2" class:active aria-hidden="true">
	<span class="led"></span>
	<svg class="reel" width="56" height="56" viewBox="0 0 56 56" fill="none">
		<circle
			cx="28"
			cy="28"
			r="26"
			fill="hsl(var(--background))"
			stroke="currentColor"
			stroke-opacity="0.3"
		/>
		<circle
			cx="28"
			cy="28"
			r="10"
			stroke="currentColor"
			stroke-opacity="0.7"
			stroke-width="1.5"
		/>
		<g
			stroke="currentColor"
			stroke-opacity="0.7"
			stroke-width="3"
			stroke-linecap="round"
		>
			<line x1="28" y1="13" x2="28" y2="18" />
			<line
				x1="28"
				y1="13"
				x2="28"
				y2="18"
				transform="rotate(120 28 28)"
			/>
			<line
				x1="28"
				y1="13"
				x2="28"
				y2="18"
				transform="rotate(240 28 28)"
			/>
		</g>
		<circle cx="28" cy="28" r="2.5" fill="currentColor" />
		<circle cx="41" cy="41" r="2" fill="#2563eb" />
	</svg>
</div>

<style>
	.reel {
		color: hsl(var(--foreground));
		animation: reel-spin 2.4s linear infinite;
		animation-play-state: paused;
	}

	.active .reel {
		animation-play-state: running;
	}

	.led {
		width: 4px;
		height: 4px;
		border-radius: 9999px;
		background-color: hsl(var(--foreground) / 0.15);
	}

	.active .led {
		background-color: hsl(var(--led));
		animation: led-blink 1s steps(1, end) infinite;
	}

	@keyframes reel-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes led-blink {
		50% {
			opacity: 0.25;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.reel,
		.active .led {
			animation: none;
		}
	}
</style>
