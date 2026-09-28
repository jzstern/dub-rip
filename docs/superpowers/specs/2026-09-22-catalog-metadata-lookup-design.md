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
| Preview (SoundCloud) | the page's ISRC and duration | **2 calls where today there are none** (3 with an ISRC), since a SoundCloud preview uses the upload's own artwork and never searches a store. Both searches always go out; an ISRC lookup joins them *alongside* rather than instead, because an uploader-supplied ISRC can resolve to a track that is not this upload, and short-circuiting on it would leave the judge nothing to fall back on. |
| `/details` (YouTube) | + duration, from the **existing** yt-dlp call | none |
| Download | same as `/details` | + one Deezer `/album/{id}` (~300 ms) for label and genre; one fewer iTunes search |

**No new yt-dlp calls anywhere.** Duration and description come from the `--dump-json` call that already runs.

Consequences:

- **A later stage can refine or withdraw a preview match, and Stage B has to render that.** Duration is not purely additive evidence: a catalog cut that outruns the upload is refused (see above), so a match accepted on text alone can be dropped once `/details` supplies the runtime, and a field donated by a cross-catalog twin can drop out with it. The trade was deliberate — the alternative is tagging a 3:26 upload from a 7:41 extended mix — but it means the preview verdict is provisional, not a promise. Stage B should either hold the canonical fields back until the duration is in, or show them as provisional and let the `/details` response correct them.
- Ranking, by contrast, **is** stable: among candidates that all remain accepted, the choice does not depend on the duration, so the two stages cannot disagree about *which* release to prefer.
- Artwork comes from the matched candidate, which fixes a remix showing the original's cover. With no match, artwork falls back to today's order using the same responses.
- The lookup never runs inside `fetchYouTubeMetadata`, so `youtube-identity-characterization.test.ts` keeps pinning the heuristic stage and does not change.

### Matching rules

**Normalization** (comparison only; written values keep their original characters), in order: cap at 300 characters without splitting a surrogate pair, collapse whitespace, NFKD, strip **only** the Latin/Greek/Cyrillic combining diacritics, casefold, fold `&`/`+` to `and`, drop apostrophes entirely, replace remaining punctuation with a space, collapse again. So `HUMBLE.` = `HUMBLE`, `I Cant Fail` = `I Can't Fail`, and `Beyoncé` = `Beyonce`. Stripping every combining mark would also erase the Japanese dakuten, which is a letter difference rather than an accent — it would make パート (Part) and ハート (Heart) the same title. A trailing store disambiguator is removed from catalog artists: `Klaps (BE)` → `Klaps`.

Matching is exact after normalization. No edit-distance fuzzing: fuzzing is how near-miss titles get accepted.

**Version tags**, parsed from bracketed and dashed suffixes on both sides:

| Class | Examples | Rule |
| --- | --- | --- |
| **Identity** | remix, **a bare "edit"**, re-edit, bootleg, flip, rework, refix, VIP, mashup, live, acoustic, instrumental, a cappella, slowed, sped up, nightcore, cover, karaoke, tribute — and any bracket containing a word we don't recognize | Kind **and** credited name must match exactly. An unqualified "(Edit)" names someone else's cut, so it belongs here rather than with the length variants. |
| **Length** | radio edit, extended mix, club mix, short/long/full version, **single version**, **video mix**, **12″ mix** | Must match, unless duration is within ±5 s. Checked before the neutral vocabulary, so "single version" and "video mix" land here even though each of their words is individually neutral. |
| **Neutral** | original mix, album version, remaster(ed) [year], explicit, clean, mono, stereo, official video/audio, `feat.`/`ft.`/`with` credits | Ignored. |

An unrecognized bracket counts as identity, so matching fails closed. `(SneakPreview) Adrian Ackers Blueprint 1` can never match a plain catalog title.

**A candidate is accepted** when the artist check passes (either side's primary artist is in the other's artist set, split on `, & x feat ft with`), **the album is that artist's own** (its album artist shares a name with the track's credits, unless it is a compilation), the base titles are equal, the version rules above hold, **the catalog's cut does not outrun the upload**, and one of:

1. **ISRC** — the candidate carries the upload's own ISRC, compared as an identifier (case and dashes ignored). An exact identifier, but on SoundCloud the *uploader* supplies it, so it earns no exemption from the gate above: a bootleg stamped with the original's ISRC would otherwise be written as the original, which is the exact failure this design exists to prevent. A runtime that disagrees also cancels it.
2. **Duration** — within ±5 s. SoundCloud always has it; YouTube has it once `/details` returns.
3. **Agreement** — an iTunes candidate and a Deezer candidate pass independently with the same normalized identity **and runtimes within ±5 s of each other**.

Agreement exists because YouTube has no duration at preview time, and because an official music video usually runs 30–90 s longer than the track (`Adele – Hello` is 6:07 against a 4:55 track), so a duration rule alone would reject most correct music-video matches.

That asymmetry is why the runtime rule is one-directional. An upload may wrap a track in an intro or an outro, so a *longer upload* is ordinary. A **catalog cut that outruns the upload** by more than the tolerance is not: it is a live take, an extended mix, or the full track behind a bootleg that borrowed its ISRC. Such a candidate is refused outright, and it cannot corroborate another candidate either.

**Revised 2026-09-27, after a PR-env download of Flume's official "Never Be Like You" was written with an instrumental knock-off's album, label, ISRC and cover.** Deezer carried no copy of the real single for that search, only rows credited to "Flume" on other artists' albums: "Unst" by Unstrumental (3:32) and "The Lockbox" by The Amalgamates (3:55, the single's exact runtime). Two rules were too weak:

