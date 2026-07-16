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

<div class="preview-card space-y-2">
	<p class="receipt-item-line font-bold">
		<span>MP3 Audio</span>
		<span class="dots" aria-hidden="true"></span>
		<span>OK</span>
	</p>
	<div class="flex items-center gap-3">
		<div class="receipt-thumb relative h-12 w-12 flex-shrink-0 overflow-hidden border border-black bg-muted">
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
		<div class="min-w-0 flex-1 space-y-0.5">
			<p class="truncate text-xs font-bold uppercase">{preview.title || preview.videoTitle}</p>
			<div class="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
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
</div>

<style>
	.preview-card {
		animation: preview-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
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
