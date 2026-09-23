import type { CatalogCandidate } from "./catalog-candidate";
import type { CatalogRequestOptions } from "./itunes-catalog";

/**
 * Deezer, which the artwork lookup already calls. Its search results carry the
 * ISRC, and `/track/isrc:` turns an ISRC from a SoundCloud upload straight into
 * a release. The label and the genre live on the album, one call further.
 *
 * Two quirks drive this code:
 * - Field-scoped search (`artist:"x" track:"y"`) returns nothing today, even
 *   for Deezer's own documented example, so only free text is used.
 * - Errors arrive as HTTP 200 with an `error` object, quota included.
 */

const SEARCH_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 6000;

/** Artwork URLs are fetched later, so only Deezer's own CDN is accepted. */
const ARTWORK_HOST = /(?:^|\.)dzcdn\.net$/;

interface DeezerArtist {
	name?: unknown;
}

interface DeezerAlbumRef {
	id?: unknown;
	title?: unknown;
	cover_xl?: unknown;
	cover_big?: unknown;
	cover_medium?: unknown;
}

interface DeezerTrack {
	title?: unknown;
	title_short?: unknown;
	duration?: unknown;
	isrc?: unknown;
	release_date?: unknown;
	artist?: DeezerArtist;
	album?: DeezerAlbumRef;
}

interface DeezerError {
	error?: { message?: unknown; code?: unknown };
}

export interface DeezerAlbumInfo {
	label?: string;
	genre?: string;
	releaseDate?: string;
	isCompilation: boolean;
}

export function deezerSearchUrl(term: string, limit = SEARCH_LIMIT): string {
	return `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`;
}

export function deezerIsrcUrl(isrc: string): string {
	return `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`;
}

export function deezerAlbumUrl(albumId: string): string {
	return `https://api.deezer.com/album/${encodeURIComponent(albumId)}`;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

function coverArtUrl(album: DeezerAlbumRef | undefined): string | undefined {
	const url =
		optionalString(album?.cover_xl) ??
		optionalString(album?.cover_big) ??
		optionalString(album?.cover_medium);
	if (!url) return undefined;
	try {
		return ARTWORK_HOST.test(new URL(url).hostname) ? url : undefined;
	} catch {
		return undefined;
	}
}

function toCandidate(track: DeezerTrack): CatalogCandidate | null {
	const title =
		optionalString(track.title) ?? optionalString(track.title_short);
	const artist = optionalString(track.artist?.name);
	if (!title || !artist) return null;

	const duration = track.duration;
	return {
		source: "deezer",
		artist,
		title,
		album: optionalString(track.album?.title),
		albumId: optionalString(track.album?.id),
		releaseDate: optionalString(track.release_date)?.slice(0, 10),
		durationSeconds:
			typeof duration === "number" && duration > 0 ? duration : undefined,
		isrc: optionalString(track.isrc),
		artworkUrl: coverArtUrl(track.album),
	};
}

/** Deezer answers 200 with an `error` object, including for quota. */
function payloadError(body: unknown): string | null {
	const error = (body as DeezerError | null)?.error;
	if (!error) return null;
	return `${optionalString(error.message) ?? "error"} (code ${
		optionalString(error.code) ?? "?"
	})`;
}

async function requestDeezer(
	url: string,
	operation: string,
	timeout: number,
): Promise<unknown | null> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(Math.round(timeout)),
		});
		if (!response.ok) {
			console.warn(
				`[catalog] deezer ${operation} failed: HTTP ${response.status}`,
			);
			return null;
		}
		const body = await response.json();
		const error = payloadError(body);
		if (error) {
			console.warn(`[catalog] deezer ${operation} failed: ${error}`);
			return null;
		}
		return body;
	} catch (error) {
		console.warn(
			`[catalog] deezer ${operation} failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
		return null;
	}
}

export async function searchDeezer(
	term: string,
	{ timeout = DEFAULT_TIMEOUT_MS }: CatalogRequestOptions = {},
): Promise<CatalogCandidate[]> {
	if (!term.trim()) return [];
	const body = (await requestDeezer(
		deezerSearchUrl(term),
		"search",
		timeout,
	)) as { data?: DeezerTrack[] } | null;
	if (!Array.isArray(body?.data)) return [];
	return body.data
		.map(toCandidate)
		.filter((candidate): candidate is CatalogCandidate => candidate !== null);
}

export async function deezerTrackByIsrc(
	isrc: string,
	{ timeout = DEFAULT_TIMEOUT_MS }: CatalogRequestOptions = {},
): Promise<CatalogCandidate | null> {
	if (!isrc.trim()) return null;
	const body = (await requestDeezer(
		deezerIsrcUrl(isrc),
		"isrc lookup",
		timeout,
	)) as DeezerTrack | null;
	return body ? toCandidate(body) : null;
}

export async function deezerAlbum(
	albumId: string,
	{ timeout = DEFAULT_TIMEOUT_MS }: CatalogRequestOptions = {},
): Promise<DeezerAlbumInfo | null> {
	if (!albumId.trim()) return null;
	const body = (await requestDeezer(
		deezerAlbumUrl(albumId),
		"album lookup",
		timeout,
	)) as {
		label?: unknown;
		record_type?: unknown;
		release_date?: unknown;
		genres?: { data?: { name?: unknown }[] };
	} | null;
	if (!body) return null;

	return {
		label: optionalString(body.label),
		genre: optionalString(body.genres?.data?.[0]?.name),
		releaseDate: optionalString(body.release_date)?.slice(0, 10),
		isCompilation: body.record_type === "compile",
	};
}
