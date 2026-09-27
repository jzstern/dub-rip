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
	normalizeIsrc,
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
 * The artist, the song name and the version must agree for EVERY candidate —
 * including one reached through its ISRC. On SoundCloud the uploader supplies
 * that ISRC, so a bootleg stamped with the original's would otherwise be
 * written as the original: the version check is the whole defence, and a proof
 * that skips it is not a proof. On top of the text gate, one of three things
 * must hold: the ISRC matches, the runtimes agree, or both catalogs
 * independently reached the same recording.
 */

const DURATION_TOLERANCE_SECONDS = 5;

/** Strongest first. Only decides the reported `via`; ranking is structural. */
const EVIDENCE_ORDER: MatchEvidence[] = ["isrc", "duration", "agreement"];

/** Deezer first: it carries the ISRC and keeps feat. credits in the title. */
const SOURCE_RANK: Record<CatalogSource, number> = { deezer: 0, itunes: 1 };

/** Both stores back-date a reissue to Jan 1, so such a date cannot order releases. */
const IMPRECISE_DATE = /-01-01$/;

interface Assessment {
	candidate: CatalogCandidate;
	textPass: boolean;
	sameLength: boolean;
	durationPass: boolean;
	/** Both runtimes are known and disagree — evidence against, not merely absent. */
	durationContradicts: boolean;
	/**
	 * The catalog's cut runs materially longer than the upload. An upload may
	 * wrap a track in an intro or an outro — a music video legitimately runs
	 * 30–90s longer — but a catalog recording that outruns the upload is a
	 * different cut: a live version, an extended mix, or the full track behind a
	 * bootleg that borrowed its ISRC.
	 */
	candidateOutruns: boolean;
	isrcPass: boolean;
	recordingKey: string;
	reason: UnmatchedReason;
}

interface Match {
	assessment: Assessment;
	proofs: MatchEvidence[];
	agreed: boolean;
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
	queryIsrc: string | undefined,
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

	const bothDurations =
		query.durationSeconds !== undefined &&
		candidate.durationSeconds !== undefined;
	const signedGap = bothDurations
		? (candidate.durationSeconds as number) - (query.durationSeconds as number)
		: Number.NaN;
	const durationGap = Math.abs(signedGap);
	const candidateIsrc = normalizeIsrc(candidate.isrc);

	return {
		candidate,
		textPass: artistPass && titlePass && version.identity,
		sameLength: version.length,
		durationPass: bothDurations && durationGap <= DURATION_TOLERANCE_SECONDS,
		durationContradicts:
			bothDurations && durationGap > DURATION_TOLERANCE_SECONDS,
		candidateOutruns: bothDurations && signedGap > DURATION_TOLERANCE_SECONDS,
		isrcPass:
			queryIsrc !== undefined &&
			candidateIsrc !== undefined &&
			queryIsrc === candidateIsrc,
		recordingKey: identityKey(candidateTitle),
		reason: missReason(artistPass, titlePass, version.identity),
	};
}

/**
 * Every proof this candidate satisfies, strongest first. The text gate comes
 * first and applies to all of them. A runtime that disagrees cancels the ISRC
 * proof rather than being ignored: two recordings minutes apart in length are
 * not the same recording, whatever tag the uploader typed.
 */
function proofsFor(
	assessment: Assessment,
	agreedKeys: Set<string>,
): MatchEvidence[] {
	if (!assessment.textPass || assessment.candidateOutruns) return [];
	const proofs: MatchEvidence[] = [];
	if (assessment.isrcPass && !assessment.durationContradicts)
		proofs.push("isrc");
	if (assessment.durationPass) proofs.push("duration");
	if (assessment.sameLength && agreedKeys.has(assessment.recordingKey)) {
		proofs.push("agreement");
	}
	return proofs.sort(
		(left, right) =>
			EVIDENCE_ORDER.indexOf(left) - EVIDENCE_ORDER.indexOf(right),
	);
}

/** Keys that an iTunes result and a Deezer result both reached on their own. */
function keysBothCatalogsReached(assessments: Assessment[]): Set<string> {
	const sources = new Map<string, Set<CatalogSource>>();
	for (const assessment of assessments) {
		if (!assessment.textPass || assessment.candidateOutruns) continue;
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
 * the album. A candidate whose runtime the query rules out is excluded: a live
 * cut of the same song would otherwise donate its ISRC to the studio version.
 * Ranked candidates come first, so a real release fills a field before a
 * compilation does.
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
			!assessment.durationContradicts &&
			(assessment.textPass || assessment.isrcPass)
		) {
			support.add(assessment.candidate);
		}
	}
	return [...support];
}

function preciseDate(releaseDate: string | undefined): string | undefined {
	return releaseDate && !IMPRECISE_DATE.test(releaseDate)
		? releaseDate
		: undefined;
}

/**
 * Ranking is structural, not evidential, so that the choice cannot change when
 * a later stage learns the duration: a preview and its download must agree, or
 * the file disagrees with what the user was shown. Corroboration comes first,
 * then the release's own qualities, and the catalogs' own ordering breaks the
 * rest — both APIs rank the canonical release above a reissue or a knock-off,
 * which a back-dated "Jan 1" reissue date does not.
 */
function betterMatch(left: Match, right: Match): number {
	const byIsrc =
		Number(!left.proofs.includes("isrc")) -
		Number(!right.proofs.includes("isrc"));
	if (byIsrc !== 0) return byIsrc;

	const byAgreement = Number(!left.agreed) - Number(!right.agreed);
	if (byAgreement !== 0) return byAgreement;

	const a = left.assessment.candidate;
	const b = right.assessment.candidate;

	const byCompilation =
		Number(a.isCompilation ?? false) - Number(b.isCompilation ?? false);
	if (byCompilation !== 0) return byCompilation;

	const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
	if (bySource !== 0) return bySource;

	const byRank = (a.rank ?? 0) - (b.rank ?? 0);
	if (byRank !== 0) return byRank;

	const leftDate = preciseDate(a.releaseDate);
	const rightDate = preciseDate(b.releaseDate);
	if (leftDate && rightDate) return leftDate.localeCompare(rightDate);
	return 0;
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
	const queryIsrc = normalizeIsrc(query.isrc);
	const assessments = candidates.map((candidate) =>
		assess(query, queryTitle, queryCredit, queryIsrc, candidate),
	);
	const agreedKeys = keysBothCatalogsReached(assessments);

	const matches = assessments
		.flatMap((assessment) => {
			const proofs = proofsFor(assessment, agreedKeys);
			return proofs.length
				? [
						{
							assessment,
							proofs,
							agreed: agreedKeys.has(assessment.recordingKey),
						},
					]
				: [];
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
		via: best.proofs[0] as MatchEvidence,
		candidate: best.assessment.candidate,
		metadata: fillFromSupport(
			canonicalFrom(best.assessment.candidate, query.isrc),
			supportingCandidates(matches, assessments, best.assessment),
		),
	};
}
