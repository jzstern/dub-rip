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

		if (!details || typeof details.duration !== "number") {
			throw new Error("Could not parse duration from yt-dlp output");
		}

		return json({
			success: true,
			duration: details.duration,
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Preview details error:", message);

		return json(
			{
				error: "Failed to load details",
			},
			{ status: 500 },
		);
	}
};
