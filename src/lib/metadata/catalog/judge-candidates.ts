import type {
	CanonicalMetadata,
	CatalogCandidate,
	CatalogSource,
	CatalogVerdict,
	MatchEvidence,
	TrackQuery,
	UnmatchedReason,
} from "./catalog-candidate";
import { isPreciseDate, releaseYear } from "./catalog-candidate";
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

/** Deezer first: it carries the ISRC. */
const SOURCE_RANK: Record<CatalogSource, number> = { deezer: 0, itunes: 1 };

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
	credit: ArtistCredit;
	/** The same song in the same version, whoever it is credited to. */
	songPass: boolean;
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
	/** The names in the artist field: whose recording it is. */
	leads: Set<string>;
	/** The leads plus the guests the title features. */
	all: Set<string>;
}

function artistCredit(credit: string, title: ParsedTitle): ArtistCredit {
	const names = splitArtistNames(credit);
	const all = new Set(names);
	for (const featured of title.featured) {
		for (const name of splitArtistNames(featured)) all.add(name);
	}
	return { primary: names[0], leads: new Set(names), all };
}

/**
 * Catalogs and uploads disagree on who else is credited, so only the leads must
 * line up — and a lead has to meet a lead. Meeting a guest let "Kenny Loggins -
 * Danger Zone" match Cherlene's "Danger Zone (feat. Kenny Loggins)", the Archer
 * cover, and write Cherlene as the artist.
 */
function artistsAgree(query: ArtistCredit, candidate: ArtistCredit): boolean {
	return (
		(query.primary !== undefined && candidate.leads.has(query.primary)) ||
		(candidate.primary !== undefined && query.leads.has(candidate.primary))
	);
}

/**
 * Whether the album is the credited artist's own. Deezer files knock-offs under
 * the real artist's name — "Never Be Like You", credited to Flume, on "The
 * Lockbox" by The Amalgamates, at the single's exact runtime — so neither the
 * track credit nor the runtime can tell them apart, and only the album's own
 * credit does. Any shared name passes, so a feature on the other artist's album
 * still counts. A compilation is exempt: its album is never written.
 */
function onTheArtistsOwnRelease(
	candidate: CatalogCandidate,
	credit: ArtistCredit,
	candidateTitle: ParsedTitle,
): boolean {
	if (!candidate.albumArtist || candidate.isCompilation) return true;
	/** An official remix often sits on the remixer's own release: "(Robin Schulz Edit)" on Robin Schulz's "Prayer". */
	const versionCredits = candidateTitle.tags.flatMap((tag) =>
		tag.class === "identity" && tag.credit
			? [new Set(tag.credit.split(" "))]
			: [],
	);
	return splitArtistNames(candidate.albumArtist).some(
		(name) =>
			credit.all.has(name) ||
			versionCredits.some((words) =>
				name.split(" ").every((word) => words.has(word)),
			),
	);
}

/** The artist and song checks alone, before the version, the release or any evidence. */
function artistAndSongAgree(
	queryTitle: ParsedTitle,
	queryCredit: ArtistCredit,
	candidate: CatalogCandidate,
	candidateTitle: ParsedTitle,
): { artistPass: boolean; titlePass: boolean } {
	const queryBase = normalizeForMatch(queryTitle.base);
	return {
		artistPass: artistsAgree(
			queryCredit,
			artistCredit(candidate.artist, candidateTitle),
		),
		/** A title that is nothing but a version, like "(Instrumental)", names no song. */
		titlePass:
			queryBase !== "" && queryBase === normalizeForMatch(candidateTitle.base),
	};
}

/**
 * Whether a candidate names the upload's artist, song and version, so it could
 * match once its release is known. `vouchedCandidates` uses it to spend its
 * album calls on those rows alone — not on the live takes and soundtrack
 * cuts that share the song's name; every row it rejects fails the text gate
 * below.
 */
export function namesTheSameRecording(
	query: TrackQuery,
	candidate: CatalogCandidate,
): boolean {
	const queryTitle = parseTrackTitle(query.title);
	const candidateTitle = parseTrackTitle(candidate.title);
	const { artistPass, titlePass } = artistAndSongAgree(
		queryTitle,
		artistCredit(query.artist, queryTitle),
		candidate,
		candidateTitle,
	);
	return (
		artistPass && titlePass && sameVersion(queryTitle, candidateTitle).identity
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
	const songAgreement = artistAndSongAgree(
		queryTitle,
		queryCredit,
		candidate,
		candidateTitle,
	);
	const candidateCredit = artistCredit(candidate.artist, candidateTitle);
	const artistPass =
		songAgreement.artistPass &&
		onTheArtistsOwnRelease(candidate, candidateCredit, candidateTitle);
	const { titlePass } = songAgreement;

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
		credit: candidateCredit,
		songPass: titlePass && version.identity,
		reason: missReason(artistPass, titlePass, version.identity),
	};
}

