<script lang="ts">
import type { VideoPreview as VideoPreviewType } from "$lib/types";

interface Props {
	preview: VideoPreviewType;
	formatDuration: (seconds: number) => string;
}

let { preview, formatDuration }: Props = $props();

let imageLoaded = $state(false);
let artworkFailed = $state(false);

let imageSrc = $derived(
	preview.artwork && !artworkFailed ? preview.artwork : preview.thumbnail,
);

function handleArtworkError() {
	if (preview.artwork && !artworkFailed) {
		artworkFailed = true;
	}
}
</script>

<div class="preview-card flex items-center gap-3 rounded-sm border border-border bg-muted/40 p-3">
	<div class="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-sm border border-border bg-muted">
		<img
			src={imageSrc}
			alt={preview.title}
			onload={() => (imageLoaded = true)}
			onerror={handleArtworkError}
			class="absolute inset-0 h-full w-full object-cover grayscale-[0.2] transition-opacity duration-300 {imageLoaded
				? 'opacity-100'
				: 'opacity-0'}"
		/>
	</div>
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

<style>
	.preview-card {
		animation: preview-in 200ms ease-out;
	}

	@keyframes preview-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.preview-card {
			animation: none;
		}

		.preview-card img {
			transition: none;
		}
	}
</style>
