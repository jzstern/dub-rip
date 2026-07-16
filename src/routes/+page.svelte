<script lang="ts">
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
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
	<div class="receipt-wrap">
		<div class="receipt-edge receipt-edge--top" aria-hidden="true"></div>
		<main class="receipt space-y-4">
			<!-- Printed header -->
			<header class="space-y-1 text-center">
				<p class="text-lg leading-none" aria-hidden="true">◉</p>
				<h1 class="receipt-h1 text-base font-bold tracking-[0.15em]">DUB-RIP RECORDS</h1>
				<p class="text-[11px] uppercase text-muted-foreground">YouTube audio · rich metadata</p>
				<p class="text-[11px] uppercase text-muted-foreground">Terminal 01 · Web Edition</p>
			</header>

			<hr class="receipt-sep" />

			<!-- Input as receipt line -->
			<div class="space-y-2">
				<label for="url-input" class="block text-xs font-bold uppercase tracking-widest">Paste URL &gt;</label>
				<Input
					id="url-input"
					bind:value={url}
					placeholder="youtube.com/watch?v=..."
					disabled={loading}
					autofocus
					onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
					class="receipt-input h-10 text-sm"
				/>
				<DownloadButton
					loading={loading}
					disabled={loading || !isValidUrl}
					onClick={handleDownload}
				/>
			</div>

			<!-- Preview as receipt items -->
			{#if preview && !loading && !loadingPreview}
				<VideoPreview preview={preview} formatDuration={formatDuration} />
			{/if}

			{#if loadingPreview}
				<PreviewSkeleton />
			{/if}

			<!-- Error -->
			{#if error}
				<div class="border border-dashed border-destructive p-2">
					<p class="text-xs uppercase text-destructive">!! {error}</p>
				</div>
			{/if}

			<!-- Progress prints line by line -->
			{#if loading || status}
				{@const filled = Math.min(10, Math.floor(roundedProgress / 10))}
				<hr class="receipt-sep" />
				<div class="receipt-lines space-y-1.5" aria-live="polite">
					{#if videoTitle}
						<p class="receipt-print-line truncate text-xs font-bold uppercase">{videoTitle}</p>
					{/if}

					{#key status}
						<p class="receipt-print-line text-xs uppercase text-muted-foreground">&gt; {status}</p>
					{/key}

					<p
						class="receipt-print-line text-xs tabular-nums"
						role="progressbar"
						aria-valuenow={roundedProgress}
						aria-valuemin="0"
						aria-valuemax="100"
					>
						{"■".repeat(filled)}{"□".repeat(10 - filled)} {roundedProgress}%
					</p>

					{#if speed || eta}
						<p class="receipt-print-line flex justify-between text-[11px] uppercase text-muted-foreground">
							<span>{speed}</span>
							{#if eta}<span>ETA {eta}</span>{/if}
						</p>
					{/if}

					{#if downloadComplete && completedFilename}
						<p class="receipt-print-line truncate text-[11px] uppercase text-muted-foreground">File: {completedFilename}</p>
					{/if}
				</div>

				{#if downloadComplete}
					<div class="text-center">
						<span class="receipt-stamp">✂ Saved</span>
					</div>
				{/if}
			{/if}

			<hr class="receipt-sep" />

			<!-- Barcode footer -->
			<footer class="space-y-1.5 text-center">
				<div class="receipt-barcode" aria-hidden="true"></div>
				<p class="text-[11px] tracking-[0.3em]">*DR-2025*</p>
				<p class="text-[10px] uppercase text-muted-foreground">Thank you · Play it loud</p>
			</footer>
		</main>
		<div class="receipt-edge receipt-edge--bottom" aria-hidden="true"></div>
	</div>
</div>
