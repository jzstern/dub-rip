/**
 * Runs the labelled corpus in tests/fixtures/catalog/eval-corpus.json against
 * the live iTunes and Deezer APIs and reports how the matcher did.
 *
 * Run with `bun scripts/eval-catalog-lookup.ts`. The gate is precision: a WRONG
 * line means the matcher wrote metadata for the wrong recording, and the run
 * exits non-zero. A MISS is recall — no metadata was written where some was
 * available, which is the safe direction.
 */

import { lookupCatalogMetadata } from "../src/lib/metadata/catalog/lookup-catalog";
import { normalizeForMatch } from "../src/lib/metadata/catalog/normalize-text";
import { parseTrackTitle } from "../src/lib/metadata/catalog/track-version";
import corpus from "../tests/fixtures/catalog/eval-corpus.json";

interface EvalCase {
	name: string;
	artist: string;
	title: string;
	isrc?: string;
	durationSeconds?: number;
	expect: "match" | "none";
	expectArtist?: string;
	expectTitle?: string;
}

const cases = corpus.cases as EvalCase[];
const tally = { correct: 0, wrong: 0, missed: 0 };

/** Catalogs append credited artists, so containment either way is right here. */
function sameArtist(
	left: string | undefined,
	right: string | undefined,
): boolean {
	if (!left || !right) return false;
	const a = normalizeForMatch(left);
	const b = normalizeForMatch(right);
	return a === b || a.includes(b) || b.includes(a);
}

/** Exact: the title is already reduced to its base, so containment would hide a wrong match. */
function sameTitle(
	left: string | undefined,
	right: string | undefined,
): boolean {
	if (!left || !right) return false;
	return normalizeForMatch(left) === normalizeForMatch(right);
}

for (const testCase of cases) {
	const verdict = await lookupCatalogMetadata(
		{
			artist: testCase.artist,
			title: testCase.title,
			isrc: testCase.isrc,
			durationSeconds: testCase.durationSeconds,
		},
		{ enrich: true },
	);

	const got =
		verdict.status === "matched"
			? `${verdict.metadata.artist} — ${verdict.metadata.title}`
			: `(none: ${verdict.reason})`;

	if (verdict.status === "matched" && testCase.expect === "none") {
		tally.wrong += 1;
		console.log(`WRONG   ${testCase.name}\n        wrote ${got}`);
		continue;
	}
	if (verdict.status !== "matched" && testCase.expect === "match") {
		tally.missed += 1;
		console.log(`MISS    ${testCase.name} ${got}`);
		continue;
	}
	if (verdict.status === "matched") {
		const titleMatches = sameTitle(
			parseTrackTitle(verdict.metadata.title).base,
			testCase.expectTitle,
		);
		const artistMatches = sameArtist(
			verdict.metadata.artist,
			testCase.expectArtist,
		);
		if (!titleMatches || !artistMatches) {
			tally.wrong += 1;
			console.log(
				`WRONG   ${testCase.name}\n        wanted ${testCase.expectArtist} — ${testCase.expectTitle}\n        got    ${got}`,
			);
			continue;
		}
		tally.correct += 1;
		console.log(
			`OK      ${testCase.name} [${verdict.via}] ${got} · ${verdict.metadata.album ?? "no album"} · ${verdict.metadata.year ?? "no year"} · ${verdict.metadata.genre ?? "no genre"}${verdict.metadata.label ? ` · ${verdict.metadata.label}` : ""}`,
		);
		continue;
	}
	tally.correct += 1;
	console.log(`OK      ${testCase.name} ${got}`);
}

const matchable = cases.filter(
	(testCase) => testCase.expect === "match",
).length;
console.log(
	`\n${tally.correct}/${cases.length} as expected · ${tally.wrong} wrong · ${tally.missed} missed of ${matchable} matchable`,
);

if (tally.wrong > 0) {
	console.error(
		"\nFAILED: the matcher wrote metadata for the wrong recording.",
	);
	process.exit(1);
}
