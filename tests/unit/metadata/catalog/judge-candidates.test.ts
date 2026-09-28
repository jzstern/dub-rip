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

	it("keeps the release both catalogs reached when a later stage learns the duration", () => {
		// #given — the upload runs 307s, which only the knock-off's runtime matches
		const query = { artist: "Toto", title: "Africa", durationSeconds: 307 };

		// #when
		const verdict = judgeCandidates(query, [
			TOTO_ITUNES,
			TOTO_ALBUM_CUT,
			TOTO_KNOCK_OFF,
		]);

		// #then — the preview's choice stands, so the file matches what was shown
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: "Toto IV" },
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
	it("takes year and genre from the shorter twin of a longer upload", () => {
		// #given — the music-video case agreement exists for: the twin is the donor
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

		// #then
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { year: 1982, genre: "Rock" },
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
		expect(verdict).toMatchObject({
			status: "matched",
			via: "agreement",
			metadata: { album: "Skin" },
		});
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
			{ artist: "Disclosure", title: "Latch", durationSeconds: 256 },
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
		expect(verdict).toMatchObject({
			status: "matched",
			metadata: { album: undefined },
		});
	});
});
