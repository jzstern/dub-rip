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

<div class="preview-card flex items-stretch gap-0 border-2 border-foreground">
	<div class="relative h-16 w-16 flex-shrink-0 overflow-hidden border-r-2 border-foreground bg-muted">
		<img
			src={imageSrc}
			alt={preview.title}
			onload={() => (imageLoaded = true)}
			onerror={handleArtworkError}
			class="absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ease-out-strong {imageLoaded
				? 'opacity-100'
				: 'opacity-0'}"
		/>
	</div>
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

<style>
	.preview-card {
		animation: preview-in 160ms var(--ease-out-strong);
	}

	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
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
