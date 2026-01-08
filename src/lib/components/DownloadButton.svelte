<script lang="ts">
import { Button } from "$lib/components/ui/button";
import { Loader2 } from "lucide-svelte";

interface Props {
	loading: boolean;
	disabled: boolean;
	onClick: () => void;
}

let { loading, disabled, onClick }: Props = $props();
</script>

<Button onclick={onClick} disabled={disabled} class="w-full h-11">
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
