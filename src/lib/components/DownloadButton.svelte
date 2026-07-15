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

<div class="group relative">
	<div
		class="pointer-events-none absolute inset-0 rounded-md opacity-0 shadow-[0_0_28px_-2px_hsl(var(--chrome-magenta)/0.7)] transition-opacity duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none {disabled ? '' : 'group-hover:opacity-100'}"
	></div>
	<Button
		onclick={onClick}
		disabled={disabled}
		class="relative h-11 w-full border border-chrome-cyan/40 bg-gradient-to-r from-chrome-cyan to-chrome-magenta font-display text-sm font-bold uppercase tracking-[0.2em] text-background shadow-[0_0_20px_-4px_hsl(var(--chrome-cyan)/0.7)] transition-transform duration-150 ease-[var(--ease-out-strong)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
	>
		{#if loading}
			<Loader2 class="mr-2 h-4 w-4 animate-spin" />
			Downloading
		{:else}
			Download
		{/if}
	</Button>
</div>
