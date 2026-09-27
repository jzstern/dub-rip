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

/** "Klaps (BE)" and "Sarah (UK)" are store disambiguators, not part of a name. */
const STORE_DISAMBIGUATOR = /\s*\([A-Z]{2,3}\d*\)\s*$/;

const ARTIST_SEPARATOR =
	/\s*(?:,|&|\+|\/|\sx\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bwith\s|\band\s)\s*/gi;

/**
 * Caps the text without cutting a surrogate pair in half. A lone high surrogate
 * survives into `encodeURIComponent` when the term reaches a search URL, where
 * it throws URIError — one emoji landing on the boundary would otherwise take
 * down the whole lookup.
 */
export function collapseWhitespace(text: string): string {
	let capped = text.slice(0, MAX_LENGTH);
	const lastCode = capped.charCodeAt(capped.length - 1);
	if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
		capped = capped.slice(0, -1);
	}
	return capped.replace(/\s+/g, " ").trim();
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
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
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
