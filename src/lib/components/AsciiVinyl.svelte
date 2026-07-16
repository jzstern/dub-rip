<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();

const SPOKE_ANGLES = [0, 60, 120, 180, 240, 300];
const REELS = [
	{ cx: 46, cy: 34 },
	{ cx: 114, cy: 34 },
];
</script>

<div class="reel-deck select-none" data-active={active} aria-hidden="true">
	<svg viewBox="0 0 160 80" width="180" height="90" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path
			class="tape"
			d="M46 62 L66 70 L94 70 L114 62"
			stroke-width="2"
			stroke-linecap="round"
		/>
		{#each REELS as reel (reel.cx)}
			<g class="reel" style="transform-origin: {reel.cx}px {reel.cy}px">
				<circle class="rim" cx={reel.cx} cy={reel.cy} r="27" stroke-width="2" />
				<circle class="tape-pack" cx={reel.cx} cy={reel.cy} r="20" stroke-width="6" />
				{#each SPOKE_ANGLES as angle (angle)}
					<line
						class="spoke"
						x1={reel.cx}
						y1={reel.cy - 6}
						x2={reel.cx}
						y2={reel.cy - 16}
						stroke-width="2.5"
						stroke-linecap="round"
						transform="rotate({angle} {reel.cx} {reel.cy})"
					/>
				{/each}
				<circle class="hub" cx={reel.cx} cy={reel.cy} r="5" />
			</g>
		{/each}
		<circle class="capstan" cx="80" cy="66" r="3.5" stroke-width="2" />
		<rect class="led" x="76" y="10" width="8" height="4" rx="1" />
	</svg>
</div>

<style>
	.reel-deck {
		color: hsl(var(--muted-foreground));
	}

	.rim,
	.capstan {
		stroke: currentColor;
		opacity: 0.55;
	}

	.tape-pack {
		stroke: currentColor;
		opacity: 0.3;
	}

	.spoke {
		stroke: currentColor;
		opacity: 0.7;
	}

	.hub {
		fill: currentColor;
		opacity: 0.6;
	}

	.tape {
		stroke: currentColor;
		opacity: 0.35;
	}

	.led {
		fill: hsl(var(--primary));
		animation: standby-breathe 4s ease-in-out infinite;
	}

	.reel {
		transform-box: view-box;
	}

	[data-active="true"] .reel {
		animation: reel-spin 1.6s linear infinite;
	}

	[data-active="true"] .tape,
	[data-active="true"] .tape-pack {
		stroke: hsl(var(--primary));
		opacity: 0.8;
	}

	[data-active="true"] .led {
		animation: none;
		opacity: 1;
	}

	@keyframes reel-spin {
		to {
			rotate: 360deg;
		}
	}

	@keyframes standby-breathe {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 0.7;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		[data-active="true"] .reel {
			animation: none;
		}
		.led {
			animation: none;
			opacity: 0.7;
		}
	}
</style>
