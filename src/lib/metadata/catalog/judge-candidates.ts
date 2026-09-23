import type {
	CanonicalMetadata,
	CatalogCandidate,
	CatalogVerdict,
	MatchEvidence,
	TrackQuery,
	UnmatchedReason,
} from "./catalog-candidate";
import {
	artistDisplayName,
	normalizeForMatch,
	splitArtistNames,
} from "./normalize-text";
import {
	identityKey,
	type ParsedTitle,
	parseTrackTitle,
	sameVersion,
} from "./track-version";

/**
 * Decides whether a catalog result is provably the same recording as the
 * upload. Pure, so every stage of a request can re-run it as evidence arrives:
 * a preview judges on text alone, and the download adds the duration that the
 * yt-dlp details call already fetched.
 *
 * A candidate is written only when the artist, the song name and the version
 * agree AND one of three proofs holds. Nothing else is accepted, because a
 * plain search confidently returns the original for a bootleg.
 */

const DURATION_TOLERANCE_SECONDS = 5;

const EVIDENCE_RANK: Record<MatchEvidence, number> = {
	isrc: 0,
	duration: 1,
	agreement: 2,
};

/** Closest miss first: the reason reported is the furthest the best candidate got. */
const REASON_RANK: UnmatchedReason[] = [
	"unverified",
	"version-mismatch",
	"title-mismatch",
	"artist-mismatch",
	"no-candidates",
];

interface Assessment {
	candidate: CatalogCandidate;
	textPass: boolean;
	lengthPass: boolean;
	durationPass: boolean;
	isrcPass: boolean;
	key: string;
	reason: UnmatchedReason;
}

function artistNames(credit: string, title: ParsedTitle): Set<string> {
	const names = splitArtistNames(credit);
	for (const featured of title.featured) {
		names.push(...splitArtistNames(featured));
	}
	return new Set(names);
}

function artistsAgree(
	queryCredit: string,
	queryTitle: ParsedTitle,
	candidateCredit: string,
	candidateTitle: ParsedTitle,
): boolean {
	const queryNames = artistNames(queryCredit, queryTitle);
	const candidateNames = artistNames(candidateCredit, candidateTitle);
	const queryPrimary = splitArtistNames(queryCredit)[0];
	const candidatePrimary = splitArtistNames(candidateCredit)[0];
	return (
		(queryPrimary !== undefined && candidateNames.has(queryPrimary)) ||
		(candidatePrimary !== undefined && queryNames.has(candidatePrimary))
	);
}

function assess(
	query: TrackQuery,
	queryTitle: ParsedTitle,
	candidate: CatalogCandidate,
): Assessment {
	const candidateTitle = parseTrackTitle(candidate.title);
	const version = sameVersion(queryTitle, candidateTitle);
	const artistPass = artistsAgree(
		query.artist,
		queryTitle,
		candidate.artist,
		candidateTitle,
	);
	const queryBase = normalizeForMatch(queryTitle.base);
	/** A title that is nothing but a version, like "(Instrumental)", names no song. */
	const titlePass =
		queryBase !== "" && queryBase === normalizeForMatch(candidateTitle.base);
	const textPass = artistPass && titlePass && version.identity;
	const durationPass =
		query.durationSeconds !== undefined &&
		candidate.durationSeconds !== undefined &&
		Math.abs(query.durationSeconds - candidate.durationSeconds) <=
			DURATION_TOLERANCE_SECONDS;

	let reason: UnmatchedReason = "artist-mismatch";
	if (artistPass && !titlePass) reason = "title-mismatch";
	else if (artistPass && titlePass && !version.identity)
		reason = "version-mismatch";
	else if (textPass) reason = "unverified";

	return {
		candidate,
		textPass,
		lengthPass: version.length || durationPass,
		durationPass,
		isrcPass:
			query.isrc !== undefined &&
			candidate.isrc !== undefined &&
			query.isrc.toUpperCase() === candidate.isrc.toUpperCase(),
		key: identityKey(candidateTitle),
		reason,
	};
}

function evidenceFor(
	assessment: Assessment,
	agreedKeys: Set<string>,
): MatchEvidence | null {
	if (assessment.isrcPass) return "isrc";
	if (!assessment.textPass) return null;
	if (assessment.durationPass) return "duration";
	if (assessment.lengthPass && agreedKeys.has(assessment.key))
		return "agreement";
	return null;
}

