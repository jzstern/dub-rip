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
		// #given — the upload names the radio edit; the candidate is the 6:07 album cut
		const query = {
			artist: "Daft Punk",
			title: "Get Lucky (Radio Edit) ft. Pharrell Williams, Nile Rodgers",
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

	it("accepts a length variant the duration confirms", () => {
		// #when — the same radio edit, against the catalog's own radio-edit row
		const verdict = judgeCandidates(
			{
				artist: "Daft Punk",
				title: "Get Lucky (Radio Edit) ft. Pharrell Williams, Nile Rodgers",
				durationSeconds: 248,
			},
			[
				candidate({
					artist: "Daft Punk",
					title:
						"Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)",
					durationSeconds: 248,
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "duration" });
	});

	it("refuses a bare edit, which names someone else's cut", () => {
		// #given — an unnamed DJ edit whose runtime happens to land near the original
		const query = {
			artist: "Fred again..",
			title: "Marea (Edit)",
			durationSeconds: 302,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "Fred again..",
				title: "Marea",
				album: "Actual Life",
				durationSeconds: 300,
				isrc: "GB5KW2100001",
			}),
		]);

		// #then
		expect(verdict).toEqual({
			status: "unmatched",
			reason: "version-mismatch",
		});
	});

	it("refuses a single version whose duration does not confirm it", () => {
		// #when
		const verdict = judgeCandidates(
			{
				artist: "Daft Punk",
				title: "Get Lucky (Single Version)",
				durationSeconds: 248,
			},
			[
				candidate({
					artist: "Daft Punk",
					title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
					durationSeconds: 367,
				}),
			],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
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

	it("refuses an ISRC copied onto a sped-up edit of the same song", () => {
		// #given — the version differs, so it is a different recording whatever the tag says
		const query = {
			artist: "Billie Eilish",
			title: "bad guy (Sped Up)",
			isrc: "USUM71900764",
		};

		// #when
		const verdict = judgeCandidates(query, [STAMPED]);

		// #then
		expect(verdict).toEqual({
			status: "unmatched",
			reason: "version-mismatch",
		});
	});

	it("refuses an ISRC whose candidate runs minutes longer than the upload", () => {
		// #given — a bootleg tagged with the source track's ISRC, 136s shorter
		const query = {
			artist: "Klaps",
			title: "Se Cura",
			isrc: "DEH742513913",
			durationSeconds: 150,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "Klaps (BE)",
				title: "Se Cura",
				album: "Deadline Records Va 05",
				durationSeconds: 286,
				isrc: "DEH742513913",
			}),
		]);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "unverified" });
	});

	it("accepts a distributor upload whose title and ISRC both line up", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Billie Eilish", title: "bad guy", isrc: "USUM71900764" },
			[STAMPED],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "isrc" });
	});

	it("compares an ISRC as an identifier, ignoring case and dashes", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Billie Eilish", title: "bad guy", isrc: "us-um7-19-00764" },
			[STAMPED],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "isrc" });
	});
});

describe("judgeCandidates() ranks the same recording stably", () => {
	const TOTO_ALBUM_CUT = candidate({
		artist: "Toto",
		title: "Africa",
		album: "Toto IV",
		durationSeconds: 296,
		rank: 0,
		isrc: "USSM19801941",
	});
	const TOTO_KNOCK_OFF = candidate({
		artist: "Toto",
		title: "Africa",
		album: "Classic Rock Instrumentals",
		albumArtist: "Instrumental Hits Orchestra",
		durationSeconds: 307,
		rank: 4,
	});
	const TOTO_ITUNES = candidate({
		source: "itunes",
		artist: "Toto",
		title: "Africa",
		album: "Toto IV",
		durationSeconds: 296,
		rank: 0,
	});

	it("names the song both catalogs reached but no release its runtime does not prove", () => {
		// #given — the upload runs 307s, which only the knock-off's runtime matches
		const query = { artist: "Toto", title: "Africa", durationSeconds: 307 };

		// #when
		const verdict = judgeCandidates(query, [
			TOTO_ITUNES,
			TOTO_ALBUM_CUT,
			TOTO_KNOCK_OFF,
		]);

		// #then
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Toto",
			title: "Africa",
			source: "deezer",
		});
	});

	it("chooses the same release with and without a duration", () => {
		// #given — the preview has no duration; /details later supplies one
		const candidates = [TOTO_ITUNES, TOTO_ALBUM_CUT, TOTO_KNOCK_OFF];
		const preview = judgeCandidates(
			{ artist: "Toto", title: "Africa" },
			candidates,
		);

		// #when
		const download = judgeCandidates(
			{ artist: "Toto", title: "Africa", durationSeconds: 307 },
			candidates,
		);

		// #then — ranking is structural, so the two stages cannot disagree
		expect(preview.status === "matched" && preview.candidate.album).toBe(
			download.status === "matched" && download.candidate.album,
		);
	});

	it("prefers the catalog's own top result over a back-dated reissue", () => {
		// #given — iTunes back-dates the greatest-hits reissue to Jan 1
		const query = {
			artist: "Rick Astley",
			title: "Never Gonna Give You Up",
			durationSeconds: 214,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Rick Astley",
				title: "Never Gonna Give You Up",
				album: "Whenever You Need Somebody",
				releaseDate: "1987-07-27",
				durationSeconds: 214,
				rank: 0,
			}),
			candidate({
				source: "itunes",
				artist: "Rick Astley",
				title: "Never Gonna Give You Up",
				album: "The Best Of Me: Never Edition",
				releaseDate: "1987-01-01",
				durationSeconds: 214,
				rank: 2,
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Whenever You Need Somebody" },
		});
	});

	it("takes the earlier release when both dates are precise", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Adele", title: "Hello", durationSeconds: 295 },
			[
				candidate({
					artist: "Adele",
					title: "Hello",
					album: "25 (Reissue)",
					releaseDate: "2020-03-14",
					durationSeconds: 295,
					rank: 0,
				}),
				candidate({
					artist: "Adele",
					title: "Hello",
					album: "25",
					releaseDate: "2015-11-20",
					durationSeconds: 295,
					rank: 0,
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({ metadata: { album: "25" } });
	});
});

