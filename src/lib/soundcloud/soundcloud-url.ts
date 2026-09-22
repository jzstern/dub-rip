/**
 * Browser-safe on purpose: the page imports this (through media-link.ts) to
 * decide whether Download is enabled, so it must not pull in server code.
 */

export interface SoundCloudTrackRef {
	/** `user/slug`, lowercased, plus `/s-<token>` for a private share link (token case kept). */
	id: string;
	canonicalUrl: string;
}

const TRACK_HOSTS = new Set([
	"soundcloud.com",
	"www.soundcloud.com",
	"m.soundcloud.com",
]);
const SHORT_LINK_HOST = "on.soundcloud.com";
const PERMALINK_SEGMENT = /^[a-z0-9_-]+$/i;
const SECRET_TOKEN_SEGMENT = /^s-[a-z0-9]+$/i;
const SHORT_LINK_CODE = /^[a-z0-9]+$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** First path segments that are site pages, not user profiles. */
const RESERVED_USER_SEGMENTS = new Set([
	"charts",
	"discover",
	"feed",
	"jobs",
	"messages",
	"mobile",
	"notifications",
	"pages",
	"people",
	"search",
	"settings",
	"signin",
	"stations",
	"stream",
	"tags",
	"terms-of-use",
	"upload",
	"you",
]);

/** Second path segments that are a profile's sub-pages, not a track. */
const RESERVED_TRACK_SEGMENTS = new Set([
	"albums",
	"comments",
	"followers",
	"following",
	"likes",
	"playlists",
	"popular-tracks",
	"reposts",
	"sets",
	"spotlight",
	"stations",
	"toptracks",
	"tracks",
]);

function toHttpUrl(input: string): URL | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(
			HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`,
		);
		return url.protocol === "https:" || url.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}

function pathSegments(url: URL): string[] {
	return url.pathname.split("/").filter(Boolean);
}

export function parseSoundCloudTrackUrl(
	input: string,
): SoundCloudTrackRef | null {
	const url = toHttpUrl(input);
	if (!url || !TRACK_HOSTS.has(url.hostname.toLowerCase())) return null;

	const segments = pathSegments(url);
	if (segments.length < 2 || segments.length > 3) return null;
	const [user = "", slug = "", secret] = segments;

	if (!PERMALINK_SEGMENT.test(user) || !PERMALINK_SEGMENT.test(slug))
		return null;
	if (RESERVED_USER_SEGMENTS.has(user.toLowerCase())) return null;
	if (RESERVED_TRACK_SEGMENTS.has(slug.toLowerCase())) return null;
	if (secret !== undefined && !SECRET_TOKEN_SEGMENT.test(secret)) return null;

	const id = [`${user}/${slug}`.toLowerCase(), secret]
		.filter(Boolean)
		.join("/");
	return { id, canonicalUrl: `https://soundcloud.com/${id}` };
}

export function parseSoundCloudShortLinkCode(input: string): string | null {
	const url = toHttpUrl(input);
	if (!url || url.hostname.toLowerCase() !== SHORT_LINK_HOST) return null;
	const segments = pathSegments(url);
	const code = segments[0];
	return segments.length === 1 && code && SHORT_LINK_CODE.test(code)
		? code
		: null;
}
