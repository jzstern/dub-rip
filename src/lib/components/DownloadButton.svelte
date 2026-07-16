<script lang="ts">
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
	class="press-block h-11 w-full rounded-none text-[0.6875rem] font-bold uppercase tracking-[0.16em] shadow-none hover:bg-accent hover:text-accent-foreground"
>
	{#if loading}
		Downloading
	{:else}
		Download
	{/if}
</Button>