describe("judgeCandidates() treats a longer catalog cut as a different recording", () => {
	it("refuses a candidate that outruns the upload, even with both catalogs agreeing", () => {
		// #given — a 7:41 extended cut against a 3:26 upload, titled identically
		const query = {
			artist: "New Order",
			title: "Blue Monday",
			durationSeconds: 206,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "New Order",
				title: "Blue Monday",
				durationSeconds: 461,
			}),
			candidate({
				artist: "New Order",
				title: "Blue Monday",
				durationSeconds: 461,
			}),
		]);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("does not let an outrunning cut corroborate a candidate with no runtime", () => {
		// #given — the only other row is a 7:41 extended mix, which may not vouch
		const query = {
			artist: "New Order",
			title: "Blue Monday",
			durationSeconds: 206,
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "New Order",
				title: "Blue Monday",
				durationSeconds: 461,
			}),
			candidate({ artist: "New Order", title: "Blue Monday" }),
		]);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("still accepts a shorter catalog cut, because an upload may carry an intro", () => {
		// #given — a music video runs 6:07 against the 4:55 track
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

describe("judgeCandidates() fills gaps only from the same recording", () => {
	it("writes no release fields for a music video only agreement matches", () => {
		// #given — both catalogs carry the song; neither runtime is the upload's
		const query = { artist: "Toto", title: "Africa", durationSeconds: 330 };

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "Toto",
				title: "Africa",
				album: "Toto IV",
				durationSeconds: 295,
			}),
			candidate({
				source: "itunes",
				artist: "Toto",
				title: "Africa",
				album: "Toto IV",
				durationSeconds: 295,
				releaseDate: "1982-04-08",
				genre: "Rock",
			}),
		]);

		// #then — the song is proven, which of its releases is not
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Toto",
			title: "Africa",
			source: "deezer",
		});
	});

	it("takes the release fields from the row whose runtime proves it", () => {
		// #given — the audio upload runs as long as the album cut
		const query = { artist: "Toto", title: "Africa", durationSeconds: 296 };

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				artist: "Toto",
				title: "Africa",
				album: "Toto IV",
				durationSeconds: 295,
			}),
			candidate({
				source: "itunes",
				artist: "Toto",
				title: "Africa",
				album: "Toto IV",
				durationSeconds: 295,
				releaseDate: "1982-04-08",
				genre: "Rock",
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Toto IV", year: 1982, genre: "Rock" },
		});
	});

	it("takes nothing from a candidate whose artist disagrees, ISRC or not", () => {
		// #given — an ISRC-reached row by someone else entirely
		const query = {
			artist: "Some Bedroom Producer",
			title: "Night Drive",
			durationSeconds: 200,
			isrc: "USUM71900764",
		};

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Some Bedroom Producer",
				title: "Night Drive",
				durationSeconds: 200,
			}),
			candidate({
				artist: "Totally Different Artist",
				title: "Night Drive",
				album: "Someone Else's Album",
				genre: "Pop",
				releaseDate: "2019-03-29",
				isrc: "USUM71900764",
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: undefined, genre: undefined, year: undefined },
		});
	});

	it("writes the ISRC in its canonical form, not as the uploader typed it", () => {
		// #when
		const verdict = judgeCandidates(
			{
				artist: "Some Bedroom Producer",
				title: "Night Drive",
				durationSeconds: 200,
				isrc: "us-um7-19-00764",
			},
			[
				candidate({
					source: "itunes",
					artist: "Some Bedroom Producer",
					title: "Night Drive",
					durationSeconds: 200,
				}),
			],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { isrc: "USUM71900764" },
		});
	});

	it("does not take an ISRC from a candidate the duration rules out", () => {
		// #given — a live cut of the same song, four times too long to be this upload
		const query = { artist: "Adele", title: "Hello", durationSeconds: 295 };

		// #when
		const verdict = judgeCandidates(query, [
			candidate({
				source: "itunes",
				artist: "Adele",
				title: "Hello",
				album: "25",
				durationSeconds: 295,
				releaseDate: "2015-11-20",
			}),
			candidate({
				artist: "Adele",
				title: "Hello",
				album: "Live at the Royal Albert Hall",
				durationSeconds: 372,
				isrc: "GBBKS1100123",
			}),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "25", isrc: undefined },
		});
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

	it("writes only the recording's identity from a compilation", () => {
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

		// #then — a workout compilation's genre, date and sleeve are its own
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Avicii",
			title: "Levels (Skrillex Remix)",
			source: "itunes",
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

		// #then — the CHOSEN candidate, not the merged output, which a fill could mask
		expect(verdict.status === "matched" && verdict.candidate.album).toBe(
			"Levels (Remixes) - Single",
		);
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

describe("judgeCandidates() needs the catalogs to agree on a recording, not a title", () => {
	/**
	 * Seen on a PR-env download of the official upload (3:53): Deezer's top row
	 * was a 3:32 instrumental knock-off credited to Flume, iTunes had the single.
	 */
	const FLUME_KNOCK_OFF = candidate({
		artist: "Flume",
		title: "Never Be Like You",
		album: "Unst",
		durationSeconds: 212,
		isrc: "QZANL1714525",
		rank: 0,
	});
	const FLUME_SINGLE_ITUNES = candidate({
		source: "itunes",
		artist: "Flume",
		title: "Never Be Like You (feat. Kai)",
		album: "Skin",
		durationSeconds: 235,
		rank: 0,
	});
	const FLUME_SINGLE_DEEZER = candidate({
		artist: "Flume",
		title: "Never Be Like You (feat. Kai)",
		album: "Skin",
		durationSeconds: 234,
		rank: 1,
	});
	const query = { artist: "Flume", title: "Never Be Like You feat. Kai" };

	it("picks the release the upload's runtime confirms over a knock-off Deezer ranks first", () => {
		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 233 }, [
			FLUME_KNOCK_OFF,
			FLUME_SINGLE_ITUNES,
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Skin" },
		});
	});

	it("takes no ISRC from a same-titled release of another length", () => {
		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 233 }, [
			FLUME_KNOCK_OFF,
			FLUME_SINGLE_ITUNES,
		]);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.isrc).toBe(
			undefined,
		);
	});

	it("does not count one title at two lengths as both catalogs agreeing", () => {
		// #given — a preview, with no runtime of the upload's own to settle it

		// #when
		const verdict = judgeCandidates(query, [
			FLUME_KNOCK_OFF,
			FLUME_SINGLE_ITUNES,
		]);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("still agrees when the two catalogs' runtimes are within five seconds", () => {
		// #when
		const verdict = judgeCandidates(query, [
			FLUME_KNOCK_OFF,
			FLUME_SINGLE_DEEZER,
			FLUME_SINGLE_ITUNES,
		]);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});
});

