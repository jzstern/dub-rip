import { collapseWhitespace, normalizeForMatch } from "./normalize-text";

/**
 * Splits a track title into the name of the song, its featured credits and its
 * version tags, so a remix is never mistaken for the recording it remixes.
 *
 * The three classes decide how strictly a catalog result has to agree:
 * - `identity` — a different recording. Must match exactly, credit included.
 * - `length`   — the same recording, cut differently. Must match unless the
 *                runtimes agree.
 * - `neutral`  — says nothing about the recording. Ignored.
 *
 * Anything unrecognised is treated as `identity`, so matching fails closed:
 * "(SneakPreview) Adrian Ackers Blueprint 1" can never match a plain title.
 */

export type VersionClass = "identity" | "length" | "neutral";

export interface VersionTag {
	class: VersionClass;
	kind: string;
	credit?: string;
}

export interface ParsedTitle {
	base: string;
	featured: string[];
	tags: VersionTag[];
}

const BRACKET_GROUP = /\s*[([{【]([^()[\]{}【】]*)[)\]}】]/g;
const INLINE_FEATURED = /\s(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;
const BRACKET_FEATURED = /^(?:feat\.?|ft\.?|featuring|with|w\/)\s+(.+)$/i;
const DASH_SUFFIX = /\s+[-–—]\s+([^-–—]+)$/;
const SEGMENT_SEPARATOR = /\s+[-–—]\s+/;
const FEATURED_SEPARATOR = /\s*(?:,|&|\+|\band\b|\bx\b)\s*/i;
const DANGLING_PUNCTUATION = /^[\s,;:|/–—-]+|[\s,;:|/–—-]+$/g;

const IDENTITY_KIND =
	/\b(remix|rmx|edit|bootleg|flip|rework|refix|vip|mashup|live|acoustic|unplugged|instrumental|acapella|cappella|karaoke|cover|tribute|slowed|sped|nightcore|reprise|demo|dub|session)\b/;

/**
 * Length variants: the same recording, cut for radio, a club or a 12".
 *
 * Checked before the neutral vocabulary, so "single version" and "video mix"
 * land here even though "single", "version", "video" and "mix" are each
 * individually neutral. A bare "edit" is deliberately NOT here — an unqualified
 * "(Edit)" names someone else's edit, so it belongs with the identity kinds and
 * has to fail closed.
 */
const LENGTH_PHRASE =
	/^(?:radio (?:edit|mix|version)|extended(?: (?:mix|version|edit))?|club (?:mix|edit)|single (?:version|mix|edit)|video (?:mix|version|edit)|(?:short|long|full) (?:version|edit)|(?:7|10|12)(?: inch)?(?: (?:mix|version|edit))?)$/;

/**
 * Words that describe a file or a master rather than a recording. A bracket
 * made only of these says nothing, so "(Official Video Remastered)" and
 * "(Original Mix)" compare equal to no bracket at all.
 */
const NEUTRAL_TOKENS = new Set([
	"official",
	"video",
	"audio",
	"music",
	"lyric",
	"lyrics",
	"lyrical",
	"visualizer",
	"visualiser",
	"hd",
	"hq",
	"uhd",
	"4k",
	"remaster",
	"remastered",
	"remastering",
	"explicit",
	"clean",
	"original",
	"album",
	"single",
	"version",
	"mix",
	"mono",
	"stereo",
	"deluxe",
	"edition",
	"bonus",
]);

/**
 * The two catalogs spell the same cut differently — iTunes writes "12-Inch
 * Version" where Deezer writes '12" Version'. Keying a length tag on the text
 * as written would stop those rows from ever agreeing on one recording, so each
 * maps to the family it belongs to instead.
 */
const LENGTH_FAMILIES: [RegExp, string][] = [
	[/^radio\b/, "radio"],
	[/^extended\b/, "extended"],
	[/^club\b/, "club"],
	[/^single\b/, "single"],
	[/^video\b/, "video"],
	[/^short\b/, "short"],
	[/^(?:long|full)\b/, "full"],
	[/^(?:7|10|12)\b/, "vinyl"],
];

function lengthFamily(normalized: string): string {
	return (
		LENGTH_FAMILIES.find(([pattern]) => pattern.test(normalized))?.[1] ??
		normalized
	);
}

/** "remastered 2021" and "2015 remaster" are masterings; "2023 version" is a re-recording. */
const MASTERING_TOKEN = /^remaster(?:ed|ing)?$/;

function isNeutral(normalized: string): boolean {
	const tokens = normalized.split(" ").filter(Boolean);
	if (tokens.length === 0) return false;
	/**
	 * A year only rides along with a mastering word. Allowing a bare year on its
	 * own made "(2023 Version)" neutral, which silently equated a Taylor's-Version
	 * style re-recording — a different recording entirely — with the original.
	 */
	const hasMastering = tokens.some((token) => MASTERING_TOKEN.test(token));
	return tokens.every(
		(token) =>
			NEUTRAL_TOKENS.has(token) || (hasMastering && /^\d{4}$/.test(token)),
	);
}

function splitFeaturedNames(credit: string): string[] {
	return credit
		.split(FEATURED_SEPARATOR)
		.map((name) => name.trim())
		.filter(Boolean);
}

function classifySegment(segment: string): VersionTag | null {
	const normalized = normalizeForMatch(segment);
	if (!normalized) return null;
	if (LENGTH_PHRASE.test(normalized)) {
		return { class: "length", kind: lengthFamily(normalized) };
	}
	if (isNeutral(normalized)) {
		return { class: "neutral", kind: normalized };
	}
	const kind = normalized.match(IDENTITY_KIND)?.[1];
	if (!kind) {
		return { class: "identity", kind: "unknown", credit: normalized };
	}
	const credit = normalized
		.split(" ")
		.filter((token) => token !== kind)
		.join(" ");
	return credit
		? { class: "identity", kind, credit }
		: { class: "identity", kind };
}

function tidy(text: string): string {
	return text.replace(/\s+/g, " ").replace(DANGLING_PUNCTUATION, "").trim();
}

export function parseTrackTitle(title: string): ParsedTitle {
	const featured: string[] = [];
	const tags: VersionTag[] = [];

	const collect = (segment: string): void => {
		const credit = segment.match(BRACKET_FEATURED)?.[1];
		if (credit) {
			featured.push(...splitFeaturedNames(credit));
			return;
		}
		const tag = classifySegment(segment);
		if (tag) tags.push(tag);
	};

	/** Capped and collapsed first: the patterns below scan runs quadratically. */
	let base = collapseWhitespace(title);
	base = base.replace(BRACKET_GROUP, (_group, inner: string) => {
		for (const segment of inner.split(SEGMENT_SEPARATOR)) collect(segment);
		return "";
	});

	const dashSuffix = base.match(DASH_SUFFIX);
	if (dashSuffix?.[1] && dashSuffix.index !== undefined) {
		/** Only a recognised version is a suffix; "Heavy - Adrian Ackers Blueprint" is a title. */
		const tag = classifySegment(dashSuffix[1]);
		if (tag && tag.kind !== "unknown") {
			tags.push(tag);
			base = base.slice(0, dashSuffix.index);
		}
	}

	const inlineFeatured = base.match(INLINE_FEATURED);
	if (inlineFeatured?.[1]) {
		featured.push(...splitFeaturedNames(inlineFeatured[1]));
		base = base.slice(0, inlineFeatured.index);
	}

	return { base: tidy(base), featured, tags };
}

function tagKey(parsed: ParsedTitle, versionClass: VersionClass): string {
	return parsed.tags
		.filter((tag) => tag.class === versionClass)
		.map((tag) => `${tag.kind}:${tag.credit ?? ""}`)
		.sort()
		.join(",");
}

/** Two titles share a key when they name the same recording, cut the same way. */
export function identityKey(parsed: ParsedTitle): string {
	return [
		normalizeForMatch(parsed.base),
		tagKey(parsed, "identity"),
		tagKey(parsed, "length"),
	].join("|");
}

export function sameVersion(
	left: ParsedTitle,
	right: ParsedTitle,
): { identity: boolean; length: boolean } {
	return {
		identity: tagKey(left, "identity") === tagKey(right, "identity"),
		length: tagKey(left, "length") === tagKey(right, "length"),
	};
}
