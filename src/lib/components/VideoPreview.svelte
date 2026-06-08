<script lang="ts">
import type { VideoPreview as VideoPreviewType } from "$lib/types";

interface Props {
	preview: VideoPreviewType;
	formatDuration: (seconds: number) => string;
}

let { preview, formatDuration }: Props = $props();
</script>

<div class="flex items-stretch gap-0 border-2 border-foreground">
	<img
		src={preview.thumbnail}
		alt={preview.title}
		class="h-16 w-16 flex-shrink-0 border-r-2 border-foreground object-cover"
	/>
	<div class="min-w-0 flex-1 space-y-1 p-3">
		<p class="truncate text-sm font-bold leading-tight">{preview.title || preview.videoTitle}</p>
		<div class="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
			{#if preview.artist}
				<span class="truncate">{preview.artist}</span>
			{/if}
			{#if preview.duration}
				{#if preview.artist}
					<span class="text-accent">/</span>
				{/if}
				<span>{formatDuration(preview.duration)}</span>
			{/if}
		</div>
	</div>
</div>
