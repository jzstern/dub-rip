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
	variant="ghost"
	onclick={onClick}
	disabled={disabled}
	class="w-full h-11 justify-between rounded-none px-0 text-base font-medium lowercase transition-transform duration-150 ease-out hover:bg-transparent hover:text-accent active:scale-[0.99] disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100"
>
	{#if loading}
		<span class="flex items-center gap-3">
			<Loader2 class="h-4 w-4 animate-spin" />
			<span>Downloading</span>
		</span>
	{:else}
		<span>Download</span>
		<span aria-hidden="true">→</span>
	{/if}
</Button>
