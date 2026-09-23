import {
	type CatalogCandidate,
	type CatalogVerdict,
	releaseYear,
	type TrackQuery,
} from "./catalog-candidate";
import { deezerAlbum, deezerTrackByIsrc, searchDeezer } from "./deezer-catalog";
import { searchITunes } from "./itunes-catalog";
import { judgeCandidates } from "./judge-candidates";
import { collapseWhitespace, normalizeForMatch } from "./normalize-text";
import { parseTrackTitle } from "./track-version";

/**
 * Looks a track up in iTunes and Deezer and judges what comes back.
 *
 * Candidates are cached, verdicts are not: evidence arrives in stages — a
 * preview has only the upload title, the download also has the duration the
 * yt-dlp details call already fetched — and re-judging cached candidates costs
 * nothing while letting a later stage accept what an earlier one could not.
 *
 * The cache is a port rather than a module so that the wiring stage can pass
 * the app's single-flight cache in. Without one the lookup still works, one
 * fetch at a time.
 */

export const CANDIDATE_TTL_MS = 10 * 60 * 1000;

export interface CandidateCache {
	get<T>(key: string, factory: () => Promise<T>, ttlMs: number): Promise<T>;
}

export interface LookupOptions {
	timeout?: number;
	cache?: CandidateCache;
	/** Fetch the Deezer album for label and genre. Off for previews, which show neither. */
	enrich?: boolean;
}

/**
 * The words worth searching for: the artist, the song, its featured credits and
 * any version that names a different recording. Neutral text is dropped, so
 * "Bohemian Rhapsody (Official Video Remastered)" searches as the song itself —
 * with the noise left in, the catalogs answer with covers and lullaby versions.
 */
export function searchTerm(query: TrackQuery): string {
	const parsed = parseTrackTitle(query.title);
	/** `unknown` is the sentinel for a bracket we could not classify, not a word to search for. */
	const versions = parsed.tags
		.filter((tag) => tag.class !== "neutral")
		.flatMap((tag) => [
			tag.credit ?? "",
			tag.kind === "unknown" ? "" : tag.kind,
		]);
	return collapseWhitespace(
		[query.artist, parsed.base, ...parsed.featured, ...versions].join(" "),
	);
}

export function candidateCacheKey(query: TrackQuery): string {
	return [
		normalizeForMatch(query.artist),
		normalizeForMatch(query.title),
		query.isrc?.toUpperCase() ?? "",
	].join("|");
}

/**
 * An ISRC identifies the recording outright, so it is tried alone. A wrong or
 * unknown one falls through to the searches rather than ending the lookup.
 */
export async function fetchCatalogCandidates(
	query: TrackQuery,
	{ timeout }: Pick<LookupOptions, "timeout"> = {},
): Promise<CatalogCandidate[]> {
	if (query.isrc) {
		const byIsrc = await deezerTrackByIsrc(query.isrc, { timeout });
		if (byIsrc) return [byIsrc];
	}

	const term = searchTerm(query);
	if (!term) return [];

	const [itunes, deezer] = await Promise.all([
		searchITunes(term, { timeout }),
		searchDeezer(term, { timeout }),
	]);
	return [...itunes, ...deezer];
}

async function enrichFromAlbum(
	verdict: CatalogVerdict,
	timeout: number | undefined,
): Promise<CatalogVerdict> {
	if (verdict.status !== "matched") return verdict;
	const { albumId } = verdict.candidate;
	if (!albumId) return verdict;

	const album = await deezerAlbum(albumId, { timeout });
	if (!album) return verdict;

	return {
		...verdict,
		metadata: {
			...verdict.metadata,
			label: verdict.metadata.label ?? album.label,
			genre: verdict.metadata.genre ?? album.genre,
			album: album.isCompilation ? undefined : verdict.metadata.album,
			year: verdict.metadata.year ?? releaseYear(album.releaseDate),
		},
	};
}

export async function lookupCatalogMetadata(
	query: TrackQuery,
	{ timeout, cache, enrich = false }: LookupOptions = {},
): Promise<CatalogVerdict> {
	const fetchCandidates = () => fetchCatalogCandidates(query, { timeout });
	const candidates = cache
		? await cache.get(
				candidateCacheKey(query),
				fetchCandidates,
				CANDIDATE_TTL_MS,
			)
		: await fetchCandidates();

	const judged = judgeCandidates(query, candidates);
	const verdict = enrich ? await enrichFromAlbum(judged, timeout) : judged;

	console.log(
		verdict.status === "matched"
			? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
			: `[catalog] unmatched reason=${verdict.reason}`,
	);
	return verdict;
}
