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
	class="w-full h-11 rounded-sm font-mono text-xs font-bold uppercase tracking-[0.2em] shadow-none active:translate-y-px motion-reduce:active:translate-y-0"
>
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
