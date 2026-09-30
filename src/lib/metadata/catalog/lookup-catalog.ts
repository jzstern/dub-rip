import { createSingleFlightCache } from "../../single-flight-cache";
import type {
	CatalogCandidate,
	CatalogVerdict,
	TrackQuery,
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
}

/** Thrown when no catalog could be reached, so the miss is never cached as a result. */
export class CatalogUnavailableError extends Error {
	/**
	 * @param answered The rows of the catalog that did answer. Never judged and
	 * never cached, but still a cover for the preview card — main's artwork
	 * lookup falls back from one catalog to the other the same way.
	 */
	constructor(readonly answered: CatalogCandidate[] = []) {
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
 *
 * Either search failing counts as an outage, not as a catalog with nothing to
 * say. The rules that refuse a wrong release need both catalogs — a Deezer copy
 * is what disputes iTunes's Sinatra & Bennett duet credit — so a lookup missing
 * one would accept what the other would have refused, and caching that set
 * would keep accepting it for ten minutes.
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

	if (itunes === null || deezer === null) {
		throw new CatalogUnavailableError([...(itunes ?? []), ...(deezer ?? [])]);
	}

	return [...(byIsrc ? [byIsrc] : []), ...itunes, ...deezer];
}

/** Albums do not change and many tracks share one, so a checked album is kept far longer than a search. */
const ALBUM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * One ISRC rarely sits on more than a single and its album, and Deezer's
 * per-IP quota — about 50 calls in 5 s — is shared by every user.
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
 * The candidates the judge may see for this query, or `null` when one of them
 * could not be vouched for. Only a Deezer row carrying the upload's own ISRC
 * can supply release fields (see `provesTheRelease`), and Deezer's search rows
 * do not say whose album a track is on or whether it is a compilation — so
 * such a row is passed on only with its album's artist, label, date and genre
 * attached. Every other row names at most the song, which its own credit
 * already settles; a lookup without an ISRC makes no album call at all.
 *
 * A failed album call fails the whole lookup rather than just its row, so a
 * release is never judged without the evidence its album check exists for.
 *
 * Runs on every lookup, against the cached search rows, and caches nothing but
 * the albums themselves. Checking once when the rows were fetched made the
 * result depend on whichever query filled the cache key — a lyric channel's
 * "Never Be Like You Kai" shares a key with the official upload but names no
 * row, so it cached them all unchecked.
 */
export async function vouchedCandidates(
	query: TrackQuery,
	candidates: CatalogCandidate[],
	timeout: number,
): Promise<CatalogCandidate[] | null> {
	const isrc = normalizeIsrc(query.isrc);
	const needsCheck = (candidate: CatalogCandidate) =>
		isrc !== undefined &&
		candidate.source === "deezer" &&
		normalizeIsrc(candidate.isrc) === isrc &&
		namesTheSameRecording(query, candidate);
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
	if ([...albums.values()].some((album) => !album?.artist)) return null;

	return candidates.flatMap((candidate) => {
		if (!needsCheck(candidate)) return [candidate];
		const album = candidate.albumId ? albums.get(candidate.albumId) : undefined;
		if (!album) return [];
		return [
			{
				...candidate,
				albumArtist: album.artist,
				isCompilation: album.isCompilation,
				label: candidate.label ?? album.label,
				genre: candidate.genre ?? album.genre,
				releaseDate: candidate.releaseDate ?? album.releaseDate,
			},
		];
	});
}

export async function lookupCatalogMetadata(
	query: TrackQuery,
	{ timeout = DEFAULT_TIMEOUT_MS, cache }: LookupOptions = {},
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

	const vouched = await vouchedCandidates(query, candidates, remaining());
	if (!vouched) {
		console.log("[catalog] unmatched reason=album-check-failed");
		return { status: "unmatched", reason: "no-candidates" };
	}

	const verdict = judgeCandidates(query, vouched);
	console.log(
		verdict.status === "matched"
			? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
			: `[catalog] unmatched reason=${verdict.reason}`,
	);
	return verdict;
}
