import * as Sentry from "@sentry/sveltekit";
import { createSingleFlightCache } from "$lib/single-flight-cache";
import type {
	CatalogCandidate,
	CatalogVerdict,
	TrackQuery,
} from "./catalog-candidate";
import { judgeCandidates } from "./judge-candidates";
import {
	CANDIDATE_TTL_MS,
	CatalogUnavailableError,
	candidateCacheKey,
	fetchCatalogCandidates,
	lookupCatalogMetadata,
} from "./lookup-catalog";

/**
 * One candidate fetch per track across preview, details and download — the same
 * collapse `soundcloud-track-cache.ts` does for the track page and
 * `video-details-cache.ts` for yt-dlp's extraction.
 *
 * Candidates are cached; verdicts are not. Each stage re-judges the same
 * candidates with whatever evidence it has by then, so `/details` can accept on
 * duration what a preview could only weigh as text. That only works while all
 * three stages build the SAME query: artist and title always come from the
 * heuristic identity — never from a verdict, never from `details.track` or
 * `details.artist` — and only `isrc` and `durationSeconds` vary by stage.
 */
const cache = createSingleFlightCache<CatalogCandidate[]>();

export interface CatalogLookup {
	verdict: CatalogVerdict;
	/** Kept so an unmatched verdict can still answer the artwork question. */
	candidates: CatalogCandidate[];
}

const UNMATCHED: CatalogVerdict = {
	status: "unmatched",
	reason: "no-candidates",
};

/**
 * A lookup can never fail a preview or a download. An unreachable catalog is
 * ordinary and already logged; anything else reaching here is our own bug.
 */
function reportLookupBug(error: unknown, query: TrackQuery): void {
	Sentry.captureException(
		error instanceof Error ? error : new Error(String(error)),
		{
			level: "warning",
			tags: { service: "catalog", operation: "lookup" },
			extra: { artist: query.artist, title: query.title },
		},
	);
}

/** Nothing to search for, and a blank key would collide every such track. */
function isBlank(query: TrackQuery): boolean {
	return !query.artist.trim() && !query.title.trim();
}

/**
 * Preview and `/details`: judges the shared candidates and hands them back, so
 * artwork can fall back to today's order using the same responses. Never
 * enriches — the Deezer album call belongs to the download.
 */
export async function sharedCatalogLookup(
	query: TrackQuery,
	{ timeout }: { timeout: number },
): Promise<CatalogLookup> {
	if (isBlank(query)) return { verdict: UNMATCHED, candidates: [] };

	let candidates: CatalogCandidate[];
	try {
		candidates = await cache.get(
			candidateCacheKey(query),
			() => fetchCatalogCandidates(query, { timeout }),
			CANDIDATE_TTL_MS,
		);
	} catch (error) {
		if (!(error instanceof CatalogUnavailableError)) {
			reportLookupBug(error, query);
		}
		console.log("[catalog] unmatched reason=catalogs-unreachable");
		return { verdict: UNMATCHED, candidates: [] };
	}

	try {
		const verdict = judgeCandidates(query, candidates);
		console.log(
			verdict.status === "matched"
				? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
				: `[catalog] unmatched reason=${verdict.reason}`,
		);
		return { verdict, candidates };
	} catch (error) {
		reportLookupBug(error, query);
		return { verdict: UNMATCHED, candidates };
	}
}

/** The download: the same cached candidates, plus the album call for label and genre. */
export async function enrichedCatalogVerdict(
	query: TrackQuery,
	{ timeout }: { timeout: number },
): Promise<CatalogVerdict> {
	if (isBlank(query)) return UNMATCHED;
	try {
		return await lookupCatalogMetadata(query, { timeout, cache, enrich: true });
	} catch (error) {
		reportLookupBug(error, query);
		return UNMATCHED;
	}
}

/**
 * The cover the match proved, else today's order — iTunes first, then Deezer —
 * taken from the responses already in memory rather than a second pair of
 * searches.
 */
export function catalogArtworkUrl({
	verdict,
	candidates,
}: CatalogLookup): string | undefined {
	const matched =
		verdict.status === "matched" ? verdict.metadata.artworkUrl : undefined;
	return (
		matched ??
		candidates.find(
			(candidate) => candidate.source === "itunes" && candidate.artworkUrl,
		)?.artworkUrl ??
		candidates.find((candidate) => candidate.artworkUrl)?.artworkUrl
	);
}

/** The preview card is 56 px, while candidates carry the 600 px cover the file gets. */
const CARD_ARTWORK_SIZE = 300;

/** A no-op on a Deezer URL, which is not size-templated. */
export function cardSizedArtwork(url: string | undefined): string | undefined {
	return url?.replace(
		"600x600bb",
		`${CARD_ARTWORK_SIZE}x${CARD_ARTWORK_SIZE}bb`,
	);
}

export function clearCatalogCandidateCache(): void {
	cache.clear();
}
