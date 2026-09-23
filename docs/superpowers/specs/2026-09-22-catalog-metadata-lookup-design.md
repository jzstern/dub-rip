# Canonical track metadata from music catalogs

**Status:** design approved 2026-09-22. **Stage A is implemented** on `docs/metadata-lookup-design` and measured (see *Measured results*); it is inert until wired. Stage B waits for SoundCloud Phase 2 and a go-ahead from the human.

**Goal:** stop deriving a track's identity from the words an uploader typed. Look the track up in a music catalog and, when the match is provably the same recording, use the catalog's title, artist, album, year, label, ISRC and genre instead.

Today every field comes from the upload title through `cleanUploadTitle` → `parseArtistAndTitle` → `resolveTrackIdentity`, plus `credits.ts` for label and remixer. Every new edge case has needed a new regex (PRs #135, #136). A catalog lookup replaces guesswork with evidence wherever a match can be proven, and leaves the heuristics in charge everywhere else.

---

## Research (2026-09-22)

Every claim below was checked against the live APIs, not only the docs.

### What each source is worth

| Source | Gives | Costs | Verdict |
| --- | --- | --- | --- |
| **iTunes Search** | title, artist, album, release date, genre, duration, artwork, compilation flag (`collectionArtistName: "Various Artists"`) | ~20 calls/min per IP; no key | **Use.** Already called for artwork. No ISRC, no label; `lookup?isrc=` returns 0 results. |
| **Deezer** | title split into `title_short` + `title_version`, artist, album, duration, **`isrc` in search results**, `/track/isrc:{code}`, `/album/{id}` → label, genres, `record_type` | 50 req/5s; no key | **Use.** Already called for artwork. Field-scoped search (`artist:"x" track:"y"`) returns nothing today, even for Deezer's own documented example, so only free-text search works. |
| **MusicBrainz** | CC0 data, ISRC→recording, tags | 1 req/s, `503` over it; a named User-Agent is required; label needs a second `/release/{id}?inc=labels` call | **Defer.** Its `score` carries no confidence: `recording:"Strobe" AND artist:"deadmau5"` returned 11 recordings at score 100 with the original 11th, and an invented title also scored 100. It found none of Klaps, THISO or Onlynumbers. |
| **Spotify** | ISRC, album name, release date | since Feb 2026: owner needs Premium, 1 client ID per developer, 5 users per app, search `limit` max 10; album `label` removed; genres always empty | **Reject.** High friction, and it no longer carries the two fields we lack. |
| **Discogs** | labels, catalog numbers, `styles` (the best genre source for electronic music) | 25 req/min unauthenticated, 60 authenticated | **Defer.** Revisit if genre quality disappoints. |
| **AcoustID** | fingerprint → recording | needs the audio and a key; 3 req/s; non-commercial | **Defer.** Can't run at preview time, since nothing is downloaded yet. |
| **SoundCloud page** | `publisher_metadata.isrc`, `album_title`, `p_line`, `label_name`, `genre`, `release_date`, duration | already fetched by Phase 2 | **Use as input.** ISRC on ~24% of the 152-upload sample, and trustworthy when present. |
| **YouTube description** | `Provided to YouTube by …`, `Title · Artist`, album, `℗ year label`, `Released on:` | already parsed by yt-dlp into `track`/`artist`/`album`/`release_year` | **Use as input.** It never carries an ISRC. Its "Provided to YouTube by" line names the distributor, not the label. |

### Why a naive lookup is dangerous

The top search hit is confidently wrong for exactly the uploads SoundCloud is full of:

| Query | iTunes top hit | Why it's wrong |
| --- | --- | --- |
| `Tame Impala – Dracula (JENNIE Remix)` | `Dracula`, the original | A different recording. |
| `Maroon 5 – Payphone [TWLGHT & SadBois Archive Edit 02]` | `Payphone (feat. Wiz Khalifa)` | A bootleg matched to the original. |
| `Avicii – Levels (Skrillex Remix)` | right track, album `Body By Jake: Boot Camp Workout` | Compilation pollution. |
| `The Chainsmokers – Don't Let Me Down ft. Daya (Hipst3r Edit)` | no hit | Correct: bootlegs aren't in catalogs. |

Matching lessons from existing taggers: beets weights bracketed text at 0.3 and `feat…` at 0.1, so `(X Remix)` costs almost nothing there — precisely the mistake to avoid. Picard scores length to zero at a 30 s difference. beets uses a 10 s grace and a 30 s maximum. Both are tuned for tagging a known album, not for identifying an arbitrary upload, so this design treats version words as a hard requirement instead.

---

## Design

### Principle

The heuristic pipeline stays exactly as it is and keeps two jobs: it builds the **query**, and it is the **fallback**. A catalog match overrides it only when the match is proven to be the same recording. Anything less and nothing changes.

### New units

All are new files under `src/lib/metadata/catalog/`. Only the two clients touch the network.

| File | Job |
| --- | --- |
| `catalog-candidate.ts` | The `CatalogCandidate` and `CanonicalMetadata` types and the verdict union. |
| `normalize-text.ts` | Comparison-only normalization. |
| `track-version.ts` | Splits a title into base title, featured credits and classified version tags. |
| `itunes-catalog.ts` | `searchITunes(term, opts)` → up to 5 candidates. |
| `deezer-catalog.ts` | `searchDeezer`, `deezerTrackByIsrc`, `deezerAlbum`. |
| `judge-candidates.ts` | Pure. `judgeCandidates(query, candidates, evidence)` → verdict. |
| `lookup-catalog.ts` | Orchestration. It takes an optional cache port, so Stage A ships no cache of its own and Stage B passes Phase 2's `single-flight-cache.ts` in. |

### Evidence grows; the cache holds candidates

The cache stores **candidates**, not verdicts, keyed by the normalized `artist|title|isrc` with a 10-minute TTL. Each stage re-judges the cached candidates with whatever it knows by then, which costs nothing and lets the verdict improve.

The cache is a **port**, not a module: `lookupCatalogMetadata` takes an optional `{ get(key, factory, ttlMs) }`. Stage A ships uncached, since Phase 2 creates `single-flight-cache.ts`, and Stage B passes that in. Without a port the lookup still works, one fetch at a time.

| Stage | Evidence available | Network vs today |
| --- | --- | --- |
| Preview (YouTube) | iTunes and Deezer agreeing (YouTube never supplies an ISRC) | none — the two searches artwork already runs, with `limit=5` instead of 1 |
| Preview (SoundCloud) | the page's ISRC and duration | none, or one Deezer ISRC call instead of the searches |
| `/details` (YouTube) | + duration, from the **existing** yt-dlp call | none |
| Download | same as `/details` | + one Deezer `/album/{id}` (~300 ms) for label and genre; one fewer iTunes search |

**No new yt-dlp calls anywhere.** Duration and description come from the `--dump-json` call that already runs.

Consequences:

- The verdict is **monotonic**: more evidence only adds ways to accept, so a preview match is never withdrawn.
- The file gets the verdict `/details` displayed. What you see is what you get.
- Artwork comes from the matched candidate, which fixes a remix showing the original's cover. With no match, artwork falls back to today's order using the same responses.
- The lookup never runs inside `fetchYouTubeMetadata`, so `youtube-identity-characterization.test.ts` keeps pinning the heuristic stage and does not change.

### Matching rules

**Normalization** (comparison only; written values keep their original characters): NFKC, strip diacritics, casefold, fold `’`→`'` and `&`/`+`/`and` to one token, drop punctuation, collapse whitespace. So `HUMBLE.` = `HUMBLE` and `I Cant Fail` = `I Can't Fail`. A trailing store disambiguator is removed from catalog artists: `Klaps (BE)` → `Klaps`.

Matching is exact after normalization. No edit-distance fuzzing: fuzzing is how near-miss titles get accepted.

**Version tags**, parsed from bracketed and dashed suffixes on both sides:

| Class | Examples | Rule |
| --- | --- | --- |
| **Identity** | remix, edit, re-edit, bootleg, flip, rework, refix, VIP, mashup, live, acoustic, instrumental, a cappella, slowed, sped up, nightcore, cover, karaoke, tribute — and any bracket containing a word we don't recognize | Kind **and** credited name must match exactly. |
| **Length** | radio edit, extended mix, club mix, short version, single version | Must match, unless duration is within ±5 s. |
| **Neutral** | original mix, album version, remaster(ed) [year], explicit, clean, mono, stereo, official video/audio, `feat.`/`ft.`/`with` credits | Ignored. |

An unrecognized bracket counts as identity, so matching fails closed. `(SneakPreview) Adrian Ackers Blueprint 1` can never match a plain catalog title.

**A candidate is accepted** when the artist check passes (either side's primary artist is in the other's artist set, split on `, & x feat ft with`), the base titles are equal, the version rules above hold, and one of:

1. **ISRC** — the candidate came from `/track/isrc:`. An exact identifier, accepted outright.
2. **Duration** — within ±5 s. SoundCloud always has it; YouTube has it once `/details` returns.
3. **Agreement** — an iTunes candidate and a Deezer candidate pass independently with the same normalized identity.

Agreement exists because YouTube has no duration at preview time, and because an official music video usually runs 30–90 s longer than the track (`Adele – Hello` is 6:07 against a 4:55 track), so a duration rule alone would reject most correct music-video matches.

**Choosing among accepted candidates:** duration-verified beats agreement; then Deezer beats iTunes (it keeps the `Artist – Title (feat. X)` shape the filenames use, and carries the ISRC); then non-compilation beats compilation; then the earlier release.

### Fields on a match

No match means today's behavior, unchanged.

| ID3 field | On match | Fallback |
| --- | --- | --- |
| Title, artist (and the filename) | catalog | today's order: `details.track` / `details.artist` (yt-dlp's parsed Topic metadata), then the heuristic |
| Album (TALB) | catalog, unless it is a compilation (`Various Artists`, Deezer `record_type: compile`) | `details.album`, then the title |
| Year (TYER) | catalog release year | `details` year |
| Genre (TCON) | iTunes `primaryGenreName`, else the Deezer album genre — either beats YouTube's "Music" | `details.genre` |
| Label (TPUB) | SoundCloud `label_name` when present, else the Deezer album label | `resolveLabel` as today |
| ISRC (TSRC) | SoundCloud's own ISRC when present, else the catalog's | platform only |
| Remixer (TPE4) | `extractRemixer` on the catalog title | same, on the heuristic title |

