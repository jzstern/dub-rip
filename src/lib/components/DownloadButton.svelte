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
	class="h-11 w-full rounded-sm bg-primary font-mono text-xs font-bold uppercase tracking-[0.25em] text-primary-foreground shadow-none transition-[transform,color] duration-150 ease-out hover:bg-primary hover:text-gold active:scale-[0.98] motion-reduce:active:scale-100"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin motion-reduce:hidden" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
