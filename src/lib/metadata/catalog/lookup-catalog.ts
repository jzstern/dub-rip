import { createSingleFlightCache } from "../../single-flight-cache";
import {
	type CatalogCandidate,
	type CatalogVerdict,
	isPreciseDate,
	releaseYear,
	type TrackQuery,
} from "./catalog-candidate";
import {
	type DeezerAlbumInfo,
	deezerAlbum,
	deezerTrackByIsrc,
	searchDeezer,
} from "./deezer-catalog";
import { searchITunes } from "./itunes-catalog";
import { judgeCandidates, namesTheSameRecording } from "./judge-candidates";
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

	return [...(byIsrc ? [byIsrc] : []), ...(itunes ?? []), ...(deezer ?? [])];
}

/** Albums do not change and many tracks share one, so a checked album is kept far longer than a search. */
const ALBUM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The judge prefers a catalog's higher-ranked rows anyway, and a much-reissued
 * song has ten albums to ask about: checking them all spent Deezer's per-IP
 * quota — about 50 calls in 5 s, shared by every user — on rows that could not
 * win.
 */
const MAX_ALBUM_CHECKS = 3;

/** A failed call answers null, which the cache never keeps, so the next request asks again. */
const albumCache = createSingleFlightCache<DeezerAlbumInfo | null>();

function checkedAlbum(
	albumId: string,
	timeout: number,
): Promise<DeezerAlbumInfo | null> {
	return albumCache.get(
		albumId,
		() => deezerAlbum(albumId, { timeout }),
		ALBUM_TTL_MS,
	);
}

export function clearDeezerAlbumCache(): void {
	albumCache.clear();
}

/**
 * The candidates the judge may see for this query. Deezer's search rows do not
 * say whose album a track is on, and Deezer files knock-offs under the real
 * artist's name — so a Deezer row that could match is passed on only once its
 * album is known, and is left out when it is not: past the cap, or when the
 * album call failed. iTunes rows carry the credit already.
 *
 * Runs on every lookup, against the cached search rows, and caches nothing but
 * the albums themselves. Checking once when the rows were fetched made the
 * result depend on whichever query filled the cache key — a lyric channel's
 * "Never Be Like You Kai" shares a key with the official upload but names no
 * row, so it cached them all unchecked — and cached a failed check as an
 * answer for ten minutes.
 */
export async function vouchedCandidates(
	query: TrackQuery,
	candidates: CatalogCandidate[],
	timeout: number,
): Promise<CatalogCandidate[]> {
	const needsCheck = (candidate: CatalogCandidate) =>
		candidate.source === "deezer" && namesTheSameRecording(query, candidate);
	const albumIds = [
		...new Set(
			candidates
				.filter(needsCheck)
				.flatMap((candidate) => (candidate.albumId ? [candidate.albumId] : [])),
		),
	].slice(0, MAX_ALBUM_CHECKS);
	const albums = new Map(
		await Promise.all(
			albumIds.map(
				async (albumId) =>
					[albumId, await checkedAlbum(albumId, timeout)] as const,
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

/**
 * Exported so the shared cache can enrich a verdict it judged from cached
 * candidates. The album was usually checked already, so this is a cache hit.
 * A compilation's label, genre and date describe the compilation, not the
 * recording, so it gives nothing but the news that the album name is wrong.
 */
export async function enrichVerdictFromAlbum(
	verdict: CatalogVerdict,
	timeout: number,
): Promise<CatalogVerdict> {
	if (verdict.status !== "matched") return verdict;
	const { albumId } = verdict.candidate;
	if (!albumId) return verdict;

	const album = await checkedAlbum(albumId, timeout);
	if (!album) return verdict;
	if (album.isCompilation) {
		return { ...verdict, metadata: { ...verdict.metadata, album: undefined } };
	}

	const albumYear = releaseYear(album.releaseDate);
	const { year } = verdict.metadata;
	return {
		...verdict,
		metadata: {
			...verdict.metadata,
			label: verdict.metadata.label ?? album.label,
			genre: verdict.metadata.genre ?? album.genre,
			/** Deezer dates a reissue by the reissue, so a precise date can only move the year earlier. */
			year:
				year !== undefined &&
				albumYear !== undefined &&
				isPreciseDate(album.releaseDate)
					? Math.min(year, albumYear)
					: (year ?? albumYear),
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

	const judged = judgeCandidates(
		query,
		await vouchedCandidates(query, candidates, remaining()),
	);
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