SoundCloud's own label and ISRC win because the distributor supplied them as clean fields for that exact upload. A **YouTube** label does not: `details.label` is scraped out of a free-text `℗` line ("℗ 2009 Mau5trap Recordings under exclusive license in North America to Ultra Records, Inc."), so on a match the Deezer album label beats it.

### Error handling

- **A lookup failure can never fail a preview or a download.** Timeout, 403/429, 5xx, Deezer's `200 {error:{code:4}}` quota response and malformed JSON all yield zero candidates, and the heuristic stands.
- Timeouts: the preview keeps today's 4 s artwork budget, which the searches share; downloads get 6 s. Timeout values are whole milliseconds (`AbortSignal.timeout` rejects fractional values on Node while Bun tolerates them).
- One log line per verdict — `[catalog] matched via=duration source=deezer` or `[catalog] unmatched reason=version-mismatch` — gives a production match rate without Sentry noise. A miss is normal, as artwork misses are (`docs/error-reporting.md`).
- Sentry sees only exceptions from our own parsing or judging, at `warning` with `service: "catalog"`. Those mean a bug.
- Transient failures are not cached; empty results are.
- The `service: "catalog"` tag gets documented in `docs/error-reporting.md` during **Stage B**. That file is in Phase 2's File map, so a Stage A edit would halt its controller.
- No rate-limit queue at current traffic. The shared cache takes iTunes from 2 searches per track to 1, against its ~20/min limit.

