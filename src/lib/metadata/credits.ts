const VERSION_CREDIT =
	/[([]\s*([^()[\]]+?)\s+(?:remix|re-?edit|edit|bootleg|flip|rework|refix)\s*[)\]]/gi;

/** A word that describes a version rather than naming the person who made it. */
const GENERIC_VERSION_WORD =
	/^(?:original|radio|extended|club|dub|instrumental|album|single|clean|explicit|dirty|short|long|main|intro|outro|dj|vocal|acoustic|live|official|video|lyrics?|tv|promo|vip|deluxe|festival|acapella|a|capella|cappella|super|tiktok|summer|trap|house|techno|hardstyle|slowed|sped|speed|up|nightcore|mix|edit|\d+)$/i;

/**
 * Every word has to be generic, so "Video Mix" describes a version while
 * "Dirty South" and "Club Killers" still name the act that made it.
 */
function describesAVersion(name: string): boolean {
	return name.split(" ").every((word) => GENERIC_VERSION_WORD.test(word));
}

const LABEL_LIKE_NAME = /\b(?:records|recordings)\b/i;

/**
 * The person named in the last version credit, e.g. "(W&W Remix)" → "W&W". Written to TPE4.
 *
 * Whitespace runs are collapsed before matching, not for tidiness: VERSION_CREDIT's
 * `\s*`, lazy name and `\s+` can each take part of a run, so an unclosed bracket
 * before a long run backtracks in cubic time. The title can be yt-dlp's `track`,
 * which an uploader controls through a YouTube Music-style description, so an
 * uncollapsed run of a few thousand spaces blocks the event loop for seconds.
 */
export function extractRemixer(title: string): string | undefined {
	const singleSpaced = title.replace(/\s+/g, " ");
	const names = [...singleSpaced.matchAll(VERSION_CREDIT)]
		.map((match) => match[1]?.trim() ?? "")
		.filter((name) => name && !describesAVersion(name));
	return names.at(-1);
}

export interface LabelCandidates {
	platformLabel?: string;
	titleLabel?: string;
	uploader?: string;
	artist: string;
}

/**
 * The platform's own label field wins, then a label named in the title, then
 * the uploading channel when its name says it's a label ("Decaydance
 * Records") and it isn't also the artist.
 */
export function resolveLabel({
	platformLabel,
	titleLabel,
	uploader,
	artist,
}: LabelCandidates): string | undefined {
	const platform = platformLabel?.trim();
	if (platform) return platform;
	if (titleLabel) return titleLabel;
	const channel = uploader?.trim();
	if (
		channel &&
		LABEL_LIKE_NAME.test(channel) &&
		channel.toLowerCase() !== artist.trim().toLowerCase()
	) {
		return channel;
	}
	return undefined;
}
