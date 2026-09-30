import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCatalogMetadata } from "$lib/metadata/catalog/lookup-catalog";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";
import { expectEveryFixtureHit, stubCatalogFetch } from "./catalog-fixtures";

/**
 * The other side of `youtube-identity-characterization.test.ts`, which pins what
 * the heuristics make of a YouTube title. This pins what the catalog lookup then
 * does with it, so any change to what a user would see is visible in a diff.
 *
 * The same titles run through both files. A row marked `heuristic` is one the
 * lookup refused to touch, which is the safe outcome, not a bug: it happens
 * where a catalog's top results are covers, karaoke or alternate mixes.
 */

/** [oEmbed title, channel, artist shown, title shown, where it came from] */
const CANONICAL_YOUTUBE_TITLES: [
	string,
	string,
	string,
	string,
	"catalog" | "heuristic",
][] = [
	[
		"Adele - Hello (Official Music Video)",
		"AdeleVEVO",
		"Adele",
		"Hello",
		"heuristic",
	],
	[
		"Daft Punk – Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers",
		"Daft Punk",
		"Daft Punk",
		"Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
		"catalog",
	],
	[
		"Macklemore & Ryan Lewis - Can't Hold Us feat. Ray Dalton (Official Music Video)",
		"Macklemore",
		"Macklemore & Ryan Lewis",
		"Can't Hold Us feat. Ray Dalton",
		"heuristic",
	],
	["Eminem: Lose Yourself", "EminemVEVO", "Eminem", "Lose Yourself", "catalog"],
	["Coldplay | Yellow", "Coldplay", "Coldplay", "Yellow", "catalog"],
	[
		"Never Gonna Give You Up",
		"Rick Astley",
		"Rick Astley",
		"Never Gonna Give You Up",
		"heuristic",
	],
	[
		"Bohemian Rhapsody",
		"Queen - Topic",
		"Queen",
		"Bohemian Rhapsody",
		"catalog",
	],
	[
		"Rick Astley - Never Gonna Give You Up [Official Video]",
		"Rick Astley",
		"Rick Astley",
		"Never Gonna Give You Up",
		"heuristic",
	],
	[
		"Metallica - Enter Sandman (Remastered)",
		"Metallica",
		"Metallica",
		"Enter Sandman (Remastered)",
		"heuristic",
	],
	[
		"Avicii - Levels (Skrillex Remix)",
		"Avicii",
		"Avicii",
		"Levels (Skrillex Remix)",
		"catalog",
	],
	[
		"Queen - Bohemian Rhapsody (Official Video Remastered)",
		"Queen Official",
		"Queen",
		"Bohemian Rhapsody",
		"catalog",
	],
	[
		"The Weeknd - Blinding Lights (Official Video)",
		"TheWeekndVEVO",
		"The Weeknd",
		"Blinding Lights",
		"catalog",
	],
	[
		"Kendrick Lamar - HUMBLE.",
		"KendrickLamarVEVO",
		"Kendrick Lamar",
		"HUMBLE.",
		"catalog",
	],
	["Artist – Title (Lyrics)", "Some Channel", "Artist", "Title", "heuristic"],
];

interface ShownIdentity {
	artist: string;
	title: string;
	from: "catalog" | "heuristic";
}

async function resolveShownIdentity(
	rawTitle: string,
	uploader: string,
): Promise<ShownIdentity> {
	const heuristic = resolveTrackIdentity({ rawTitle, uploader });
	const verdict = await lookupCatalogMetadata({
		artist: heuristic.artist,
		title: heuristic.trackTitle,
	});
	return verdict.status === "matched"
		? {
				artist: verdict.metadata.artist,
				title: verdict.metadata.title ?? heuristic.trackTitle,
				from: "catalog" as const,
			}
		: {
				artist: heuristic.artist,
				title: heuristic.trackTitle,
				from: "heuristic" as const,
			};
}

describe("canonical identity characterization", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(
		CANONICAL_YOUTUBE_TITLES,
	)("%j from %j shows %j / %j, from the %s", async (rawTitle, uploader, artist, title, from) => {
		// #given
		const stub = stubCatalogFetch();

		// #when
		const shown = await resolveShownIdentity(rawTitle, uploader);

		// #then — a missing fixture would otherwise read as a legitimate "heuristic" row
		expectEveryFixtureHit(stub);
		expect(shown).toEqual({ artist, title, from });
	});

	it("names the song but no release when only agreement proves it", async () => {
		// #given
		stubCatalogFetch();

		// #when
		const verdict = await lookupCatalogMetadata({
			artist: "Daft Punk",
			title: "Get Lucky ft. Pharrell Williams, Nile Rodgers",
		});

		// #then — a music video's runtime proves none of the song's releases
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Daft Punk",
			title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
			source: "deezer",
		});
	});
});
