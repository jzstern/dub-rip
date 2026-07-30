import * as Sentry from "@sentry/sveltekit";
import { json } from "@sveltejs/kit";
import { getVideoDetails } from "$lib/video-details-cache";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";
import type { RequestHandler } from "./$types";

const DURATION_EXTRACTION_TIMEOUT_MS = 12_000;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: "URL is required" }, { status: 400 });
		}

		const videoId = extractVideoId(url);
		if (!videoId) {
			return json({ error: "Invalid YouTube URL" }, { status: 400 });
		}

		const normalizedUrl = buildWatchUrl(videoId);

		const details = await getVideoDetails(videoId, normalizedUrl, {
			timeout: DURATION_EXTRACTION_TIMEOUT_MS,
		});

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
			Sentry.captureException(
				new Error("yt-dlp returned video details without a duration"),
				{
					tags: { service: "preview-details", operation: "parse-duration" },
					extra: { videoId },
				},
			);
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
