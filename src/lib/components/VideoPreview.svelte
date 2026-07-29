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

<div
	class="preview-card flex items-center gap-3.5 rounded-lg border bg-background p-3"
>
	<div class="relative h-14 w-14 flex-shrink-0">
		<div class="h-full w-full overflow-hidden rounded-md bg-muted">
			<img
				src={imageSrc}
				alt={preview.title || preview.videoTitle}
				onload={() => (imageLoaded = true)}
				onerror={handleArtworkError}
				class="h-full w-full object-cover transition-opacity duration-300 {imageLoaded
					? 'opacity-100'
					: 'opacity-0'}"
			/>
		</div>
		{#if preview.duration}
			<span
				class="absolute -right-1 -bottom-1 rounded border bg-background px-1 font-mono text-[9.5px] leading-normal text-foreground tabular-nums"
			>{formatDuration(preview.duration)}</span>
		{/if}
	</div>
	<div class="min-w-0 flex-1 space-y-0.5">
		<p class="truncate text-sm font-semibold text-foreground">
			{preview.title || preview.videoTitle}
		</p>
		{#if preview.artist}
			<p class="truncate text-xs text-muted-foreground">{preview.artist}</p>
		{/if}
	</div>
</div>

<style>
	.preview-card {
		animation: preview-in 200ms var(--ease-out-strong);
	}

	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
	}

	@keyframes preview-fade {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.preview-card {
			animation: preview-fade 200ms ease-out;
		}

		.preview-card img {
			transition: none;
		}
	}
</style>
