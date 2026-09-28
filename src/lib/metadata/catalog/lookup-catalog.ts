import {
	type CatalogCandidate,
	type CatalogVerdict,
	releaseYear,
	type TrackQuery,
} from "./catalog-candidate";
import { deezerAlbum, deezerTrackByIsrc, searchDeezer } from "./deezer-catalog";
import { searchITunes } from "./itunes-catalog";
import { judgeCandidates, namesTheSameSong } from "./judge-candidates";
import {
	collapseWhitespace,
	normalizeForMatch,
	normalizeIsrc,
} from "./normalize-text";
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
 * the app's own `createSingleFlightCache<CatalogCandidate[]>()` in. Without one
 * the lookup still works, one fetch at a time.
 */

export const CANDIDATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Structurally satisfied by `SingleFlightCache<CatalogCandidate[]>` from
 * $lib/single-flight-cache. Deliberately not generic in `get`: a concrete cache
 * cannot satisfy a method-level generic, which would make it unpassable.
 */
export interface CandidateCache {
	get(
		key: string,
		fetch: () => Promise<CatalogCandidate[]>,
		ttlMs: number,
	): Promise<CatalogCandidate[]>;
}

export interface LookupOptions {
	/** Total budget for the whole lookup, not per request. */
	timeout?: number;
	cache?: CandidateCache;
	/** Fetch the Deezer album for label and genre. Off for previews, which show neither. */
	enrich?: boolean;
}

/** Thrown when no catalog could be reached, so the miss is never cached as a result. */
export class CatalogUnavailableError extends Error {
	constructor() {
		super("No music catalog could be reached");
		this.name = "CatalogUnavailableError";
	}
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

/**
 * Keyed on what is actually fetched, not on the raw query: two titles that
 * differ only in bracketed noise search identically and must share an entry,
 * while two that search differently must not — normalising the whole title
 * would collide "Bohemian Rhapsody (Live Aid)" with the studio version.
 */
export function candidateCacheKey(query: TrackQuery): string {
	return [
		normalizeForMatch(searchTerm(query)),
		normalizeIsrc(query.isrc) ?? "",
	].join("|");
}

/**
 * All three calls go out together. The ISRC leg is not a short-circuit: an
 * uploader-supplied ISRC can resolve to a track that is not this upload, and
 * suppressing the searches would leave nothing for the judge to fall back on.
 */
export async function fetchCatalogCandidates(
	query: TrackQuery,
	{ timeout = DEFAULT_TIMEOUT_MS }: Pick<LookupOptions, "timeout"> = {},
): Promise<CatalogCandidate[]> {
	const deadline = Date.now() + timeout;
	const term = searchTerm(query);
	const isrc = normalizeIsrc(query.isrc);

	const [byIsrc, itunes, deezer] = await Promise.all([
		isrc ? deezerTrackByIsrc(isrc, { timeout }) : Promise.resolve(null),
		searchITunes(term, { timeout }),
		searchDeezer(term, { timeout }),
	]);

	/** Both searches unreachable is an outage, which must not be cached as a miss. */
	if (itunes === null && deezer === null && !byIsrc) {
		throw new CatalogUnavailableError();
	}

	return withDeezerAlbumArtists(
		query,
		[...(byIsrc ? [byIsrc] : []), ...(itunes ?? []), ...(deezer ?? [])],
		Math.max(1, deadline - Date.now()),
	);
}

/**
 * Deezer's search rows do not say whose album a track is on, and a knock-off
 * credited to the real artist is otherwise indistinguishable from the real
 * release. So every Deezer row that could match is checked against its album
 * before anything is judged; iTunes rows already carry the credit. A row whose
 * album cannot be read is dropped, not trusted — an unchecked row is exactly
 * the one that wrote a knock-off's ISRC into a file. This runs once per track:
 * the result is what the candidate cache holds.
 */
async function withDeezerAlbumArtists(
	query: TrackQuery,
	candidates: CatalogCandidate[],
	timeout: number,
): Promise<CatalogCandidate[]> {
	const needsCheck = (candidate: CatalogCandidate) =>
		candidate.source === "deezer" && namesTheSameSong(query, candidate);
	const albumIds = [
		...new Set(
			candidates
				.filter(needsCheck)
				.flatMap((candidate) => (candidate.albumId ? [candidate.albumId] : [])),
		),
	];
	const albums = new Map(
		await Promise.all(
			albumIds.map(
				async (albumId) =>
					[albumId, await deezerAlbum(albumId, { timeout })] as const,
			),
		),
	);

	return candidates.flatMap((candidate) => {
		if (!needsCheck(candidate)) return [candidate];
		const album = candidate.albumId ? albums.get(candidate.albumId) : null;
		if (!album?.artist) return [];
		return [
			{
				...candidate,
				albumArtist: album.artist,
				isCompilation: album.isCompilation,
			},
		];
	});
}

/** Exported so the shared cache can enrich a verdict it judged from cached candidates. */
export async function enrichVerdictFromAlbum(
	verdict: CatalogVerdict,
	timeout: number,
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
	{ timeout = DEFAULT_TIMEOUT_MS, cache, enrich = false }: LookupOptions = {},
): Promise<CatalogVerdict> {
	/** A budget, so a lookup cannot take a multiple of the caller's timeout. */
	const deadline = Date.now() + timeout;
	const remaining = () => Math.max(1, deadline - Date.now());

	let candidates: CatalogCandidate[];
	try {
		const fetchCandidates = () =>
			fetchCatalogCandidates(query, { timeout: remaining() });
		candidates = cache
			? await cache.get(
					candidateCacheKey(query),
					fetchCandidates,
					CANDIDATE_TTL_MS,
				)
			: await fetchCandidates();
	} catch (error) {
		if (!(error instanceof CatalogUnavailableError)) throw error;
		console.log("[catalog] unmatched reason=catalogs-unreachable");
		return { status: "unmatched", reason: "no-candidates" };
	}

	const judged = judgeCandidates(query, candidates);
	const verdict = enrich
		? await enrichVerdictFromAlbum(judged, remaining())
		: judged;

	console.log(
		verdict.status === "matched"
			? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
			: `[catalog] unmatched reason=${verdict.reason}`,
	);
	return verdict;
}
