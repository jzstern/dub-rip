<script lang="ts">
const VINYL_CHARS = ["─", "━", "═", "~", "≈"];
const GROOVE_CHARS = ["╌", "┄", "╴", "╶"];
const LABEL_CHAR = "█";
const SPINDLE_CHAR = "◉";

let rotation = $state(0);
let isHovering = $state(false);
let isPaused = $state(false);

const SIZE = 35;
const CENTER = Math.floor(SIZE / 2);
const LABEL_RADIUS = 6.5;
const SPINDLE_RADIUS = 1.7;
const ASPECT_RATIO = 1.6;

function generateVinyl(): string[] {
	const lines: string[] = [];

	for (let y = 0; y < SIZE; y++) {
		let line = "";
		for (let x = 0; x < SIZE; x++) {
			const dx = x - CENTER;
			const dy = (y - CENTER) * ASPECT_RATIO;
			const distance = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx) + rotation;

			if (distance < SPINDLE_RADIUS) {
				line += SPINDLE_CHAR;
			} else if (distance < LABEL_RADIUS) {
				const labelPattern = Math.floor((angle * 2 + distance) % 2);
				line += labelPattern === 0 ? LABEL_CHAR : "▓";
			} else if (distance <= CENTER - 1) {
				const grooveIndex = Math.floor(distance) % 2;
				const charSet = grooveIndex === 0 ? VINYL_CHARS : GROOVE_CHARS;
				const rawIndex = Math.floor(
					((angle + Math.PI) / (Math.PI * 2)) * charSet.length + distance * 0.5,
				);
				const angleIndex =
					((rawIndex % charSet.length) + charSet.length) % charSet.length;
				line += charSet[angleIndex];
			} else if (distance <= CENTER) {
				line += "○";
			} else {
				line += " ";
			}
		}
		lines.push(line);
	}

	return lines;
}

let animationFrame: number;
let lastTime: number | null = null;

function animate(time: number) {
	if (lastTime !== null) {
		const delta = time - lastTime;
		const speed = isHovering ? 0.003 : 0.001;
		rotation += delta * speed;
	}
	lastTime = time;
	animationFrame = requestAnimationFrame(animate);
}

$effect(() => {
	if (isPaused) {
		lastTime = null;
		return;
	}
	animationFrame = requestAnimationFrame(animate);
	return () => cancelAnimationFrame(animationFrame);
});

let vinylLines = $derived(generateVinyl());

function handleClick() {
	isPaused = !isPaused;
}
</script>

<button
	class="group cursor-pointer border-none bg-transparent p-0 focus:outline-none"
	onmouseenter={() => isHovering = true}
	onmouseleave={() => isHovering = false}
	onclick={handleClick}
	aria-label={isPaused ? "Play animation" : "Pause animation"}
>
	<pre
		class="font-mono text-[0.53rem] leading-[0.45rem] text-muted-foreground transition-all duration-300 select-none sm:text-[0.64rem] sm:leading-[0.54rem] {isHovering ? 'text-primary scale-105' : ''} {isPaused ? 'opacity-60' : ''}"
	>{vinylLines.join("\n")}</pre>
</button>
