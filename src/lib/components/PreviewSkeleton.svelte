<div class="mono-skeleton flex items-center gap-3 rounded-md border bg-muted/50 p-3" data-testid="preview-skeleton">
	<div class="h-10 w-10 flex-shrink-0 rounded-[4px] bg-muted"></div>
	<div class="min-w-0 flex-1 space-y-2">
		<div class="h-3.5 w-3/4 rounded-[3px] bg-muted"></div>
		<div class="h-3 w-1/2 rounded-[3px] bg-muted"></div>
	</div>
</div>

<style>
	.mono-skeleton {
		animation: skeleton-breathe 1.6s ease-in-out infinite;
	}

	@keyframes skeleton-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mono-skeleton {
			animation: none;
			opacity: 0.75;
		}
	}
</style>
