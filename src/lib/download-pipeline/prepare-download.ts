import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import type { SoundCloudArtwork } from "$lib/artwork";
import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import { trySoundCloudDownload } from "$lib/download-pipeline/try-soundcloud";
import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import type { MediaLink } from "$lib/media-link";
import {
	soundCloudDetails,
	soundCloudRefusal,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import {
	type SoundCloudTrack,
	SoundCloudTrackError,
} from "$lib/soundcloud/soundcloud-track";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import { getVideoDetails } from "$lib/video-details-cache";
import {
	fetchThumbnailBuffer,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import { waitForBgutilPot } from "$lib/wait-for-bgutil-pot";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureBgutilPlugin } from "$lib/yt-dlp-binary";

type Send = (data: Record<string, unknown>) => void;

export interface DownloadAttemptInput {
	outputPath: string;
	ffmpegPath: string;
	debugMode: boolean;
	ytDlp: YtDlpInstance;
	signal: AbortSignal;
}

export interface PreparedDownload {
	titleState: DownloadTitle;
	/** The uploading channel. buildID3Tags uses it to recognise label uploads. */
	uploader: string;
	detailsPromise: Promise<VideoDetails | null>;
	thumbnailPromise: Promise<ThumbnailImage | null>;
	/** Present only for SoundCloud; selects its cover-art order in finalizeMp3. */
	soundCloudArtwork?: SoundCloudArtwork;
	runAttempt: (input: DownloadAttemptInput) => Promise<void>;
}

const BGUTIL_MISCONFIGURED_MESSAGE =
	"Server is misconfigured: BGUTIL_POT_URL is not set. Downloads cannot run without the bgutil-pot sidecar.";

/**
 * Railway's log timestamps put the sidecar's cold start at up to ~9 s (an upper
 * bound; see waitForBgutilPot). A wait well past that is a sidecar that is down,
 * not starting, and holding the user longer would only delay the failure they
 * are going to get.
 */
const SIDECAR_WAKE_CAP_MS = 12_000;

/**
 * A warm sidecar answers in milliseconds. A first ping that answered but took
 * this long is still a cold start worth a log line — a ping can hang for most of
 * its 3 s timeout and then succeed, which needs no second attempt to count.
 */
const SLOW_WAKE_LOG_MS = 250;

function emptyTitleState(): DownloadTitle {
	return { videoTitle: "", artist: "", trackTitle: "" };
}

export function sendTitleInfo(send: Send, titleState: DownloadTitle): void {
	send({
		type: "info",
		title: titleState.videoTitle,
		artist: titleState.artist,
		track: titleState.trackTitle,
	});
}

/**
 * `POST /api/preview` nudges the sleeping bgutil-pot sidecar awake while the
 * user reads the preview, but that ping is fire-and-forget, so a click before
 * the sidecar listens still reaches yt-dlp while it is booting. yt-dlp then
 * cannot fetch a PO token, YouTube bot-checks the `web` player request, and the
 * failure is indistinguishable from a throttled IP. The retry below used to be
 * the only thing recovering it (2026-09-17 00:59:41: a direct curl of this
 * route with no preview; the first attempt failed, the retry minted a token and
 * succeeded). How often browser users reach this route that early is
 * unmeasured: after a paste the page's first contact with the sidecar is
 * `/api/preview/details`, not this route.
 *
 * Waiting here turns that into a deterministic start. It never fails the
 * download: if the sidecar stays silent the attempt goes ahead anyway and the
 * retry loop is still the safety net.
 */
async function waitForSidecar(
	bgutilPotUrl: string,
	videoId: string,
	signal: AbortSignal,
	send: Send,
): Promise<void> {
	const wake = await waitForBgutilPot(bgutilPotUrl, {
		maxWaitMs: SIDECAR_WAKE_CAP_MS,
		signal,
		onWaiting: () =>
			send({ type: "status", message: "Waking up the downloader..." }),
	});

	if (wake.awake) {
		if (wake.attempts > 1 || wake.waitedMs >= SLOW_WAKE_LOG_MS) {
			console.info(
				`bgutil-pot answered /ping after ${wake.attempts} attempts, ${wake.waitedMs}ms`,
			);
		}
		return;
	}
	if (signal.aborted) return;

	const summary = `${wake.attempts} attempts, ${wake.waitedMs}ms`;
	console.warn(
		`bgutil-pot did not answer /ping before the download: ${summary}`,
	);
	Sentry.addBreadcrumb({
		category: "download",
		level: "warning",
		message: "bgutil-pot did not answer /ping before the download started",
		data: { videoId, attempts: wake.attempts, waitedMs: wake.waitedMs },
	});
}

async function prepareYouTubeDownload(
	link: MediaLink,
	send: Send,
	signal: AbortSignal,
): Promise<PreparedDownload | null> {
	send({ type: "status", message: "Getting video info..." });

	if (env.BGUTIL_POT_URL) {
		await waitForSidecar(env.BGUTIL_POT_URL, link.id, signal, send);
		if (signal.aborted) {
			throw signal.reason ?? new Error("Download aborted");
		}
	}

	const titleState = emptyTitleState();
	let uploader = "";
	const detailsPromise: Promise<VideoDetails | null> = getVideoDetails(
		link.id,
		link.canonicalUrl,
	).catch(() => null);
	const thumbnailPromise: Promise<ThumbnailImage | null> = fetchThumbnailBuffer(
		link.id,
	).catch(() => null);

	try {
		const metadata = await fetchYouTubeMetadata(link.id);
		titleState.videoTitle = metadata.videoTitle;
		titleState.artist = metadata.artist;
		titleState.trackTitle = metadata.trackTitle;
		uploader = metadata.uploader;

		console.log("Got metadata from oEmbed:", {
			videoTitle: titleState.videoTitle,
			artist: titleState.artist,
			trackTitle: titleState.trackTitle,
			uploader: metadata.uploader,
		});

		sendTitleInfo(send, titleState);
	} catch (err) {
		if (err instanceof YouTubeMetadataError) {
			console.log("oEmbed metadata failed:", err.message);
			if (err.isUnavailable) {
				send({ type: "error", message: "Video not found or unavailable" });
				return null;
			}
		} else {
			console.error("Metadata fetch error:", err);
		}
	}

	send({ type: "status", message: "Starting download..." });

	const bgutilPotUrl = env.BGUTIL_POT_URL;
	if (!bgutilPotUrl) {
		send({ type: "error", message: BGUTIL_MISCONFIGURED_MESSAGE });
		Sentry.captureMessage("BGUTIL_POT_URL is unset", {
			level: "error",
			tags: { service: "download-stream", operation: "bgutil-pot-config" },
		});
		return null;
	}
	const pluginDir = await ensureBgutilPlugin();

	return {
		titleState,
		uploader,
		detailsPromise,
		thumbnailPromise,
		runAttempt: ({ outputPath, ffmpegPath, debugMode, ytDlp, signal }) =>
			tryYtDlpDownload({
				videoUrl: link.canonicalUrl,
				outputPath,
				bgutilPotUrl,
				ffmpegPath,
				pluginDir,
				debugMode,
				ytDlp,
				send,
				signal,
			}),
	};
}

/**
 * Everything knowable before yt-dlp runs is checked here, so a Go+ preview,
 * a geo-block or a deleted track never enters the retry loop or reaches
 * Sentry — like a private YouTube video, they are normal operation. A lookup
 * that failed for any other reason was already reported by
 * fetchSoundCloudTrack; the download goes ahead, as it does for YouTube when
 * oEmbed fails.
 */
async function prepareSoundCloudDownload(
	link: MediaLink,
	send: Send,
): Promise<PreparedDownload | null> {
	send({ type: "status", message: "Getting track info..." });

	let track: SoundCloudTrack | null = null;
	try {
		track = await getSoundCloudTrack(link);
	} catch (err) {
		if (err instanceof SoundCloudTrackError && err.isUnavailable) {
			send({ type: "error", message: "Track not found or unavailable" });
			return null;
		}
		console.error("SoundCloud metadata error:", err);
	}

	const refusal = track && soundCloudRefusal(track);
	if (refusal) {
		Sentry.addBreadcrumb({
			category: "download",
			level: "info",
			message: `Download rejected: ${refusal}`,
			data: { videoId: link.id },
		});
		send({ type: "error", message: refusal });
		return null;
	}

	const titleState = track ? soundCloudTitleState(track) : emptyTitleState();
	if (track) sendTitleInfo(send, titleState);

	send({ type: "status", message: "Starting download..." });

	return {
		titleState,
		uploader: track?.uploader ?? "",
		detailsPromise: Promise.resolve(track ? soundCloudDetails(track) : null),
		thumbnailPromise: Promise.resolve(null),
		soundCloudArtwork: {
			artworkUrl: track?.artworkUrl,
			avatarUrl: track?.avatarUrl,
		},
		runAttempt: ({ outputPath, ffmpegPath, debugMode, ytDlp, signal }) =>
			trySoundCloudDownload({
				videoUrl: link.canonicalUrl,
				outputPath,
				ffmpegPath,
				debugMode,
				ytDlp,
				send,
				signal,
			}),
	};
}

/** `null` means an error event was already sent and the stream should close. */
export function prepareDownload(
	link: MediaLink,
	send: Send,
	signal: AbortSignal,
): Promise<PreparedDownload | null> {
	return link.kind === "youtube"
		? prepareYouTubeDownload(link, send, signal)
		: prepareSoundCloudDownload(link, send);
}
