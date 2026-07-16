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

<div class="flex min-h-dvh flex-col justify-between gap-16 px-6 py-8 sm:px-12 sm:py-12">
	{#if false}
		<AsciiVinyl active={loading} />
	{/if}

	<header>
		<h1 class="sleeve-rise font-sans text-[clamp(4rem,10vw,6.5rem)] font-semibold lowercase leading-[0.92] tracking-[-0.04em]">dub-rip</h1>
		<p class="sleeve-rise sleeve-rise-2 mt-5 font-mono text-xs lowercase tracking-[0.14em] text-muted-foreground">youtube → mp3 · rich metadata</p>
	</header>

	<main class="sleeve-rise sleeve-rise-3 w-full">
		<Card.Root class="block gap-0 rounded-none border-0 border-t border-foreground/30 bg-transparent p-0 shadow-none">
			<Card.Content class="p-0">
				<div class="grid grid-cols-[3rem_1fr] items-center border-b border-foreground/15 transition-colors duration-150 focus-within:border-foreground">
					<span class="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">01</span>
					<Input
						bind:value={url}
						placeholder="paste url"
						disabled={loading}
						autofocus
						onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
						class="h-14 rounded-none border-0 bg-transparent px-0 text-base shadow-none placeholder:lowercase focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
					/>
				</div>

				<div class="grid grid-cols-[3rem_1fr] items-center border-b border-foreground/15">
					<span class="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">02</span>
					<DownloadButton
						loading={loading}
						disabled={loading || !isValidUrl}
						onClick={handleDownload}
					/>
				</div>

				{#if loadingPreview}
					<div class="grid grid-cols-[3rem_1fr] items-center border-b border-foreground/15">
						<span class="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">03</span>
						<PreviewSkeleton />
					</div>
				{/if}

				{#if preview && !loading && !loadingPreview}
					<div class="grid grid-cols-[3rem_1fr] items-center border-b border-foreground/15">
						<span class="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">03</span>
						<VideoPreview preview={preview} formatDuration={formatDuration} />
					</div>
				{/if}

				{#if error}
					<div class="grid grid-cols-[3rem_1fr] items-center border-b border-foreground/15">
						<span class="font-mono text-xs text-destructive" aria-hidden="true">×</span>
						<p class="py-4 font-mono text-xs lowercase text-destructive">{error}</p>
					</div>
				{/if}

				{#if loading || status}
					<div class="pt-8">
						<div class="flex items-end justify-between gap-8">
							<div class="min-w-0 space-y-1.5">
								{#if videoTitle}
									<p class="truncate text-sm font-medium">{videoTitle}</p>
								{/if}
								<p class="font-mono text-xs lowercase tracking-[0.08em] text-muted-foreground">{status}</p>
								{#if downloadComplete && completedFilename}
									<p class="truncate font-mono text-xs text-muted-foreground">{completedFilename}</p>
								{/if}
							</div>
							<p class="shrink-0 text-6xl leading-none tabular-nums tracking-[-0.03em] sm:text-8xl {downloadComplete ? 'font-semibold' : 'font-normal'}">
								{roundedProgress}<span class="align-top text-2xl sm:text-3xl">%</span>
							</p>
						</div>
						<div class="mt-5">
							<Progress value={roundedProgress} class="h-px rounded-none bg-foreground/15" />
							<div class="mt-2 flex justify-end gap-4 font-mono text-[11px] lowercase text-muted-foreground">
								{#if speed}<span>{speed}</span>{/if}
								{#if eta}<span>eta {eta}</span>{/if}
							</div>
						</div>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</main>

	<footer class="sleeve-rise sleeve-rise-4 flex items-end justify-between gap-6">
		<span class="block h-3 w-3 bg-accent" aria-hidden="true"></span>
		<p class="text-right font-mono text-[11px] tracking-[0.14em] text-muted-foreground">DR-001 / STEREO / 44.1kHz</p>
	</footer>
</div>