- Agreement was keyed on the title alone, so the 3:32 row "agreed" with iTunes's 3:55 single and then won, because Deezer ranks first. Agreement now also requires the two catalog runtimes to agree, and a donor may not fill fields for a winner whose runtime it contradicts.
- Neither the credit nor the runtime can tell The Lockbox from the single, but the album can. iTunes search rows carry `collectionArtistName`; Deezer search rows do not, so every Deezer row that names the song and artist is checked against its album before judging (usually one to three calls, paid once per track and cached with the candidates). A row whose album cannot be read is dropped, not trusted.

The upload's `feat.` credit is also written back when the catalog files the feature outside its title (Deezer's "Latch", not "Latch (feat. Sam Smith)"), since the Deezer-first rule's premise that Deezer keeps `feat.` in the title does not always hold.

**Choosing among accepted candidates is structural, not evidential**, so the choice cannot change when a later stage learns the duration — a preview and its download must agree, or the file contradicts what the user was shown. In order: an ISRC proof; then a recording both catalogs reached; then non-compilation over compilation; then Deezer over iTunes (it keeps the `Artist – Title (feat. X)` shape the filenames use, and carries the ISRC); then **the catalog's own result order**, since both APIs rank the canonical release above a reissue or a knock-off; then the earlier release date, and only when both dates are precise — both stores back-date a reissue to January 1, which would otherwise make a greatest-hits set look older than the album it reissues.

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
- **An outage and a genuine miss are different results.** Each adapter returns `null` when it could not be reached or was refused (quota included) and `[]` only when it answered with nothing. If no catalog could be reached, the lookup throws, so the cache stores nothing and the next request retries — an outage recorded as "no such track" would outlive the outage by the full TTL. A genuine empty result is cached.
- **The cache key is the search term, not the raw query.** Two titles that differ only in bracketed noise search identically and must share an entry; two that search differently must not. Keying on the normalized title would collide `Bohemian Rhapsody (Live Aid)` with the studio version.
- **`timeout` is a budget for the whole lookup**, not per request, so three legs cannot take three times the caller's limit.
- **Input is capped and whitespace collapsed before any pattern runs** (`collapseWhitespace`, 300 characters). The patterns start with `\s*`, which rescans a run of spaces from every offset, and the artist can be `details.artist` — which an uploader controls through a video description. Measured before the fix: a 16k-space artist blocked the event loop for 3.7 s, because the query credit was re-parsed once per candidate. The query is now parsed once per lookup, not once per candidate.
- **Artwork URLs are checked for scheme as well as host.** `https:` only, on `mzstatic.com` or `dzcdn.net`. This allowlist is the only gate the later image fetch has, and `file://mzstatic.com/etc/passwd` passes a host-only check. When Stage B fetches these, it must use `redirect: "manual"` or re-validate each hop, or a redirect escapes the allowlist.
- Response arrays are capped at the search limit on our side; `limit` is only a request hint.
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

## Measured results (Stage A, re-measured 2026-09-27 after review)

`bun scripts/eval-catalog-lookup.ts` against the live APIs, 25 labelled cases:

**22/25 as expected · 0 wrong · 3 missed of 16 matchable** — unchanged by the review fixes, but the gate is now real: the harness compares the matched recording's *version* against the upload's, where before it compared base titles only and so could not see the wrong-recording class at all. `Klaps – Se Cura` also stopped writing "Deadline Records Va 05" as its album, now that a Various Artists album counts as a compilation on Deezer as well as iTunes.

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
| An ISRC hit must pass the same artist/title/version gate as everything else | The uploader supplies the ISRC on SoundCloud, and the match becomes the filename. A proof that skips the version check is not a proof. |
| A catalog cut that outruns the upload is refused | An upload may carry an intro or outro; a longer catalog recording is a different cut. |
| Ranking is structural, never evidential | A preview and its download must pick the same release, or the file contradicts what was shown. |
| Comparison input is capped at 300 characters | The artist can be attacker-chosen text, and the patterns scan whitespace runs quadratically. |
| An unreachable catalog throws instead of returning empty | An outage cached as "no such track" would outlive the outage. |

## Known limitations

Each of these is a case where text and runtime cannot settle the question, so the matcher answers with its best guess or declines. They are documented rather than fixed because every available fix trades a wrong match for a missed one, or the reverse.

- **Featured credits are ignored when comparing identity**, because the catalogs disagree on where to put them: iTunes credits "Daft Punk, Pharrell Williams & Nile Rodgers" with the title "Get Lucky", while Deezer credits "Daft Punk" with the title "Get Lucky (feat. …)". A rule either way breaks one of them. The cost: a Topic upload of a collaboration, titled only "Dracula", can match the solo single of the same name when their runtimes are within tolerance. The song is right; the album may name the wrong release.
- **Two different recordings with the same title and artist cannot be told apart** when neither carries a version word — an instrumental re-recording on a compilation, say. Structural ranking makes the *choice* stable and prefers the canonical release, but it cannot make the choice provably right.
- **A Deezer search result never carries a compilation flag**, because the flag lives on the album. A Deezer-only match therefore writes its album name until enrichment (download time) fetches the album and can drop it.
- **Recall, not precision, is where this gives ground.** Where Deezer's top ten is covers and karaoke — `Adele – Hello`, `Rick Astley – Never Gonna Give You Up` — nothing agrees and the heuristic stands.

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
