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
	class="h-14 w-full rounded-none border-2 border-foreground bg-accent text-base font-bold tracking-[0.2em] text-accent-foreground uppercase shadow-none transition-none hover:bg-accent hover:brightness-90 disabled:opacity-40"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Ripping
	{:else}
		Download →
	{/if}
</Button>
