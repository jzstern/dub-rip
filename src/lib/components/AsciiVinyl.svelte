<script lang="ts">
let isPaused = $state(false);

function handleClick() {
	isPaused = !isPaused;
}
</script>

<button
	class="group relative flex h-28 w-28 items-center justify-center rounded-full border-none bg-transparent p-0 focus:outline-none"
	onclick={handleClick}
	aria-label={isPaused ? "Resume glow" : "Pause glow"}
>
	<span
		class="pointer-events-none absolute inset-[-30%] rounded-full blur-2xl transition-opacity duration-500 disc-aura {isPaused ? 'opacity-40' : 'opacity-90'}"
	></span>

	<span
		class="relative h-24 w-24 rounded-full transition-transform duration-500 disc-face group-hover:scale-105 {isPaused ? '' : 'disc-spin'}"
	>
		<span class="absolute inset-[34%] rounded-full disc-core"></span>
		<span class="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_8px_2px_rgba(255,255,255,0.7)]"></span>
		<span class="absolute left-[28%] top-[24%] h-5 w-8 -rotate-[40deg] rounded-full bg-white/25 blur-[2px]"></span>
	</span>
</button>

<style>
	.disc-face {
		background:
			radial-gradient(circle at 38% 30%, #f0abfc 0%, #a78bfa 42%, #4c1d95 100%);
		box-shadow:
			inset 0 0 24px -6px rgba(255, 255, 255, 0.6),
			inset 0 -10px 30px -10px rgba(76, 29, 149, 0.9),
			0 12px 40px -10px rgba(167, 139, 250, 0.7);
	}

	.disc-aura {
		background:
			radial-gradient(circle, rgba(167, 139, 250, 0.85) 0%, rgba(240, 171, 252, 0.45) 45%, transparent 70%);
		animation: disc-pulse 4.5s ease-in-out infinite;
	}

	.disc-core {
		background:
			radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(103, 232, 249, 0.55) 60%, rgba(103, 232, 249, 0) 100%);
	}

	.disc-spin {
		animation: disc-rotate 14s linear infinite;
	}

	@keyframes disc-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.75;
		}
		50% {
			transform: scale(1.12);
			opacity: 1;
		}
	}

	@keyframes disc-rotate {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.disc-aura,
		.disc-spin {
			animation: none;
		}
	}
</style>
