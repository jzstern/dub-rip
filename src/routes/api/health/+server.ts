import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
	try {
		// Test if we can import the dependencies
		const _YTDlpWrap = (await import("yt-dlp-wrap")).default;
		const ffmpegPath = (await import("@ffmpeg-installer/ffmpeg")).default;

		return json({
			status: "ok",
			ytdlp: "imported",
			ffmpeg: ffmpegPath.path,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		return json(
			{
				status: "error",
				error: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
};