function sameAlbum(left: CatalogCandidate, right: CatalogCandidate): boolean {
	return (
		left.album !== undefined &&
		right.album !== undefined &&
		normalizeForMatch(left.album) === normalizeForMatch(right.album)
	);
}

/** "Prince & The Revolution": the band behind the lead, not a second performer. */
function isBackingBand(name: string): boolean {
	return name.startsWith("the ");
}

/**
 * A lead one copy of a track credits that the other copy never mentions, and
 * the upload never names either — not as an artist, a guest or a remixer.
 */
function leadTheOtherOmits(
	from: Assessment,
	other: Assessment,
	named: string[],
): boolean {
	const credits = (names: Iterable<string>, lead: string) =>
		[...names].some((name) => sameCredit(lead, name));
	return [...from.credit.leads].some(
		(lead) =>
			!isBackingBand(lead) &&
			!credits(named, lead) &&
			!credits(other.credit.all, lead),
	);
}

/**
 * Two catalogs' copies of one track that disagree on who performs it. iTunes
 * credits the Duets "New York, New York" to Frank Sinatra & Tony Bennett, while
 * Deezer's copy on the same album names Sinatra alone — and an upload naming
 * only Sinatra is his 1980 solo record, which both catalogs title differently.
 * When the other copy credits the extra name too, as Deezer's "Get Lucky (feat.
 * Pharrell Williams and Nile Rodgers)" does against iTunes's three-name lead,
 * the catalogs agree and the upload has simply left a guest out.
 */
function withDisputedPerformersRefused(
	assessments: Assessment[],
	named: string[],
): Assessment[] {
	return assessments.map((assessment) => {
		if (!assessment.textPass) return assessment;
		const disputed = assessments.some(
			(copy) =>
				copy !== assessment &&
				copy.songPass &&
				copy.recordingKey === assessment.recordingKey &&
				sameAlbum(copy.candidate, assessment.candidate) &&
				!runtimesDisagree(copy.candidate, assessment.candidate) &&
				(leadTheOtherOmits(assessment, copy, named) ||
					leadTheOtherOmits(copy, assessment, named)),
		);
		return disputed
			? { ...assessment, textPass: false, reason: "artist-mismatch" }
			: assessment;
	});
}

/** Everyone the upload credits: its artists, its guests, and any remixer its version names. */
function namedByUpload(credit: ArtistCredit, title: ParsedTitle): string[] {
	return [
		...credit.all,
		...title.tags.flatMap((tag) =>
			tag.class === "identity" && tag.credit ? [tag.credit] : [],
		),
	];
}

/**
 * Every proof this candidate satisfies, strongest first. The text gate comes
 * first and applies to all of them. A runtime that disagrees cancels the ISRC
 * proof rather than being ignored: two recordings minutes apart in length are
 * not the same recording, whatever tag the uploader typed.
 */
function proofsFor(
	assessment: Assessment,
	corroborated: boolean,
): MatchEvidence[] {
	if (!assessment.textPass || assessment.candidateOutruns) return [];
	const proofs: MatchEvidence[] = [];
	if (assessment.isrcPass && !assessment.durationContradicts)
		proofs.push("isrc");
	if (assessment.durationPass) proofs.push("duration");
	if (assessment.sameLength && corroborated) proofs.push("agreement");
	return proofs.sort(
		(left, right) =>
			EVIDENCE_ORDER.indexOf(left) - EVIDENCE_ORDER.indexOf(right),
	);
}

/** Both runtimes are known and apart, so the two rows cannot be one recording. */
function runtimesDisagree(
	left: CatalogCandidate,
	right: CatalogCandidate,
): boolean {
	return (
		left.durationSeconds !== undefined &&
		right.durationSeconds !== undefined &&
		Math.abs(left.durationSeconds - right.durationSeconds) >
			DURATION_TOLERANCE_SECONDS
	);
}

/**
 * The candidates an iTunes result and a Deezer result both reached on their
 * own. The outruns check here is the load-bearing one: without it a 7:41
 * extended mix would corroborate itself and hand a 3:26 upload the wrong
 * recording. The same check in `proofsFor` is belt to this braces — a cut that
 * outruns the upload contradicts its runtime by definition, so the other two
 * proofs already refuse it — but it keeps the rule legible where the proofs are
 * decided.
 *
 * A shared title is not a shared recording, so when both runtimes are known the
 * twin must also run the same length. Keyed on the title alone, a 3:32
 * instrumental knock-off credited to Flume on Deezer "agreed" with the 3:55
 * single on iTunes, and then won the match because Deezer ranks first — writing
 * the knock-off album's label, ISRC and cover into the official upload's file.
 */
