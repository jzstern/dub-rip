<script lang="ts">
import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";
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

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md space-y-6">
		<!-- Header -->
		<div class="flex flex-col items-center space-y-2 text-center">
			<AsciiVinyl active={loading} />
			<p class="font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
				DR-45-001 · SIDE A · 45 RPM
			</p>
			<div class="flex items-start justify-center gap-1">
				<h1 class="font-display text-4xl uppercase leading-none tracking-tight">dub-rip</h1>
				<span aria-hidden="true" class="mt-0.5 font-mono text-[10px]">®</span>
			</div>
			<p class="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-gold">
				A dub plate special
			</p>
			<p class="text-sm text-muted-foreground">Download YouTube audio with rich metadata</p>
		</div>

		<!-- Main Card -->
		<Card.Root class="relative rounded-sm border border-border bg-card p-6 pb-8 shadow-none">
			<span aria-hidden="true" class="absolute left-2 top-1.5 font-mono text-[10px] text-muted-foreground select-none">45</span>
			<span aria-hidden="true" class="absolute right-2 top-1.5 font-mono text-[10px] text-muted-foreground select-none">℗ 2026</span>
			<span aria-hidden="true" class="absolute bottom-1.5 left-2 font-mono text-[10px] text-muted-foreground select-none">DR-45-001</span>
			<span aria-hidden="true" class="absolute bottom-1.5 right-2 font-mono text-[10px] text-muted-foreground select-none">STEREO</span>
			<Card.Content class="space-y-4 p-0">
				<!-- Input -->
				<div class="space-y-3">
					<label class="flex items-baseline gap-2 border-b border-foreground/50 transition-colors duration-150 focus-within:border-gold">
						<span class="font-mono text-[11px] font-bold tracking-[0.2em] text-muted-foreground select-none">CUT:</span>
						<Input
							bind:value={url}
							placeholder="Paste YouTube URL"
							disabled={loading}
							autofocus
							onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
							class="h-11 rounded-none border-0 bg-transparent px-0 font-mono text-sm shadow-none placeholder:text-muted-foreground/60 dark:bg-transparent"
						/>
					</label>
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
					<div class="rounded-sm border border-destructive/30 bg-destructive/10 p-3">
						<p class="text-sm text-destructive">{error}</p>
					</div>
				{/if}

				<!-- Progress -->
				{#if loading || status}
					<div class="space-y-3">
						{#if videoTitle}
							<p class="truncate text-sm font-medium">{videoTitle}</p>
						{/if}

						<p class="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
							{status === "Downloading..."
								? "Cutting…"
								: status === "Saving..."
									? "Stamping…"
									: status === "Downloaded!"
										? "Cut complete"
										: status}
						</p>

						<div class="space-y-2">
							<Progress value={roundedProgress} class="h-2 rounded-none bg-foreground/15" />
							<div class="flex justify-between font-mono text-[11px] text-muted-foreground">
								<span>{roundedProgress}%</span>
								<div class="flex gap-2">
									{#if speed}<span>{speed}</span>{/if}
									{#if eta}<span>ETA: {eta}</span>{/if}
								</div>
							</div>
						</div>

						{#if downloadComplete && completedFilename}
							<p class="truncate font-mono text-[11px] text-muted-foreground">{completedFilename}</p>
						{/if}
					</div>
				{/if}

			</Card.Content>
		</Card.Root>
	</div>
</div>
