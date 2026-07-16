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

<div class="preview-card flex items-center gap-3 py-3">
	<div class="relative h-12 w-12 flex-shrink-0 overflow-hidden bg-muted">
		<img
			src={imageSrc}
			alt={preview.title}
			onload={() => (imageLoaded = true)}
			onerror={handleArtworkError}
			class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 {imageLoaded
				? 'opacity-100'
				: 'opacity-0'}"
		/>
	</div>
	<div class="min-w-0 flex-1 space-y-1">
		<p class="truncate text-sm font-medium">{preview.title || preview.videoTitle}</p>
		<div class="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
			{#if preview.artist}
				<span class="truncate">{preview.artist}</span>
			{/if}
			{#if preview.duration}
				{#if preview.artist}
					<span>•</span>
				{/if}
				<span class="tabular-nums">{formatDuration(preview.duration)}</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.preview-card {
		animation: preview-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.preview-card {
			animation: preview-fade 150ms ease-out;
		}

		.preview-card img {
			transition: none;
		}
	}

	@keyframes preview-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
