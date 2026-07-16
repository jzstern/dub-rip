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
	data-armed={loading}
	variant="secondary"
	class="transport-key w-full h-11 gap-2.5"
>
	{#if loading}
		<Loader2 class="h-3.5 w-3.5 animate-spin text-primary" />
		Downloading
	{:else}
		<span class="transport-dot" aria-hidden="true">●</span>
		Download
	{/if}
</Button>
