<script lang="ts">
import { Loader2 } from "lucide-svelte";
import { Button } from "$lib/components/ui/button";

interface Props {
	loading: boolean;
	disabled: boolean;
	onClick: () => void;
}

let { loading, disabled, onClick }: Props = $props();
</script>

<Button
	onclick={onClick}
	disabled={disabled}
	class="print-btn h-11 w-full rounded-none font-mono text-sm font-bold uppercase tracking-[0.2em] shadow-none transition-transform hover:bg-primary"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Printing
	{:else}
		[ Print MP3 ]
	{/if}
</Button>

<style>
	:global(.print-btn) {
		transition-duration: 160ms;
		transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
	}

	:global(.print-btn:active:not(:disabled)) {
		transform: scale(0.98);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.print-btn:active:not(:disabled)) {
			transform: none;
		}
	}
</style>
