import * as Sentry from "@sentry/sveltekit";
import { json } from "@sveltejs/kit";
import { UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import {
	cardSizedArtwork,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import type { TrackQuery } from "$lib/metadata/catalog/catalog-candidate";
import { resolveMediaLink } from "$lib/resolve-media-link";
import {
	soundCloudDetails,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import type { SoundCloudTrack } from "$lib/soundcloud/soundcloud-track";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import { getVideoDetails } from "$lib/video-details-cache";
import type { VideoDetails } from "$lib/video-metadata";
import type { RequestHandler } from "./$types";

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;
const DETAILS_CATALOG_TIMEOUT_MS = 4000;

/**
 * The same query the preview built, now with the duration — the evidence a
 * YouTube preview could not have, and what lets a text-only match be confirmed
 * or refused here.
 *
 * The artist and title are the heuristic ones the client echoes back, never a
 * canonical value and never `details.track` / `details.artist`: all three stages
 * have to hash to one cache key, or `/details` would judge query B against
 * candidates fetched for query A.
 */
function detailsQuery(
	details: VideoDetails,
	track: SoundCloudTrack | null,
	body: { artist?: unknown; title?: unknown },
): TrackQuery {
	if (track) {
		const { artist, trackTitle } = soundCloudTitleState(track);
		return {
			artist,
			title: trackTitle,
			isrc: track.isrc,
			durationSeconds: track.durationSeconds,
		};
	}
	return {
		artist:
			typeof body.artist === "string" ? body.artist : (details.artist ?? ""),
		title:
			typeof body.title === "string"
				? body.title
				: (details.track ?? details.title ?? ""),
		durationSeconds: details.duration,
	};
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { url } = body;

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const link = await resolveMediaLink(url);
		if (!link) {
			return json({ error: UNSUPPORTED_LINK_MESSAGE }, { status: 400 });
		}
		const videoId = link.id;

		/**
		 * The track itself is kept, not just its details: `soundCloudDetails`
		 * deliberately withholds `artist` and `track`, so without it there is no
		 * identity left to query the catalog with.
		 */
		const track =
			link.kind === "soundcloud"
				? await getSoundCloudTrack(link).catch(() => null)
				: null;
		const details =
			link.kind === "youtube"
				? await getVideoDetails(videoId, link.canonicalUrl, {
						timeout: DURATION_EXTRACTION_TIMEOUT_MS,
					})
				: track && soundCloudDetails(track);

		/**
		 * A null result means the extraction itself failed, and
		 * `fetchVideoDetails` already reported that underlying error — capturing
		 * again here would file a second issue for one incident.
		 */
		if (!details) {
			Sentry.addBreadcrumb({
				category: "preview-details",
				level: "warning",
				message: "Video details extraction returned no result",
				data: { videoId },
			});
			return json({ error: "Failed to load details" }, { status: 500 });
		}

		if (typeof details.duration !== "number") {
			// SoundCloud's oEmbed fallback (used when the track page can't be
			// parsed) carries no duration field at all, and even a successfully
			// parsed track page can yield a `found` track with no
			// `durationSeconds` — so a missing duration is expected here, not an
			// extraction failure.
			if (link.kind === "youtube") {
				Sentry.captureException(
					new Error("yt-dlp returned video details without a duration"),
					{
						tags: { service: "preview-details", operation: "parse-duration" },
						extra: { videoId },
					},
				);
				return json({ error: "Failed to load details" }, { status: 500 });
			}
			return json({ success: true });
		}

		const { verdict } = await sharedCatalogLookup(
			detailsQuery(details, track, body),
			{ timeout: DETAILS_CATALOG_TIMEOUT_MS },
		);

		/**
		 * Match-only keys, never a `canonical: null`: the client merges whatever
		 * arrives, so an absent key leaves the heuristic identity standing.
		 */
		return json({
			success: true,
			duration: details.duration,
			...(verdict.status === "matched"
				? {
						artist: verdict.metadata.artist,
						title: verdict.metadata.title,
						...(verdict.metadata.artworkUrl
							? { artwork: cardSizedArtwork(verdict.metadata.artworkUrl) }
							: {}),
					}
				: {}),
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Preview details error:", message);

		Sentry.captureException(
			error instanceof Error ? error : new Error(message),
			{ tags: { service: "preview-details", operation: "load-details" } },
		);

		return json(
			{
				error: "Failed to load details",
			},
			{ status: 500 },
		);
	}
};
