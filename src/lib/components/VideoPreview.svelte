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

<article class="preview-card flex items-start gap-4 border-t pt-4">
	<figure class="m-0 flex-shrink-0">
		<div class="relative h-16 w-16 overflow-hidden border border-foreground bg-muted p-0.5">
			<img
				src={imageSrc}
				alt={preview.title}
				onload={() => (imageLoaded = true)}
				onerror={handleArtworkError}
				class="h-full w-full object-cover transition-opacity duration-300 {imageLoaded
					? 'opacity-100'
					: 'opacity-0'}"
			/>
		</div>
		{#if preview.duration}
			<figcaption class="mt-1 text-center font-mono text-[0.625rem] text-muted-foreground">
				{formatDuration(preview.duration)}
			</figcaption>
		{/if}
	</figure>
	<div class="min-w-0 flex-1">
		<h3 class="line-clamp-2 font-display text-base font-bold leading-snug">
			{preview.title || preview.videoTitle}
		</h3>
		{#if preview.artist}
			<p class="small-caps mt-1.5 truncate text-muted-foreground">By {preview.artist}</p>
		{/if}
	</div>
</article>

<style>
	@media (prefers-reduced-motion: no-preference) {
		.preview-card {
			animation: news-item-in 250ms var(--ease-out-strong) both;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.preview-card {
			animation: fade-in 200ms ease-out both;
		}

		.preview-card img {
			transition: none;
		}
	}

	@keyframes news-item-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
