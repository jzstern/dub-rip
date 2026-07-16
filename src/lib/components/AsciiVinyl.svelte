<script lang="ts">
const VINYL_CHARS = ["─", "━", "═", "~", "≈"];
const GROOVE_CHARS = ["╌", "┄", "╴", "╶"];
const LABEL_CHAR = "█";
const SPINDLE_CHAR = "◉";

interface Props {
	active?: boolean;
}

interface Run {
	text: string;
	label: boolean;
}

let { active = false }: Props = $props();

let rotation = $state(0);

const SIZE = 35;
const CENTER = Math.floor(SIZE / 2);
const LABEL_RADIUS = 6.5;
const SPINDLE_RADIUS = 1.7;
const ASPECT_RATIO = 1.6;

function charAt(x: number, y: number): { char: string; label: boolean } {
	const dx = x - CENTER;
	const dy = (y - CENTER) * ASPECT_RATIO;
	const distance = Math.sqrt(dx * dx + dy * dy);
	const angle = Math.atan2(dy, dx) + rotation;

	if (distance < SPINDLE_RADIUS) {
		return { char: SPINDLE_CHAR, label: true };
	}
	if (distance < LABEL_RADIUS) {
		const labelPattern = Math.floor((angle * 2 + distance) % 2);
		return { char: labelPattern === 0 ? LABEL_CHAR : "▓", label: true };
	}
	if (distance <= CENTER - 1) {
		const grooveIndex = Math.floor(distance) % 2;
		const charSet = grooveIndex === 0 ? VINYL_CHARS : GROOVE_CHARS;
		const rawIndex = Math.floor(
			((angle + Math.PI) / (Math.PI * 2)) * charSet.length + distance * 0.5,
		);
		const angleIndex =
			((rawIndex % charSet.length) + charSet.length) % charSet.length;
		return { char: charSet[angleIndex], label: false };
	}
	if (distance <= CENTER) {
		return { char: "○", label: false };
	}
	return { char: " ", label: false };
}

function generateVinyl(): Run[][] {
	const lines: Run[][] = [];

	for (let y = 0; y < SIZE; y++) {
		const runs: Run[] = [];
		for (let x = 0; x < SIZE; x++) {
			const { char, label } = charAt(x, y);
			const last = runs[runs.length - 1];
			if (last && last.label === label) {
				last.text += char;
			} else {
				runs.push({ text: char, label });
			}
		}
		lines.push(runs);
	}

	return lines;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

let animationFrame: number;
let lastTime: number | null = null;

function animate(time: number) {
	if (lastTime !== null) {
		const delta = time - lastTime;
		const speed = active ? 0.003 : 0.001;
		rotation += delta * speed;
	}
	lastTime = time;
	animationFrame = requestAnimationFrame(animate);
}

$effect(() => {
	if (prefersReducedMotion()) return;
	animationFrame = requestAnimationFrame(animate);
	return () => cancelAnimationFrame(animationFrame);
});

let vinylLines = $derived(generateVinyl());
</script>

<pre
	aria-hidden="true"
	class="ascii-vinyl font-mono text-[0.68rem] leading-[0.58rem] {active ? 'text-primary scale-105 is-active' : 'text-foreground/80'} select-none sm:text-[0.9rem] sm:leading-[0.76rem]"
>{#each vinylLines as runs, i}{#if i > 0}{"\n"}{/if}{#each runs as run}{#if run.label}<span class="label">{run.text}</span>{:else}{run.text}{/if}{/each}{/each}</pre>

<style>
	.ascii-vinyl {
		transition:
			transform 300ms var(--ease-out-strong),
			color 300ms ease;
		animation: vinyl-in 300ms var(--ease-out-strong) both;
	}

	.label {
		color: hsl(var(--accent));
		transition: color 300ms ease;
	}

	.is-active .label {
		color: color-mix(in oklab, hsl(var(--accent)), white 20%);
	}

	@keyframes vinyl-in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ascii-vinyl {
			animation: none;
			transition: color 300ms ease;
		}
	}
</style>
