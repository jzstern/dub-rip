<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();

let rotation = $state(0);
let isHovering = $state(false);
let isPaused = $state(false);
let reduceMotion = $state(false);

let animationFrame: number;
let lastTime: number | null = null;
let currentSpeed = 0;

let targetSpeed = $derived(
	isPaused && !active ? 0 : active ? 0.18 : isHovering ? 0.12 : 0.045,
);

function animate(time: number) {
	if (lastTime !== null) {
		const delta = time - lastTime;
		currentSpeed += (targetSpeed - currentSpeed) * Math.min(1, delta / 300);
		rotation = (rotation + delta * currentSpeed) % 360;
	}
	lastTime = time;
	animationFrame = requestAnimationFrame(animate);
}

$effect(() => {
	const query = window.matchMedia("(prefers-reduced-motion: reduce)");
	reduceMotion = query.matches;
	const onChange = (event: MediaQueryListEvent) => {
		reduceMotion = event.matches;
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
});

$effect(() => {
	if (reduceMotion) {
		lastTime = null;
		return;
	}
	animationFrame = requestAnimationFrame(animate);
	return () => {
		cancelAnimationFrame(animationFrame);
		lastTime = null;
	};
});

function togglePause() {
	isPaused = !isPaused;
}

function handleHover(hovering: boolean) {
	isHovering =
		hovering && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

const spokes = [0, 60, 120, 180, 240, 300];
</script>

<button
	type="button"
	class="group cursor-pointer border-none bg-transparent p-0 focus-visible:outline-none"
	onmouseenter={() => handleHover(true)}
	onmouseleave={() => handleHover(false)}
	onclick={togglePause}
	aria-label={isPaused ? "Play reels" : "Pause reels"}
>
	<svg
		width="232"
		height="116"
		viewBox="0 0 232 116"
		fill="none"
		role="img"
		aria-hidden="true"
		class="select-none drop-shadow-[0_6px_14px_hsl(var(--vignette)/0.35)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none {isHovering
			? 'scale-[1.03]'
			: ''} {isPaused && !active ? 'opacity-70' : ''}"
	>
		<defs>
			<linearGradient id="reelBody" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="hsl(var(--reel))" stop-opacity="0.95" />
				<stop offset="1" stop-color="hsl(var(--reel))" stop-opacity="0.78" />
			</linearGradient>
		</defs>

		<line
			x1="62"
			y1="42"
			x2="170"
			y2="42"
			stroke="hsl(var(--reel))"
			stroke-width="11"
			stroke-linecap="round"
			opacity="0.85"
		/>

		{#each [62, 170] as cx (cx)}
			<circle {cx} cy="58" r="32" fill="url(#reelBody)" />
			<circle
				{cx}
				cy="58"
				r="32"
				fill="none"
				stroke="hsl(var(--primary))"
				stroke-width="1.5"
				opacity="0.65"
			/>
			<g transform="rotate({cx === 62 ? rotation : -rotation} {cx} 58)">
				{#each spokes as angle (angle)}
					<rect
						x={cx - 2.5}
						y="28"
						width="5"
						height="20"
						rx="2.5"
						fill="hsl(var(--reel-spoke))"
						transform="rotate({angle} {cx} 58)"
					/>
				{/each}
			</g>
			<circle {cx} cy="58" r="9" fill="hsl(var(--reel-spoke))" />
			<circle {cx} cy="58" r="3.5" fill="hsl(var(--primary))" />
		{/each}
	</svg>
</button>
