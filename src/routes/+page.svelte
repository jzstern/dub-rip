<script lang="ts">
import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
import { Input } from "$lib/components/ui/input";
import { Progress } from "$lib/components/ui/progress";
import VideoPreview from "$lib/components/VideoPreview.svelte";
import { formatDuration } from "$lib/format-duration";
import { createProgressSmoother } from "$lib/progress-smoothing";
import type { VideoPreview as VideoPreviewType } from "$lib/types";

let url = $state("");
let loading = $state(false);

function isValidYouTubeUrl(input: string): boolean {
	if (!input) return false;
	const patterns = [
		/^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
		/^https?:\/\/youtu\.be\/[\w-]{11}/,
		/^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
		/^https?:\/\/m\.youtube\.com\/watch\?v=[\w-]{11}/,
	];
	return patterns.some((pattern) => pattern.test(input));
}

let isValidUrl = $derived(isValidYouTubeUrl(url));
let error = $state("");
let errorUrl = $state("");
let status = $state("");
let progress = $state(0);
let displayProgress = $state(0);
let roundedProgress = $derived(Math.round(displayProgress));
let speed = $state("");
let eta = $state("");
let videoTitle = $state("");
let preview = $state<VideoPreviewType | null>(null);
let loadingPreview = $state(false);
let downloadComplete = $state(false);
let completedFilename = $state("");
let currentDownloadId = 0;

const smoother = createProgressSmoother();
let rafId: number | null = null;
let lastFrameTime = 0;

function stopSmoothing(): void {
	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
}

function frame(now: number): void {
	const delta = now - lastFrameTime;
	lastFrameTime = now;
	displayProgress = smoother.tick(delta);
	rafId = requestAnimationFrame(frame);
}

function startSmoothing(): void {
	stopSmoothing();
	lastFrameTime = performance.now();
	rafId = requestAnimationFrame(frame);
}

async function loadPreview(targetUrl: string) {
	loadingPreview = true;

	try {
		const response = await fetch("/api/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: targetUrl }),
		});

		if (!response.ok) {
			const data = await response.json();
			throw new Error(data.error || "Failed to load preview");
		}

		if (url !== targetUrl) return;

		preview = await response.json();

		fetch("/api/preview/details", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: targetUrl }),
		})
			.then((res) => res.json())
			.then((details) => {
				if (url === targetUrl && preview && details.success) {
					preview = {
						...preview,
						duration: details.duration,
					};
				}
			})
			.catch((err) => console.error("Details error:", err));
	} catch (err) {
		if (url !== targetUrl) return;
		console.error("Preview error:", err);
		error = err instanceof Error ? err.message : "Failed to load preview";
		errorUrl = targetUrl;
		preview = null;
	} finally {
		loadingPreview = false;
	}
}

let lastPreviewUrl = $state("");
$effect(() => {
	if (url !== lastPreviewUrl) {
		lastPreviewUrl = url;
		if (error && url !== errorUrl) {
			error = "";
			errorUrl = "";
		}
		if (downloadComplete) {
			downloadComplete = false;
			completedFilename = "";
			status = "";
			progress = 0;
			smoother.reset();
			displayProgress = 0;
			videoTitle = "";
		}
	}

	if (!isValidUrl || loading) {
		preview = null;
		loadingPreview = false;
		return;
	}

	const currentUrl = url;
	const timeoutId = setTimeout(() => {
		loadPreview(currentUrl);
	}, 500);

	return () => clearTimeout(timeoutId);
});

function handleDownload() {
	if (!isValidUrl) {
		error = "Please enter a valid YouTube URL";
		return;
	}

	loading = true;
	error = "";
	status = "Connecting...";
	progress = 0;
	smoother.reset();
	displayProgress = 0;
	startSmoothing();
	speed = "";
	eta = "";
	videoTitle = "";
	downloadComplete = false;
	completedFilename = "";
	const thisDownloadId = ++currentDownloadId;

	const eventSource = new EventSource(
		`/api/download-stream?url=${encodeURIComponent(url)}`,
	);

	eventSource.onmessage = (event) => {
		try {
			const data = JSON.parse(event.data);

			switch (data.type) {
				case "status":
					status = data.message;
					break;

				case "info":
					videoTitle = data.title;
					status = "Downloading...";
					break;

				case "progress":
					progress = Math.round(data.percent) || 0;
					smoother.setTarget(progress);
					speed = data.speed || "";
					eta = data.eta || "";
					break;

				case "complete": {
					eventSource.close();
					status = "Saving...";
					progress = 95;
					smoother.setTarget(95);
					speed = "";
					eta = "";

					setTimeout(() => {
						if (currentDownloadId !== thisDownloadId) return;
						try {
							const binaryString = atob(data.data);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							const blob = new Blob([bytes], { type: "audio/mpeg" });
							const downloadUrl = window.URL.createObjectURL(blob);
							const a = document.createElement("a");
							a.href = downloadUrl;
							a.download = data.filename;
							document.body.appendChild(a);
							a.click();
							window.URL.revokeObjectURL(downloadUrl);
							document.body.removeChild(a);

							progress = 100;
							smoother.complete();
							displayProgress = 100;
							stopSmoothing();
							status = "Downloaded!";
							loading = false;
							downloadComplete = true;
							completedFilename = data.filename;
							url = "";
							preview = null;
						} catch (err) {
							console.error("Failed to save file:", err);
							error = "Failed to save file";
							loading = false;
							status = "";
							stopSmoothing();
						}
					}, 0);
					break;
				}

				case "error":
					error = data.message;
					errorUrl = url;
					eventSource.close();
					loading = false;
					status = "";
					stopSmoothing();
					break;
			}
		} catch (err) {
			console.error("Failed to parse event:", err);
		}
	};

	eventSource.onerror = () => {
		if (!error) {
			error = "Connection lost";
		}
		errorUrl = url;
		eventSource.close();
		loading = false;
		status = "";
		stopSmoothing();
	};
}

