const VERSION_CREDIT =
	/[([]\s*([^()[\]]+?)\s+(?:remix|re-?edit|edit|bootleg|flip|rework|refix)\s*[)\]]/gi;

/** Words that describe a version rather than name the person who made it. */
const GENERIC_VERSION_NAME =
	/^(?:original|radio|extended|club|dub|instrumental|album|single|clean|explicit|short|long|main|vocal|acoustic|live|official|vip|deluxe|festival|acapella|a capella|a cappella|super clean|tiktok|summer|trap|house|techno|hardstyle|slowed|sped up|speed up|nightcore|\d+)$/i;

const LABEL_LIKE_NAME = /\b(?:records|recordings)\b/i;

/** The person named in the last version credit, e.g. "(W&W Remix)" → "W&W". Written to TPE4. */
export function extractRemixer(title: string): string | undefined {
	const names = [...title.matchAll(VERSION_CREDIT)]
		.map((match) => match[1]?.trim() ?? "")
		.filter((name) => name && !GENERIC_VERSION_NAME.test(name));
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
