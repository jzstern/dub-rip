import { describe, expect, it } from "vitest";
import type { CatalogCandidate } from "$lib/metadata/catalog/catalog-candidate";
import { judgeCandidates } from "$lib/metadata/catalog/judge-candidates";

function candidate(overrides: Partial<CatalogCandidate>): CatalogCandidate {
	return {
		source: "deezer",
		artist: "Artist",
		title: "Title",
		...overrides,
	};
}

const DRACULA_ORIGINAL_ITUNES = candidate({
	source: "itunes",
	artist: "Tame Impala",
	title: "Dracula",
	album: "Dracula - Single",
	releaseDate: "2025-09-24",
	durationSeconds: 205,
	genre: "Alternative",
});

const DRACULA_ORIGINAL_DEEZER = candidate({
	artist: "Tame Impala",
	title: "Dracula",
	album: "Dracula (with JENNIE)",
	durationSeconds: 205,
	isrc: "USQX92600001",
});

describe("judgeCandidates() rejects what a search gets wrong", () => {
	it("does not match a remix to the original recording", () => {
		// #given — the upload is the JENNIE remix; both catalogs return the original
		const query = { artist: "Tame Impala", title: "Dracula (JENNIE Remix)" };

		// #when
		const verdict = judgeCandidates(query, [
			DRACULA_ORIGINAL_ITUNES,
			DRACULA_ORIGINAL_DEEZER,
		]);

		// #then
		expect(verdict).toEqual({
			status: "unmatched",
			reason: "version-mismatch",
		});
	});

	it("does not match a bootleg edit to the original recording", () => {
		// #given
		const query = {
			artist: "Maroon 5",
			title: "Payphone [TWLGHT & SadBois Archive Edit 02]",
			durationSeconds: 231,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Maroon 5",
				title: "Payphone (feat. Wiz Khalifa)",
				album: "Overexposed (Deluxe Version)",
				durationSeconds: 231,
			}),
		]);

		// #then
		expect(verdict).toEqual({
			status: "unmatched",
			reason: "version-mismatch",
		});
	});

	it("does not match a different artist's track of the same name", () => {
		// #given
		const query = {
			artist: "blk.",
			title: "I Cant Fail",
			durationSeconds: 201,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "DJ Kay Slay",
				title: "I Can't Fail",
				durationSeconds: 201,
			}),
		]);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "artist-mismatch" });
	});

	it("does not match on text alone when no evidence confirms it", () => {
		// #given — one catalog only, and no duration to check against
		const query = { artist: "Tame Impala", title: "Dracula" };

		// #when
		const verdict = judgeCandidates(query, [DRACULA_ORIGINAL_ITUNES]);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "unverified" });
	});

	it("reports an empty candidate list", () => {
		// #when
		const verdict = judgeCandidates({ artist: "Klaps", title: "Se Cura" }, []);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "no-candidates" });
	});

	it("rejects a length variant when the duration disagrees", () => {
		// #given — the upload is the 4:08 radio edit, the candidate the 6:07 album cut
		const query = {
			artist: "Daft Punk",
			title: "Get Lucky ft. Pharrell Williams, Nile Rodgers",
			durationSeconds: 248,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "Daft Punk",
				title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
				durationSeconds: 367,
			}),
		]);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "unverified" });
	});
});