describe("judgeCandidates() keeps the featured artists the upload names", () => {
	const LATCH = {
		artist: "Disclosure",
		title: "Latch",
		album: "Settle (Special Edition)",
		durationSeconds: 256,
	};
	const query = { artist: "Disclosure", title: "Latch ft. Sam Smith" };

	it("adds back a feature the catalog files outside the title", () => {
		// #when
		const verdict = judgeCandidates(query, [
			candidate(LATCH),
			candidate({ ...LATCH, source: "itunes" }),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { title: "Latch (feat. Sam Smith)" },
		});
	});

	it("does not double a feature the catalog's title already carries", () => {
		// #given
		const credited = { ...LATCH, title: "Latch (feat. Sam Smith)" };

		// #when
		const verdict = judgeCandidates(query, [
			candidate(credited),
			candidate({ ...credited, source: "itunes" }),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { title: "Latch (feat. Sam Smith)" },
		});
	});

	it("does not add a feature the catalog credits as an artist", () => {
		// #given
		const coCredited = { ...LATCH, artist: "Disclosure & Sam Smith" };

		// #when
		const verdict = judgeCandidates(query, [
			candidate(coCredited),
			candidate({ ...coCredited, source: "itunes" }),
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { title: "Latch" },
		});
	});
});

describe("judgeCandidates() writes only the artist's own releases", () => {
	const SINGLE = candidate({
		source: "itunes",
		artist: "Flume",
		title: "Never Be Like You (feat. Kai)",
		album: "Never Be Like You (feat. Kai) - Single",
		durationSeconds: 235,
	});
	const query = {
		artist: "Flume",
		title: "Never Be Like You feat. Kai",
		durationSeconds: 233,
	};

	it("refuses a row credited to the artist on somebody else's album", () => {
		// #given — the same runtime, credited to Flume, on The Amalgamates' album
		const knockOff = candidate({
			artist: "Flume",
			title: "Never Be Like You",
			album: "The Lockbox",
			albumArtist: "The Amalgamates",
			durationSeconds: 235,
			isrc: "QZ9Y21704533",
		});

		// #when
		const verdict = judgeCandidates(query, [knockOff, SINGLE]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Never Be Like You (feat. Kai) - Single" },
		});
	});

	it("accepts a feature on the other credited artist's album", () => {
		// #given — Sam Smith's album, crediting Disclosure & Sam Smith
		const feature = candidate({
			artist: "Disclosure & Sam Smith",
			title: "Latch",
			album: "In the Lonely Hour",
			albumArtist: "Sam Smith",
			durationSeconds: 256,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Disclosure",
				title: "Latch ft. Sam Smith",
				durationSeconds: 256,
			},
			[feature],
		);

		// #then
		expect(verdict.status).toBe("matched");
	});

	it("accepts a compilation's row, whose album it never writes", () => {
		// #given
		const compilation = candidate({
			artist: "Flume",
			title: "Never Be Like You (feat. Kai)",
			album: "Summer Hits 2016",
			albumArtist: "Various Artists",
			isCompilation: true,
			durationSeconds: 234,
		});

		// #when
		const verdict = judgeCandidates(query, [compilation]);

		// #then
		expect(
			verdict.status === "matched" ? verdict.metadata.album : "unmatched",
		).toBeUndefined();
	});
});

