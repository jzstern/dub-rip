/**
 * Browser-safe on purpose: the page imports this (through media-link.ts) to
 * decide whether Download is enabled, so it must not pull in server code.
 */

export interface BandcampTrackRef {
	/** `artist-subdomain/track-slug`, lowercased. */
	id: string;
	canonicalUrl: string;
}

/**
 * Only `<artist>.bandcamp.com`. Artists on a custom domain serve the same
 * pages, but nothing in the URL says so, and accepting arbitrary hosts would
 * turn the track-page fetch into a request to any server a user names.
 */
const ARTIST_HOST = /^([a-z0-9][a-z0-9-]*)\.bandcamp\.com$/;
const NON_ARTIST_SUBDOMAINS = new Set(["www", "daily", "blog", "m"]);
const SLUG = /^[a-z0-9_-]+$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

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

/** Album links are deliberately unsupported: one link, one file. */
export function parseBandcampTrackUrl(input: string): BandcampTrackRef | null {
	const url = toHttpUrl(input);
	if (!url) return null;

	const artist = url.hostname.toLowerCase().match(ARTIST_HOST)?.[1];
	if (!artist || NON_ARTIST_SUBDOMAINS.has(artist)) return null;

	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 2 || segments[0] !== "track") return null;
	const slug = segments[1]?.toLowerCase() ?? "";
	if (!SLUG.test(slug)) return null;

	return {
		id: `${artist}/${slug}`,
		canonicalUrl: `https://${artist}.bandcamp.com/track/${slug}`,
	};
}
