<script lang="ts">
import { untrack } from "svelte";

type VinylState = "idle" | "ready" | "active";

interface Props {
	state?: VinylState;
}

let { state: vinylState = "idle" }: Props = $props();

const ROWS = 13;
const COLS = 27;
const RADIUS = 11.4;
const GROOVES = ["-", "~", "="];
const SHIMMER = ["-", "~", "=", "~"];
const RIM = ["o", "0", "O"];

const REVOLUTION = Math.PI * 2;
const SPEEDS: Record<VinylState, number> = {
	idle: 0.15 * REVOLUTION,
	ready: 0.225 * REVOLUTION,
	active: 0.45 * REVOLUTION,
};
const FRAME_MS = 120;
const VELOCITY_SMOOTHING_MS = 250;

interface Segment {
	text: string;
	label: boolean;
}

let renderedPhase = $state(0);

function renderDisc(phase: number, shimmering: boolean): Segment[] {
	const cy = (ROWS - 1) / 2;
	const cx = (COLS - 1) / 2;
	const grooveSet = shimmering ? SHIMMER : GROOVES;
	const segments: Segment[] = [];
	let text = "";
	let label = false;

	const push = (ch: string, isLabel: boolean): void => {
		if (isLabel !== label && text) {
			segments.push({ text, label });
			text = "";
		}
		label = isLabel;
		text += ch;
	};

	for (let y = 0; y < ROWS; y++) {
		for (let x = 0; x < COLS; x++) {
			const nx = x - cx;
			const ny = (y - cy) * 2.05;
			const r = Math.hypot(nx, ny);
			const a = Math.atan2(ny, nx) + phase;

			if (r <= 1.0) {
				push("·", true);
			} else if (r <= 3.5) {
				push(Math.floor(a / 0.9 + 64) % 2 === 0 ? "@" : "#", true);
			} else if (r <= RADIUS - 1.6) {
				const ring = Math.floor(r);
				const seg = Math.floor(a / 0.5 + 128);
				push(grooveSet[(seg + ring) % grooveSet.length], false);
			} else if (r <= RADIUS - 0.5) {
				const seg = Math.floor(a / 0.5 + 128);
				push(RIM[seg % RIM.length], false);
			} else if (r <= RADIUS + 0.15) {
				push(".", false);
			} else {
				push(" ", false);
			}
		}
		push("\n", false);
	}
	if (text) segments.push({ text, label });
	return segments;
}

let frame = $derived(renderDisc(renderedPhase, vinylState === "active"));

let reducedMotion = $state(false);

$effect(() => {
	if (typeof window.matchMedia !== "function") return;
	const query = window.matchMedia("(prefers-reduced-motion: reduce)");
	reducedMotion = query.matches;
	const onChange = (event: MediaQueryListEvent): void => {
		reducedMotion = event.matches;
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
});

let onScreen = $state(true);
let discEl = $state<HTMLPreElement | null>(null);

$effect(() => {
	if (!discEl || typeof IntersectionObserver !== "function") return;
	const observer = new IntersectionObserver((entries) => {
		onScreen = entries[entries.length - 1].isIntersecting;
	});
	observer.observe(discEl);
	return () => observer.disconnect();
});

let phase = 0;
let velocity = SPEEDS[untrack(() => vinylState)];

$effect(() => {
	if (reducedMotion || !onScreen) return;

	let rafId = 0;
	let lastTime: number | null = null;
	let sinceRender = FRAME_MS;

	const tick = (now: number): void => {
		if (lastTime !== null) {
			const delta = now - lastTime;
			const target = SPEEDS[vinylState];
			velocity +=
				(target - velocity) * (1 - Math.exp(-delta / VELOCITY_SMOOTHING_MS));
			phase += (velocity * delta) / 1000;
			sinceRender += delta;
			if (sinceRender >= FRAME_MS) {
				sinceRender = 0;
				renderedPhase = phase;
			}
		}
		lastTime = now;
		rafId = requestAnimationFrame(tick);
	};

	rafId = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(rafId);
});
</script>

<pre
	bind:this={discEl}
	aria-hidden="true"
	class="vinyl text-center font-mono text-muted-foreground select-none"
	class:vinyl--idle={vinylState === "idle"}
	class:vinyl--ready={vinylState === "ready"}
	class:vinyl--active={vinylState === "active"}
>{#each frame as segment, i (i)}{#if segment.label}<span class="lbl">{segment.text}</span>{:else}{segment.text}{/if}{/each}</pre>
<p class="sr-only">
	An ASCII drawing of a vinyl record with an amber center label. It spins
	continuously, speeding up while a download is in progress.
</p>

<style>
	.vinyl {
		font-size: clamp(12px, 2.9vw, 13px);
		line-height: 1.12;
		letter-spacing: 0.06em;
	}

	.lbl {
		color: hsl(var(--primary) / 0.7);
		transition: color 250ms var(--ease-out-strong);
	}

	.vinyl--ready .lbl {
		color: hsl(var(--primary));
	}

	.vinyl--active .lbl {
		color: hsl(var(--amber-hot));
	}

	@media (prefers-reduced-motion: reduce) {
		.lbl {
			transition: none;
		}
	}
</style>
