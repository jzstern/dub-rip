<script lang="ts">
import type { VideoPreview as VideoPreviewType } from "$lib/types";

interface Props {
	preview: VideoPreviewType;
	formatDuration: (seconds: number) => string;
}

let { preview, formatDuration }: Props = $props();
</script>

<div class="flex items-center gap-3 p-3 rounded-md border border-border/70 bg-secondary/50 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)]">
	<img
		src={preview.thumbnail}
		alt={preview.title}
		class="w-12 h-12 rounded object-cover flex-shrink-0 ring-1 ring-primary/40"
	/>
	<div class="flex-1 min-w-0 space-y-0.5">
		<p class="text-sm font-medium truncate">{preview.title || preview.videoTitle}</p>
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			{#if preview.artist}
				<span class="truncate">{preview.artist}</span>
			{/if}
			{#if preview.duration}
				{#if preview.artist}
					<span>•</span>
				{/if}
				<span>{formatDuration(preview.duration)}</span>
			{/if}
		</div>
	</div>
</div>
