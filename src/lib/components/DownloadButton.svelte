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
	class="h-11 w-full border border-chrome-cyan/40 bg-gradient-to-r from-chrome-cyan to-chrome-magenta font-display text-sm font-bold uppercase tracking-[0.2em] text-background shadow-[0_0_20px_-4px_hsl(var(--chrome-cyan)/0.7)] transition-all hover:brightness-110 hover:shadow-[0_0_28px_-2px_hsl(var(--chrome-magenta)/0.7)]"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
