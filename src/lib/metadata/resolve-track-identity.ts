import {
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import { cleanUploadTitle } from "./clean-upload-title";

export interface TrackIdentityInput {
	rawTitle: string;
	uploader: string;
	/** An artist credit supplied by the platform (SoundCloud's `publisher_metadata.artist`). */
	creditedArtist?: string;
	labelName?: string;
}

export interface TrackIdentity {
	artist: string;
	trackTitle: string;
}

const ARTIST_LIST_SEPARATOR = /\s*(?:,|&|\+|\sx\s|\bfeat\.?\s|\bft\.?\s)\s*/i;
/** A VEVO channel is only ever named after its artist. */
const VEVO_SUFFIX = /\s*vevo$/i;
/**
 * "Two Friends Mixes" is an artist's channel, but "Summer Mixes" is not, and a
 * lone word is as likely to be a song title as an artist, so what's left must
 * be more than one word. "Records", "Music" and "TV" aren't stripped at all:
 * "Island Records" names a label, not an artist called "Island".
 */
const ARTIST_CHANNEL_SUFFIX = /\s+(?:mixes|official)$/i;
const MULTI_WORD = /\S\s+\S/;
const TRAILING_VERSION = /(?:\s*[([][^()[\]]*[)\]])+$/;

function normalizeName(name: string): string {
	return name
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, "");
}

function channelStems(name: string): string[] {
	const stems = [name.replace(VEVO_SUFFIX, "")];
	const artistStem = name.replace(ARTIST_CHANNEL_SUFFIX, "");
	if (MULTI_WORD.test(artistStem)) stems.push(artistStem);
	return stems;
}

function knownArtistNames(...names: (string | undefined)[]): Set<string> {
	const variants = names.flatMap((name) =>
		name ? [...name.split(ARTIST_LIST_SEPARATOR), ...channelStems(name)] : [],
	);
	return new Set(variants.map(normalizeName).filter(Boolean));
}

/**
 * "Title - Artist" uploads are common on SoundCloud and not rare on YouTube.
 * A swap needs the right side to *be* a known name and the left side not to
 * be one, so an ordinary "Artist - Title" is never flipped by coincidence.
 */
function swapIfReversed(
	artist: string,
	title: string,
	known: Set<string>,
): TrackIdentity | null {
	const version = title.match(TRAILING_VERSION)?.[0] ?? "";
	const titleCore = title.slice(0, title.length - version.length).trim();
	if (
		!known.has(normalizeName(titleCore)) ||
		known.has(normalizeName(artist))
	) {
		return null;
	}
	return { artist: titleCore, trackTitle: `${artist}${version}`.trim() };
}

/**
 * Precedence — title, then platform credit, then uploader — is measured, not
 * assumed: across 152 real SoundCloud uploads the platform credit named the
 * label, a repost channel, an editor or a truncated name often enough, even on
 * distributor uploads with an ISRC, while an artist in the title was right.
 */
export function resolveTrackIdentity({
	rawTitle,
	uploader,
	creditedArtist,
	labelName,
}: TrackIdentityInput): TrackIdentity {
	const { title: cleaned } = cleanUploadTitle(rawTitle, { labelName });
	const parsed = parseArtistAndTitle(cleaned);
	const uploaderArtist = sanitizeUploaderAsArtist(uploader);
	const credited = creditedArtist?.trim() || undefined;

	if (parsed.artist) {
		const swapped = swapIfReversed(
			parsed.artist,
			parsed.title,
			knownArtistNames(credited, uploaderArtist),
		);
		return swapped ?? { artist: parsed.artist, trackTitle: parsed.title };
	}

	return {
		artist: credited || uploaderArtist,
		trackTitle: parsed.title || cleaned,
	};
}
