export type CatalogSource = "itunes" | "deezer";

/** One release a catalog offered for a query, reduced to the fields we compare or write. */
export interface CatalogCandidate {
	source: CatalogSource;
	artist: string;
	title: string;
	album?: string;
	/** Deezer's album id, which the label and genre come from. */
	albumId?: string;
	isCompilation?: boolean;
	releaseDate?: string;
	durationSeconds?: number;
	isrc?: string;
	genre?: string;
	label?: string;
	artworkUrl?: string;
}

/** What a proven match writes, in place of the values parsed from the upload title. */
export interface CanonicalMetadata {
	artist: string;
	title: string;
	album?: string;
	year?: number;
	genre?: string;
	label?: string;
	isrc?: string;
	artworkUrl?: string;
	source: CatalogSource;
}

/**
 * How a match was proven. `isrc` is an exact identifier, `duration` is a
 * runtime within tolerance, and `agreement` is two catalogs independently
 * returning the same recording — the only evidence a YouTube preview has,
 * because oEmbed carries no duration.
 */
export type MatchEvidence = "isrc" | "duration" | "agreement";

/**
 * Why nothing was written. Ordered from the closest miss to the furthest, which
 * is the order `judgeCandidates` reports them in: a `version-mismatch` means a
 * remix or bootleg was kept apart from the original, which is the point.
 */
export type UnmatchedReason =
	| "unverified"
	| "version-mismatch"
	| "title-mismatch"
	| "artist-mismatch"
	| "no-candidates";

export type CatalogVerdict =
	| {
			status: "matched";
			via: MatchEvidence;
			candidate: CatalogCandidate;
			metadata: CanonicalMetadata;
	  }
	| { status: "unmatched"; reason: UnmatchedReason };

export interface CatalogRequestOptions {
	timeout?: number;
}

/** Shared by both adapters and the album enrichment, so a year means one thing. */
export function releaseYear(
	releaseDate: string | undefined,
): number | undefined {
	const year = Number.parseInt(releaseDate?.slice(0, 4) ?? "", 10);
	return year > 1900 ? year : undefined;
}

export interface TrackQuery {
	artist: string;
	title: string;
	/** An ISRC the platform supplied, from SoundCloud's `publisher_metadata`. */
	isrc?: string;
	durationSeconds?: number;
}
