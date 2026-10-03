import * as Sentry from "@sentry/sveltekit";
import { json } from "@sveltejs/kit";
import {
	bandcampDetails,
	bandcampTitleState,
} from "$lib/bandcamp/bandcamp-metadata";
import { getBandcampTrack } from "$lib/bandcamp/bandcamp-track-cache";
import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import { type MediaLink, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import {
	cardSizedArtwork,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import type { TrackQuery } from "$lib/metadata/catalog/catalog-candidate";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";
import { readUrlFromBody } from "$lib/read-url-body";
import { resolveMediaLink } from "$lib/resolve-media-link";
import {
	soundCloudDetails,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import { getVideoDetails } from "$lib/video-details-cache";
import type { VideoDetails } from "$lib/video-metadata";
import type { RequestHandler } from "./$types";

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;

/**
 * A SoundCloud or Bandcamp track, read from its own page. The title state is
 * kept, not just the details: those deliberately withhold `artist` and
 * `track`, so without it there is no identity left to query the catalog with.
 */
interface PlatformTrack {
	titleState: DownloadTitle;
	details: VideoDetails;
	hasOwnArtwork: boolean;
}

async function loadPlatformTrack(
	link: MediaLink,
): Promise<PlatformTrack | null> {
	if (link.kind === "soundcloud") {
		const track = await getSoundCloudTrack(link).catch(() => null);
		return (
			track && {
				titleState: soundCloudTitleState(track),
				details: soundCloudDetails(track),
				hasOwnArtwork: Boolean(track.artworkUrl),
			}
		);
	}
	if (link.kind === "bandcamp") {
		const track = await getBandcampTrack(link).catch(() => null);
		return (
			track && {
				titleState: bandcampTitleState(track),
				details: bandcampDetails(track),
				hasOwnArtwork: Boolean(track.artworkUrl),
			}
		);
	}
	return null;
}
const DETAILS_CATALOG_TIMEOUT_MS = 4000;

/**
 * The same query the preview built, now with the duration — the evidence a
 * YouTube preview could not have, and what lets a text-only match be confirmed
 * or refused here.
 *
 * Derived entirely server-side, from the upload's own title and uploader
 * through the same heuristic the preview and the download use. It is
 * deliberately NOT taken from the request body: the identity becomes a key in a
 * cache shared across requests, so letting a caller choose it would let anyone
 * seed another user's track with candidates fetched for a string they picked,
 * and mint unbounded keys in a cache that never evicts.
 */
function detailsQuery(
	details: VideoDetails,
	platform: PlatformTrack | null,
): TrackQuery {
	if (platform) {
		const { artist, trackTitle } = platform.titleState;
		return {
			artist,
			title: trackTitle,
			isrc: platform.details.isrc,
			durationSeconds: platform.details.duration,
		};
	}
	/**
	 * No `labelName`, though `details` has one: the preview and the download
	 * resolve this identity from oEmbed, which has none, and a different
	 * identity here is a different cache key — the card would show one verdict
	 * and the file get another.
	 */
	const { artist, trackTitle } = resolveTrackIdentity({
		rawTitle: details.title ?? "",
		uploader: details.uploader ?? "",
	});
	return { artist, title: trackTitle, durationSeconds: details.duration };
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const url = await readUrlFromBody(request);

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const link = await resolveMediaLink(url);
		if (!link) {
			return json({ error: UNSUPPORTED_LINK_MESSAGE }, { status: 400 });
		}
		const videoId = link.id;

		const platform = await loadPlatformTrack(link);
		const details =
			link.kind === "youtube"
				? await getVideoDetails(videoId, link.canonicalUrl, {
						timeout: DURATION_EXTRACTION_TIMEOUT_MS,
					})
				: platform?.details;

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
			// parsed SoundCloud or Bandcamp page can yield a track with no
			// duration — so a missing duration is expected here, not an
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
			detailsQuery(details, platform),
			{
				timeout: DETAILS_CATALOG_TIMEOUT_MS,
			},
		);

		/**
		 * Match-only keys, never a `canonical: null`: the client merges whatever
		 * arrives, so an absent key leaves the heuristic identity standing.
		 *
		 * No catalog cover for a SoundCloud or Bandcamp upload that has its own:
		 * the file gets the upload's cover (`resolvePlatformAlbumArt` tries it
		 * first), and the card has to show the cover the file will carry.
		 */
		const catalogCover =
			verdict.status === "matched" && !platform?.hasOwnArtwork
				? verdict.metadata.artworkUrl
				: undefined;
		return json({
			success: true,
			duration: details.duration,
			...(verdict.status === "matched"
				? {
						artist: verdict.metadata.artist,
						title: verdict.metadata.title,
						...(catalogCover
							? { artwork: cardSizedArtwork(catalogCover) }
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
