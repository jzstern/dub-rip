<script lang="ts">
const VINYL_CHARS = ["─", "━", "═", "~", "≈"];
const GROOVE_CHARS = ["╌", "┄", "╴", "╶"];
const LABEL_CHAR = "█";
const SPINDLE_CHAR = "◉";

interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();

let rotation = $state(0);

const SIZE = 35;
const CENTER = Math.floor(SIZE / 2);
const LABEL_RADIUS = 7.5;
const SPINDLE_RADIUS = 2.4;
const ASPECT_RATIO = 1.6;

interface Segment {
	text: string;
	gold: boolean;
}

function generateVinyl(): Segment[][] {
	const lines: Segment[][] = [];

	for (let y = 0; y < SIZE; y++) {
		const segments: Segment[] = [];
		for (let x = 0; x < SIZE; x++) {
			const dx = x - CENTER;
			const dy = (y - CENTER) * ASPECT_RATIO;
			const distance = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx) + rotation;

			let char: string;
			let gold = false;
			if (distance < SPINDLE_RADIUS) {
				char = SPINDLE_CHAR;
			} else if (distance < LABEL_RADIUS) {
				const labelPattern = Math.floor((angle * 2 + distance) % 2);
				char = labelPattern === 0 ? LABEL_CHAR : "▓";
				gold = true;
			} else if (distance <= CENTER - 1) {
				const grooveIndex = Math.floor(distance) % 2;
				const charSet = grooveIndex === 0 ? VINYL_CHARS : GROOVE_CHARS;
				const rawIndex = Math.floor(
					((angle + Math.PI) / (Math.PI * 2)) * charSet.length + distance * 0.5,
				);
				const angleIndex =
					((rawIndex % charSet.length) + charSet.length) % charSet.length;
				char = charSet[angleIndex];
			} else if (distance <= CENTER) {
				char = "○";
			} else {
				char = " ";
			}

			const last = segments[segments.length - 1];
			if (last && last.gold === gold) {
				last.text += char;
			} else {
				segments.push({ text: char, gold });
			}
		}
		lines.push(segments);
	}

	return lines;
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
	if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
	animationFrame = requestAnimationFrame(animate);
	return () => cancelAnimationFrame(animationFrame);
});

let vinylLines = $derived(generateVinyl());
</script>

<pre
	aria-hidden="true"
	class="font-mono text-[0.53rem] leading-[0.45rem] {active ? 'text-primary scale-105' : 'text-foreground/80'} transition-[transform,color] duration-300 ease-out select-none sm:text-[0.64rem] sm:leading-[0.54rem]"
>{#each vinylLines as line, i}{#if i > 0}{"\n"}{/if}{#each line as segment}{#if segment.gold}<span class="label-gold">{segment.text}</span>{:else}{segment.text}{/if}{/each}{/each}</pre>

<style>
	.label-gold {
		color: hsl(var(--gold));
	}
</style>
