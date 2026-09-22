import {
	parseSoundCloudShortLinkCode,
	parseSoundCloudTrackUrl,
} from "$lib/soundcloud/soundcloud-url";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";

export type MediaLinkKind = "youtube" | "soundcloud";

export interface MediaLink {
	kind: MediaLinkKind;
	/** YouTube video ID, or SoundCloud `user/slug[/s-token]`. */
	id: string;
	canonicalUrl: string;
}

export type ParsedMediaLink =
	| MediaLink
	| { kind: "soundcloud-short-link"; code: string };

export const UNSUPPORTED_LINK_MESSAGE =
	"Paste a YouTube video or SoundCloud track link";

/**
 * Synchronous and browser-safe: the page calls it on every keystroke to
 * enable Download. A share link parses here, but only the server can follow
 * its redirect — see resolveMediaLink.
 */
export function parseMediaLink(input: string): ParsedMediaLink | null {
	const videoId = extractVideoId(input);
	if (videoId) {
		return {
			kind: "youtube",
			id: videoId,
			canonicalUrl: buildWatchUrl(videoId),
		};
	}
	const track = parseSoundCloudTrackUrl(input);
	if (track) return { kind: "soundcloud", ...track };
	const code = parseSoundCloudShortLinkCode(input);
	return code ? { kind: "soundcloud-short-link", code } : null;
}
