/**
 * Comparison-only normalisation. Every value written to a tag keeps its
 * original characters; these forms exist so that "HUMBLE." and "HUMBLE", or
 * "I Cant Fail" and "I Can't Fail", compare equal.
 */

/** "Klaps (BE)" and "Sarah (UK)" are store disambiguators, not part of a name. */
const STORE_DISAMBIGUATOR = /\s*\([A-Z]{2,3}\d*\)\s*$/;

const ARTIST_SEPARATOR =
	/\s*(?:,|&|\+|\/|\sx\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bwith\s|\band\s)\s*/gi;

export function normalizeForMatch(text: string): string {
	return (
		text
			.normalize("NFKD")
			.replace(/\p{M}+/gu, "")
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
	return name.replace(STORE_DISAMBIGUATOR, "").trim();
}

/** Every name in an artist credit, normalised. "Tame Impala & JENNIE" gives two. */
export function splitArtistNames(credit: string): string[] {
	return artistDisplayName(credit)
		.split(ARTIST_SEPARATOR)
		.map(normalizeForMatch)
		.filter(Boolean);
}