describe("judgeCandidates() needs the upload's lead to lead the recording", () => {
	it("refuses a cover that only features the upload's artist", () => {
		// #given — recorded: the Archer series' "Danger Zone", sung by Cherlene
		const cherlene = candidate({
			source: "itunes",
			artist: "Cherlene",
			title: "Danger Zone (feat. Kenny Loggins)",
			album: "Archer: Cherlene (Songs from the TV Series)",
			durationSeconds: 221,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Kenny Loggins", title: "Danger Zone", durationSeconds: 217 },
			[cherlene],
		);

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "artist-mismatch" });
	});

	it("leaves a two-name credit alone when no other copy disputes it", () => {
		// #given — only iTunes carries the track, crediting both singers; with no
		// second copy to disagree, the catalogs have not contradicted themselves
		const duet = candidate({
			source: "itunes",
			artist: "Frank Sinatra & Tony Bennett",
			title: "New York, New York",
			album: "Duets (20th Anniversary Deluxe Edition)",
			durationSeconds: 210,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Frank Sinatra",
				title: "New York, New York",
				durationSeconds: 207,
			},
			[duet],
		);

		// #then
		expect(verdict.status).toBe("matched");
	});

	it("refuses the other catalog's copy of that duet, credited to one singer", () => {
		// #given — Deezer lists the same Duets track under Sinatra alone
		const deezerCopy = candidate({
			artist: "Frank Sinatra",
			title: "New York, New York",
			album: "Duets (20th Anniversary Deluxe Edition)",
			durationSeconds: 210,
			isrc: "USCA29300070",
		});
		const itunesCopy = candidate({
			source: "itunes",
			artist: "Frank Sinatra & Tony Bennett",
			title: "New York, New York",
			album: "Duets (20th Anniversary Deluxe Edition)",
			durationSeconds: 210,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Frank Sinatra",
				title: "New York, New York",
				durationSeconds: 207,
			},
			[deezerCopy, itunesCopy],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("still accepts a duet when the upload names both singers", () => {
		// #given
		const duet = candidate({
			source: "itunes",
			artist: "Frank Sinatra & Tony Bennett",
			title: "New York, New York",
			album: "Duets (20th Anniversary Deluxe Edition)",
			durationSeconds: 210,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Frank Sinatra & Tony Bennett",
				title: "New York, New York",
				durationSeconds: 207,
			},
			[duet],
		);

		// #then
		expect(verdict.status).toBe("matched");
	});
});

describe("judgeCandidates() writes no release fields from a compilation", () => {
	/** Recorded: two workout compilations carry a 226 s "Hot Stuff" of their own. */
	const WORKOUT_DEEZER = candidate({
		artist: "Donna Summer",
		title: "Hot Stuff",
		album: "Body By Jake: Sweating Disco Dance Party (BPM 108-128)",
		isCompilation: true,
		durationSeconds: 226,
		isrc: "USUM70852166",
		label: "Body By Jake",
		releaseDate: "2012-10-09",
		artworkUrl:
			"https://cdn-images.dzcdn.net/images/cover/workout/1000x1000-000000-80-0-0.jpg",
	});
	const WORKOUT_ITUNES = candidate({
		source: "itunes",
		artist: "Donna Summer",
		title: "Hot Stuff",
		album: "Don't Quit Music: Sweating Disco Dance Party",
		isCompilation: true,
		durationSeconds: 226,
	});
	const BAD_GIRLS = candidate({
		source: "itunes",
		artist: "Donna Summer",
		title: "Hot Stuff",
		album: "Bad Girls",
		durationSeconds: 315,
		releaseDate: "1979-04-25",
	});

	it("prefers the album release the runtime confirms over two agreeing compilations", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Donna Summer", title: "Hot Stuff", durationSeconds: 314 },
			[WORKOUT_DEEZER, WORKOUT_ITUNES, BAD_GIRLS],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Bad Girls" },
		});
	});

	it("writes neither the compilation's ISRC, label, date nor sleeve when it wins", () => {
		// #given — the single-length upload, which only the compilations match
		const query = {
			artist: "Donna Summer",
			title: "Hot Stuff",
			durationSeconds: 228,
		};

		// #when
		const verdict = judgeCandidates(query, [WORKOUT_DEEZER, WORKOUT_ITUNES]);

		// #then
		expect(verdict.status === "matched" && verdict.metadata).toEqual({
			artist: "Donna Summer",
			title: "Hot Stuff",
			source: "deezer",
		});
	});

	it("keeps the upload's own ISRC when a compilation carries it", () => {
		// #given — a SoundCloud upload whose ISRC Deezer answers with a label's best-of
		const bestOf = candidate({
			artist: "Pegboard Nerds",
			title: "Hero (feat. Elizaveta)",
			album: "Monstercat - Best of 2014",
			isCompilation: true,
			durationSeconds: 283,
			isrc: "CA6D21001011",
			releaseDate: "2015-01-26",
		});
		const single = candidate({
			source: "itunes",
			artist: "Pegboard Nerds",
			title: "Hero (feat. Elizaveta)",
			album: "Hero (feat. Elizaveta) - Single",
			durationSeconds: 283,
			releaseDate: "2014-03-17",
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Pegboard Nerds",
				title: "Hero (feat. Elizaveta)",
				isrc: "CA6D21001011",
				durationSeconds: 283,
			},
			[bestOf, single],
		);

		// #then — the album comes from the single, not the best-of
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				isrc: "CA6D21001011",
				album: "Hero (feat. Elizaveta) - Single",
			},
		});
	});

	it("takes nothing from a compilation that supports the chosen release", () => {
		// #given — the release has no ISRC; only the compilation's copy carries one
		const release = candidate({
			source: "itunes",
			artist: "Donna Summer",
			title: "Hot Stuff",
			album: "Hot Stuff - Single",
			durationSeconds: 226,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Donna Summer", title: "Hot Stuff", durationSeconds: 228 },
			[WORKOUT_DEEZER, release],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.isrc).toBe(
			undefined,
		);
	});
});

