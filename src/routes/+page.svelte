<script lang="ts">
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
import TapeReel from "$lib/components/TapeReel.svelte";
import { Input } from "$lib/components/ui/input";
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
	<main class="w-full max-w-md">
		<div class="device relative rounded-2xl border border-foreground/15 p-6 pb-7 shadow-sm">
			<span class="screw left-2.5 top-2.5"></span>
			<span class="screw right-2.5 top-2.5"></span>
			<span class="screw bottom-2.5 left-2.5"></span>
			<span class="screw bottom-2.5 right-2.5"></span>

			<!-- Silkscreen header -->
			<header class="flex items-center justify-between gap-4">
				<div class="space-y-1">
					<h1 class="font-mono text-lg font-bold tracking-[0.25em]">DUB–RIP</h1>
					<p class="silkscreen">Audio extractor · YouTube → MP3</p>
				</div>
				<TapeReel active={loading} />
			</header>

			<div class="grille mx-auto my-5 w-32"></div>

			<div class="space-y-5">
				<!-- Line in -->
				<div class="space-y-1.5">
					<label class="silkscreen block" for="line-in">Line in</label>
					<Input
						id="line-in"
						bind:value={url}
						placeholder="PASTE YOUTUBE URL"
						disabled={loading}
						autofocus
						onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
						class="h-11 rounded border-foreground/15 bg-[hsl(var(--input))] font-mono text-sm shadow-inner placeholder:text-[11px] placeholder:tracking-[0.15em]"
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
					<div class="rounded border border-destructive/30 bg-destructive/10 p-3">
						<p class="font-mono text-[10px] uppercase tracking-[0.2em] text-destructive">Err</p>
						<p class="mt-1 text-sm text-destructive">{error}</p>
					</div>
				{/if}

				<!-- Progress -->
				{#if loading || status}
					<div class="space-y-3">
						{#if videoTitle}
							<p class="truncate text-sm font-medium">{videoTitle}</p>
						{/if}

						<p class="silkscreen">{status}</p>

						<div class="space-y-2">
							<div
								class="flex gap-[3px]"
								role="progressbar"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={roundedProgress}
							>
								{#each Array.from({ length: 20 }, (_, i) => i) as segment (segment)}
									<span
										class="led-segment {segment < roundedProgress / 5 ? 'led-segment-on' : ''}"
									></span>
								{/each}
							</div>
							<div class="flex justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
								<span>{roundedProgress}%</span>
								<div class="flex gap-3">
									{#if speed}<span>{speed}</span>{/if}
									{#if eta}<span>ETA {eta}</span>{/if}
								</div>
							</div>
						</div>

						{#if downloadComplete && completedFilename}
							<p class="truncate font-mono text-[10px] text-muted-foreground">{completedFilename}</p>
						{/if}
					</div>
				{/if}

				<!-- Rec button -->
				<div class="flex justify-center pt-1">
					<DownloadButton
						loading={loading}
						disabled={loading || !isValidUrl}
						onClick={handleDownload}
					/>
				</div>
			</div>
		</div>
	</main>
</div>
