/**
 * Strips what uploaders put around a track's name — premiere banners,
 * free-download tags, "(Official Audio)", file extensions — and lifts out the
 * two bracketed credits worth keeping: a label and a catalog number.
 *
 * Every pattern here came from a real upload title; see the fixtures in
 * tests/unit/metadata/clean-upload-title.test.ts before widening one. Noise is
 * matched against an NFKC-normalised copy so styled text ("𝐅𝐑𝐄𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃")
 * is recognised, while every kept segment keeps its original characters.
 */

export interface CleanedUploadTitle {
	title: string;
	label?: string;
	catalogNumber?: string;
}

export interface UploadTitleHints {
	/** The platform's own label field (SoundCloud's `label_name`). */
	labelName?: string;
}

const PROMO_WORD = String.raw`(?:world\s+)?(?:premiere|exclusive)\s*\d*`;

const BRACKETED_PROMO_PREFIX = new RegExp(
	String.raw`^[\[(【]\s*${PROMO_WORD}\s*[\])】]\s*(?:[:|]|\/\/?|[-–—])?\s*`,
	"i",
);

/** Requires a separator, so a song that merely starts with "Exclusive" is left alone. */
const SEPARATED_PROMO_PREFIX = new RegExp(
	String.raw`^${PROMO_WORD}\s*(?:[:|]|\/\/?|\s[-–—]\s)\s*`,
	"i",
);

const NOISE_PHRASE = new RegExp(
	`^(?:${[
		String.raw`free\s*(?:download|dl)`,
		String.raw`out\s+now`,
		String.raw`out\s+on\s+\S+`,
		PROMO_WORD,
		String.raw`official(?:\s+(?:hd|4k))?(?:\s+(?:music|lyrics?))?(?:\s+(?:video|audio|visuali[sz]er))?`,
		String.raw`(?:music|lyrics?)\s+video`,
		"lyrics?",
		"video",
		"audio",
		"visuali[sz]er",
		"hq",
		"hd",
		"4k",
		String.raw`\d{3,4}p`,
		"wav",
		"mp3",
		String.raw`320\s*(?:kbps)?`,
	].join("|")})$`,
	"i",
);

/**
 * Square brackets only, and three leading letters: "(VIP 2019)" is a version,
 * "[EP01]" and "[HD1080]" are not catalog numbers, "[RCKLSS014]" is.
 */
const CATALOG_NUMBER = /^[A-Z]{3,}[A-Z0-9]*-?\d{2,}$/;
/**
 * A label is a name. Text that opens by describing the recording or the
 * release — "(Home Recordings)", "(Live at Abbey Road Recordings)", "[Free
 * Release]", "[Single Release]" — is version info, and a phrase that merely
 * contains a label ("[Out Now on Spinnin' Records]") is not one. Both stay in
 * the title and write no TPUB.
 */
const NOT_A_LABEL_NAME =
	/^(?:official|live|home|demo|original|studio|early|new|single|album|promo|free|digital|debut|press|pre|vinyl|japan)\b|\s(?:on|at|via|from|by)\s/i;
const LABEL_SUFFIX = /^.+\s(?:records|recordings)$/i;
/** "[Monstercat Release]" names the label Monstercat. */
const RELEASE_SUFFIX = /^(.+?)\s+release$/i;
const BRACKET_GROUP = /\s*([[(【])([^()[\]【】]*)[\])】]/g;
const TRAILING_SEGMENT = /\s+(?:\||\/\/?)\s*([^|/]*)$/;
const TRAILING_FREE_DOWNLOAD =
	/(?:\s*[-–—|/]+\s*|\s+)free\s*(?:download|dl)\s*$/i;
/** Case-sensitive: the all-caps banner is SoundCloud's convention, and "Grand Premiere" is a real title. */
const TRAILING_PREMIERE_BANNER = /\s+PREMIERE$/;
const FILE_EXTENSION = /\.(?:mp3|мп3|wav|flac|m4a|aiff?)$/i;
const DANGLING_SEPARATORS = /^[\s|/:–—-]+|[\s|/:–—-]+$/g;

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function normalizeForMatching(text: string): string {
	return text.normalize("NFKC").trim();
}

function isNoiseSegment(segment: string): boolean {
	const normalized = normalizeForMatching(segment);
	return (
		normalized === "" ||
		NOISE_PHRASE.test(normalized) ||
		/\bpremiere\b/i.test(normalized)
	);
}

function stripPromoPrefix(title: string): string {
	return title
		.replace(BRACKETED_PROMO_PREFIX, "")
		.replace(SEPARATED_PROMO_PREFIX, "");
}

function stripTrailingNoise(title: string): string {
	let current = title;
	for (;;) {
		const segment = current.match(TRAILING_SEGMENT);
		if (segment?.index !== undefined && isNoiseSegment(segment[1] ?? "")) {
			current = current.slice(0, segment.index);
			continue;
		}
		const stripped = current
			.replace(TRAILING_FREE_DOWNLOAD, "")
			.replace(TRAILING_PREMIERE_BANNER, "");
		if (stripped === current) return current;
		current = stripped;
	}
}

function labelFrom(
	text: string,
	labelName: string | undefined,
): string | undefined {
	const hint = labelName?.trim();
	if (hint && text.toLowerCase() === normalizeForMatching(hint).toLowerCase()) {
		return hint;
	}
	if (NOT_A_LABEL_NAME.test(text)) return undefined;
	if (LABEL_SUFFIX.test(text)) return text;
	return text.match(RELEASE_SUFFIX)?.[1];
}

export function cleanUploadTitle(
	rawTitle: string,
	hints: UploadTitleHints = {},
): CleanedUploadTitle {
	const original = collapseWhitespace(rawTitle);
	const credits: Omit<CleanedUploadTitle, "title"> = {};

	let title = stripPromoPrefix(original).replace(FILE_EXTENSION, "");
	title = stripTrailingNoise(title);
	title = title.replace(
		BRACKET_GROUP,
		(group: string, open: string, inner: string) => {
			const text = normalizeForMatching(inner);
			if (NOISE_PHRASE.test(text)) return "";
			if (open === "[" && CATALOG_NUMBER.test(text)) {
				credits.catalogNumber ??= text;
				return "";
			}
			const label = labelFrom(text, hints.labelName);
			if (label) {
				credits.label ??= label;
				return "";
			}
			return group;
		},
	);
	title = stripTrailingNoise(title);
	title = collapseWhitespace(title).replace(DANGLING_SEPARATORS, "");

	return { title: title || original, ...credits };
}