$effect(() => {
	return () => stopSmoothing();
});
</script>

<div class="flex min-h-screen flex-col">
	<header class="flex items-center justify-between border-b-2 border-foreground px-5 py-3 font-mono text-xs uppercase tracking-[0.2em]">
		<span>YouTube → MP3</span>
		<span class="text-accent">●&nbsp;Audio Ripper</span>
	</header>

	<main class="flex flex-1 items-center justify-center p-5">
		<div class="w-full max-w-xl">
			<!-- Hero -->
			<div class="mb-4 flex items-end gap-4">
				<AsciiVinyl active={loading} />
				<div class="-mb-1 flex-1">
					<h1 class="font-display text-6xl font-bold leading-[0.85] tracking-tighter sm:text-7xl">
						dub<span class="text-accent">-</span>rip
					</h1>
					<p class="mt-3 max-w-xs text-sm leading-snug text-muted-foreground">
						Download YouTube audio with rich metadata.
					</p>
				</div>
			</div>

			<div class="rule-draw mb-6 h-[3px] bg-accent" aria-hidden="true"></div>

			<!-- Main panel -->
			<div class="border-2 border-foreground">
				<div class="flex items-center justify-between border-b-2 border-foreground bg-foreground px-4 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.25em] text-background">
					<span>Source URL</span>
					<span>01</span>
				</div>

				<div class="space-y-4 p-4 sm:p-5">
					<!-- Input -->
					<div class="space-y-3">
						<Input
							bind:value={url}
							placeholder="Paste YouTube URL"
							disabled={loading}
							autofocus
							onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
							class="h-14 rounded-none border-2 border-foreground px-4 font-mono text-base shadow-none focus-visible:border-accent focus-visible:ring-0"
						/>
						<DownloadButton
							loading={loading}
							disabled={loading || !isValidUrl}
							onClick={handleDownload}
						/>
					</div>

					<!-- Preview -->
					{#if preview && !loading && !loadingPreview}
						<VideoPreview preview={preview} formatDuration={formatDuration} />
					{/if}

					<!-- Loading Preview -->
					{#if loadingPreview}
						<PreviewSkeleton />
					{/if}

					<!-- Error -->
					{#if error}
						<div class="reveal border-2 border-accent bg-accent/10 p-3">
							<p class="font-mono text-sm font-bold uppercase tracking-wide text-accent">{error}</p>
						</div>
					{/if}

					<!-- Progress -->
					{#if loading || status}
						<div class="space-y-4 border-t-2 border-foreground pt-4">
							{#if videoTitle}
								<p class="truncate text-sm font-bold">{videoTitle}</p>
							{/if}

							<div class="flex items-end justify-between gap-4">
								<span class="font-display text-6xl font-bold leading-none tracking-tighter tabular-nums sm:text-7xl">{roundedProgress}<span class="text-accent">%</span></span>
								<p class="pb-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{status}</p>
							</div>

							<div class="space-y-2">
								<Progress value={roundedProgress} class="h-3 rounded-none border-2 border-foreground bg-transparent" />
								<div class="flex justify-between font-mono text-xs uppercase tracking-wide text-muted-foreground">
									<span>{roundedProgress}% Complete</span>
									<div class="flex gap-3">
										{#if speed}<span>{speed}</span>{/if}
										{#if eta}<span>ETA {eta}</span>{/if}
									</div>
								</div>
							</div>

							{#if downloadComplete && completedFilename}
								<p class="truncate border-t-2 border-foreground pt-3 font-mono text-xs text-muted-foreground">{completedFilename}</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</main>

	<footer class="border-t-2 border-foreground px-5 py-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
		dub-rip / no ads / no tracking
	</footer>
</div>

<style>
	.rule-draw {
		transform-origin: left;
		animation: draw-in 360ms var(--ease-out-strong) both;
	}

	@keyframes draw-in {
		from {
			transform: scaleX(0);
		}
	}

	.reveal {
		animation: reveal-in 140ms var(--ease-out-strong);
	}

	@keyframes reveal-in {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rule-draw {
			animation: none;
		}

		.reveal {
			animation-name: fade-in;
		}
	}
</style>
