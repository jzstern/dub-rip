/**
 * Comparison-only normalisation. Every value written to a tag keeps its
 * original characters; these forms exist so that "HUMBLE." and "HUMBLE", or
 * "I Cant Fail" and "I Can't Fail", compare equal.
 *
 * Whitespace is collapsed and the input is capped before any pattern runs.
 * Both matter: the patterns below start with `\s*`, which re-scans a run of
 * spaces from every offset, and the text can be an artist name an uploader
 * chose — the same trap `metadata/credits.ts` documents, where a few thousand
 * spaces blocked the event loop for seconds.
 */

/** Longer than any real artist or title; a catalog search on more is junk anyway. */
const MAX_LENGTH = 300;

/**
 * Only the Latin/Greek/Cyrillic combining diacritics are stripped, so "Beyoncé"
 * folds to "Beyonce". Stripping every `\p{M}` would also erase the Japanese
 * dakuten, which is a letter difference rather than an accent: it would make
 * パート (Part) and ハート (Heart) the same title.
 */
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/** A high surrogate with no low after it, or a low with no high before it. */
const UNPAIRED_SURROGATE =
	/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** "Klaps (BE)" and "Sarah (UK)" are store disambiguators, not part of a name. */
const STORE_DISAMBIGUATOR = /\s*\([A-Z]{2,3}\d*\)\s*$/;

const ARTIST_SEPARATOR =
	/\s*(?:,|&|\+|\/|\sx\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bwith\s|\band\s)\s*/gi;

/**
 * Caps the text and drops any unpaired surrogate — one the cap split off, and
 * one the uploader typed. A lone surrogate reaching `encodeURIComponent` when
 * the term becomes a search URL throws URIError, which would take down the whole
 * lookup rather than degrade to no candidates.
 */
export function collapseWhitespace(text: string): string {
	return text
		.slice(0, MAX_LENGTH)
		.replace(UNPAIRED_SURROGATE, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeForMatch(text: string): string {
	return (
		collapseWhitespace(text)
			.normalize("NFKD")
			.replace(COMBINING_DIACRITICS, "")
			.toLowerCase()
			.replace(/[&+]/g, " and ")
			// Apostrophes close up rather than split, so "Can't" and "Cant" agree.
			.replace(/['’‘`´]/g, "")
			// Marks are kept: dropping them here would undo the kana rule above.
			.replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/** The name as it should be written, without a store's country disambiguator. */
export function artistDisplayName(name: string): string {
	return collapseWhitespace(name).replace(STORE_DISAMBIGUATOR, "").trim();
}

/** Every name in an artist credit, normalised. "Tame Impala & JENNIE" gives two. */
export function splitArtistNames(credit: string): string[] {
	return artistDisplayName(credit)
		.split(ARTIST_SEPARATOR)
		.map(normalizeForMatch)
		.filter(Boolean);
}

/** ISRCs are compared as identifiers: case and the optional dashes carry no meaning. */
export function normalizeIsrc(isrc: string | undefined): string | undefined {
	const compact = isrc?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
	return compact ? compact : undefined;
}