function corroboratedAssessments(assessments: Assessment[]): Set<Assessment> {
	const eligible = assessments.filter(
		(assessment) =>
			assessment.textPass &&
			!assessment.candidateOutruns &&
			(assessment.sameLength || assessment.durationPass),
	);
	return new Set(
		eligible.filter((assessment) =>
			eligible.some(
				(twin) =>
					twin.candidate.source !== assessment.candidate.source &&
					twin.recordingKey === assessment.recordingKey &&
					!runtimesDisagree(twin.candidate, assessment.candidate),
			),
		),
	);
}

/** Words an uploader leaves after a credit that name no artist: "ft. Sam Smith HD". */
const NOT_A_NAME =
	/\b(?:official|video|audio|lyrics?|hd|hq|4k|youtube|visuali[sz]er|mv|clip|explicit|clean|remaster(?:ed)?|prod)\b|[-–—|/]/i;

function nameWords(name: string): Set<string> {
	return new Set(normalizeForMatch(name).split(" ").filter(Boolean));
}

/** "Pharrell" and "Pharrell Williams" are one credit, spelled shorter. */
function sameCredit(left: string, right: string): boolean {
	const a = nameWords(left);
	const b = nameWords(right);
	const within = (small: Set<string>, large: Set<string>) =>
		small.size > 0 && [...small].every((word) => large.has(word));
	return within(a, b) || within(b, a);
}

/**
 * A catalog can file a feature under the track's contributors instead of its
 * title — "Latch", not "Latch (feat. Sam Smith)" — and writing that title as-is
 * dropped the credit the upload named. It is added back only when the catalog
 * credits no feature at all and none of the upload's names, and only when what
 * the upload typed after "ft." is names: the catalog spells a credit its own
 * way ("Ty Dolla $ign"), and an uploader's trailing "HD" is not a guest. The
 * names are joined with commas because that is how they were split —
 * "Tyler, The Creator" comes back whole.
 */
function titleKeepingFeatures(
	candidate: CatalogCandidate,
	queryTitle: ParsedTitle,
): string {
	if (queryTitle.featured.length === 0) return candidate.title;
	const candidateTitle = parseTrackTitle(candidate.title);
	if (candidateTitle.featured.length > 0) return candidate.title;
	if (queryTitle.featured.some((name) => NOT_A_NAME.test(name))) {
		return candidate.title;
	}
	const credited = [...artistCredit(candidate.artist, candidateTitle).all];
	const alreadyCredited = queryTitle.featured.some((name) =>
		credited.some((creditedName) => sameCredit(name, creditedName)),
	);
	return alreadyCredited
		? candidate.title
		: `${candidate.title} (feat. ${joinCredits(queryTitle.featured)})`;
}

/**
 * "Wizkid & Kyla", "Selena Gomez, Ozuna & Cardi B". A name the upload split at
 * a comma is rejoined with one — "Tyler, The Creator" — which is why a name
 * starting with "The" is never the one an "&" goes before.
 */
function joinCredits(names: string[]): string {
	const last = names.at(-1) ?? "";
	if (names.length < 2 || /^the\s/i.test(last)) return names.join(", ");
	return `${names.slice(0, -1).join(", ")} & ${last}`;
}

/**
 * A compilation names the recording but not its release: its album, date,
 * label and sleeve are the compilation's, and its ISRC can belong to a
 * re-recording — a workout mix of "Hot Stuff" carries its own. So a compilation
 * contributes the artist and title, and an ISRC only when it is the upload's
 * own; the release fields come from a real release of the same recording, if
 * one is present.
 */
function canonicalFrom(
	candidate: CatalogCandidate,
	queryTitle: ParsedTitle,
	queryIsrc: string | undefined,
): CanonicalMetadata {
	const identity = {
		artist: artistDisplayName(candidate.artist),
		title: titleKeepingFeatures(candidate, queryTitle),
		isrc: queryIsrc,
		source: candidate.source,
	};
	if (candidate.isCompilation) return identity;
	return {
		...identity,
		album: candidate.album,
		genre: candidate.genre,
		label: candidate.label,
		isrc: candidate.isrc ?? queryIsrc,
		artworkUrl: candidate.artworkUrl,
	};
}

