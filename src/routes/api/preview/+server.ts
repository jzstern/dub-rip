import * as Sentry from "@sentry/sveltekit";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { resolveArtworkUrl } from "$lib/artwork";
import { type MediaLink, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import { resolveMediaLink } from "$lib/resolve-media-link";
import {
	soundCloudRefusal,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import { SoundCloudTrackError } from "$lib/soundcloud/soundcloud-track";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import type { RequestHandler } from "./$types";

const PREVIEW_ARTWORK_SIZE = 300;
const PREVIEW_ARTWORK_TIMEOUT = 4000;
const BGUTIL_PREWARM_TIMEOUT = 2000;

/**
 * Nudges the sleeping bgutil-pot sidecar awake, without waiting for it.
 *
 * The sidecar sleeps when inactive, and its first PO token costs a BotGuard
 * bootstrap (~2.3 MB of YouTube's `base.js`) on top of the container start.
 * A user pastes a URL seconds before clicking Download, so paying that here
 * moves it off the download's critical path at zero idle cost — the wake was
 * going to happen anyway.
 *
 * `/ping` is the healthcheck (`healthcheckPath` in `railway.toml`); it starts
 * the container without doing speculative BotGuard work, which `/get_pot`
 * would.
 */
function prewarmBgutilPot(): void {
	if (!env.BGUTIL_POT_URL) return;

	fetch(`${env.BGUTIL_POT_URL}/ping`, {
		signal: AbortSignal.timeout(BGUTIL_PREWARM_TIMEOUT),
		// Deliberately unreported: the sidecar sleeps, so a cold or slow /ping is
		// the normal case and the download path wakes it regardless. See the
		// exclusions in docs/error-reporting.md.
	}).catch(() => undefined);
}

/**
 * The upload's own artwork is the preview image whenever it has one — the
 * same order resolveSoundCloudAlbumArt uses — so the cover a user sees is
 * the cover they get. No bgutil prewarm: SoundCloud never uses the sidecar.
 * fetchSoundCloudTrack already decided what to report, as fetchYouTubeMetadata
 * does for YouTube, so its errors are answered here without a second capture.
 */
async function previewSoundCloud(link: MediaLink): Promise<Response> {
	try {
		const track = await getSoundCloudTrack(link);
		const refusal = soundCloudRefusal(track);
		if (refusal) {
			return json({ error: refusal }, { status: 422 });
		}

		const { artist, trackTitle } = soundCloudTitleState(track);
		const artwork =
			track.artworkUrl ??
			(await resolveArtworkUrl(artist, trackTitle, {
				itunesSize: PREVIEW_ARTWORK_SIZE,
				timeout: PREVIEW_ARTWORK_TIMEOUT,
			}));

		return json({
			success: true,
			videoTitle: track.title,
			artist,
			title: trackTitle,
			thumbnail: track.artworkUrl ?? track.avatarUrl ?? "",
			artwork: artwork ?? undefined,
			duration: track.durationSeconds,
		});
	} catch (error) {
		if (!(error instanceof SoundCloudTrackError)) throw error;
		console.error("Preview error:", error.message);
		return error.isUnavailable
			? json({ error: "Track is unavailable or private" }, { status: 404 })
			: json({ error: "Failed to load preview" }, { status: 500 });
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const link = await resolveMediaLink(url);
		if (!link) {
			return json({ error: UNSUPPORTED_LINK_MESSAGE }, { status: 400 });
		}

		if (link.kind === "soundcloud") {
			return await previewSoundCloud(link);
		}

		const videoId = link.id;

		prewarmBgutilPot();

		const metadata = await fetchYouTubeMetadata(videoId);
		const artwork = await resolveArtworkUrl(
			metadata.artist,
			metadata.trackTitle,
			{ itunesSize: PREVIEW_ARTWORK_SIZE, timeout: PREVIEW_ARTWORK_TIMEOUT },
		);

		return json({
			success: true,
			videoTitle: metadata.videoTitle,
			artist: metadata.artist,
			title: metadata.trackTitle,
			thumbnail: metadata.thumbnailUrl,
			artwork: artwork ?? undefined,
		});
	} catch (error) {
		/**
		 * `fetchYouTubeMetadata` decides what to report for every
		 * `YouTubeMetadataError` — an unavailable video deliberately stays
		 * unreported, a 5xx or timeout is already a warning. Capturing again
		 * here filed a second issue for one incident.
		 *
		 * Anything else reaching this catch is unexpected (a malformed body,
		 * an artwork bug) and would otherwise be invisible, since this route
		 * catches everything and SvelteKit's `handleError` never sees it.
		 */
		if (error instanceof YouTubeMetadataError) {
			console.error("Preview error:", error.message);
			if (error.isUnavailable) {
				return json(
					{ error: "Video is unavailable or private" },
					{ status: 404 },
				);
			}
		} else {
			const message = error instanceof Error ? error.message : "Unknown error";
			console.error("Preview error:", message);
			Sentry.captureException(
				error instanceof Error ? error : new Error(message),
				{ tags: { service: "preview", operation: "load-preview" } },
			);
		}

		return json({ error: "Failed to load preview" }, { status: 500 });
	}
};