### Testing

- Everything runs offline against recorded responses in `tests/fixtures/catalog/`; `scripts/record-catalog-fixtures.ts` refreshes them (TypeScript, run by Bun, so it shares the real URL builders and can't drift from them).
- Unit tests cover the version classifier, normalization, both clients including their error shapes, and the judge.
- Every dangerous case above is a named regression row: the JENNIE remix, the Payphone bootleg, the Marea edit, the Levels compilation, the bad guy ISRC, `Klaps (BE)`, and Get Lucky's radio edit against the album version.
- `scripts/eval-catalog-lookup.ts` runs the labelled corpus in `tests/fixtures/catalog/eval-corpus.json` against the live APIs and reports the match rate and any wrong match. **Zero wrong matches is the gate** before Stage B is wired; the script exits non-zero if one appears.
- `youtube-identity-characterization.test.ts` does not change. A separate canonical characterization test records what those titles become after a lookup.
- Goal: no existing `expect` changes. Canonical fields are added to responses only on a match, and `resolveArtworkUrl` keeps its signature. Anything unavoidable gets listed for approval in the Stage B plan.

---

## Measured results (Stage A, 2026-09-23)

`bun scripts/eval-catalog-lookup.ts` against the live APIs, 25 labelled cases:

**22/25 as expected · 0 wrong · 3 missed of 16 matchable.**

- Every case that must not match, did not: the Payphone bootleg, the Hipst3r edit, the Ed Marquis bootleg, a DJ edit, an unreleased SoundCloud edit, an unreleased original mix, and a remix the stores don't carry under that name.
- Underground SoundCloud-style releases matched on duration and filled label, genre and year: `Klaps – Se Cura` (Deadline Rec, Electronic, 2025), `Onlynumbers – Occult`, `THISO – Back The F Up`.
- The three misses are all recall, never wrong data: `Adele – Hello`, `Rick Astley – Never Gonna Give You Up` and `Metallica – Enter Sandman (Remastered)`. In each, iTunes returns the right recording first while **Deezer's top 10 contains only covers, karaoke and alternate mixes**, so no two catalogs agree. At download time a duration match can still rescue them for audio uploads; for music videos it cannot, because the video is longer than the track.

Three things changed during implementation, each measured:

| Change | Why | Effect |
| --- | --- | --- |
| Search limit 10, not 5 | Deezer's first five results for a famous song are frequently covers | more agreement, no extra calls |
| The search term drops neutral text | "Bohemian Rhapsody (Official Video Remastered)" made the catalogs answer with lullaby and Muppet versions | that row went from miss to match |
| Fields missing on the chosen release are filled from the other catalog's copy of the same recording | Deezer names recordings best but its search results carry no release date and no genre, while iTunes carries both | `year` and `genre` went from empty to filled on every agreement match, with no extra call |

If recall on mainstream music videos matters more than the current strictness, the open question is whether a single catalog's exact artist + title + version match should be enough on its own. The version check, not the agreement rule, is what rejects every bootleg above — but that change needs a human decision, not an implementer's.

## Sequencing around SoundCloud Phase 2

Phase 2 (`docs/superpowers/plans/2026-09-20-soundcloud-support.md`) halts its controller on any commit touching its File map.

**Stage A — the lookup core. No file in Phase 2's File map, and none of PR #136's files.**
- Adds only `src/lib/metadata/catalog/*`, its tests, fixtures, the recording script and the evaluation corpus.
- Imports `extractRemixer`; never edits `credits.ts`, `clean-upload-title.ts` or `resolve-track-identity.ts`.
- Inert in production until Stage B. It is deliberately dead code, which is why it is short.

**Stage B — wiring. Only after Phase 2 merges, and only with the human's go-ahead.**
- Touches `artwork.ts`, the three API routes, `finalize-mp3.ts`, Phase 2's `soundcloud-metadata.ts` and `prepare-download.ts`, `+page.svelte` and `types.ts`.
- The candidate cache reuses Phase 2's `single-flight-cache.ts` rather than adding a second one.

**Verification:** run the corpus from the PR environment, since Deezer results vary by region and Railway's egress region is not this laptop's. After merge, spot-check production; a PR-environment pass is not a production pass (memory `dub-rip-pr-env-not-prod-ip`).

---

## Decisions and their reasons

| Decision | Reason |
| --- | --- |
| Strict override, not "best hit wins" | The probe shows the best hit tags a bootleg as the original. |
| No per-download opt-out in the UI | Wrong matches get fixed by tightening the matcher; each one becomes a regression fixture. |
| Cross-catalog agreement substitutes for duration | YouTube has no duration at preview time, and music videos are legitimately longer than their tracks. |
| Cache candidates, not verdicts | Evidence arrives in stages; re-judging is free and keeps preview, details and download consistent. |
| Deezer preferred over iTunes when both pass | It carries the ISRC and keeps artist and feat. credits in the shape the filenames already use. |
| Compilation albums are not written | `Levels (Skrillex Remix)` would otherwise be tagged to a workout compilation. |
| Unknown bracket text is treated as identity | Failing closed keeps unreleased and edited uploads on the heuristic path. |

## Considered and rejected

- **Spotify.** Premium-gated since February 2026, 5 users per app, and it no longer returns `label` or genres.
- **MusicBrainz in v1.** Scores carry no confidence, labels need a second call at 1 req/s, and underground coverage was absent in every probe. Worth revisiting for genre and first-release year at download time.
- **AcoustID fingerprinting.** Impossible at preview time, since no audio exists yet. A candidate for confirming a match at download time later.
- **Editable metadata fields in the UI.** A bigger change than the problem warrants today.
- **Fuzzy title matching.** It is exactly how a near-miss becomes a confident mismatch.

## Noticed along the way

- `labelFromDescription` falls back to the "Provided to YouTube by" line, which names the **distributor** (for example `IIP-DDS`), not the label. It only fires when the `℗` line is missing, which is rare in auto-generated descriptions. A catalog match supersedes it.
- `README.md` claims album and release-year embedding, but on YouTube the album is usually just the track title. A match makes the claim true; until then the README overstates it.

## Terms of use

Deezer's terms limit use to non-commercial purposes, and Apple ties use of its content to promoting the store. Both services are already called for artwork; this extends that use to metadata. MusicBrainz (CC0) is the cleanest alternative if that ever matters.
