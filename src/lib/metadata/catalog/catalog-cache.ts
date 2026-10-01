import * as Sentry from "@sentry/sveltekit";
import type { PreferredArtwork } from "$lib/artwork";
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
	clearDeezerAlbumCache,
	fetchCatalogCandidates,
	vouchedCandidates,
} from "./lookup-catalog";

/**
 * One candidate fetch per track across `/details` and the download — the same
 * collapse `soundcloud-track-cache.ts` does for the track page and
 * `video-details-cache.ts` for yt-dlp's extraction.
 *
 * Candidates are cached; verdicts are not. Each stage re-judges the same
 * candidates with whatever evidence it has by then. That only works while both
 * stages build the SAME query: artist and title always come from the heuristic
 * identity — never from a verdict, never from `details.track` or
 * `details.artist` — and only `isrc` and `durationSeconds` vary by stage.
 */
const cache = createSingleFlightCache<CatalogCandidate[]>();

export interface CatalogLookup {
	verdict: CatalogVerdict;
}

const UNMATCHED: CatalogLookup = {
	verdict: { status: "unmatched", reason: "no-candidates" },
};

/**
 * A lookup can never fail a preview or a download. An unreachable catalog is
 * ordinary and already logged; anything else reaching here is our own bug.
 */
function reportLookupBug(error: unknown, query: TrackQuery): void {
	console.error("[catalog] lookup failed:", error);
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
 * `/details` and the download: judges the shared candidates. The Deezer rows
 * carrying the upload's ISRC are checked against their albums first (see
 * `vouchedCandidates`); that album data is also where the label, genre and
 * release date of such a release come from, so the download needs no call of
 * its own.
 *
 * `timeout` covers the searches and the album checks together.
 */
export async function sharedCatalogLookup(
	query: TrackQuery,
	{ timeout }: { timeout: number },
): Promise<CatalogLookup> {
	if (isBlank(query)) return UNMATCHED;
	const deadline = Date.now() + timeout;

	let candidates: CatalogCandidate[];
	try {
		candidates = await cache.get(
			candidateCacheKey(query),
			() => fetchCatalogCandidates(query, { timeout }),
			CANDIDATE_TTL_MS,
		);
	} catch (error) {
		if (error instanceof CatalogUnavailableError) {
			console.log("[catalog] unmatched reason=catalogs-unreachable");
		} else {
			reportLookupBug(error, query);
		}
		return UNMATCHED;
	}

	try {
		const verdict = judgeCandidates(
			query,
			await vouchedCandidates(
				query,
				candidates,
				Math.max(1, deadline - Date.now()),
			),
		);
		console.log(
			verdict.status === "matched"
				? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
				: `[catalog] unmatched reason=${verdict.reason}`,
		);
		return { verdict };
	} catch (error) {
		reportLookupBug(error, query);
		return UNMATCHED;
	}
}

/**
 * The cover of the release the upload's own ISRC proved, or none — in which
 * case the cover is found exactly as it is today. A catalog's top result for a
 * song is not that song's release: it gave an Eminem upload Rihanna's "Love
 * the Way You Lie, Pt. II" sleeve. The source travels with the URL so a written
 * cover can be labelled honestly.
 */
export function releaseCover({
	verdict,
}: CatalogLookup): PreferredArtwork | undefined {
	if (verdict.status !== "matched" || !verdict.metadata.artworkUrl) {
		return undefined;
	}
	return { url: verdict.metadata.artworkUrl, source: verdict.metadata.source };
}

/** The preview card is 56 px, while candidates carry the full-size cover the file gets. */
const CARD_ARTWORK_SIZE = 300;

/** iTunes templates its size as `600x600bb`; Deezer as a `/1000x1000-…` path segment. */
export function cardSizedArtwork(url: string | undefined): string | undefined {
	return url
		?.replace("600x600bb", `${CARD_ARTWORK_SIZE}x${CARD_ARTWORK_SIZE}bb`)
		.replace(/\/(\d+)x\1-/, `/${CARD_ARTWORK_SIZE}x${CARD_ARTWORK_SIZE}-`);
}

export function clearCatalogCandidateCache(): void {
	cache.clear();
	clearDeezerAlbumCache();
}