describe("judgeCandidates() accepts an official remix on the remixer's own release", () => {
	it("counts the remixer named in the version as the album's artist", () => {
		// #given — recorded: the Robin Schulz edit sits on Robin Schulz's "Prayer"
		const edit = candidate({
			artist: "Clean Bandit",
			title: "Rather Be (feat. Jess Glynne) (Robin Schulz Edit)",
			album: "Prayer",
			albumArtist: "Robin Schulz",
			durationSeconds: 192,
			isrc: "GBAHS1400266",
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Clean Bandit",
				title: "Rather Be ft. Jess Glynne (Robin Schulz Edit)",
				durationSeconds: 192,
			},
			[edit],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Prayer" },
		});
	});

	it("still refuses someone else's album the version does not name", () => {
		// #given
		const knockOff = candidate({
			artist: "Clean Bandit",
			title: "Rather Be (feat. Jess Glynne) (Robin Schulz Edit)",
			album: "Summer Covers",
			albumArtist: "Hannah Adams",
			durationSeconds: 192,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Clean Bandit",
				title: "Rather Be ft. Jess Glynne (Robin Schulz Edit)",
				durationSeconds: 192,
			},
			[knockOff],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});
});

describe("judgeCandidates() never garbles a title while keeping a feature", () => {
	function titleFor(uploadTitle: string, catalogTitle: string): string | false {
		const row = { artist: "Artist", title: catalogTitle, durationSeconds: 200 };
		const verdict = judgeCandidates(
			{ artist: "Artist", title: uploadTitle, durationSeconds: 200 },
			[candidate(row), candidate({ ...row, source: "itunes" })],
		);
		return verdict.status === "matched" && verdict.metadata.title;
	}

	it.each([
		[
			"Work from Home ft. Ty Dolla Sign",
			"Work from Home (feat. Ty Dolla $ign)",
			"Work from Home (feat. Ty Dolla $ign)",
		],
		[
			"Get Lucky ft. Pharrell",
			"Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
			"Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
		],
		["Latch ft. Sam Smith HD", "Latch", "Latch"],
		["Uptown Funk ft. Bruno Mars - YouTube", "Uptown Funk", "Uptown Funk"],
		[
			"After The Storm ft. Tyler, The Creator, Bootsy Collins",
			"After The Storm",
			"After The Storm (feat. Tyler, The Creator & Bootsy Collins)",
		],
		["Latch ft. Sam Smith", "Latch", "Latch (feat. Sam Smith)"],
		[
			"One Dance ft. Wizkid & Kyla",
			"One Dance",
			"One Dance (feat. Wizkid & Kyla)",
		],
		[
			"EARFQUAKE ft. Tyler, The Creator",
			"EARFQUAKE",
			"EARFQUAKE (feat. Tyler, The Creator)",
		],
	])("%s against the catalog's %s", (uploadTitle, catalogTitle, written) => {
		// #when
		const title = titleFor(uploadTitle, catalogTitle);

		// #then
		expect(title).toBe(written);
	});

	it("keeps the upload's guest once when the catalog shortens it to a lead", () => {
		// #given — the catalog credits "Pharrell" as a lead; the upload spells it out as a guest
		const row = {
			artist: "Artist & Pharrell",
			title: "Song",
			durationSeconds: 200,
		};

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Artist",
				title: "Song ft. Pharrell Williams",
				durationSeconds: 200,
			},
			[candidate(row), candidate({ ...row, source: "itunes" })],
		);

		// #then — the upload's artist is kept, so its guest stays in the title
		expect(
			verdict.status === "matched" && [
				verdict.metadata.artist,
				verdict.metadata.title,
			],
		).toEqual(["Artist", "Song (feat. Pharrell Williams)"]);
	});
});

