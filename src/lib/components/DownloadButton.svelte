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
	{disabled}
	class="h-11 w-full font-mono text-xs font-bold tracking-[0.14em] transition-transform duration-150 ease-out active:scale-[0.98]"
>
	{#if loading}
		<span
			data-testid="download-working"
			class="text-primary-foreground/80 motion-safe:animate-pulse">DOWNLOADING…</span
		>
	{:else}
		DOWNLOAD
	{/if}
</Button>
