import type {
	CanonicalMetadata,
	CatalogCandidate,
	CatalogSource,
	CatalogVerdict,
	MatchEvidence,
	TrackQuery,
	UnmatchedReason,
} from "./catalog-candidate";
import { releaseYear } from "./catalog-candidate";
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

/** Deezer first: it carries the ISRC and keeps feat. credits in the title. */
const SOURCE_RANK: Record<CatalogSource, number> = { deezer: 0, itunes: 1 };

interface Assessment {
	candidate: CatalogCandidate;
	textPass: boolean;
	/** The artist or the song name lined up, which an ISRC hit is sanity-checked against. */
	namesAgree: boolean;
	sameLength: boolean;
	durationPass: boolean;
	isrcPass: boolean;
	recordingKey: string;
	reason: UnmatchedReason;
}

interface Match {
	assessment: Assessment;
	via: MatchEvidence;
}

interface ArtistCredit {
	/** The lead name, which is the one that has to appear on the other side. */
	primary: string | undefined;
	all: Set<string>;
}

function artistCredit(credit: string, title: ParsedTitle): ArtistCredit {
	const names = splitArtistNames(credit);
	const all = new Set(names);
	for (const featured of title.featured) {
		for (const name of splitArtistNames(featured)) all.add(name);
	}
	return { primary: names[0], all };
}

/** Catalogs and uploads disagree on who else is credited, so only the leads must line up. */
function artistsAgree(query: ArtistCredit, candidate: ArtistCredit): boolean {
	return (
		(query.primary !== undefined && candidate.all.has(query.primary)) ||
		(candidate.primary !== undefined && query.all.has(candidate.primary))
	);
}

/** How far a candidate got, from the furthest miss to the closest. */
function missReason(
	artistPass: boolean,
	titlePass: boolean,
	identityPass: boolean,
): UnmatchedReason {
	if (!artistPass) return "artist-mismatch";
	if (!titlePass) return "title-mismatch";
	if (!identityPass) return "version-mismatch";
	return "unverified";
}

function assess(
	query: TrackQuery,
	queryTitle: ParsedTitle,
	queryCredit: ArtistCredit,
	candidate: CatalogCandidate,
): Assessment {
	const candidateTitle = parseTrackTitle(candidate.title);
	const version = sameVersion(queryTitle, candidateTitle);
	const artistPass = artistsAgree(
		queryCredit,
		artistCredit(candidate.artist, candidateTitle),
	);

	const queryBase = normalizeForMatch(queryTitle.base);
	/** A title that is nothing but a version, like "(Instrumental)", names no song. */
	const titlePass =
		queryBase !== "" && queryBase === normalizeForMatch(candidateTitle.base);

	return {
		candidate,
		textPass: artistPass && titlePass && version.identity,
		namesAgree: artistPass || titlePass,
		sameLength: version.length,
		durationPass:
			query.durationSeconds !== undefined &&
			candidate.durationSeconds !== undefined &&
			Math.abs(query.durationSeconds - candidate.durationSeconds) <=
				DURATION_TOLERANCE_SECONDS,
		isrcPass:
			query.isrc !== undefined &&
			candidate.isrc !== undefined &&
			query.isrc.toUpperCase() === candidate.isrc.toUpperCase(),
		recordingKey: identityKey(candidateTitle),
		reason: missReason(artistPass, titlePass, version.identity),
	};
}

function evidenceFor(
	assessment: Assessment,
	agreedKeys: Set<string>,
): MatchEvidence | null {
	/**
	 * An ISRC identifies a recording exactly, but on SoundCloud the uploader
	 * supplies it, so one stamped from a famous release would otherwise hand
	 * that release's artist and title to an unrelated upload. Requiring the
	 * artist or the song name to line up costs real distributor uploads
	 * nothing — their own metadata is where the ISRC came from.
	 */
	if (assessment.isrcPass && assessment.namesAgree) return "isrc";
	if (!assessment.textPass) return null;
	if (assessment.durationPass) return "duration";
	if (assessment.sameLength && agreedKeys.has(assessment.recordingKey)) {
		return "agreement";
	}
	return null;
}

