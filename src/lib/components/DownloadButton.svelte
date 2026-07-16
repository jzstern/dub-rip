<script lang="ts">
interface Props {
	loading: boolean;
	disabled: boolean;
	onClick: () => void;
}

let { loading, disabled, onClick }: Props = $props();
</script>

<div class="flex flex-col items-center gap-2">
	<button type="button" class="rec-button" onclick={onClick} {disabled}>
		{#if loading}
			<span class="rec-dot" aria-hidden="true"></span>
			<span class="font-mono text-sm font-bold tracking-[0.15em]">REC</span>
		{:else}
			<span class="font-mono text-sm font-bold tracking-[0.15em]">GET</span>
		{/if}
	</button>
	<span class="silkscreen">{loading ? "BUSY" : "PUSH"}</span>
</div>

<style>
	.rec-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 72px;
		height: 72px;
		border-radius: 9999px;
		background-color: hsl(var(--primary));
		color: hsl(var(--primary-foreground));
		box-shadow:
			0 0 0 4px hsl(var(--foreground) / 0.08),
			0 3px 0 hsl(18 100% 34%);
		transition:
			transform 100ms var(--ease-out),
			box-shadow 100ms var(--ease-out);
	}

	.rec-button:focus-visible {
		outline: 2px solid hsl(var(--ring));
		outline-offset: 4px;
	}

	.rec-button:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow:
			0 0 0 4px hsl(var(--foreground) / 0.08),
			0 1px 0 hsl(18 100% 34%);
	}

	.rec-button:disabled {
		opacity: 0.4;
	}

	.rec-dot {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background-color: hsl(var(--primary-foreground));
		animation: rec-blink 1s steps(1, end) infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.rec-button {
			transition: none;
		}

		.rec-dot {
			animation: none;
		}
	}

	@keyframes rec-blink {
		50% {
			opacity: 0.2;
		}
	}
</style>
