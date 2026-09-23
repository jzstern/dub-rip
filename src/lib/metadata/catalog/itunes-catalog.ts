import type { CatalogCandidate } from "./catalog-candidate";

/**
 * iTunes Search, which the artwork lookup already calls. It gives album,
 * release date, genre and duration, but never an ISRC or a label.
 *
 * The limit is Apple's: about 20 calls per minute per IP. A failure of any
 * kind returns no candidates, so a lookup can never fail a preview.
 */

const SEARCH_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 6000;
const ARTWORK_SIZE = 600;

/** Artwork URLs are fetched later, so only Apple's own CDN is accepted. */
const ARTWORK_HOST = /(?:^|\.)mzstatic\.com$/;

/** iTunes marks a compilation by crediting the collection to Various Artists. */
const COMPILATION_ARTIST = "various artists";

interface ITunesResult {
	wrapperType?: unknown;
	kind?: unknown;
	trackName?: unknown;
	artistName?: unknown;
	collectionName?: unknown;
	collectionArtistName?: unknown;
	releaseDate?: unknown;
	primaryGenreName?: unknown;
	trackTimeMillis?: unknown;
	artworkUrl100?: unknown;
}

export function itunesSearchUrl(term: string, limit = SEARCH_LIMIT): string {
	return `https://itunes.apple.com/search?term=${encodeURIComponent(
		term,
	)}&entity=song&limit=${limit}`;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function coverArtUrl(artworkUrl100: unknown): string | undefined {
	const url = optionalString(artworkUrl100);
	if (!url) return undefined;
	try {
		if (!ARTWORK_HOST.test(new URL(url).hostname)) return undefined;
	} catch {
		return undefined;
	}
	return url.replace("100x100bb", `${ARTWORK_SIZE}x${ARTWORK_SIZE}bb`);
}

function toCandidate(result: ITunesResult): CatalogCandidate | null {
	const title = optionalString(result.trackName);
	const artist = optionalString(result.artistName);
	if (!title || !artist || result.kind !== "song") return null;

	const durationMs = result.trackTimeMillis;
	return {
		source: "itunes",
		artist,
		title,
		album: optionalString(result.collectionName),
		isCompilation:
			optionalString(result.collectionArtistName)?.toLowerCase() ===
			COMPILATION_ARTIST,
		releaseDate: optionalString(result.releaseDate)?.slice(0, 10),
		durationSeconds:
			typeof durationMs === "number" && durationMs > 0
				? Math.round(durationMs / 1000)
				: undefined,
		genre: optionalString(result.primaryGenreName),
		artworkUrl: coverArtUrl(result.artworkUrl100),
	};
}

export interface CatalogRequestOptions {
	timeout?: number;
}

export async function searchITunes(
	term: string,
	{ timeout = DEFAULT_TIMEOUT_MS }: CatalogRequestOptions = {},
): Promise<CatalogCandidate[]> {
	if (!term.trim()) return [];
	try {
		const response = await fetch(itunesSearchUrl(term), {
			signal: AbortSignal.timeout(Math.round(timeout)),
		});
		if (!response.ok) {
			console.warn(`[catalog] itunes search failed: HTTP ${response.status}`);
			return [];
		}
		const body = (await response.json()) as { results?: ITunesResult[] };
		if (!Array.isArray(body?.results)) return [];
		return body.results
			.map(toCandidate)
			.filter((candidate): candidate is CatalogCandidate => candidate !== null);
	} catch (error) {
		console.warn(
			`[catalog] itunes search failed: ${error instanceof Error ? error.message : error}`,
		);
		return [];
	}
}
