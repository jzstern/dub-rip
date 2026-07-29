<script lang="ts">
import { LoaderCircle } from "lucide-svelte";
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
	disabled={disabled || loading}
	class="h-11 w-full font-mono text-xs font-bold tracking-[0.14em] transition-transform duration-150 ease-out active:scale-[0.98]"
>
	{#if loading}
		<span data-testid="download-working" class="flex items-center gap-2">
			<LoaderCircle
				aria-hidden="true"
				class="size-3.5 motion-safe:animate-spin"
			/>
			DOWNLOADING
		</span>
	{:else}
		DOWNLOAD
	{/if}
</Button>
