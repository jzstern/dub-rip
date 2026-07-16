<script lang="ts">
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
import * as Card from "$lib/components/ui/card";
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

<div class="min-h-screen px-5 py-10 sm:py-16">
	<div class="mx-auto w-full max-w-xl">
		<header class="masthead text-center">
			<div class="rule rule-heavy" aria-hidden="true"></div>
			<div class="rule rule-hairline mt-[3px]" aria-hidden="true"></div>

			<div class="masthead-rise delay-1 mt-6 flex justify-center text-foreground" aria-hidden="true">
				<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
					<circle cx="15" cy="15" r="13.5" stroke="currentColor" stroke-width="1" />
					<circle cx="15" cy="15" r="10.5" stroke="currentColor" stroke-width="0.5" />
					<circle cx="15" cy="15" r="8.5" stroke="currentColor" stroke-width="0.5" />
					<circle cx="15" cy="15" r="6.5" stroke="currentColor" stroke-width="0.5" />
					<circle cx="15" cy="15" r="2.5" fill="hsl(var(--accent))" stroke="none" />
					<circle cx="15" cy="15" r="0.9" fill="hsl(var(--background))" stroke="none" />
				</svg>
			</div>

			<h1 class="masthead-title masthead-rise delay-2 mt-2 font-display text-6xl font-black leading-none tracking-tight sm:text-7xl">Dub—Rip</h1>
			<p class="small-caps masthead-rise delay-3 mt-3 text-muted-foreground">YouTube Audio, Properly Tagged</p>

			<div class="rule rule-hairline mt-5" aria-hidden="true"></div>
			<p class="small-caps masthead-rise delay-3 py-1.5 tracking-[0.2em]">Vol. I · No. 1 — Audio Edition — Free</p>
			<div class="rule rule-hairline" aria-hidden="true"></div>
		</header>

		<div class="mt-10 flex items-center gap-3">
			<div class="h-px flex-1 bg-border" aria-hidden="true"></div>
			<h2 class="small-caps">The Download Desk</h2>
			<div class="h-px flex-1 bg-border" aria-hidden="true"></div>
		</div>

		<Card.Root class="mt-4 rounded-none border-4 border-double border-foreground bg-transparent p-6 shadow-none sm:p-8">
			<Card.Content class="space-y-5 p-0">
				<div class="space-y-4">
					<label for="recording-url" class="small-caps block text-center">Submit a Recording</label>
					<Input
						id="recording-url"
						bind:value={url}
						placeholder="Paste a YouTube address"
						disabled={loading}
						autofocus
						onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
						class="h-11 rounded-none border-x-0 border-t-0 bg-transparent px-1 text-center font-serif shadow-none placeholder:italic dark:bg-transparent"
					/>
					<DownloadButton
						loading={loading}
						disabled={loading || !isValidUrl}
						onClick={handleDownload}
					/>
				</div>

				{#if preview && !loading && !loadingPreview}
					<VideoPreview preview={preview} formatDuration={formatDuration} />
				{/if}

				{#if loadingPreview}
					<PreviewSkeleton />
				{/if}

				{#if error}
					<div class="border-l-2 border-accent pl-3">
						<p class="small-caps text-accent">Correction</p>
						<p class="mt-1 text-sm text-destructive">{error}</p>
					</div>
				{/if}

				{#if loading || status}
					<div class="space-y-2 border-t pt-4">
						{#if videoTitle}
							<p class="truncate font-display text-sm font-bold">{videoTitle}</p>
						{/if}

						<p class="small-caps text-muted-foreground">
							{status}{#if loading}&nbsp;— <span class="font-mono">{roundedProgress}</span> per cent{/if}
						</p>

						<div class="space-y-1.5">
							<Progress value={roundedProgress} class="h-0.5 rounded-none bg-border" />
							<div class="flex justify-between font-mono text-[0.6875rem] text-muted-foreground">
								<span>{roundedProgress}%</span>
								<div class="flex gap-3">
									{#if speed}<span>{speed}</span>{/if}
									{#if eta}<span>ETA {eta}</span>{/if}
								</div>
							</div>
						</div>

						{#if downloadComplete && completedFilename}
							<div class="border-t pt-3">
								<p class="small-caps text-accent">Final Edition</p>
								<p class="mt-1 truncate font-mono text-[0.6875rem] text-muted-foreground">{completedFilename}</p>
							</div>
						{/if}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<footer class="mt-8 text-center">
			<p class="small-caps text-muted-foreground">Set in Playfair Display — Printed on Demand</p>
		</footer>
	</div>
</div>

<style>
	.rule {
		background: hsl(var(--foreground));
	}

	.rule-heavy {
		height: 3px;
	}

	.rule-hairline {
		height: 1px;
	}

	.masthead-title {
		font-feature-settings: "onum" 1;
	}

	@media (prefers-reduced-motion: no-preference) {
		.masthead .rule {
			transform-origin: center;
			animation: rule-draw 400ms var(--ease-out-strong) both;
		}

		.masthead-rise {
			animation: rise-in 350ms var(--ease-out-strong) both;
		}

		.delay-1 {
			animation-delay: 60ms;
		}

		.delay-2 {
			animation-delay: 120ms;
		}

		.delay-3 {
			animation-delay: 180ms;
		}
	}

	@keyframes rule-draw {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	@keyframes rise-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
