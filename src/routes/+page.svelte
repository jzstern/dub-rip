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
	<div class="w-full max-w-md space-y-8">
		<div class="flex flex-col items-center space-y-3 text-center">
			<AsciiVinyl active={loading} />
			<h1 class="text-xl font-semibold uppercase tracking-[0.22em]">dub-rip</h1>
			<p class="silkscreen">YouTube audio · rich metadata</p>
		</div>

		<Card.Root class="channel-strip gap-0 rounded-md border-border p-0 shadow-none">
			<Card.Content class="p-0">
				<div class="space-y-3 p-5">
					<div class="silkscreen">Input</div>
					<Input
						bind:value={url}
						placeholder="Paste YouTube URL"
						disabled={loading}
						autofocus
						onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
						class="input-well h-11 rounded-sm"
					/>
					<DownloadButton
						loading={loading}
						disabled={loading || !isValidUrl}
						onClick={handleDownload}
					/>
				</div>

				{#if (preview && !loading && !loadingPreview) || loadingPreview}
					<div class="strip-section space-y-3 p-5">
						<div class="silkscreen">Source</div>
						{#if preview && !loading && !loadingPreview}
							<VideoPreview preview={preview} formatDuration={formatDuration} />
						{/if}
						{#if loadingPreview}
							<PreviewSkeleton />
						{/if}
					</div>
				{/if}

				{#if error}
					<div class="strip-section space-y-3 p-5">
						<div class="silkscreen text-destructive">Clip</div>
						<div class="flex items-start gap-2.5">
							<span class="clip-light mt-1" aria-hidden="true"></span>
							<p class="readout text-xs leading-5 text-destructive">{error}</p>
						</div>
					</div>
				{/if}

				{#if loading || status}
					<div class="strip-section space-y-3 p-5">
						<div class="silkscreen">Level</div>

						{#if videoTitle}
							<p class="truncate text-sm font-medium">{videoTitle}</p>
						{/if}

						<div class="space-y-1.5">
							<Progress value={roundedProgress} />
							<div class="vu-scale" aria-hidden="true">
								{#each Array.from({ length: 21 }, (_, i) => i) as tick (tick)}
									<div class={tick % 5 === 0 ? "vu-tick vu-tick-major" : "vu-tick"}></div>
								{/each}
							</div>
							<div class="readout flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
								<span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
							</div>
						</div>

						<div class="readout flex items-baseline justify-between gap-3 text-xs">
							<span class="truncate text-muted-foreground">{status}</span>
							<span class="shrink-0 text-primary">{roundedProgress}%</span>
						</div>

						{#if speed || eta}
							<div class="readout flex gap-4 text-[11px] text-muted-foreground">
								{#if speed}<span>{speed}</span>{/if}
								{#if eta}<span>ETA {eta}</span>{/if}
							</div>
						{/if}

						{#if downloadComplete && completedFilename}
							<p class="readout truncate text-[11px] text-muted-foreground">{completedFilename}</p>
						{/if}
					</div>
				{/if}

				<div class="strip-section readout flex items-center justify-between px-5 py-3 text-[10px] text-muted-foreground">
					<span>SRC YOUTUBE</span>
					<span aria-hidden="true">→</span>
					<span>MP3 320 · ID3v2</span>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
