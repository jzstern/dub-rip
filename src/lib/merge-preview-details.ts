import type { VideoPreview } from "$lib/types";

/** The fields `/api/preview/details` may answer with, each one optional. */
export interface PreviewDetails {
	duration?: number;
	artist?: string;
	title?: string;
	artwork?: string;
}

/**
 * Key-conditional, because /details answers `{success:true}` alone when a
 * SoundCloud track carries no duration — spreading absent keys would blank the
 * card. A canonical artist/title arrives only when the catalog match survived
 * the duration check, so an absent one leaves the heuristic identity standing.
 */
export function mergePreviewDetails(
	preview: VideoPreview,
	details: PreviewDetails,
): VideoPreview {
	return {
		...preview,
		...(typeof details.duration === "number"
			? { duration: details.duration }
			: {}),
		...(details.artist ? { artist: details.artist } : {}),
		...(details.title ? { title: details.title } : {}),
		...(details.artwork ? { artwork: details.artwork } : {}),
	};
}
