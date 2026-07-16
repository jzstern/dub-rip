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
	class="h-11 w-full rounded-lg text-xs font-semibold uppercase tracking-[0.16em] shadow-none transition-[transform,background-color] duration-[120ms] ease-out hover:bg-[hsl(17_84%_50%)] active:translate-y-px active:bg-[hsl(17_80%_46%)] disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
