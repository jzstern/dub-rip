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
	class="h-11 w-full rounded-sm border border-primary/40 bg-primary font-mono text-sm font-bold tracking-wide shadow-none transition-[background-color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-out)] hover:bg-primary/90 hover:shadow-[0_0_14px_hsl(var(--phosphor)/0.45)] focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-[0.98] motion-reduce:active:scale-100"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		./downloading
	{:else}
		<span class="mr-1 opacity-70">$</span> ./download
	{/if}
</Button>
