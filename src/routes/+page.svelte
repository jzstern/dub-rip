<script lang="ts">
import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Progress } from "$lib/components/ui/progress";
import VideoPreview from "$lib/components/VideoPreview.svelte";
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
let speed = $state("");
let eta = $state("");
let videoTitle = $state("");
let preview = $state<VideoPreviewType | null>(null);
let loadingPreview = $state(false);

function formatDuration(seconds: number): string {
	if (!seconds) return "";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
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
	}

	if (!isValidUrl || loading) {
		preview = null;
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
	speed = "";
	eta = "";
	videoTitle = "";

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
					speed = data.speed || "";
					eta = data.eta || "";
					break;

				case "complete": {
					status = "Download complete!";
					progress = 100;

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

					eventSource.close();
					loading = false;
					url = "";
					preview = null;

					setTimeout(() => {
						status = "";
						progress = 0;
						videoTitle = "";
					}, 2000);
					speed = "";
					eta = "";
					break;
				}

				case "error":
					error = data.message;
					errorUrl = url;
					eventSource.close();
					loading = false;
					status = "";
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
	};
}
</script>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md space-y-6">
		<!-- Header -->
		<div class="flex flex-col items-center space-y-2 text-center">
			<AsciiVinyl />
			<h1 class="text-4xl font-bold tracking-tight">dub-rip</h1>
			<p class="text-sm text-muted-foreground">Download YouTube audio with rich metadata</p>
		</div>

		<!-- Main Card -->
		<Card.Root class="p-6">
			<Card.Content class="space-y-4 p-0">
				<!-- Input -->
				<div class="space-y-2">
					<Input
						bind:value={url}
						placeholder="Paste YouTube URL"
						disabled={loading}
						autofocus
						onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
						class="h-11"
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
					<div class="rounded-md border border-destructive/20 bg-destructive/10 p-3">
						<p class="text-sm text-destructive">{error}</p>
					</div>
				{/if}

				<!-- Progress -->
				{#if loading || status}
					<div class="space-y-3">
						{#if videoTitle}
							<p class="truncate text-sm font-medium">{videoTitle}</p>
						{/if}

						<p class="text-xs text-muted-foreground">{status}</p>

						<div class="space-y-2">
							<Progress value={progress} class="h-2" />
							<div class="flex justify-between text-xs text-muted-foreground">
								<span>{progress}%</span>
								<div class="flex gap-2">
									{#if speed}<span>{speed}</span>{/if}
									{#if eta}<span>ETA: {eta}</span>{/if}
								</div>
							</div>
						</div>
					</div>
				{/if}

			</Card.Content>
		</Card.Root>
	</div>
</div>
