import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYouTubeMetadata } from "$lib/youtube-metadata";

function stubOEmbed(title: string, authorName: string): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				title,
				author_name: authorName,
				thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
			}),
		})),
	);
}

/** [oEmbed title, channel, expected artist, expected track title] */
const STABLE_YOUTUBE_TITLES: [string, string, string, string][] = [
	["Adele - Hello (Official Music Video)", "AdeleVEVO", "Adele", "Hello"],
	[
		"Daft Punk – Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers",
		"Daft Punk",
		"Daft Punk",
		"Get Lucky ft. Pharrell Williams, Nile Rodgers",
	],
	[
		"Macklemore & Ryan Lewis - Can't Hold Us feat. Ray Dalton (Official Music Video)",
		"Macklemore",
		"Macklemore & Ryan Lewis",
		"Can't Hold Us feat. Ray Dalton",
	],
	["Eminem: Lose Yourself", "EminemVEVO", "Eminem", "Lose Yourself"],
	["Coldplay | Yellow", "Coldplay", "Coldplay", "Yellow"],
	[
		"Never Gonna Give You Up",
		"Rick Astley",
		"Rick Astley",
		"Never Gonna Give You Up",
	],
	["Bohemian Rhapsody", "Queen - Topic", "Queen", "Bohemian Rhapsody"],
	[
		"Rick Astley - Never Gonna Give You Up [Official Video]",
		"Rick Astley",
		"Rick Astley",
		"Never Gonna Give You Up",
	],
	[
		"Metallica - Enter Sandman (Remastered)",
		"Metallica",
		"Metallica",
		"Enter Sandman (Remastered)",
	],
	[
		"Avicii - Levels (Skrillex Remix)",
		"Avicii",
		"Avicii",
		"Levels (Skrillex Remix)",
	],
	[
		"Queen - Bohemian Rhapsody (Official Video Remastered)",
		"Queen Official",
		"Queen",
		"Bohemian Rhapsody (Official Video Remastered)",
	],
	[
		"The Weeknd - Blinding Lights (Official Video)",
		"TheWeekndVEVO",
		"The Weeknd",
		"Blinding Lights",
	],
	[
		"Kendrick Lamar - HUMBLE.",
		"KendrickLamarVEVO",
		"Kendrick Lamar",
		"HUMBLE.",
	],
	["Artist – Title (Lyrics)", "Some Channel", "Artist", "Title"],
];

describe("YouTube title identity characterization", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(
		STABLE_YOUTUBE_TITLES,
	)("%j from %j resolves to %j / %j", async (title, channel, artist, trackTitle) => {
		// #given
		stubOEmbed(title, channel);

		// #when
		const metadata = await fetchYouTubeMetadata("dQw4w9WgXcQ");

		// #then
		expect({
			artist: metadata.artist,
			trackTitle: metadata.trackTitle,
		}).toEqual({
			artist,
			trackTitle,
		});
	});
});
