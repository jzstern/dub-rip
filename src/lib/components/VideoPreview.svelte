<script lang="ts">
import type { VideoPreview as VideoPreviewType } from "$lib/types";

interface Props {
	preview: VideoPreviewType;
	formatDuration: (seconds: number) => string;
}

let { preview, formatDuration }: Props = $props();
</script>

<div class="flex items-center gap-3 rounded-sm border border-border bg-muted/40 p-3">
	<img
		src={preview.thumbnail}
		alt={preview.title}
		class="h-12 w-12 flex-shrink-0 rounded-sm border border-border object-cover grayscale-[0.2]"
	/>
	<div class="min-w-0 flex-1 space-y-0.5">
		<p class="truncate font-mono text-sm font-medium text-primary">{preview.title || preview.videoTitle}</p>
		<div class="flex items-center gap-2 font-mono text-xs text-muted-foreground">
			{#if preview.artist}
				<span class="truncate">{preview.artist}</span>
			{/if}
			{#if preview.duration}
				{#if preview.artist}
					<span class="text-primary/60">::</span>
				{/if}
				<span>{formatDuration(preview.duration)}</span>
			{/if}
		</div>
	</div>
</div>