describe("judgeCandidates() draws the agreement line at five seconds", () => {
	const deezer = candidate({
		artist: "Artist",
		title: "Song",
		album: "Real",
		durationSeconds: 200,
	});

	it("counts two catalogs five seconds apart as one recording", () => {
		// #when
		const verdict = judgeCandidates({ artist: "Artist", title: "Song" }, [
			deezer,
			candidate({
				source: "itunes",
				artist: "Artist",
				title: "Song",
				durationSeconds: 205,
			}),
		]);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});

	it("does not count two catalogs six seconds apart as one recording", () => {
		// #when
		const verdict = judgeCandidates({ artist: "Artist", title: "Song" }, [
			deezer,
			candidate({
				source: "itunes",
				artist: "Artist",
				title: "Song",
				durationSeconds: 206,
			}),
		]);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("takes nothing from a same-titled row six seconds from the chosen one", () => {
		// #given — the upload's runtime confirms the Deezer row alone
		const other = candidate({
			source: "itunes",
			artist: "Artist",
			title: "Song",
			durationSeconds: 206,
			releaseDate: "1999-05-01",
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Artist", title: "Song", durationSeconds: 200 },
			[deezer, other],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(
			undefined,
		);
	});
});

describe("judgeCandidates() dates a recording by its earliest release", () => {
	const RELEASE = candidate({
		artist: "Stealers Wheel",
		title: "Stuck In The Middle With You",
		album: "Stealers Wheel",
		durationSeconds: 208,
	});

	it("takes the earliest precise year among the releases the runtime proves", () => {
		// #given — the original and a remaster of the same master
		const original = candidate({
			source: "itunes",
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "Stealers Wheel",
			durationSeconds: 208,
			releaseDate: "1972-11-01",
		});
		const reissue = candidate({
			source: "itunes",
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "The Very Best Of",
			durationSeconds: 208,
			releaseDate: "2008-05-12",
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Stealers Wheel",
				title: "Stuck In The Middle With You",
				durationSeconds: 209,
			},
			[RELEASE, reissue, original],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(1972);
	});

	it("does not take a placeholder Jan 1 date for the recording's year", () => {
		// #given — recorded: an "80s hits" set iTunes dates 1980-01-01
		const eighties = candidate({
			source: "itunes",
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "Anos 80 - Nostalgia Internacionais",
			isCompilation: true,
			durationSeconds: 208,
			releaseDate: "1970-01-01",
		});
		const original = candidate({
			source: "itunes",
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "Stealers Wheel",
			durationSeconds: 208,
			releaseDate: "1972-11-01",
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Stealers Wheel",
				title: "Stuck In The Middle With You",
				durationSeconds: 209,
			},
			[RELEASE, eighties, original],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(1972);
	});

	it("never dates the recording by a compilation's copy", () => {
		// #given — a best-of dated earlier than any release it collects
		const bestOf = candidate({
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "Seventies Gold",
			isCompilation: true,
			durationSeconds: 208,
			releaseDate: "1970-03-01",
		});
		const album = candidate({
			source: "itunes",
			artist: "Stealers Wheel",
			title: "Stuck In The Middle With You",
			album: "Stealers Wheel",
			durationSeconds: 208,
			releaseDate: "1972-11-01",
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Stealers Wheel",
				title: "Stuck In The Middle With You",
				durationSeconds: 209,
			},
			[RELEASE, bestOf, album],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(1972);
	});
});

describe("judgeCandidates() refuses only a performer the catalogs dispute", () => {
	it("accepts a guest iTunes lists as a lead when Deezer's copy features them", () => {
		// #given — recorded: iTunes credits all three; Deezer features two of them
		const itunes = candidate({
			source: "itunes",
			artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
			title: "Get Lucky",
			album: "Random Access Memories",
			durationSeconds: 370,
		});
		const deezer = candidate({
			artist: "Daft Punk",
			title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
			album: "Random Access Memories",
			durationSeconds: 367,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Daft Punk", title: "Get Lucky ft. Pharrell" },
			[itunes, deezer],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});

	it("counts a remixer the upload's version names", () => {
		// #given — iTunes credits the remixer as a lead; Deezer's copy does not
		const itunes = candidate({
			source: "itunes",
			artist: "Kygo & Marvin Gaye",
			title: "Sexual Healing (Kygo Remix)",
			album: "Sexual Healing (Kygo Remix)",
			durationSeconds: 368,
		});
		const deezer = candidate({
			artist: "Marvin Gaye",
			title: "Sexual Healing (Kygo Remix)",
			album: "Sexual Healing (Kygo Remix)",
			durationSeconds: 368,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Marvin Gaye", title: "Sexual Healing (Kygo Remix)" },
			[itunes, deezer],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});

	it("does not take a backing band for a second performer", () => {
		// #given
		const itunes = candidate({
			source: "itunes",
			artist: "Prince & The Revolution",
			title: "Purple Rain",
			album: "Purple Rain",
			durationSeconds: 521,
		});
		const deezer = candidate({
			artist: "Prince",
			title: "Purple Rain",
			album: "Purple Rain",
			durationSeconds: 520,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Prince", title: "Purple Rain" },
			[itunes, deezer],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "agreement" });
	});
});
describe("judgeCandidates() writes a release only when the release is proven", () => {
	/** Recorded: Bonnie Tyler's 2005 re-recording sits in both catalogs at 3:50. */
	const REMAKE_DEEZER = candidate({
		artist: "Bonnie Tyler",
		title: "Total Eclipse of the Heart",
		album: "Bonnie",
		durationSeconds: 230,
		isrc: "FR54E0500110",
		label: "Ba-Ba Music",
		releaseDate: "2005-04-14",
	});
	const REMAKE_ITUNES = candidate({
		source: "itunes",
		artist: "Bonnie Tyler",
		title: "Total Eclipse of the Heart",
		album: "Bonnie",
		durationSeconds: 231,
		releaseDate: "2005-04-14",
	});
	const ORIGINAL_ITUNES = candidate({
		source: "itunes",
		artist: "Bonnie Tyler",
		title: "Total Eclipse of the Heart",
		album: "Faster Than the Speed of Night",
		durationSeconds: 330,
		releaseDate: "1983-04-01",
	});
	const query = {
		artist: "Bonnie Tyler",
		title: "Total Eclipse of the Heart",
	};

	it("takes the release from the row the runtime proves, not from a re-recording both catalogs carry", () => {
		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 330 }, [
			REMAKE_DEEZER,
			REMAKE_ITUNES,
			ORIGINAL_ITUNES,
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Faster Than the Speed of Night" },
		});
	});

	it("takes no ISRC or label from a re-recording the runtime rules out", () => {
		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 330 }, [
			REMAKE_DEEZER,
			REMAKE_ITUNES,
			ORIGINAL_ITUNES,
		]);

		// #then
		expect(
			verdict.status === "matched" && [
				verdict.metadata.isrc,
				verdict.metadata.label,
			],
		).toEqual([undefined, undefined]);
	});

	it("writes no year for a release only one catalog lists", () => {
		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 330 }, [
			REMAKE_DEEZER,
			REMAKE_ITUNES,
			ORIGINAL_ITUNES,
		]);

		// #then — the catalogs date releases; one catalog alone cannot vouch for it
		expect(verdict.status === "matched" && verdict.metadata.year).toBe(
			undefined,
		);
	});

	it("takes a release both catalogs list from Deezer, dated by the earlier copy", () => {
		// #given — Deezer dates the album by its digital reissue
		const deezerAlbum = candidate({
			artist: "Bonnie Tyler",
			title: "Total Eclipse of the Heart",
			album: "Faster Than the Speed of Night",
			durationSeconds: 331,
			isrc: "GBBBN8302012",
			label: "Columbia",
			releaseDate: "2009-06-01",
		});

		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 330 }, [
			deezerAlbum,
			ORIGINAL_ITUNES,
		]);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: {
				album: "Faster Than the Speed of Night",
				isrc: "GBBBN8302012",
				label: "Columbia",
				year: 1983,
			},
		});
	});

	it("writes no release when each catalog proves a different one", () => {
		// #given — a budget reissue on Deezer, the label's album on iTunes
		const budget = candidate({
			artist: "Bonnie Tyler",
			title: "Total Eclipse of the Heart",
			album: "Greatest Hits Collection",
			durationSeconds: 330,
			label: "Budget Classics",
		});

		// #when
		const verdict = judgeCandidates({ ...query, durationSeconds: 330 }, [
			budget,
			ORIGINAL_ITUNES,
		]);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.album).toBe(
			undefined,
		);
	});

	it("counts a store's ' - Single' album as the same release as the plain name", () => {
		// #given
		const itunesSingle = candidate({
			source: "itunes",
			artist: "Avicii",
			title: "Levels",
			album: "Levels - Single",
			durationSeconds: 200,
			releaseDate: "2011-10-28",
		});
		const deezerSingle = candidate({
			artist: "Avicii",
			title: "Levels",
			album: "Levels",
			durationSeconds: 199,
			label: "Universal Music",
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Avicii", title: "Levels", durationSeconds: 200 },
			[itunesSingle, deezerSingle],
		);

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Levels", label: "Universal Music", year: 2011 },
		});
	});
});

