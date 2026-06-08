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

<Button onclick={onClick} disabled={disabled} class="glow-button h-12 w-full rounded-xl bg-gradient-to-r from-[#7c3aed] via-[#a855f7] to-[#d946ef] text-base font-semibold text-white hover:opacity-95">
	{#if loading}
		<Loader2 class="mr-2 h-4 w-4 animate-spin" />
		Downloading
	{:else}
		Download
	{/if}
</Button>