describe("judgeCandidates() distrusts an ISRC an uploader typed", () => {
	const STAMPED = candidate({
		artist: "Billie Eilish",
		title: "bad guy",
		album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
		isrc: "USUM71900764",
	});

	it("refuses an ISRC stamped onto an unrelated upload", () => {
		// #given — an uploader put a famous release's ISRC on their own track
		const query = {
			artist: "Some Bedroom Producer",
			title: "Untitled Jam 4",
			isrc: "USUM71900764",
		};

		// #when
		const verdict = judgeCandidates(query, [STAMPED]);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("still accepts it when the upload's own artist lines up", () => {
		// #when — a distributor upload, where the ISRC and the credit came together
		const verdict = judgeCandidates(
			{
				artist: "Billie Eilish",
				title: "bad guy (Sped Up)",
				isrc: "USUM71900764",
			},
			[STAMPED],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "isrc" });
	});
});

describe("judgeCandidates() survives hostile input", () => {
	it("does not stall on an artist made of whitespace", () => {
		// #given — yt-dlp's `artist` can come from a description an uploader wrote
		const query = { artist: `${" ".repeat(50_000)}x`, title: "bad guy" };
		const candidates = Array.from({ length: 20 }, () =>
			candidate({ artist: "Billie Eilish", title: "bad guy" }),
		);

		// #when
		const startedAt = performance.now();
		judgeCandidates(query, candidates);

		// #then
		expect(performance.now() - startedAt).toBeLessThan(250);
	});
});

describe("judgeCandidates() accepts what it can prove", () => {
	it("accepts a candidate carrying the upload's own ISRC", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Billie Eilish", title: "bad guy", isrc: "USUM71900764" },
			[
				candidate({
					artist: "Billie Eilish",
					title: "bad guy",
					album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
					releaseDate: "2019-03-29",
					durationSeconds: 194,
					isrc: "USUM71900764",
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			via: "isrc",
			metadata: {
				artist: "Billie Eilish",
				title: "bad guy",
				album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
				year: 2019,
				isrc: "USUM71900764",
			},
		});
	});

	it("accepts a duration match within five seconds", () => {
		// #when
		const verdict = judgeCandidates(
			{
				artist: "Avicii",
				title: "Levels (Skrillex Remix)",
				durationSeconds: 279,
			},
			[
				candidate({
					artist: "Avicii",
					title: "Levels (Skrillex Remix)",
					album: "Levels (Remixes)",
					durationSeconds: 281,
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "duration" });
	});

	it("accepts when both catalogs agree, with no duration at all", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Tame Impala", title: "Dracula" },
			[DRACULA_ORIGINAL_ITUNES, DRACULA_ORIGINAL_DEEZER],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});

	it("keeps a music video's longer runtime from blocking an agreed match", () => {
		// #given — the video runs 6:07, the track 4:55
		const query = { artist: "Adele", title: "Hello", durationSeconds: 367 };

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Adele",
				title: "Hello",
				durationSeconds: 295,
			}),
			candidate({ artist: "Adele", title: "Hello", durationSeconds: 295 }),
		]);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});
});

describe("judgeCandidates() picks between accepted candidates", () => {
	const query = {
		artist: "Avicii",
		title: "Levels (Skrillex Remix)",
		durationSeconds: 281,
	};

	it("leaves the album empty rather than name a compilation", () => {
		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Avicii",
				title: "Levels (Skrillex Remix)",
				album: "Body By Jake: Boot Camp Workout (BPM 126-140)",
				isCompilation: true,
				durationSeconds: 281,
				genre: "Pop",
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: undefined, genre: "Pop" },
		});
	});

	it("prefers a release over a compilation carrying the same recording", () => {
		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Avicii",
				title: "Levels (Skrillex Remix)",
				album: "Body By Jake: Boot Camp Workout (BPM 126-140)",
				isCompilation: true,
				durationSeconds: 281,
			}),
			candidate({
				source: "itunes",
				artist: "Avicii",
				title: "Levels (Skrillex Remix)",
				album: "Levels (Remixes) - Single",
				durationSeconds: 281,
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Levels (Remixes) - Single" },
		});
	});

	it("prefers Deezer, which carries the ISRC and keeps feat. credits in the title", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Daft Punk", title: "Get Lucky", durationSeconds: 367 },
			[
				candidate({
					source: "itunes",
					artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
					title: "Get Lucky",
					durationSeconds: 370,
				}),
				candidate({
					artist: "Daft Punk",
					title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
					durationSeconds: 367,
					isrc: "USQX91300108",
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				artist: "Daft Punk",
				title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
			},
		});
	});

	it("drops a store's country disambiguator from the artist name", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Klaps", title: "Se Cura", durationSeconds: 286 },
			[
				candidate({
					artist: "Klaps (BE)",
					title: "Se Cura",
					album: "Deadline Records Va 05",
					durationSeconds: 286,
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { artist: "Klaps" },
		});
	});
});
