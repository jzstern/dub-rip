<script lang="ts">
interface Props {
	active?: boolean;
}

let { active = false }: Props = $props();
</script>

<div
	class="relative flex h-28 w-28 items-center justify-center"
	class:disc--active={active}
	aria-hidden="true"
>
	<span class="disc-aura pointer-events-none absolute inset-[-30%] rounded-full blur-2xl"></span>

	<span class="disc-face disc-spin relative h-24 w-24 rounded-full">
		<span class="disc-core absolute inset-[34%] rounded-full"></span>
		<span class="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_8px_2px_rgba(255,255,255,0.7)]"></span>
		<span class="absolute left-[28%] top-[24%] h-5 w-8 -rotate-[40deg] rounded-full bg-white/25 blur-[2px]"></span>
	</span>
</div>

<style>
	.disc-face {
		background: radial-gradient(circle at 38% 30%, #f0abfc 0%, #a78bfa 42%, #4c1d95 100%);
		box-shadow:
			inset 0 0 24px -6px rgba(255, 255, 255, 0.6),
			inset 0 -10px 30px -10px rgba(76, 29, 149, 0.9),
			0 12px 40px -10px rgba(167, 139, 250, 0.7);
	}

	.disc-aura {
		background: radial-gradient(
			circle,
			rgba(167, 139, 250, 0.85) 0%,
			rgba(240, 171, 252, 0.45) 45%,
			transparent 70%
		);
		--aura-min: 0.5;
		--aura-max: 0.85;
		opacity: var(--aura-min);
		animation: disc-pulse 4.5s cubic-bezier(0.37, 0, 0.63, 1) infinite;
	}

	.disc--active .disc-aura {
		--aura-min: 0.8;
		--aura-max: 1;
		animation-duration: 1.8s;
	}

	.disc-core {
		background: radial-gradient(
			circle,
			rgba(255, 255, 255, 0.95) 0%,
			rgba(103, 232, 249, 0.55) 60%,
			rgba(103, 232, 249, 0) 100%
		);
	}

	.disc-spin {
		animation: disc-rotate 14s linear infinite;
	}

	.disc--active .disc-spin {
		animation-duration: 4s;
	}

	@keyframes disc-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: var(--aura-min);
		}
		50% {
			transform: scale(1.12);
			opacity: var(--aura-max);
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

		.disc--active .disc-aura {
			opacity: var(--aura-max);
		}
	}
</style>