describe("judgeCandidates() credits exactly who the upload credits", () => {
	it("refuses the solo record of one singer for a duet upload", () => {
		// #given — Exodus is credited to Bob Marley & The Wailers alone
		const exodus = candidate({
			artist: "Bob Marley & The Wailers",
			title: "Turn Your Lights Down Low",
			album: "Exodus",
			durationSeconds: 220,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Lauryn Hill & Bob Marley",
				title: "Turn Your Lights Down Low",
				durationSeconds: 346,
			},
			[exodus, { ...exodus, source: "itunes" }],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("puts the guest back in the title when the upload's artist is kept", () => {
		// #given — the catalog credits Pharrell only in the artist field it won't write
		const itunes = candidate({
			source: "itunes",
			artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
			title: "Get Lucky",
			album: "Random Access Memories",
			durationSeconds: 369,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Daft Punk",
				title: "Get Lucky ft. Pharrell",
				durationSeconds: 369,
			},
			[itunes],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.title).toBe(
			"Get Lucky (feat. Pharrell)",
		);
	});

	it("keeps the upload's artist when the catalog credits a lead the upload never names", () => {
		// #given — iTunes lists the guests as co-leads
		const itunes = candidate({
			source: "itunes",
			artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
			title: "Get Lucky",
			album: "Random Access Memories",
			durationSeconds: 369,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Daft Punk", title: "Get Lucky", durationSeconds: 369 },
			[itunes],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.artist).toBe(
			"Daft Punk",
		);
	});

	it("writes the catalog's spelling when it credits the same leads", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Beyonce", title: "Halo", durationSeconds: 261 },
			[
				candidate({
					source: "itunes",
					artist: "Beyoncé",
					title: "Halo",
					album: "I Am... Sasha Fierce",
					durationSeconds: 261,
				}),
			],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.artist).toBe(
			"Beyoncé",
		);
	});

	it("does not let another artist's cover single dispute the real release", () => {
		// #given — recorded: a band's cover single shares the album name and length
		const single = candidate({
			artist: "Ed Sheeran",
			title: "Shape of You",
			album: "Shape of You",
			durationSeconds: 233,
			isrc: "GBAHS1600463",
		});
		const cover = candidate({
			source: "itunes",
			artist: "Fame on Fire",
			title: "Shape of You",
			album: "Shape of You - Single",
			durationSeconds: 236,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Ed Sheeran", title: "Shape of You", isrc: "GBAHS1600463" },
			[single, cover],
		);

		// #then
		expect(verdict).toMatchObject({ status: "matched", via: "isrc" });
	});

	it("counts a lead act named 'The …' as a performer, not a backing band", () => {
		// #given — a Daft Punk solo row for a song the upload credits to both acts
		const solo = candidate({
			artist: "Daft Punk",
			title: "Starboy",
			album: "Starboy",
			durationSeconds: 230,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "The Weeknd & Daft Punk",
				title: "Starboy",
				durationSeconds: 230,
			},
			[solo, { ...solo, source: "itunes" }],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("does not add a lead act named 'The …' to an upload's artist", () => {
		// #given
		const itunes = candidate({
			source: "itunes",
			artist: "The Weeknd, Daft Punk",
			title: "Starboy",
			album: "Starboy",
			durationSeconds: 230,
		});

		// #when
		const verdict = judgeCandidates(
			{ artist: "Daft Punk", title: "Starboy", durationSeconds: 230 },
			[itunes],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.artist).toBe(
			"Daft Punk",
		);
	});

	it("refuses a tribute act whose name contains the upload's artists", () => {
		// #given — recorded: "Simon & Garfunkel Experience", at the soundtrack cut's length
		const tribute = candidate({
			artist: "Simon & Garfunkel Experience",
			title: "Mrs. Robinson",
			album: "The Best of Simon & Garfunkel",
			albumArtist: "Simon & Garfunkel Experience",
			durationSeconds: 216,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Simon & Garfunkel",
				title: "Mrs. Robinson",
				durationSeconds: 216,
			},
			[tribute],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("needs a co-lead named 'The …' credited, not just the first act", () => {
		// #given — recorded: Deezer credits "Moth To A Flame" to Swedish House Mafia alone
		const deezer = candidate({
			artist: "Swedish House Mafia",
			title: "Moth To A Flame",
			album: "Paradise Again",
			durationSeconds: 234,
		});

		// #when
		const verdict = judgeCandidates(
			{
				artist: "Swedish House Mafia & The Weeknd",
				title: "Moth To A Flame",
				durationSeconds: 234,
			},
			[deezer],
		);

		// #then
		expect(verdict.status).toBe("unmatched");
	});

	it("keeps the upload's artist when the catalog adds a backing band", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Prince", title: "Purple Rain", durationSeconds: 521 },
			[
				candidate({
					source: "itunes",
					artist: "Prince & The Revolution",
					title: "Purple Rain",
					album: "Purple Rain",
					durationSeconds: 521,
				}),
			],
		);

		// #then
		expect(verdict.status === "matched" && verdict.metadata.artist).toBe(
			"Prince",
		);
	});

	it("matches a name spelled with a dollar sign", () => {
		// #when
		const verdict = judgeCandidates(
			{ artist: "Ke$ha", title: "TiK ToK", durationSeconds: 200 },
			[
				candidate({
					source: "itunes",
					artist: "Kesha",
					title: "TiK ToK",
					album: "Animal",
					durationSeconds: 200,
				}),
			],
		);

		// #then
		expect(verdict.status).toBe("matched");
	});
});
