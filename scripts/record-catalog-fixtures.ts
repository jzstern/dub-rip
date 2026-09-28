/**
 * Records real iTunes and Deezer responses so the catalog tests can run
 * offline against shapes the services actually return.
 *
 * Run with `bun scripts/record-catalog-fixtures.ts`. Only the fields the
 * clients read are kept, which keeps the fixture reviewable in a diff.
 */

import { writeFile } from "node:fs/promises";
import {
	deezerAlbumUrl,
	deezerIsrcUrl,
	deezerSearchUrl,
} from "../src/lib/metadata/catalog/deezer-catalog";
import { itunesSearchUrl } from "../src/lib/metadata/catalog/itunes-catalog";
import { searchTerm } from "../src/lib/metadata/catalog/lookup-catalog";

const FIXTURE_PATH = "tests/fixtures/catalog/catalog-responses.json";

/** Recorded as the app asks for them, through `searchTerm`, so fixture keys match real calls. */
const QUERIES = [
	{ artist: "Billie Eilish", title: "bad guy" },
	{ artist: "Tame Impala", title: "Dracula (JENNIE Remix)" },
	{ artist: "Maroon 5", title: "Payphone [TWLGHT & SadBois Archive Edit 02]" },
	{ artist: "Avicii", title: "Levels (Skrillex Remix)" },
	{ artist: "Klaps", title: "Se Cura" },
	{
		artist: "Daft Punk",
		title: "Get Lucky ft. Pharrell Williams, Nile Rodgers",
	},
	{ artist: "Adele", title: "Hello" },
	{ artist: "Kendrick Lamar", title: "HUMBLE." },
	{
		artist: "The Chainsmokers",
		title: "Don't Let Me Down ft. Daya (Hipst3r Edit)",
	},
	{ artist: "Queen", title: "Bohemian Rhapsody" },
	{ artist: "Queen", title: "Bohemian Rhapsody (Official Video Remastered)" },
	{ artist: "Onlynumbers", title: "Occult" },
	{ artist: "Rick Astley", title: "Never Gonna Give You Up" },
	{
		artist: "Macklemore & Ryan Lewis",
		title: "Can't Hold Us feat. Ray Dalton",
	},
	{ artist: "Eminem", title: "Lose Yourself" },
	{ artist: "Coldplay", title: "Yellow" },
	{ artist: "Metallica", title: "Enter Sandman (Remastered)" },
	{ artist: "The Weeknd", title: "Blinding Lights" },
	{ artist: "Artist", title: "Title" },
];

const SEARCH_TERMS = [...new Set(QUERIES.map(searchTerm))];

const ISRCS = ["USUM71900764"];
const ALBUM_IDS = ["91598612"];

const ITUNES_FIELDS = [
	"wrapperType",
	"kind",
	"trackName",
	"artistName",
	"collectionName",
	"collectionArtistName",
	"releaseDate",
	"primaryGenreName",
	"trackTimeMillis",
	"artworkUrl100",
	"trackId",
	"collectionId",
];

const DEEZER_TRACK_FIELDS = [
	"id",
	"title",
	"title_short",
	"title_version",
	"duration",
	"isrc",
	"release_date",
	"readable",
	"artist",
	"album",
	"contributors",
];

const DEEZER_ALBUM_FIELDS = [
	"id",
	"title",
	"label",
	"record_type",
	"release_date",
	"genres",
	"upc",
	"artist",
	"cover_xl",
];

type Json = Record<string, unknown>;

function pick(source: Json, fields: string[]): Json {
	return Object.fromEntries(
		fields
			.filter((field) => field in source)
			.map((field) => [field, source[field]]),
	);
}

function trimDeezerTrack(track: Json): Json {
	const kept = pick(track, DEEZER_TRACK_FIELDS);
	const album = kept.album as Json | undefined;
	const artist = kept.artist as Json | undefined;
	if (album) kept.album = pick(album, ["id", "title", "cover_xl", "cover_big"]);
	if (artist) kept.artist = pick(artist, ["id", "name"]);
	delete kept.contributors;
	return kept;
}

async function record(
	url: string,
	trim: (body: Json) => Json,
): Promise<[string, Json]> {
	const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
	console.log(`${response.status} ${url}`);
	if (!response.ok) {
		throw new Error(`Refusing to record HTTP ${response.status} for ${url}`);
	}
	const body = (await response.json()) as Json;
	if (body.error) {
		throw new Error(`Refusing to record an error body for ${url}`);
	}
	return [url, trim(body)];
}

const entries: [string, Json][] = [];

for (const term of SEARCH_TERMS) {
	entries.push(
		await record(itunesSearchUrl(term), (body) => ({
			resultCount: body.resultCount,
			results: ((body.results as Json[]) ?? []).map((result) =>
				pick(result, ITUNES_FIELDS),
			),
		})),
	);
	entries.push(
		await record(deezerSearchUrl(term), (body) => ({
			total: body.total,
			data: ((body.data as Json[]) ?? []).map(trimDeezerTrack),
		})),
	);
}

for (const isrc of ISRCS) {
	entries.push(await record(deezerIsrcUrl(isrc), trimDeezerTrack));
}

for (const albumId of ALBUM_IDS) {
	entries.push(
		await record(deezerAlbumUrl(albumId), (body) =>
			pick(body, DEEZER_ALBUM_FIELDS),
		),
	);
}

await writeFile(
	FIXTURE_PATH,
	`${JSON.stringify(Object.fromEntries(entries), null, "\t")}\n`,
);
console.log(`\nWrote ${entries.length} responses to ${FIXTURE_PATH}`);
