<script lang="ts">
import { fade } from "svelte/transition";
import {
	recordClientBreadcrumb,
	reportClientIssue,
} from "$lib/client-reporting";
import AsciiVinyl from "$lib/components/AsciiVinyl.svelte";
import DownloadButton from "$lib/components/DownloadButton.svelte";
import PreviewSkeleton from "$lib/components/PreviewSkeleton.svelte";
import { Input } from "$lib/components/ui/input";
import VideoPreview from "$lib/components/VideoPreview.svelte";
import { formatDuration } from "$lib/format-duration";
import { createProgressSmoother } from "$lib/progress-smoothing";
import { smoothCollapse } from "$lib/transitions";
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

/**
 * Marks a failure the server already answered for — it logged and reported
 * the error on its way out, so the browser only records a breadcrumb rather
 * than filing a second issue for the same incident.
 */
class ServerRejectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ServerRejectionError";
	}
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

let vinylState: "idle" | "ready" | "active" = $derived(
	loading ? "active" : isValidUrl ? "ready" : "idle",
);

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
			const data = await response.json().catch(() => ({}));
			recordClientBreadcrumb("Preview request rejected", {
				status: response.status,
			});
			throw new ServerRejectionError(data.error || "Failed to load preview");
		}

		if (url !== targetUrl) return;

		preview = await response.json();

		fetch("/api/preview/details", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: targetUrl }),
		})
			.then(async (res) => {
				if (!res.ok) {
					recordClientBreadcrumb("Preview details request rejected", {
						status: res.status,
					});
					return null;
				}
				return res.json();
			})
			.then((details) => {
				if (url === targetUrl && preview && details?.success) {
					preview = {
						...preview,
						duration: details.duration,
					};
				}
			})
			.catch((err) => {
				console.error("Details error:", err);
				reportClientIssue(err, {
					operation: "preview-details-fetch",
					extra: { targetUrl },
				});
			});
	} catch (err) {
		if (url !== targetUrl) return;
		console.error("Preview error:", err);
		if (!(err instanceof ServerRejectionError)) {
			reportClientIssue(err, {
				operation: "preview-fetch",
				extra: { targetUrl },
			});
		}
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

	if (!isValidUrl) {
		preview = null;
		loadingPreview = false;
		return;
	}

	if (loading) {
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
							const a = document.createElement("a");
							a.href = `/api/download-file?token=${encodeURIComponent(data.token)}`;
							a.download = data.filename;
							document.body.appendChild(a);
							a.click();
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
							reportClientIssue(err, {
								operation: "download-save-file",
								extra: { filename: data.filename, size: data.size },
							});
							error = "Failed to save file";
							loading = false;
							status = "";
							stopSmoothing();
						}
					}, 0);
					break;
				}

				case "error":
					recordClientBreadcrumb("Download stream reported an error", {
						message: data.message,
					});
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
			reportClientIssue(err, {
				operation: "download-stream-parse",
				extra: { rawEvent: String(event.data).slice(0, 200) },
			});
		}
	};

	eventSource.onerror = () => {
		/**
		 * Only an unexplained drop is worth reporting. When the server sends an
		 * `error` event it closes the stream itself, and it has already filed
		 * that failure — so a disconnect with `error` set is a duplicate.
		 */
		if (!error) {
			reportClientIssue(new Error("Download stream connection lost"), {
				operation: "download-stream-transport",
				extra: { readyState: eventSource.readyState },
			});
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

<div class="page-enter flex min-h-screen items-center justify-center px-5 py-12">
	<main class="flex w-full max-w-[460px] flex-col items-center gap-7">
		<header class="flex flex-col items-center gap-5">
			<AsciiVinyl state={vinylState} />
			<div class="flex flex-col items-center gap-1.5">
				<h1
					class="font-mono text-xl font-semibold tracking-[0.42em] indent-[0.42em] text-foreground"
				>
					DUB.RIP
				</h1>
				<p
					class="font-mono text-[10.5px] tracking-[0.24em] indent-[0.24em] text-muted-foreground"
				>
					DOWNLOAD AUDIO W/ RICH METADATA
				</p>
			</div>
		</header>

		<section
			class="machined-panel w-full rounded-[10px] border bg-card"
			aria-label="Downloader"
		>
			<div class="flex flex-col p-5">
				<Input
					bind:value={url}
					placeholder="Paste a YouTube link"
					aria-label="YouTube link"
					disabled={loading}
					autofocus
					onkeydown={(e) => e.key === "Enter" && !e.isComposing && isValidUrl && !loading && handleDownload()}
					class="h-11 bg-background font-mono text-base sm:text-[13px]"
				/>
				<div class="mt-3.5">
					<DownloadButton
						loading={loading}
						disabled={loading || !isValidUrl}
						onClick={handleDownload}
					/>
				</div>

				{#if loadingPreview || preview}
					<div
						class="preview-slot mt-3.5 grid"
						transition:smoothCollapse={{ opacity: false }}
					>
						{#if loadingPreview}
							<div class="preview-layer" transition:fade={{ duration: 160 }}>
								<PreviewSkeleton />
							</div>
						{:else if preview}
							<div class="preview-layer" transition:fade={{ duration: 160 }}>
								<VideoPreview preview={preview} formatDuration={formatDuration} />
							</div>
						{/if}
					</div>
				{/if}

				{#if error}
					<div
						class="mt-3.5 rounded-lg border border-destructive/35 bg-destructive/10 p-3"
						transition:smoothCollapse
					>
						<p class="text-sm text-foreground/90">{error}</p>
					</div>
				{/if}

				{#if loading || status}
					<div class="mt-3.5 flex flex-col gap-1.5" transition:smoothCollapse>
						<div
							role="progressbar"
							aria-label="Download progress"
							aria-valuenow={roundedProgress}
							aria-valuemin={0}
							aria-valuemax={100}
							class="h-0.5 overflow-hidden rounded-full bg-muted"
						>
							<div
								class="h-full bg-primary"
								style="width: {displayProgress}%"
							></div>
						</div>
						<div
							class="flex items-baseline justify-between gap-3 font-mono text-[11px] text-muted-foreground"
						>
							<span class="tabular-nums">{roundedProgress}%</span>
							<span class="min-w-0 truncate">
								{#if speed || eta}
									{speed}{speed && eta ? " · " : ""}{eta ? `ETA ${eta}` : ""}
								{:else if !loading && status}
									{status}
								{/if}
							</span>
						</div>
					</div>
				{/if}
			</div>

			<div class="flex justify-end border-t px-5 py-2">
				<span class="font-mono text-[10px] tracking-[0.12em] text-muted-foreground"
					>MP3 128 kbps · ID3v2</span
				>
			</div>
		</section>
	</main>
</div>

<style>
	.preview-layer {
		grid-area: 1 / 1;
	}

	.page-enter {
		animation: page-enter 400ms var(--ease-out-strong) both;
	}

	@keyframes page-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page-enter {
			animation: page-fade 300ms ease-out both;
		}
	}

	@keyframes page-fade {
		from {
			opacity: 0;
		}
	}
</style>