/** Keys that an iTunes result and a Deezer result both reached on their own. */
function keysBothCatalogsReached(assessments: Assessment[]): Set<string> {
	const sources = new Map<string, Set<string>>();
	for (const assessment of assessments) {
		if (!assessment.textPass || !assessment.lengthPass) continue;
		const seen = sources.get(assessment.key) ?? new Set<string>();
		seen.add(assessment.candidate.source);
		sources.set(assessment.key, seen);
	}
	return new Set(
		[...sources.entries()]
			.filter(([, seen]) => seen.size > 1)
			.map(([key]) => key),
	);
}

function releaseYear(releaseDate: string | undefined): number | undefined {
	const year = Number.parseInt(releaseDate?.slice(0, 4) ?? "", 10);
	return year > 1900 ? year : undefined;
}

/** A compilation names the recording correctly but the album wrongly, so the album is dropped. */
function canonicalFrom(
	candidate: CatalogCandidate,
	query: TrackQuery,
): CanonicalMetadata {
	return {
		artist: artistDisplayName(candidate.artist),
		title: candidate.title,
		album: candidate.isCompilation ? undefined : candidate.album,
		year: releaseYear(candidate.releaseDate),
		genre: candidate.genre,
		label: candidate.label,
		isrc: candidate.isrc ?? query.isrc,
		artworkUrl: candidate.artworkUrl,
		source: candidate.source,
	};
}

/**
 * Deezer names the recording best but its search results carry no release date
 * and no genre, while iTunes carries both. When the two catalogs agree on a
 * recording, the fields one lacks are taken from the other rather than from a
 * second network call.
 */
function fillFromSupport(
	metadata: CanonicalMetadata,
	support: CatalogCandidate[],
): CanonicalMetadata {
	const merged = { ...metadata };
	for (const candidate of support) {
		merged.album ??= candidate.isCompilation ? undefined : candidate.album;
		merged.year ??= releaseYear(candidate.releaseDate);
		merged.genre ??= candidate.genre;
		merged.isrc ??= candidate.isrc;
		merged.label ??= candidate.label;
		merged.artworkUrl ??= candidate.artworkUrl;
	}
	return merged;
}

function betterMatch(
	left: { via: MatchEvidence; assessment: Assessment },
	right: { via: MatchEvidence; assessment: Assessment },
): number {
	const byEvidence = EVIDENCE_RANK[left.via] - EVIDENCE_RANK[right.via];
	if (byEvidence !== 0) return byEvidence;

	const bySource =
		Number(left.assessment.candidate.source === "itunes") -
		Number(right.assessment.candidate.source === "itunes");
	if (bySource !== 0) return bySource;

	const byCompilation =
		Number(left.assessment.candidate.isCompilation ?? false) -
		Number(right.assessment.candidate.isCompilation ?? false);
	if (byCompilation !== 0) return byCompilation;

	return (left.assessment.candidate.releaseDate ?? "9999").localeCompare(
		right.assessment.candidate.releaseDate ?? "9999",
	);
}

export function judgeCandidates(
	query: TrackQuery,
	candidates: CatalogCandidate[],
): CatalogVerdict {
	if (candidates.length === 0) {
		return { status: "unmatched", reason: "no-candidates" };
	}

	const queryTitle = parseTrackTitle(query.title);
	const assessments = candidates.map((candidate) =>
		assess(query, queryTitle, candidate),
	);
	const agreedKeys = keysBothCatalogsReached(assessments);

	const matches = assessments
		.map((assessment) => ({
			assessment,
			via: evidenceFor(assessment, agreedKeys),
		}))
		.filter(
			(match): match is { assessment: Assessment; via: MatchEvidence } =>
				match.via !== null,
		)
		.sort(betterMatch);

	const best = matches[0];
	if (!best) {
		const reason = REASON_RANK.find((candidateReason) =>
			assessments.some((assessment) => assessment.reason === candidateReason),
		);
		return { status: "unmatched", reason: reason ?? "no-candidates" };
	}

	const support = [
		...matches.slice(1).map((match) => match.assessment),
		...assessments.filter((assessment) => assessment.textPass),
	]
		.filter(
			(assessment) =>
				assessment.key === best.assessment.key &&
				assessment.candidate !== best.assessment.candidate,
		)
		.map((assessment) => assessment.candidate);

	return {
		status: "matched",
		via: best.via,
		candidate: best.assessment.candidate,
		metadata: fillFromSupport(
			canonicalFrom(best.assessment.candidate, query),
			support,
		),
	};
}