/** Keys that an iTunes result and a Deezer result both reached on their own. */
function keysBothCatalogsReached(assessments: Assessment[]): Set<string> {
	const sources = new Map<string, Set<CatalogSource>>();
	for (const assessment of assessments) {
		if (!assessment.textPass) continue;
		if (!assessment.sameLength && !assessment.durationPass) continue;
		const seen =
			sources.get(assessment.recordingKey) ?? new Set<CatalogSource>();
		seen.add(assessment.candidate.source);
		sources.set(assessment.recordingKey, seen);
	}
	return new Set(
		[...sources.entries()]
			.filter(([, seen]) => seen.size > 1)
			.map(([key]) => key),
	);
}

/** A compilation names the recording correctly but the album wrongly, so the album is dropped. */
function canonicalFrom(
	candidate: CatalogCandidate,
	queryIsrc: string | undefined,
): CanonicalMetadata {
	return {
		artist: artistDisplayName(candidate.artist),
		title: candidate.title,
		album: candidate.isCompilation ? undefined : candidate.album,
		year: releaseYear(candidate.releaseDate),
		genre: candidate.genre,
		label: candidate.label,
		isrc: candidate.isrc ?? queryIsrc,
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

/**
 * The other candidates for the same recording, whose fields fill the gaps in
 * the best one's. Text agreement is required because `recordingKey` compares
 * titles alone — without it, a different artist's same-named track could supply
 * the album. Ranked candidates come first, so a real release fills a field
 * before a compilation does.
 */
function supportingCandidates(
	matches: Match[],
	assessments: Assessment[],
	best: Assessment,
): CatalogCandidate[] {
	const support = new Set<CatalogCandidate>();
	for (const assessment of [
		...matches.map((match) => match.assessment),
		...assessments,
	]) {
		if (
			assessment.candidate !== best.candidate &&
			assessment.recordingKey === best.recordingKey &&
			(assessment.textPass || assessment.isrcPass)
		) {
			support.add(assessment.candidate);
		}
	}
	return [...support];
}

function betterMatch(left: Match, right: Match): number {
	const byEvidence = EVIDENCE_RANK[left.via] - EVIDENCE_RANK[right.via];
	if (byEvidence !== 0) return byEvidence;

	const a = left.assessment.candidate;
	const b = right.assessment.candidate;

	const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
	if (bySource !== 0) return bySource;

	const byCompilation =
		Number(a.isCompilation ?? false) - Number(b.isCompilation ?? false);
	if (byCompilation !== 0) return byCompilation;

	return (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999");
}

/** Closest miss first: the reason reported is the furthest the best candidate got. */
const REASON_RANK: UnmatchedReason[] = [
	"unverified",
	"version-mismatch",
	"title-mismatch",
	"artist-mismatch",
	"no-candidates",
];

export function judgeCandidates(
	query: TrackQuery,
	candidates: CatalogCandidate[],
): CatalogVerdict {
	if (candidates.length === 0) {
		return { status: "unmatched", reason: "no-candidates" };
	}

	const queryTitle = parseTrackTitle(query.title);
	/** Parsed once, not once per candidate: the credit is attacker-chosen text. */
	const queryCredit = artistCredit(query.artist, queryTitle);
	const assessments = candidates.map((candidate) =>
		assess(query, queryTitle, queryCredit, candidate),
	);
	const agreedKeys = keysBothCatalogsReached(assessments);

	const matches = assessments
		.flatMap((assessment) => {
			const via = evidenceFor(assessment, agreedKeys);
			return via ? [{ assessment, via }] : [];
		})
		.sort(betterMatch);

	const best = matches[0];
	if (!best) {
		const reason = REASON_RANK.find((candidateReason) =>
			assessments.some((assessment) => assessment.reason === candidateReason),
		);
		return { status: "unmatched", reason: reason ?? "no-candidates" };
	}

	return {
		status: "matched",
		via: best.via,
		candidate: best.assessment.candidate,
		metadata: fillFromSupport(
			canonicalFrom(best.assessment.candidate, query.isrc),
			supportingCandidates(matches, assessments, best.assessment),
		),
	};
}
