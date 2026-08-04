import * as Sentry from "@sentry/sveltekit";
import {
	DOWNLOAD_COMPLETE_PERCENT,
	DOWNLOAD_START_PERCENT,
} from "$lib/download-pipeline/progress-stages";
import {
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import { buildJsRuntimeArgs, YOUTUBE_EXTRACTOR_ARG } from "$lib/yt-dlp-binary";
import { withYtDlpConcurrencyLimit } from "$lib/yt-dlp-concurrency";

interface YtDlpProcess {
	on(
		event: "progress",
		callback: (progress: Record<string, unknown>) => void,
	): void;
	on(
		event: "ytDlpEvent",
		callback: (eventType: string, eventData: string) => void,
	): void;
	on(event: "error", callback: (error: Error) => void): void;
	on(event: "close", callback: (code: number) => void): void;
	stderr?: { on(event: string, callback: (data: Buffer) => void): void };
	ytDlpProcess?: { kill(signal?: NodeJS.Signals): boolean };
}

export interface YtDlpInstance {
	exec(args: string[]): YtDlpProcess;
}

export interface TitleState {
	videoTitle: string;
	artist: string;
	trackTitle: string;
	uploader: string;
}

export interface TryYtDlpInput {
	videoUrl: string;
	outputPath: string;
	bgutilPotUrl: string;
	ffmpegPath: string;
	pluginDir: string;
	debugMode: boolean;
	ytDlp: YtDlpInstance;
	titleState: TitleState;
	send: (data: Record<string, unknown>) => void;
	signal?: AbortSignal;
}

export async function tryYtDlpDownload({
	videoUrl,
	outputPath,
	bgutilPotUrl,
	ffmpegPath,
	pluginDir,
	debugMode,
	ytDlp,
	titleState,
	send,
	signal,
}: TryYtDlpInput): Promise<void> {
	const args = [
		videoUrl,
		"-x",
		"--audio-format",
		"mp3",
		"--audio-quality",
		"128K",
		// Audio-only DASH formats drop out of YouTube's response intermittently —
		// they get skipped whenever a GVS PO token isn't minted for the client — and
		// a bare `best` then lands on 1080p HLS: one measured run pulled 84MB over 39
		// fragments (plus an ffmpeg fixup pass) where a 3.4MB audio stream existed.
		// itag 18 (360p progressive, ~15-23MB) bounds the worst case before `best`
		// is ever reached.
		"-f",
		"bestaudio[vcodec=none]/bestaudio/18/best[height<=360]/best",
		// Only bites on the fragmented fallbacks above, which are otherwise serial.
		"--concurrent-fragments",
		"4",
		// No metadata or thumbnail postprocessors here on purpose: the downstream
		// tagging step calls NodeID3.write(), which replaces the whole ID3 tag, so
		// anything yt-dlp embeds is overwritten moments later. Asking for it cost a
		// thumbnail fetch and two extra ffmpeg rewrites of the MP3 for nothing.
		"--ffmpeg-location",
		ffmpegPath,
		"--newline",
		"--no-playlist",
		// The binary is pinned, so yt-dlp's "your version is older than 90 days"
		// notice is expected rather than actionable. Without this it would fire on
		// every download once the pin ages past the threshold, and — now that
		// warnings are no longer suppressed wholesale — bury the PO-token and
		// format-skip warnings we removed `--no-warnings` to be able to see.
		"--no-update",
		...buildJsRuntimeArgs(),
		"--plugin-dirs",
		pluginDir,
		// Shared with the metadata path — see YOUTUBE_EXTRACTOR_ARG for why both
		// the client restriction and `fetch_pot=always` are load-bearing.
		"--extractor-args",
		YOUTUBE_EXTRACTOR_ARG,
		"--extractor-args",
		`youtubepot-bgutilhttp:base_url=${bgutilPotUrl}`,
		"-o",
		`${outputPath}.%(ext)s`,
	];

	if (debugMode) {
		args.push("-v", "--list-formats");
	}

	await withYtDlpConcurrencyLimit(async () => {
		if (signal?.aborted) {
			// The caller may have aborted while this call was queued behind
			// MAX_CONCURRENT_YT_DLP_PROCESSES other downloads — by the time a slot
			// frees up there's nothing left to spawn a process for.
			throw signal.reason ?? new Error("Download aborted");
		}

		const downloadProcess = ytDlp.exec(args);

		// Killing here — rather than only having retryWithBackoff stop scheduling
		// further attempts — frees the concurrency slot and stops the YouTube
		// request immediately instead of letting it run to completion for a
		// caller that already walked away.
		const killOnAbort = () => {
			downloadProcess.ytDlpProcess?.kill("SIGTERM");
		};
		signal?.addEventListener("abort", killOnAbort, { once: true });

		try {
			downloadProcess.on("progress", (progress: Record<string, unknown>) => {
				const rawPercent = Math.min(
					100,
					Math.max(0, (progress.percent as number) || 0),
				);
				send({
					type: "progress",
					percent: Math.round(
						DOWNLOAD_START_PERCENT +
							(rawPercent / 100) *
								(DOWNLOAD_COMPLETE_PERCENT - DOWNLOAD_START_PERCENT),
					),
					speed: (progress.currentSpeed as string) || "",
					eta: (progress.eta as string) || "",
				});
			});

			downloadProcess.on(
				"ytDlpEvent",
				(eventType: string, eventData: string) => {
					console.log("yt-dlp event:", eventType, "|", eventData);

					if (!titleState.videoTitle) {
						if (eventType === "Destination") {
							const match = eventData.match(/\/([^/]+)\.\w+$/);
							if (match) {
								titleState.videoTitle = match[1].replace(/_/g, " ");
							}
						} else if (
							eventData.includes(".mp3") ||
							eventData.includes(".webm")
						) {
							const match = eventData.match(/([^/]+)\.\w+/);
							if (match) {
								titleState.videoTitle = match[1].replace(/_/g, " ");
							}
						}

						if (titleState.videoTitle) {
							const parsed = parseArtistAndTitle(titleState.videoTitle);
							titleState.artist = parsed.artist;
							titleState.trackTitle = parsed.title;

							if (!titleState.artist && titleState.uploader) {
								titleState.artist = sanitizeUploaderAsArtist(
									titleState.uploader,
								);
							}

							send({
								type: "info",
								title: titleState.videoTitle,
								artist: titleState.artist,
								track: titleState.trackTitle,
							});
						}
					}

					send({ type: "event", eventType, eventData });
				},
			);

			let errorMessage = "";
			downloadProcess.stderr?.on("data", (data: Buffer) => {
				const text = data.toString();
				console.error("yt-dlp stderr:", text);
				if (text.includes("ERROR:")) {
					errorMessage += text;
				}
				// Warnings are deliberately not suppressed (`--no-warnings` is absent): a
				// skipped-format warning is the only signal that YouTube withheld the
				// audio-only streams and we fell through to a video format.
				for (const line of text.split("\n")) {
					if (!line.includes("WARNING:")) continue;
					console.warn("yt-dlp warning:", line);
					Sentry.addBreadcrumb({
						category: "download",
						level: "warning",
						message: line.slice(0, 500),
					});
				}
			});

			// Only log here: the rejection below carries the failure to download-stream's
			// catch, which is the single place that emits the user-facing error event.
			downloadProcess.on("error", (error: Error) => {
				console.error("Download process error:", error);
			});

			await new Promise<void>((resolve, reject) => {
				downloadProcess.on("close", (code: number) => {
					if (code === 0) {
						resolve();
					} else {
						reject(
							new Error(errorMessage || `Process exited with code ${code}`),
						);
					}
				});
				downloadProcess.on("error", reject);
			});
		} finally {
			// Each retry calls tryYtDlpDownload again with the same signal; leaving
			// a stale listener registered here would accumulate one per attempt.
			signal?.removeEventListener("abort", killOnAbort);
		}
	});
}