/**
 * The recording's year is its earliest release: a reissue, a remaster or a
 * compilation comes out after the original, never before it. iTunes dates each
 * track by that original release even on a compilation — the Reservoir Dogs
 * soundtrack's "Stuck in the Middle with You" says 1972 — while Deezer dates a
 * compilation's copy by the compilation, so only those are left out.
 */
function earliestYear(candidates: CatalogCandidate[]): number | undefined {
	const dated = candidates.filter(
		(candidate) =>
			!(candidate.isCompilation && candidate.source === "deezer") &&
			releaseYear(candidate.releaseDate) !== undefined,
	);
	/** A Jan 1 date is a placeholder — an "80s hits" set dated 1980-01-01 is not the song's year. */
	const precise = dated.filter((candidate) =>
		isPreciseDate(candidate.releaseDate),
	);
	const years = (precise.length > 0 ? precise : dated).map(
		(candidate) => releaseYear(candidate.releaseDate) as number,
	);
	return years.length > 0 ? Math.min(...years) : undefined;
}

/**
 * Deezer names the recording best but its search results carry no release date
 * and no genre, while iTunes carries both. When the two catalogs agree on a
 * recording, the fields one lacks are taken from the other rather than from a
 * second network call — never from a compilation, for the reasons above, except
 * the year an iTunes compilation dates the recording by.
 */
function fillFromSupport(
	metadata: CanonicalMetadata,
	best: CatalogCandidate,
	support: CatalogCandidate[],
): CanonicalMetadata {
	const merged = { ...metadata, year: earliestYear([best, ...support]) };
	for (const candidate of support) {
		if (candidate.isCompilation) continue;
		merged.album ??= candidate.album;
		merged.genre ??= candidate.genre;
		merged.isrc ??= candidate.isrc;
		merged.label ??= candidate.label;
		merged.artworkUrl ??= candidate.artworkUrl;
	}
	return merged;
}

/**
 * The other candidates for the same recording, whose fields fill the gaps in
 * the best one's. The full text gate is required — `recordingKey` compares
 * titles alone, so without the artist check a different artist's same-named
 * track could supply the album, and an ISRC-reached candidate is no exception.
 *
 * A cut that OUTRUNS the upload is excluded, but a shorter one is not: a live
 * take would otherwise donate its ISRC to the studio version, while the shorter
 * catalog twin of a longer music video is exactly the donor whose year and
 * genre the match needs. What a donor may not do is disagree with the chosen
 * release's own runtime — an ISRC names one recording, so a same-titled row of
 * another length would stamp its code on the wrong one. Ranked candidates come
 * first, so a real release fills a field before a compilation does.
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
			!assessment.candidateOutruns &&
			!runtimesDisagree(assessment.candidate, best.candidate) &&
			assessment.textPass
		) {
			support.add(assessment.candidate);
		}
	}
	return [...support];
}

function preciseDate(releaseDate: string | undefined): string | undefined {
	return isPreciseDate(releaseDate) ? releaseDate : undefined;
}

/**
 * Ranking is structural, not evidential, so that the choice cannot change when
 * a later stage learns the duration: a preview and its download must agree, or
 * the file disagrees with what the user was shown. The upload's own ISRC comes
 * first, then a real release over a compilation — two workout compilations
 * agreeing on "Hot Stuff" are still two compilations — then corroboration, and
 * the catalogs' own ordering breaks the rest: both APIs rank the canonical
 * release above a reissue or a knock-off, which a back-dated "Jan 1" reissue
 * date does not.
 */
function betterMatch(left: Match, right: Match): number {
	const byIsrc =
		Number(!left.assessment.isrcPass) - Number(!right.assessment.isrcPass);
	if (byIsrc !== 0) return byIsrc;

	const a = left.assessment.candidate;
	const b = right.assessment.candidate;

	const byCompilation =
		Number(a.isCompilation ?? false) - Number(b.isCompilation ?? false);
	if (byCompilation !== 0) return byCompilation;

	const byAgreement = Number(!left.agreed) - Number(!right.agreed);
	if (byAgreement !== 0) return byAgreement;

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
	const assessments = withDisputedPerformersRefused(
		candidates.map((candidate) =>
			assess(query, queryTitle, queryCredit, queryIsrc, candidate),
		),
		namedByUpload(queryCredit, queryTitle),
	);
	const corroborated = corroboratedAssessments(assessments);

	const matches = assessments
		.flatMap((assessment) => {
			const agreed = corroborated.has(assessment);
			const proofs = proofsFor(assessment, agreed);
			return proofs.length ? [{ assessment, proofs, agreed }] : [];
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
			canonicalFrom(best.assessment.candidate, queryTitle, queryIsrc),
			best.assessment.candidate,
			supportingCandidates(matches, assessments, best.assessment),
		),
	};
}
