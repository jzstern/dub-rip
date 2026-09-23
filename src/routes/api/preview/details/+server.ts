import * as Sentry from "@sentry/sveltekit";
import { json } from "@sveltejs/kit";
import { UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import { resolveMediaLink } from "$lib/resolve-media-link";
import { soundCloudDetails } from "$lib/soundcloud/soundcloud-metadata";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import { getVideoDetails } from "$lib/video-details-cache";
import type { RequestHandler } from "./$types";

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;

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
		const videoId = link.id;

		const details =
			link.kind === "youtube"
				? await getVideoDetails(videoId, link.canonicalUrl, {
						timeout: DURATION_EXTRACTION_TIMEOUT_MS,
					})
				: await getSoundCloudTrack(link)
						.then(soundCloudDetails)
						.catch(() => null);

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
			// A SoundCloud track lacks a duration only when its page couldn't be
			// read, which fetchSoundCloudTrack already reported.
			if (link.kind === "youtube") {
				Sentry.captureException(
					new Error("yt-dlp returned video details without a duration"),
					{
						tags: { service: "preview-details", operation: "parse-duration" },
						extra: { videoId },
					},
				);
			}
			return json({ error: "Failed to load details" }, { status: 500 });
		}

		return json({
			success: true,
			duration: details.duration,
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
