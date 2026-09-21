# SoundCloud Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept SoundCloud track links alongside YouTube and produce the same MP3 with rich ID3 tags. Every existing YouTube behavior must keep working. Artist, title and label extraction should hold up against how real uploads are titled on both platforms.

**Architecture:** Routes stop branching on a YouTube video ID. Instead they branch on a `MediaLink` (`{ kind, id, canonicalUrl }`), parsed once per request.
- **YouTube** keeps its exact path: oEmbed, then yt-dlp details, then a yt-dlp download gated on bgutil.
- **SoundCloud** reads metadata from the JSON embedded in the track page (`window.__sc_hydration`). That JSON has the label, album, ISRC, release date, artwork and Go+ preview flags, and needs no API key. SoundCloud oEmbed is the fallback. The download uses its own yt-dlp arguments and never touches the bgutil sidecar.
- **Both sources** share one pure title pipeline: `cleanUploadTitle` → `parseArtistAndTitle` → `resolveTrackIdentity`. `buildID3Tags` gains label, ISRC, remixer, catalog-number and source-URL frames.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Bun, Vitest (jsdom), Playwright, Biome, yt-dlp 2026.08.19, node-id3 0.2.9, Sentry.

**Delivery:** two PRs, merged in order. Keep each PR short-lived, because every open PR holds a billed Railway environment (`.claude/CLAUDE.md` → Railway Cost Practices).
- **Phase 1, `feat/upload-title-metadata`** (Tasks 1–7): the metadata groundwork. It changes YouTube output only in the deliberate ways listed below.
- **Phase 2, `feat/soundcloud-support`** (Tasks 8–20): SoundCloud itself, branched from `main` after Phase 1 merges.

**Plan base:** `origin/main` at `d07e423`. The plan was researched at `9b8c2f1` on 2026-09-20 and rebased on 2026-09-21 onto PR #134, which moved the fallback title out of `try-yt-dlp.ts` and removed `TitleState`. Before starting either phase, check `git log --oneline d07e423..origin/main` for anything else that has landed on the files in the File map. PR #133 was open at the rebase, touching `download-stream/+server.ts` and `download-stream.test.ts`. If it has merged, re-check Task 6's route line numbers and Task 16 Step 4's (82–87, 124, and test lines 116/135) before starting.

**Execution:** [`2026-09-20-soundcloud-support.execution.md`](./2026-09-20-soundcloud-support.execution.md) holds the Workflow script that runs this plan one phase at a time.

**Formatting:** code pasted from this plan must be formatted before `bun run lint`, which checks but doesn't fix. Run `bunx biome check --write <changed files>`; the format-on-save hook also does it. Never pass `--unsafe` (see `.claude/CLAUDE.md`).

Skills to use along the way:
- @superpowers:test-driven-development for every task.
- @svelte-code-writer and @svelte-patterns for Task 18.
- @superpowers:verification-before-completion before each PR.

---

## Research behind this plan (2026-09-20)

All of the following was checked directly.

**yt-dlp**
- yt-dlp (2026.03.17 locally; the pin is 2026.08.19) downloads SoundCloud with no PO token, JS runtime or plugin.
- The Task 14 argv chose `http_mp3_0_0` and logged `Not converting audio …; file is already in target format mp3`, so the MP3 is not re-encoded.
- Filtering out every format fails with `ERROR: … Requested format is not available`.
- The SoundCloud extractor (`yt_dlp/extractor/soundcloud.py`) sets `track` to the raw upload title and `artists` to `publisher_metadata.artist`. It does **not** expose `label_name`, album, ISRC or release date. Those exist only in the page data.

**SoundCloud track page**
- `fetch("https://soundcloud.com/<user>/<slug>")` from Node, with the default user agent, returns HTML containing `window.__sc_hydration = [...]`.
- Its `sound` entry has:
  - `title` and `user.username` / `user.avatar_url`
  - `publisher_metadata`: `artist`, `album_title`, `isrc`, `p_line`, `c_line`, `release_title`
  - `label_name`, `genre`, `release_date`, `display_date`
  - `duration` (in ms)
  - `artwork_url` (a `-large.jpg`)
  - `policy`, and `media.transcodings[].snipped`
- A track that doesn't exist returns **HTTP 200 with no `sound` entry**, not a 404.

**Other endpoints**
- SoundCloud oEmbed returns `title` as `"<title> by <uploader>"`, plus `author_name` and a 500×500 `thumbnail_url`.
- A share link `https://on.soundcloud.com/<code>` answers `302` with `Location: https://soundcloud.com/<user>/<slug>?si=…&utm_source=…`.

**node-id3 0.2.9** writes and reads back all five new frames:
- `publisher` (TPUB)
- `ISRC` (TSRC)
- `remixArtist` (TPE4)
- `audioSourceUrl` (WOAS)
- `userDefinedText: [{ description, value }]` (TXXX)

### How real uploads carry artist, label and other info

Sample: 152 SoundCloud search results plus 8 resolved tracks.

| Signal | How often | How reliable |
| --- | --- | --- |
| Artist in the title (`Artist - Title`) | 93/152 | The best signal when present. It was right even where the platform's own credit was wrong. |
| `publisher_metadata.artist` | 91/152 | Often right, but wrong in several ways, **even on uploads that carry an ISRC**. It was seen as the uploading channel (`Two Friends Mixes`, `EP 7`), the label (`CircoLoco Records`), an editor (`Hipst3r` on a Chainsmokers edit), a truncation (`The Chain`), a typo (`Pooh Sheisty`), and spam (`Mua Nhạc Liên Hệ Zal…`). |
| `label_name` | 17/152 | Clean when present (`Warner Records`, `Darkroom/Interscope Records`). Sometimes it is the artist's own name, for self-releases. |
| ISRC / album / release date | 36 / 15 / 17 of 152 | Present on uploads from distributors, and trustworthy. |
| Uploader | 152/152 | Often a label, repost or premiere channel (`TTC Records`, `[ PREMIERE ]`, `VP RECORDS`). |
| Noise in titles | Common | See the list below. |
| Reversed `Title - Artist` | Occasional | `Dracula - Tame Impala (JENNIE Remix)`, `… Premiere - Two Friends` |

The title noise seen in the sample:
- Premiere banners: `PREMIERE //`, `Premiere |`, `PREMIERE060:`, a trailing `PREMIERE`.
- Free-download tags: `[FREE DOWNLOAD]` (including the math-bold 𝐅𝐑𝐄𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃), `(FREE DL)`, `-FreeDownload`.
- Official-audio tags: `( Official Audio )`, `| Official Audio`, `[HQ]`.
- `.mp3` suffixes.
- Catalog numbers such as `[RCKLSS014]`, and labels such as `[Reboot Records]` or `(Zentryc)`.

**Artist precedence this leads to:** the artist parsed from the title first, then `publisher_metadata.artist`, then the cleaned-up uploader name. A reversed title is swapped only when its right side exactly matches a known name (the credited artist or the uploader) and its left side does not.

**An existing YouTube bug found along the way:** `parseArtistAndTitle` splits on the first hyphen even when no whitespace surrounds it.
- `Jay-Z - Empire State Of Mind` gives the artist `Jay`.
- `Blink-182 - …` gives `Blink`.
- `5:00 AM` gets split at its colon.

Task 2 fixes this.

---

## Guardrail: no functionality lost

Every behavior below exists today and must still hold after both phases. Each is already pinned by a test that this plan does **not** weaken.

| Behavior | Pinned by |
| --- | --- |
| YouTube URL forms (watch, youtu.be, shorts, embed, /v/, m., music., no scheme) and canonical URLs that drop `list=` / `start_radio` | `tests/unit/video-utils.test.ts` |
| Preview: artist and title from oEmbed, artwork from iTunes then Deezer, the bgutil `/ping` prewarm, a 404 when the video is unavailable | `tests/unit/api/preview.test.ts` |
| Details: yt-dlp `--dump-json` through the single-flight cache, and its reporting policy | `tests/unit/services/video-details-cache.test.ts`, `tests/unit/video-metadata.test.ts`, `tests/unit/services/video-metadata-reporting.test.ts` |
| Download: the SSE event sequence, the BGUTIL gate, retry with "Retrying download...", abort, queue-full, missing output, temp-file cleanup | `tests/unit/api/download-stream.test.ts`, `tests/unit/api/download-stream-reporting.test.ts` |
| The exact YouTube yt-dlp argv, which the canary relies on | `tests/unit/services/try-yt-dlp.test.ts`, plus the **new** `youtube-argv-characterization.test.ts` (Task 1) |
| YouTube artwork order (iTunes → Deezer → cropped ytimg → maxres fallback), the ID3 fields, and the `Artist - Title.mp3` filename | `tests/unit/artwork.test.ts`, `tests/unit/services/finalize-mp3.test.ts`, `tests/unit/video-metadata.test.ts` |
| YouTube error classification and categories | `tests/unit/services/yt-dlp-error-classifier.test.ts`, `tests/unit/services/yt-dlp-error-category.test.ts` |
| The canary (no file under `src/lib/canary/` changes) | `tests/unit/canary/*`, `tests/unit/services/classify-canary-run.test.ts` |
| UI: validation gating, the Enter key, the preview flow | `tests/e2e/app.spec.ts` |
| Common YouTube titles resolve to the same artist and title | the **new** `youtube-identity-characterization.test.ts` (Task 1) |
| When oEmbed fails, the title falls back to yt-dlp's details, never the output path (PR #134) | `tests/unit/api/download-stream-title-fallback.test.ts`, `tests/unit/services/title-from-video-details.test.ts` |

**Rules for the implementer:**
1. Never change an existing `expect(...)` statement, on any of its lines, unless the change is listed under **Deliberate behavior changes** below. You may edit mock factories and fixtures only where a task says to.
2. Before each PR, run the expect audit from the execution doc: `node <expect-audit.mjs> <repo> $(git merge-base HEAD origin/main)`. It must list only statements covered by the table below. It compares every expect statement at the base with HEAD using the TypeScript parser, so it also catches edits to multi-line expects, which a line grep misses.
3. The full suite, `bun run check` and `bun run lint` pass at every commit.

## Deliberate behavior changes

| # | Change | Why | Existing test lines that change |
| --- | --- | --- | --- |
| D1 | A hyphen separates artist and title only with whitespace on at least one side, so `Jay-Z`, `Blink-182` and `A-ha` stay whole. En and em dashes still split without spaces. | The first-hyphen split is a bug. | none (new tests) |
| D2 | A colon separates artist and title only when whitespace follows it, so `5:00 AM` and `Re:Zero` stay whole. | The same kind of bug. | none |
| D3 | Titles are cleaned before splitting: promo prefixes and suffixes are removed, `(Official Audio)` and similar go even when there is no separator, plus `.mp3` suffixes and runs of whitespace. | Uploads carry this noise. | none |
| D4 | A reversed `Title - Artist` is swapped when the right side is a known artist. | Real uploads do this. | none |
| D5 | The uploader fallback drops a `VEVO` suffix and trailing symbols or emoji (`AdeleVEVO` → `Adele`, `Lil Tecca ✰` → `Lil Tecca`). | Channel names aren't artist names. | none |
| D6 | New ID3 frames: TPUB (label), TSRC (ISRC), TPE4 (remixer), WOAS (source URL) and TXXX `CATALOGNUMBER`. YouTube files always gain WOAS, and the others when they can be derived. That includes the label from YouTube Music descriptions (the `℗` line or "Provided to YouTube by"). | The label and other info were asked for. | none |
| D7 | The server's 400 message `Invalid YouTube URL` becomes `Paste a YouTube video or SoundCloud track link`. The client's error text changes the same way. | Wrong once SoundCloud is supported. | `tests/unit/api/preview.test.ts:100`, `tests/unit/api/download-stream.test.ts:116`, `tests/unit/api/download-stream.test.ts:135` |
| D8 | The client accepts every URL the server accepts. That adds music.youtube.com, /embed/, /v/ and URLs with no scheme; the client used to be stricter than the server. | One shared parser. | none |
| D9 | `ensureBgutilPlugin()` now finishes before `getYTDlp()`. Both still finish before the first attempt. | That code moves into `prepare-download.ts`. | none |
| D10 | Sentry events for failed downloads gain a `source` tag. | To tell SoundCloud breakage from YouTube breakage. | none (the tests use `objectContaining`) |

---

## File map

**Phase 1**
- Create `src/lib/metadata/clean-upload-title.ts`: strips promo noise from upload titles, and extracts a bracketed label and catalog number. Pure.
- Create `src/lib/metadata/resolve-track-identity.ts`: decides artist and title (cleanup → split → reversal check → precedence). Pure.
- Create `src/lib/metadata/credits.ts`: reads the remixer from a title's version credit, and picks the label. Pure.
- Modify `src/lib/video-utils.ts`: the separator fixes (D1, D2) and the uploader clean-up (D5).
- Modify `src/lib/youtube-metadata.ts`: use `resolveTrackIdentity`.
- Modify `src/lib/video-metadata.ts`: add `VideoDetails.label` and `VideoDetails.isrc`, the label from YouTube descriptions, and the new frames in `buildID3Tags`.
- Modify `src/lib/download-pipeline/finalize-mp3.ts` and `src/routes/api/download-stream/+server.ts`: pass `uploader` and `sourceUrl` through.

**Phase 2**
- Create `src/lib/single-flight-cache.ts`: the TTL and single-flight cache, extracted from `video-details-cache.ts`.
- Create `src/lib/soundcloud/soundcloud-url.ts`: parses track URLs and short links. Pure and browser-safe.
- Create `src/lib/media-link.ts`: the `MediaLink` type and `parseMediaLink`. Pure and browser-safe.
- Create `src/lib/resolve-media-link.ts`: server-only; follows short links.
- Create `src/lib/soundcloud/soundcloud-track.ts`: fetches and parses the track page, with the oEmbed fallback.
- Create `src/lib/soundcloud/soundcloud-track-cache.ts`: one fetch per track, shared by preview, details and download.
- Create `src/lib/soundcloud/soundcloud-metadata.ts`: turns a SoundCloud track into title state, details, and a reason to refuse it.
- Create `src/lib/download-pipeline/try-soundcloud.ts`: the SoundCloud yt-dlp arguments.
- Create `src/lib/download-pipeline/prepare-download.ts`: the per-source download preparation. The YouTube block moves here from the route.
- Modify:
  - `src/lib/video-details-cache.ts`
  - `src/lib/yt-dlp-errors.ts`
  - `src/lib/artwork.ts`
  - `src/lib/download-pipeline/try-yt-dlp.ts`
  - `src/lib/download-pipeline/finalize-mp3.ts`
  - the three API routes
  - `src/routes/+page.svelte`, `src/routes/+layout.svelte`, `src/app.html`
  - `README.md`, `.claude/CLAUDE.md`, `docs/error-reporting.md`

**Not touched:** anything under `src/lib/canary/`, `src/routes/api/canary/` and `src/routes/api/health/`, plus `src/lib/yt-dlp-binary.ts` and `scripts/`.

---

## Phase 1: metadata groundwork (`feat/upload-title-metadata`)

### Task 1: Baseline and characterization tests

**Files:**
- Create: `tests/unit/services/youtube-argv-characterization.test.ts`
- Create: `tests/unit/metadata/youtube-identity-characterization.test.ts`

- [x] **Step 1: Confirm the branch and a green baseline**

The controlling session has already created this worktree from `origin/main`, on branch `feat/upload-title-metadata`, and run `bun install` in it (see the execution doc). Confirm that, then take the baseline:

```bash
git branch --show-current
bun run test:run
bun run check
bun run lint
```

Expected: the branch prints `feat/upload-title-metadata`, and everything is green. If the branch is different, stop and report NEEDS_CONTEXT. Record the passing test count in your report; it goes in the PR description, and it must never go down.

- [x] **Step 2: Write the argv characterization test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import { YOUTUBE_EXTRACTOR_ARG } from "$lib/yt-dlp-binary";

/**
 * The canary's whole value is that it runs the argv real users get. This pins
 * that argv element-for-element, so moving the SoundCloud path in beside it
 * can't change a single YouTube flag unnoticed.
 */
const EXPECTED_YOUTUBE_ARGV = [
	"https://www.youtube.com/watch?v=q9lZ4p5YRkY",
	"-x",
	"--audio-format",
	"mp3",
	"--audio-quality",
	"128K",
	"-f",
	"bestaudio[protocol^=m3u8]/bestaudio[vcodec=none]/bestaudio/18/best[height<=360]/best",
	"--concurrent-fragments",
	"4",
	"--ffmpeg-location",
	"/usr/bin/ffmpeg",
	"--newline",
	"--no-playlist",
	"--no-update",
	"--js-runtimes",
	"node:/usr/bin/node",
	"--plugin-dirs",
	"/tmp/yt-dlp-plugins",
	"--extractor-args",
	YOUTUBE_EXTRACTOR_ARG,
	"--extractor-args",
	"youtubepot-bgutilhttp:base_url=http://bgutil-pot.railway.internal:4416",
	"-o",
	"/tmp/out.%(ext)s",
];

async function captureArgs(debugMode: boolean): Promise<string[]> {
	let captured: string[] = [];
	const ytDlp = {
		exec: (args: string[]) => {
			captured = args;
			return {
				on(event: string, callback: (code: number) => void) {
					if (event === "close") queueMicrotask(() => callback(0));
				},
			};
		},
	} as unknown as YtDlpInstance;

	await tryYtDlpDownload({
		videoUrl: "https://www.youtube.com/watch?v=q9lZ4p5YRkY",
		outputPath: "/tmp/out",
		bgutilPotUrl: "http://bgutil-pot.railway.internal:4416",
		ffmpegPath: "/usr/bin/ffmpeg",
		pluginDir: "/tmp/yt-dlp-plugins",
		debugMode,
		ytDlp,
		send: () => {},
	});
	return captured;
}

describe("tryYtDlpDownload() argv characterization", () => {
	it("passes exactly the production YouTube argv", async () => {
		// #when
		const args = await captureArgs(false);

		// #then
		expect(args).toEqual(EXPECTED_YOUTUBE_ARGV);
	});

	it("appends only the debug flags in debug mode", async () => {
		// #when
		const args = await captureArgs(true);

		// #then
		expect(args).toEqual([...EXPECTED_YOUTUBE_ARGV, "-v", "--list-formats"]);
	});
});
```

- [x] **Step 3: Run it. It must pass against the unchanged code.**

Run: `bun run test:run tests/unit/services/youtube-argv-characterization.test.ts`
Expected: PASS (2 tests). If it fails, the expectation is wrong rather than the code: fix the test until it describes today's behavior.

- [x] **Step 4: Write the identity characterization test**

These are common YouTube title shapes whose artist and title must stay exactly the same after Tasks 2–4.

```ts
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
	["Never Gonna Give You Up", "Rick Astley", "Rick Astley", "Never Gonna Give You Up"],
	["Bohemian Rhapsody", "Queen - Topic", "Queen", "Bohemian Rhapsody"],
	[
		"Rick Astley - Never Gonna Give You Up [Official Video]",
		"Rick Astley",
		"Rick Astley",
		"Never Gonna Give You Up",
	],
	["Metallica - Enter Sandman (Remastered)", "Metallica", "Metallica", "Enter Sandman (Remastered)"],
	["Avicii - Levels (Skrillex Remix)", "Avicii", "Avicii", "Levels (Skrillex Remix)"],
	[
		"Queen - Bohemian Rhapsody (Official Video Remastered)",
		"Queen Official",
		"Queen",
		"Bohemian Rhapsody (Official Video Remastered)",
	],
	["The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO", "The Weeknd", "Blinding Lights"],
	["Kendrick Lamar - HUMBLE.", "KendrickLamarVEVO", "Kendrick Lamar", "HUMBLE."],
	["Artist – Title (Lyrics)", "Some Channel", "Artist", "Title"],
];

describe("YouTube title identity characterization", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(STABLE_YOUTUBE_TITLES)(
		"%j from %j resolves to %j / %j",
		async (title, channel, artist, trackTitle) => {
			// #given
			stubOEmbed(title, channel);

			// #when
			const metadata = await fetchYouTubeMetadata("dQw4w9WgXcQ");

			// #then
			expect({ artist: metadata.artist, trackTitle: metadata.trackTitle }).toEqual({
				artist,
				trackTitle,
			});
		},
	);
});
```

- [x] **Step 5: Run it. It must pass against the unchanged code.**

Run: `bun run test:run tests/unit/metadata/youtube-identity-characterization.test.ts`
Expected: PASS (14 tests).

- [x] **Step 6: Commit**

The plan and its execution doc go in this commit, so both reach `main` with Phase 1. That matters because Phase 2's CLAUDE.md section cites the plan, and Phase 2's fresh worktree needs the execution script.

```bash
git add docs/superpowers/plans/2026-09-20-soundcloud-support.md docs/superpowers/plans/2026-09-20-soundcloud-support.execution.md tests/unit/services/youtube-argv-characterization.test.ts tests/unit/metadata/youtube-identity-characterization.test.ts
git commit -m "test: pin current YouTube argv and title identity before metadata changes"
```

### Task 2: Fix the artist/title separators and clean up uploader names (D1, D2, D5)

**Files:**
- Modify: `src/lib/video-utils.ts:13-17` (the patterns) and `src/lib/video-utils.ts:46-52` (`sanitizeUploaderAsArtist`)
- Test: append to `tests/unit/video-utils.test.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe("parseArtistAndTitle() separator rules", () => {
	it.each([
		["Jay-Z - Empire State Of Mind", "Jay-Z", "Empire State Of Mind"],
		["Blink-182 - All The Small Things", "Blink-182", "All The Small Things"],
		["A-ha - Take On Me", "A-ha", "Take On Me"],
		["Temz- 5 in the morning", "Temz", "5 in the morning"],
		["Artist -Title", "Artist", "Title"],
		["Queen–Bohemian Rhapsody", "Queen", "Bohemian Rhapsody"],
	])("splits %j into %j / %j", (input, artist, title) => {
		// #when
		const result = parseArtistAndTitle(input);

		// #then
		expect(result).toEqual({ artist, title });
	});

	it.each(["X-COOL!", "5:00 AM", "Re:Zero Main Theme"])(
		"leaves %j whole",
		(input) => {
			// #when
			const result = parseArtistAndTitle(input);

			// #then
			expect(result).toEqual({ artist: "", title: input });
		},
	);
});

describe("sanitizeUploaderAsArtist() channel decorations", () => {
	it.each([
		["AdeleVEVO", "Adele"],
		["Lil Tecca ✰", "Lil Tecca"],
		["PHAN BAO 🌊", "PHAN BAO"],
		["Edwards Music ™", "Edwards Music"],
		["VEVO", "VEVO"],
	])("turns %j into %j", (uploader, expected) => {
		// #when
		const result = sanitizeUploaderAsArtist(uploader);

		// #then
		expect(result).toBe(expected);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test:run tests/unit/video-utils.test.ts`
Expected: FAIL. For example, `Jay-Z - Empire State Of Mind` gives `{ artist: "Jay", … }`, and `AdeleVEVO` stays `AdeleVEVO`.

- [ ] **Step 3: Implement**

In `src/lib/video-utils.ts`, replace the `patterns` array in `parseArtistAndTitle`:

```ts
	const patterns = [
		// A hyphen needs whitespace on one side, so "Jay-Z" and "Blink-182" stay whole
		/^(.+?)(?:\s+-\s*|\s*-\s+|\s*[–—]\s*)(.+)$/,
		// Needs whitespace after, so "5:00 AM" and "Re:Zero" stay whole
		/^(.+?)\s*:\s+(.+)$/,
		/^(.+?)\s*\|\s*(.+)$/,
	];
```

Then replace the return statement of `sanitizeUploaderAsArtist`:

```ts
	return trimmed
		.replace(/\s*-\s*Topic$/i, "")
		.replace(/(?<=\S)VEVO$/, "")
		.replace(/(?:[\s™®©✓✔✰★☆\p{Extended_Pictographic}]|\u{FE0F}|\u{200D})+$/u, "")
		.trim();
```

The variation selector and zero-width joiner go outside the character class as alternatives on purpose. Inside a class, Biome's `noMisleadingCharacterClass` rejects them, escaped or not.

Also update the function's doc comment so it mentions the VEVO suffix and the trailing symbols.

- [ ] **Step 4: Run the tests**

Run: `bun run test:run tests/unit/video-utils.test.ts tests/unit/metadata/youtube-identity-characterization.test.ts tests/unit/youtube-metadata.test.ts`
Expected: PASS, including every test that already existed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-utils.ts tests/unit/video-utils.test.ts
git commit -m "fix(metadata): don't split artist on an unspaced hyphen or colon"
```

### Task 3: Upload-title cleanup

**Files:**
- Create: `src/lib/metadata/clean-upload-title.ts`
- Test: `tests/unit/metadata/clean-upload-title.test.ts`

- [ ] **Step 1: Write the failing test**

The `cleans %j` fixtures are real upload titles from the 2026-09-20 sample, or common YouTube forms. The `keeps … intact` fixtures are a mix of real titles and made-up edge cases (`[EP01]`, `(New Release)`) that guard against false positives.

```ts
import { describe, expect, it } from "vitest";
import { cleanUploadTitle } from "$lib/metadata/clean-upload-title";

describe("cleanUploadTitle()", () => {
	it.each([
		["PREMIERE // Klaps - Se Cura [DLRVA05]", { title: "Klaps - Se Cura", catalogNumber: "DLRVA05" }],
		["TNMN - MOVING BODY [RCKLSS014] PREMIERE", { title: "TNMN - MOVING BODY", catalogNumber: "RCKLSS014" }],
		["Premiere | THISO - Back The F Up", { title: "THISO - Back The F Up" }],
		["Premiere : ZYNK - Into The Light", { title: "ZYNK - Into The Light" }],
		["PREMIERE060: SMVGGLERS x KØDA - ME FLIPA", { title: "SMVGGLERS x KØDA - ME FLIPA" }],
		["[ PREMIERE ] Kolter - Trapped (Radio Edit)", { title: "Kolter - Trapped (Radio Edit)" }],
		["PREMIERE | blk. - I Cant Fail [Reboot Records]", { title: "blk. - I Cant Fail", label: "Reboot Records" }],
		["Took me back - Jordan | GRM PREMIERE", { title: "Took me back - Jordan" }],
		["Artist - Title [Monstercat Release]", { title: "Artist - Title", label: "Monstercat" }],
		[
			"The Chainsmokers - Don't Let Me Down ft. Daya (Hipst3r Edit)[FREE DOWNLOAD]",
			{ title: "The Chainsmokers - Don't Let Me Down ft. Daya (Hipst3r Edit)" },
		],
		["Onlynumbers - Occult / 𝐅𝐑𝐄𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃", { title: "Onlynumbers - Occult" }],
		[
			"George Loukas - On My Knees (Original Mix) Free Download",
			{ title: "George Loukas - On My Knees (Original Mix)" },
		],
		["Đã Quên Rồi - Yến Lê ft Dr.A -FreeDownload", { title: "Đã Quên Rồi - Yến Lê ft Dr.A" }],
		["Pooh Shiesty - Shiesty Summer ( Official Audio )", { title: "Pooh Shiesty - Shiesty Summer" }],
		[
			"French Montana - Unforgettable (feat. Swae Lee) (Official Audio) [HQ]",
			{ title: "French Montana - Unforgettable (feat. Swae Lee)" },
		],
		["Murtaza Qizilbash | Bhool | Official Audio", { title: "Murtaza Qizilbash | Bhool" }],
		["0 - Dj MexiCaN - Mini Mix.mp3", { title: "0 - Dj MexiCaN - Mini Mix" }],
		[
			"Kerri Chandler & Jerome Sydenham  - You're In My System",
			{ title: "Kerri Chandler & Jerome Sydenham - You're In My System" },
		],
		["Hello (Official Music Video)", { title: "Hello" }],
	])("cleans %j", (raw, expected) => {
		// #when
		const result = cleanUploadTitle(raw);

		// #then
		expect(result).toEqual(expected);
	});

	it.each([
		"Metallica - Enter Sandman (Remastered)",
		"Payphone [TWLGHT & SadBois Archive Edit 02]",
		"Avicii - Levels (VIP 2019)",
		"New Order - Blue Monday",
		"Artist - Title (New Release)",
		"Artist - Title [Single Release]",
		"Artist - Title [EP01]",
		"Artist - Title [HD1080]",
		"Song (Live at Abbey Road Recordings)",
	])("keeps version info and ordinary titles intact: %j", (raw) => {
		// #when
		const result = cleanUploadTitle(raw);

		// #then
		expect(result).toEqual({ title: raw });
	});

	it("recognises the platform's own label field in brackets", () => {
		// #given
		const raw = "Azulo - Black Sky (Zentryc) [FREE DOWNLOAD]";

		// #when
		const result = cleanUploadTitle(raw, { labelName: "Zentryc" });

		// #then
		expect(result).toEqual({ title: "Azulo - Black Sky", label: "Zentryc" });
	});

	it("never returns an empty title for a non-empty upload title", () => {
		// #when
		const result = cleanUploadTitle("[FREE DOWNLOAD]");

		// #then
		expect(result.title).toBe("[FREE DOWNLOAD]");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test:run tests/unit/metadata/clean-upload-title.test.ts`
Expected: FAIL with "Failed to resolve import `$lib/metadata/clean-upload-title`".

- [ ] **Step 3: Implement**

```ts
/**
 * Strips what uploaders put around a track's name — premiere banners,
 * free-download tags, "(Official Audio)", file extensions — and lifts out the
 * two bracketed credits worth keeping: a label and a catalog number.
 *
 * Every pattern here came from a real upload title; see the fixtures in
 * tests/unit/metadata/clean-upload-title.test.ts before widening one. Noise is
 * matched against an NFKC-normalised copy so styled text ("𝐅𝐑𝐄𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃")
 * is recognised, while every kept segment keeps its original characters.
 */

export interface CleanedUploadTitle {
	title: string;
	label?: string;
	catalogNumber?: string;
}

export interface UploadTitleHints {
	/** The platform's own label field (SoundCloud's `label_name`). */
	labelName?: string;
}

const PROMO_WORD = String.raw`(?:world\s+)?(?:premiere|exclusive)\s*\d*`;

const BRACKETED_PROMO_PREFIX = new RegExp(
	String.raw`^[\[(【]\s*${PROMO_WORD}\s*[\])】]\s*(?:[:|]|\/\/?|[-–—])?\s*`,
	"i",
);

/** Requires a separator, so a song that merely starts with "Exclusive" is left alone. */
const SEPARATED_PROMO_PREFIX = new RegExp(
	String.raw`^${PROMO_WORD}\s*(?:[:|]|\/\/?|\s[-–—]\s)\s*`,
	"i",
);

const NOISE_PHRASE = new RegExp(
	`^(?:${[
		String.raw`free\s*(?:download|dl)`,
		String.raw`out\s+now`,
		String.raw`out\s+on\s+\S+`,
		PROMO_WORD,
		String.raw`official(?:\s+(?:hd|4k))?(?:\s+(?:music|lyrics?))?(?:\s+(?:video|audio|visuali[sz]er))?`,
		String.raw`(?:music|lyrics?)\s+video`,
		"lyrics?",
		"video",
		"audio",
		"visuali[sz]er",
		"hq",
		"hd",
		"4k",
		String.raw`\d{3,4}p`,
		"wav",
		"mp3",
		String.raw`320\s*(?:kbps)?`,
	].join("|")})$`,
	"i",
);

/**
 * Square brackets only, and three leading letters: "(VIP 2019)" is a version,
 * "[EP01]" and "[HD1080]" are not catalog numbers, "[RCKLSS014]" is.
 */
const CATALOG_NUMBER = /^[A-Z]{3,}[A-Z0-9]*-?\d{2,}$/;
/** "(Live at Abbey Road Recordings)" is a version, not a label. */
const LABEL_SUFFIX = /^(?!(?:official|live)\b).+\s(?:records|recordings)$/i;
/** "[Monstercat Release]" names a label; "(New Release)" and "[Single Release]" don't. */
const RELEASE_SUFFIX =
	/^(?!(?:official|new|single|album|early|promo)\b)(.+?)\s+release$/i;
const BRACKET_GROUP = /\s*([\[(【])([^()[\]【】]*)[\])】]/g;
const TRAILING_SEGMENT = /\s+(?:\||\/\/?)\s*([^|/]*)$/;
const TRAILING_FREE_DOWNLOAD = /(?:\s*[-–—|/]+\s*|\s+)free\s*(?:download|dl)\s*$/i;
/** Case-sensitive: the all-caps banner is SoundCloud's convention, and "Grand Premiere" is a real title. */
const TRAILING_PREMIERE_BANNER = /\s+PREMIERE$/;
const FILE_EXTENSION = /\.(?:mp3|мп3|wav|flac|m4a|aiff?)$/i;
const DANGLING_SEPARATORS = /^[\s|/:–—-]+|[\s|/:–—-]+$/g;

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function normalizeForMatching(text: string): string {
	return text.normalize("NFKC").trim();
}

function isNoiseSegment(segment: string): boolean {
	const normalized = normalizeForMatching(segment);
	return (
		normalized === "" ||
		NOISE_PHRASE.test(normalized) ||
		/\bpremiere\b/i.test(normalized)
	);
}

function stripPromoPrefix(title: string): string {
	return title
		.replace(BRACKETED_PROMO_PREFIX, "")
		.replace(SEPARATED_PROMO_PREFIX, "");
}

function stripTrailingNoise(title: string): string {
	let current = title;
	for (;;) {
		const segment = current.match(TRAILING_SEGMENT);
		if (segment?.index !== undefined && isNoiseSegment(segment[1] ?? "")) {
			current = current.slice(0, segment.index);
			continue;
		}
		const stripped = current
			.replace(TRAILING_FREE_DOWNLOAD, "")
			.replace(TRAILING_PREMIERE_BANNER, "");
		if (stripped === current) return current;
		current = stripped;
	}
}

function labelFrom(
	text: string,
	labelName: string | undefined,
): string | undefined {
	const hint = labelName?.trim();
	if (hint && text.toLowerCase() === normalizeForMatching(hint).toLowerCase()) {
		return hint;
	}
	if (LABEL_SUFFIX.test(text)) return text;
	return text.match(RELEASE_SUFFIX)?.[1];
}

export function cleanUploadTitle(
	rawTitle: string,
	hints: UploadTitleHints = {},
): CleanedUploadTitle {
	const original = collapseWhitespace(rawTitle);
	const credits: Omit<CleanedUploadTitle, "title"> = {};

	let title = stripPromoPrefix(original).replace(FILE_EXTENSION, "");
	title = stripTrailingNoise(title);
	title = title.replace(
		BRACKET_GROUP,
		(group: string, open: string, inner: string) => {
			const text = normalizeForMatching(inner);
			if (NOISE_PHRASE.test(text)) return "";
			if (open === "[" && CATALOG_NUMBER.test(text)) {
				credits.catalogNumber ??= text;
				return "";
			}
			const label = labelFrom(text, hints.labelName);
			if (label) {
				credits.label ??= label;
				return "";
			}
			return group;
		},
	);
	title = stripTrailingNoise(title);
	title = collapseWhitespace(title).replace(DANGLING_SEPARATORS, "");

	return { title: title || original, ...credits };
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test:run tests/unit/metadata/clean-upload-title.test.ts`
Expected: PASS. If a `cleans %j` fixture fails, fix the pattern rather than the fixture, because those are real titles. The made-up edge cases in `keeps … intact` can be discussed, but only by adding a real title that argues the other way.

- [ ] **Step 5: Lint and commit**

```bash
bun run lint
git add src/lib/metadata/clean-upload-title.ts tests/unit/metadata/clean-upload-title.test.ts
git commit -m "feat(metadata): strip premiere/free-download/official-audio noise from upload titles"
```

### Task 4: Resolve track identity and use it for YouTube

**Files:**
- Create: `src/lib/metadata/resolve-track-identity.ts`
- Modify: `src/lib/youtube-metadata.ts:66-78`
- Test: `tests/unit/metadata/resolve-track-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";

describe("resolveTrackIdentity()", () => {
	it("takes the artist from the title when it names one", () => {
		// #given — a premiere channel upload credited to the channel itself
		const input = {
			rawTitle: "Premiere | THISO - Back The F Up",
			uploader: "TTC Records",
			creditedArtist: "The Techno Community",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({ artist: "THISO", trackTitle: "Back The F Up" });
	});

	it("prefers the title's artist over a platform credit that names the label", () => {
		// #given
		const input = {
			rawTitle: "Prospa, Cloonee & Sybil - Free Your Mind",
			uploader: "CircoLoco Records",
			creditedArtist: "CircoLoco Records",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({
			artist: "Prospa, Cloonee & Sybil",
			trackTitle: "Free Your Mind",
		});
	});

	it("falls back to the platform credit when the title names no artist", () => {
		// #given — uploaded by the label, credited to the performer
		const input = {
			rawTitle: "Go Down Deh (feat. Shaggy And Sean Paul)",
			uploader: "VP RECORDS",
			creditedArtist: "Spice",
		};

		// #when
		const identity = resolveTrackIdentity(input);

		// #then
		expect(identity).toEqual({
			artist: "Spice",
			trackTitle: "Go Down Deh (feat. Shaggy And Sean Paul)",
		});
	});

	it("falls back to the uploader when nothing else names an artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Funky Fresh [Free Download]",
			uploader: "Sluggy Beats",
		});

		// #then
		expect(identity).toEqual({ artist: "Sluggy Beats", trackTitle: "Funky Fresh" });
	});

	it("swaps a reversed title whose right side is the credited artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Dracula - Tame Impala (JENNIE Remix)",
			uploader: "ANNA",
			creditedArtist: "Tame Impala, JENNIE",
		});

		// #then
		expect(identity).toEqual({
			artist: "Tame Impala",
			trackTitle: "Dracula (JENNIE Remix)",
		});
	});

	it("swaps a reversed title whose right side is the uploader's name", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "BIG BOOTIE MIX, VOL. 27: Chicago Concert Premiere - Two Friends",
			uploader: "Two Friends Mixes",
		});

		// #then
		expect(identity).toEqual({
			artist: "Two Friends",
			trackTitle: "BIG BOOTIE MIX, VOL. 27: Chicago Concert Premiere",
		});
	});

	it("swaps a YouTube 'Title - Artist' upload from the artist's channel", () => {
		// #when
		const identity = resolveTrackIdentity({ rawTitle: "Hello - Adele", uploader: "AdeleVEVO" });

		// #then
		expect(identity).toEqual({ artist: "Adele", trackTitle: "Hello" });
	});

	it("does not swap when the left side is also a known artist", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "The Chainsmokers - Coldplay",
			uploader: "Coldplay",
			creditedArtist: "The Chainsmokers",
		});

		// #then
		expect(identity).toEqual({ artist: "The Chainsmokers", trackTitle: "Coldplay" });
	});

	it("keeps a hyphenated artist whole (D1)", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Jay-Z - Empire State Of Mind ft. Alicia Keys",
			uploader: "JayZVEVO",
		});

		// #then
		expect(identity).toEqual({
			artist: "Jay-Z",
			trackTitle: "Empire State Of Mind ft. Alicia Keys",
		});
	});

	it("cleans a title that has no separator and names the channel's artist (D3, D5)", () => {
		// #when
		const identity = resolveTrackIdentity({
			rawTitle: "Hello (Official Music Video)",
			uploader: "AdeleVEVO",
		});

		// #then
		expect(identity).toEqual({ artist: "Adele", trackTitle: "Hello" });
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test:run tests/unit/metadata/resolve-track-identity.test.ts`
Expected: FAIL (the module is not found).

- [ ] **Step 3: Implement `src/lib/metadata/resolve-track-identity.ts`**

```ts
import { parseArtistAndTitle, sanitizeUploaderAsArtist } from "$lib/video-utils";
import { cleanUploadTitle } from "./clean-upload-title";

export interface TrackIdentityInput {
	rawTitle: string;
	uploader: string;
	/** An artist credit supplied by the platform (SoundCloud's `publisher_metadata.artist`). */
	creditedArtist?: string;
	labelName?: string;
}

export interface TrackIdentity {
	artist: string;
	trackTitle: string;
}

const ARTIST_LIST_SEPARATOR = /\s*(?:,|&|\+|\sx\s|\bfeat\.?\s|\bft\.?\s)\s*/i;
const CHANNEL_SUFFIX = /\s*(?:vevo|mixes|music|official|records|tv)$/i;
const TRAILING_VERSION = /(?:\s*[([][^()[\]]*[)\]])+$/;

function normalizeName(name: string): string {
	return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function knownArtistNames(...names: (string | undefined)[]): Set<string> {
	const variants = names.flatMap((name) =>
		name
			? [...name.split(ARTIST_LIST_SEPARATOR), name.replace(CHANNEL_SUFFIX, "")]
			: [],
	);
	return new Set(variants.map(normalizeName).filter(Boolean));
}

/**
 * "Title - Artist" uploads are common on SoundCloud and not rare on YouTube.
 * A swap needs the right side to *be* a known name and the left side not to
 * be one, so an ordinary "Artist - Title" is never flipped by coincidence.
 */
function swapIfReversed(
	artist: string,
	title: string,
	known: Set<string>,
): TrackIdentity | null {
	const version = title.match(TRAILING_VERSION)?.[0] ?? "";
	const titleCore = title.slice(0, title.length - version.length).trim();
	if (!known.has(normalizeName(titleCore)) || known.has(normalizeName(artist))) {
		return null;
	}
	return { artist: titleCore, trackTitle: `${artist}${version}`.trim() };
}

/**
 * Precedence — title, then platform credit, then uploader — is measured, not
 * assumed: across 152 real SoundCloud uploads the platform credit named the
 * label, a repost channel, an editor or a truncated name often enough, even on
 * distributor uploads with an ISRC, while an artist in the title was right.
 */
export function resolveTrackIdentity({
	rawTitle,
	uploader,
	creditedArtist,
	labelName,
}: TrackIdentityInput): TrackIdentity {
	const { title: cleaned } = cleanUploadTitle(rawTitle, { labelName });
	const parsed = parseArtistAndTitle(cleaned);
	const uploaderArtist = sanitizeUploaderAsArtist(uploader);
	const credited = creditedArtist?.trim() || undefined;

	if (parsed.artist) {
		const swapped = swapIfReversed(
			parsed.artist,
			parsed.title,
			knownArtistNames(credited, uploaderArtist),
		);
		return swapped ?? { artist: parsed.artist, trackTitle: parsed.title };
	}

	return {
		artist: credited || uploaderArtist,
		trackTitle: parsed.title || cleaned,
	};
}
```

- [ ] **Step 4: Switch YouTube over.** In `src/lib/youtube-metadata.ts`:
  1. Replace the import on line 2 with `import { resolveTrackIdentity } from "./metadata/resolve-track-identity";`.
  2. Replace lines 66–78 with:

```ts
		const videoTitle = oembed.title ?? "";
		const uploader = oembed.author_name ?? "";
		const { artist, trackTitle } = resolveTrackIdentity({
			rawTitle: videoTitle,
			uploader,
		});

		return {
			videoTitle,
			artist,
			trackTitle,
			uploader,
			thumbnailUrl:
				oembed.thumbnail_url ??
				`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
		};
```

- [ ] **Step 5: Run the tests**

Run: `bun run test:run tests/unit/metadata tests/unit/youtube-metadata.test.ts tests/unit/video-utils.test.ts`
Expected: PASS, including the Task 1 characterization table.

`tests/unit/youtube-metadata.test.ts` mocks `parseArtistAndTitle` and `sanitizeUploaderAsArtist`. Because `resolve-track-identity.ts` imports them from the same module, the mocks still drive the result.

If a test there asserts the argument that `parseArtistAndTitle` was called with, and its title contains noise that cleanup now removes, stop and ask. It would be a deliberate change missing from the table.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metadata/resolve-track-identity.ts src/lib/youtube-metadata.ts tests/unit/metadata/resolve-track-identity.test.ts
git commit -m "feat(metadata): resolve artist/title from cleaned titles, credits and uploader"
```

### Task 5: Credits (remixer and label)

**Files:**
- Create: `src/lib/metadata/credits.ts`
- Test: `tests/unit/metadata/credits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractRemixer, resolveLabel } from "$lib/metadata/credits";

describe("extractRemixer()", () => {
	it.each([
		["Don't Let Me Down (W&W Remix)", "W&W"],
		["Don't Let Me Down ft. Daya (Hipst3r Edit)", "Hipst3r"],
		["A LITTLE BIT (Bassurgence Flip)", "Bassurgence"],
		["Don't Stop The Music (Ed Marquis Bootleg)", "Ed Marquis"],
		["Something Just Like This (Alesso Remix)", "Alesso"],
		["Spring (DROPIXX & ARAYSEN Remix)", "DROPIXX & ARAYSEN"],
	])("finds the remixer in %j", (title, expected) => {
		// #when
		const remixer = extractRemixer(title);

		// #then
		expect(remixer).toBe(expected);
	});

	it.each([
		"Trapped (Radio Edit)",
		"On My Knees (Original Mix)",
		"Choosin Texas (Remix Feat. Don Toliver)",
		"Levels",
		"Talking Body (Trap Remix)",
		"Anthem (Festival Edit)",
		"Song (Deluxe Edit)",
		"Song (Acapella Edit)",
		"Song (A Cappella Edit)",
		"Song (Super Clean Edit)",
	])("names nobody for %j", (title) => {
		// #when
		const remixer = extractRemixer(title);

		// #then
		expect(remixer).toBeUndefined();
	});
});

describe("resolveLabel()", () => {
	it("prefers the platform's label field", () => {
		// #when
		const label = resolveLabel({
			platformLabel: "Warner Records",
			titleLabel: "Other Records",
			uploader: "VP RECORDS",
			artist: "Mac Miller",
		});

		// #then
		expect(label).toBe("Warner Records");
	});

	it("falls back to a label named in the title", () => {
		// #when
		const label = resolveLabel({ titleLabel: "Reboot Records", uploader: "MERCILESS", artist: "blk." });

		// #then
		expect(label).toBe("Reboot Records");
	});

	it("treats a label-named uploader as the label when it isn't the artist", () => {
		// #when
		const label = resolveLabel({ uploader: "Decaydance Records", artist: "Gym Class Heroes" });

		// #then
		expect(label).toBe("Decaydance Records");
	});

	it("does not treat an ordinary channel as a label", () => {
		// #when
		const label = resolveLabel({ uploader: "Soul Music", artist: "Miyagi" });

		// #then
		expect(label).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test:run tests/unit/metadata/credits.test.ts`
Expected: FAIL (the module is not found).

- [ ] **Step 3: Implement `src/lib/metadata/credits.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `bun run test:run tests/unit/metadata/credits.test.ts`
Expected: PASS. If `bun run check` rejects `Array.prototype.at`, use `names[names.length - 1]` instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metadata/credits.ts tests/unit/metadata/credits.test.ts
git commit -m "feat(metadata): extract remixer and resolve record label"
```

### Task 6: ID3 enrichment (D6)

**Files:**
- Modify: `src/lib/video-metadata.ts` (the `VideoDetails`, `YtDlpJson`, `fetchVideoDetailsOnce` return, `ID3TagInput`, `ID3Tags` and `buildID3Tags`)
- Modify: `src/lib/download-pipeline/finalize-mp3.ts:19-30` and `:115-121`
- Modify: `src/routes/api/download-stream/+server.ts` (around line 126, the oEmbed block, and the `finalizeMp3` call at lines 274–285)
- Test: create `tests/unit/metadata/id3-enrichment.test.ts`; append to `tests/unit/video-metadata.test.ts` and `tests/unit/services/finalize-mp3.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/metadata/id3-enrichment.test.ts`:

```ts
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildID3Tags } from "$lib/video-metadata";

const require = createRequire(import.meta.url);

const BASE = {
	trackTitle: "Don't Let Me Down (W&W Remix)",
	videoTitle: "PREMIERE // The Chainsmokers - Don't Let Me Down (W&W Remix) [RCKLSS014]",
	artist: "The Chainsmokers",
	image: null,
};

describe("buildID3Tags() credits", () => {
	it("writes label, ISRC, remixer, catalog number and source URL", () => {
		// #when
		const tags = buildID3Tags({
			...BASE,
			details: { label: "Darkroom/Interscope Records", isrc: "USUM71900764" },
			sourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});

		// #then
		expect(tags).toMatchObject({
			publisher: "Darkroom/Interscope Records",
			ISRC: "USUM71900764",
			remixArtist: "W&W",
			userDefinedText: [{ description: "CATALOGNUMBER", value: "RCKLSS014" }],
			audioSourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});
	});

	it("takes the label from the upload title when the platform gives none", () => {
		// #when
		const tags = buildID3Tags({
			...BASE,
			videoTitle: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			details: null,
		});

		// #then
		expect(tags.publisher).toBe("Reboot Records");
	});

	it("adds no credit frames when nothing names them", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Hello",
			videoTitle: "Adele - Hello",
			artist: "Adele",
			details: null,
			image: null,
		});

		// #then
		expect(Object.keys(tags).sort()).toEqual(
			["album", "artist", "composer", "performerInfo", "title"].sort(),
		);
	});

	it("round-trips every new frame through node-id3", () => {
		// #given
		const NodeID3 = require("node-id3");
		const tags = buildID3Tags({
			...BASE,
			details: { label: "Reboot Records", isrc: "USUM71900764" },
			sourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});

		// #when
		const read = NodeID3.read(NodeID3.write(tags, Buffer.alloc(0)));

		// #then
		expect(read).toMatchObject({
			publisher: "Reboot Records",
			ISRC: "USUM71900764",
			remixArtist: "W&W",
			audioSourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
			userDefinedText: [{ description: "CATALOGNUMBER", value: "RCKLSS014" }],
		});
	});
});
```

Append this to the `describe("fetchVideoDetails", …)` block in `tests/unit/video-metadata.test.ts`, which already has `mockExecFileJson`:

```ts
	it("takes the label from a YouTube Music ℗ line", async () => {
		// #given
		mockExecFileJson({
			duration: 194,
			description:
				"Provided to YouTube by Interscope\n\nbad guy · Billie Eilish\n\n℗ 2019 Darkroom/Interscope Records\n\nReleased on: 2019-03-29",
		});

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.label).toBe("Darkroom/Interscope Records");
	});

	it("falls back to the 'Provided to YouTube by' distributor", async () => {
		// #given
		mockExecFileJson({ duration: 194, description: "Provided to YouTube by Believe SAS\n\nTrack · Artist" });

		// #when
		const details = await fetchVideoDetails("https://youtu.be/abc");

		// #then
		expect(details?.label).toBe("Believe SAS");
	});
```

Append this to `tests/unit/services/finalize-mp3.test.ts`. It uses the file's existing `createTempMp3`, `finalizeInputFor` and mocked `buildID3Tags`, so first add `import { buildID3Tags } from "$lib/video-metadata";` beside the other imports:

```ts
describe("finalizeMp3() tag inputs", () => {
	it("passes the uploader and source URL through to the ID3 tags", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			uploader: "Decaydance Records",
			sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		});

		// #then
		expect(buildID3Tags).toHaveBeenCalledWith(
			expect.objectContaining({
				uploader: "Decaydance Records",
				sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			}),
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test:run tests/unit/metadata/id3-enrichment.test.ts tests/unit/video-metadata.test.ts tests/unit/services/finalize-mp3.test.ts`
Expected: FAIL. The new frames are missing, `details.label` is undefined, and `uploader` is not passed through.

- [ ] **Step 3: Implement in `src/lib/video-metadata.ts`**

1. Add these imports after the existing `./retry` import:

```ts
import { cleanUploadTitle } from "./metadata/clean-upload-title";
import { extractRemixer, resolveLabel } from "./metadata/credits";
```

2. Add to `VideoDetails`:

```ts
	/** Record label: SoundCloud's `label_name`, or a YouTube Music description's ℗ line. */
	label?: string;
	isrc?: string;
```

3. Add `description?: string;` to `YtDlpJson`.

4. Add these above `fetchVideoDetailsOnce`:

```ts
const PHONOGRAM_LINE = /^℗\s*(?:\d{4}\s+)?(.+)$/m;
const PROVIDED_TO_YOUTUBE_BY = /^Provided to YouTube by (.+)$/m;

/**
 * YouTube Music's auto-generated ("… - Topic") uploads carry the label in the
 * description. The ℗ line names the imprint and "Provided to YouTube by" the
 * distributor, so the ℗ line wins.
 */
function labelFromDescription(description: string | undefined): string | undefined {
	if (!description) return undefined;
	const label =
		description.match(PHONOGRAM_LINE)?.[1] ??
		description.match(PROVIDED_TO_YOUTUBE_BY)?.[1];
	return label?.trim() || undefined;
}
```

5. In `fetchVideoDetailsOnce`'s return object, add `label: labelFromDescription(info.description),`.

6. Add to `ID3TagInput`:

```ts
	uploader?: string;
	/** Canonical URL of the upload, written to WOAS. */
	sourceUrl?: string;
```

7. Add to `ID3Tags`:

```ts
	publisher?: string;
	ISRC?: string;
	remixArtist?: string;
	audioSourceUrl?: string;
	userDefinedText?: { description: string; value: string }[];
```

8. In `buildID3Tags`, destructure `uploader, sourceUrl` as well. Then insert this after the existing `bpm` block and before `if (image)`. `details.uploader`, which PR #134 added, covers downloads whose oEmbed lookup failed.

```ts
	const titleCredits = cleanUploadTitle(videoTitle, {
		labelName: details?.label,
	});
	const label = resolveLabel({
		platformLabel: details?.label,
		titleLabel: titleCredits.label,
		uploader: uploader || details?.uploader,
		artist: finalArtist,
	});
	if (label) tags.publisher = label;
	if (details?.isrc) tags.ISRC = details.isrc;
	const remixer = extractRemixer(tags.title);
	if (remixer) tags.remixArtist = remixer;
	if (titleCredits.catalogNumber) {
		tags.userDefinedText = [
			{ description: "CATALOGNUMBER", value: titleCredits.catalogNumber },
		];
	}
	if (sourceUrl) tags.audioSourceUrl = sourceUrl;
```

- [ ] **Step 4: Plumb the new inputs through**

In `src/lib/download-pipeline/finalize-mp3.ts`:
- Add `uploader?: string;` and `sourceUrl?: string;` to `FinalizeMp3Input`.
- Destructure both in `finalizeMp3`.
- Pass `uploader, sourceUrl` into the `buildID3Tags({...})` call.

In `src/routes/api/download-stream/+server.ts`, keep the oEmbed uploader. Since PR #134, `titleState` no longer carries it; the route only logs `metadata.uploader`.
1. Next to `const titleState = {…}` (around line 126), add `let uploader = "";`.
2. In the oEmbed success block, after `titleState.trackTitle = metadata.trackTitle;`, add `uploader = metadata.uploader;`.
3. Add these to the `finalizeMp3({...})` call (around lines 274–285):

```ts
					uploader,
					sourceUrl: normalizedUrl,
```

`tests/unit/api/download-stream-title-fallback.test.ts`, added by PR #134, asserts on `finalizeMp3`'s input with `objectContaining`, so the extra fields don't affect it.

- [ ] **Step 5: Run everything**

```bash
bun run test:run
bun run check
bun run lint
```

Expected: all green. Existing `buildID3Tags` tests keep passing because their plain titles produce no credit frames.

- [ ] **Step 6: Commit**

```bash
git add src/lib/video-metadata.ts src/lib/download-pipeline/finalize-mp3.ts src/routes/api/download-stream/+server.ts tests/unit/metadata/id3-enrichment.test.ts tests/unit/video-metadata.test.ts tests/unit/services/finalize-mp3.test.ts
git commit -m "feat(id3): write label, ISRC, remixer, catalog number and source URL"
```

### Task 7: Phase 1 verification and PR

- [ ] **Step 1: Audit test edits.** The expect audit (Guardrail rule 2) should print nothing, since Phase 1 changes no existing assertion.
- [ ] **Step 2: Run the project's pre-commit agents** (the `.claude/CLAUDE.md` "Before Committing" rule): `code-simplifier:code-simplifier` on the diff, then `security-auditor`. Apply the fixes that hold up, re-run `bun run test:run`, and commit.
- [ ] **Step 3: Check against a real YouTube video.** Start the dev server through the preview tool (`preview_start`, not Bash). Download `https://www.youtube.com/watch?v=jNQXAC9IVRw` and inspect its tags:

```bash
node -e 'const t=require("node-id3").read(process.argv[1]); delete t.image; delete t.raw; console.log(t)' "$HOME/Downloads/<downloaded file>.mp3"
```

Expected: the same title, artist and album as `main` produces, plus `audioSourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw"`.

- [ ] **Step 4: Open the PR.** Push `feat/upload-title-metadata` and open a PR using `.github/PULL_REQUEST_TEMPLATE.md`. The template has no "Behavior changes" section, so add one under Description and list D1–D6 there. Put Task 1's baseline test count and the final count under "How to test". Once CI and the PR environment are green, ask the human to merge it promptly, because the PR environment is billed while it's open. The human merges.

---

## Phase 2: SoundCloud (`feat/soundcloud-support`)

**Step 0 (the controlling session does this; there's no checkbox): create a fresh worktree from updated `main`.** Each feature gets its own worktree (`~/.claude/rules/worktrees.md`). Don't create it by calling `EnterWorktree` with a `name`, for three reasons:
  - It refuses to create a worktree while the session is already inside one.
  - `worktree.baseRef: "head"` would branch from Phase 1's local HEAD instead of `main`. After a squash merge, that carries duplicate commits.
  - It picks its own branch name.

  Once Phase 1 has merged, create the worktree with git, from the main checkout's root:

```bash
git fetch origin
ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
git -C "$ROOT" worktree add .claude/worktrees/soundcloud-support -b feat/soundcloud-support origin/main
```

  Then call `EnterWorktree` with `path: "/Users/jzs/GIT/dub-rip/.claude/worktrees/soundcloud-support"`. Switching into an existing worktree by `path` is allowed from inside another one. Finish with `bun install && bun run test:run` → green.

### Task 8: Extract the single-flight cache

**Files:**
- Create: `src/lib/single-flight-cache.ts`
- Modify: `src/lib/video-details-cache.ts` (its public API is unchanged)
- Test: `tests/unit/services/single-flight-cache.test.ts`

- [ ] **Step 1: Write the failing test.** The existing `video-details-cache.test.ts` already covers hit, miss, dedupe, TTL and not caching `null`. These two tests cover what SoundCloud needs on top.

```ts
import { describe, expect, it, vi } from "vitest";
import { createSingleFlightCache } from "$lib/single-flight-cache";

describe("createSingleFlightCache()", () => {
	it("does not cache a rejection, so the next call fetches again", async () => {
		// #given
		const cache = createSingleFlightCache<string>();
		const fetch = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("ok");

		// #when
		await cache.get("k", fetch, 60_000).catch(() => {});
		const second = await cache.get("k", fetch, 60_000);

		// #then
		expect(second).toBe("ok");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps keys independent", async () => {
		// #given
		const cache = createSingleFlightCache<string>();

		// #when
		const [a, b] = await Promise.all([
			cache.get("a", async () => "A", 60_000),
			cache.get("b", async () => "B", 60_000),
		]);

		// #then
		expect([a, b]).toEqual(["A", "B"]);
	});
});
```

- [ ] **Step 2: Run it to see it fail** (the module is not found).

- [ ] **Step 3: Implement `src/lib/single-flight-cache.ts`**

```ts
interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface SingleFlightCache<T> {
	get(key: string, fetch: () => Promise<T>, ttlMs: number): Promise<T>;
	clear(): void;
}

/**
 * TTL cache where concurrent callers for one key share a single in-flight
 * fetch. Nullish results and rejections are never cached, so a failed lookup
 * is retried on the very next request.
 */
export function createSingleFlightCache<T>(): SingleFlightCache<T> {
	const entries = new Map<string, CacheEntry<NonNullable<T>>>();
	const inFlight = new Map<string, Promise<T>>();

	return {
		get(key, fetch, ttlMs) {
			const cached = entries.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				return Promise.resolve(cached.value);
			}

			const existing = inFlight.get(key);
			if (existing) return existing;

			const promise = fetch()
				.then((value) => {
					if (value != null) {
						entries.set(key, { value, expiresAt: Date.now() + ttlMs });
					}
					return value;
				})
				.finally(() => {
					inFlight.delete(key);
				});

			inFlight.set(key, promise);
			return promise;
		},
		clear() {
			entries.clear();
			inFlight.clear();
		},
	};
}
```

- [ ] **Step 4: Rewrite `src/lib/video-details-cache.ts` on top of it.** Keep the existing docstring on `getVideoDetails`, and change "keyed by YouTube videoId" to "keyed by videoId".

```ts
import { createSingleFlightCache } from "./single-flight-cache";
import { fetchVideoDetails, type VideoDetails } from "./video-metadata";

export const DEFAULT_VIDEO_DETAILS_TTL_MS = 10 * 60 * 1000;

const cache = createSingleFlightCache<VideoDetails | null>();

export interface GetVideoDetailsOptions {
	ttlMs?: number;
	timeout?: number;
}

export function getVideoDetails(
	videoId: string,
	videoUrl: string,
	options: GetVideoDetailsOptions = {},
): Promise<VideoDetails | null> {
	return cache.get(
		videoId,
		() => fetchVideoDetails(videoUrl, options.timeout),
		options.ttlMs ?? DEFAULT_VIDEO_DETAILS_TTL_MS,
	);
}

export function clearVideoDetailsCache(): void {
	cache.clear();
}
```

- [ ] **Step 5: Run the tests.** `bun run test:run tests/unit/services/single-flight-cache.test.ts tests/unit/services/video-details-cache.test.ts` → PASS, with no edits to the existing cache tests.
- [ ] **Step 6: Commit** `refactor: extract single-flight TTL cache from video-details-cache`.

### Task 9: SoundCloud URL parsing

**Files:**
- Create: `src/lib/soundcloud/soundcloud-url.ts`
- Test: `tests/unit/soundcloud/soundcloud-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
	parseSoundCloudShortLinkCode,
	parseSoundCloudTrackUrl,
} from "$lib/soundcloud/soundcloud-url";

describe("parseSoundCloudTrackUrl()", () => {
	it.each([
		[
			"https://soundcloud.com/wandw/the-chainsmokers-ft-daya-dont-let-me-down-ww-remix-1",
			"wandw/the-chainsmokers-ft-daya-dont-let-me-down-ww-remix-1",
		],
		[
			"https://soundcloud.com/the-concept-band/goldrushed-mastered?in=the-concept-band/sets/the-royal-concept-ep",
			"the-concept-band/goldrushed-mastered",
		],
		["https://m.soundcloud.com/billieeilish/bad-guy", "billieeilish/bad-guy"],
		["soundcloud.com/billieeilish/bad-guy", "billieeilish/bad-guy"],
		["https://www.soundcloud.com/BillieEilish/Bad-Guy/", "billieeilish/bad-guy"],
		[
			"https://soundcloud.com/ilaytsa/crashout?si=34a274925508434c9b3a072edf87967b&utm_source=clipboard",
			"ilaytsa/crashout",
		],
	])("accepts %j", (input, id) => {
		// #when
		const ref = parseSoundCloudTrackUrl(input);

		// #then
		expect(ref).toEqual({ id, canonicalUrl: `https://soundcloud.com/${id}` });
	});

	it("keeps a private share link's secret token, case intact", () => {
		// #when
		const ref = parseSoundCloudTrackUrl(
			"https://soundcloud.com/jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
		);

		// #then
		expect(ref).toEqual({
			id: "jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
			canonicalUrl: "https://soundcloud.com/jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp",
		});
	});

	it.each([
		"https://soundcloud.com/billieeilish",
		"https://soundcloud.com/billieeilish/sets/when-we-all-fall-asleep",
		"https://soundcloud.com/billieeilish/likes",
		"https://soundcloud.com/discover/sets/charts-top:all-music",
		"https://soundcloud.com/search?q=bad%20guy",
		"https://soundcloud.com/you/likes",
		"https://soundcloud.com/billieeilish/bad-guy/comments",
		"https://soundcloud.com.evil.example/billieeilish/bad-guy",
		"https://evil.example/billieeilish/bad-guy",
		"ftp://soundcloud.com/billieeilish/bad-guy",
		"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
		"not a url",
		"",
	])("rejects %j", (input) => {
		// #when
		const ref = parseSoundCloudTrackUrl(input);

		// #then
		expect(ref).toBeNull();
	});
});

describe("parseSoundCloudShortLinkCode()", () => {
	it("extracts the code from an on.soundcloud.com share link", () => {
		// #when
		const code = parseSoundCloudShortLinkCode("https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9");

		// #then
		expect(code).toBe("2iQZMwo9IQ8wLY3vf9");
	});

	it.each([
		"https://soundcloud.com/billieeilish/bad-guy",
		"https://on.soundcloud.com/a/b",
		"https://on.soundcloud.com/",
	])("rejects %j", (input) => {
		// #when
		const code = parseSoundCloudShortLinkCode(input);

		// #then
		expect(code).toBeNull();
	});
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Implement `src/lib/soundcloud/soundcloud-url.ts`**

```ts
/**
 * Browser-safe on purpose: the page imports this (through media-link.ts) to
 * decide whether Download is enabled, so it must not pull in server code.
 */

export interface SoundCloudTrackRef {
	/** `user/slug`, lowercased, plus `/s-<token>` for a private share link (token case kept). */
	id: string;
	canonicalUrl: string;
}

const TRACK_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);
const SHORT_LINK_HOST = "on.soundcloud.com";
const PERMALINK_SEGMENT = /^[a-z0-9_-]+$/i;
const SECRET_TOKEN_SEGMENT = /^s-[a-z0-9]+$/i;
const SHORT_LINK_CODE = /^[a-z0-9]+$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** First path segments that are site pages, not user profiles. */
const RESERVED_USER_SEGMENTS = new Set([
	"charts",
	"discover",
	"feed",
	"jobs",
	"messages",
	"mobile",
	"notifications",
	"pages",
	"people",
	"search",
	"settings",
	"signin",
	"stations",
	"stream",
	"tags",
	"terms-of-use",
	"upload",
	"you",
]);

/** Second path segments that are a profile's sub-pages, not a track. */
const RESERVED_TRACK_SEGMENTS = new Set([
	"albums",
	"comments",
	"followers",
	"following",
	"likes",
	"playlists",
	"popular-tracks",
	"reposts",
	"sets",
	"spotlight",
	"stations",
	"toptracks",
	"tracks",
]);

function toHttpUrl(input: string): URL | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
		return url.protocol === "https:" || url.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}

function pathSegments(url: URL): string[] {
	return url.pathname.split("/").filter(Boolean);
}

export function parseSoundCloudTrackUrl(input: string): SoundCloudTrackRef | null {
	const url = toHttpUrl(input);
	if (!url || !TRACK_HOSTS.has(url.hostname.toLowerCase())) return null;

	const segments = pathSegments(url);
	if (segments.length < 2 || segments.length > 3) return null;
	const [user = "", slug = "", secret] = segments;

	if (!PERMALINK_SEGMENT.test(user) || !PERMALINK_SEGMENT.test(slug)) return null;
	if (RESERVED_USER_SEGMENTS.has(user.toLowerCase())) return null;
	if (RESERVED_TRACK_SEGMENTS.has(slug.toLowerCase())) return null;
	if (secret !== undefined && !SECRET_TOKEN_SEGMENT.test(secret)) return null;

	const id = [`${user}/${slug}`.toLowerCase(), secret].filter(Boolean).join("/");
	return { id, canonicalUrl: `https://soundcloud.com/${id}` };
}

export function parseSoundCloudShortLinkCode(input: string): string | null {
	const url = toHttpUrl(input);
	if (!url || url.hostname.toLowerCase() !== SHORT_LINK_HOST) return null;
	const segments = pathSegments(url);
	const code = segments[0];
	return segments.length === 1 && code && SHORT_LINK_CODE.test(code) ? code : null;
}
```

- [ ] **Step 4: Run the test** → PASS.
- [ ] **Step 5: Commit** `feat(soundcloud): parse and canonicalize SoundCloud track and share links`.

### Task 10: `MediaLink`, and short-link resolution

**Files:**
- Create: `src/lib/media-link.ts`, `src/lib/resolve-media-link.ts`
- Test: `tests/unit/media-link.test.ts`, `tests/unit/soundcloud/resolve-media-link.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/media-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMediaLink } from "$lib/media-link";

describe("parseMediaLink()", () => {
	it("parses a YouTube link to its canonical watch URL", () => {
		// #when
		const link = parseMediaLink("https://youtu.be/dQw4w9WgXcQ?t=42");

		// #then
		expect(link).toEqual({
			kind: "youtube",
			id: "dQw4w9WgXcQ",
			canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		});
	});

	it("parses a SoundCloud track link", () => {
		// #when
		const link = parseMediaLink("https://soundcloud.com/billieeilish/bad-guy?si=abc");

		// #then
		expect(link).toEqual({
			kind: "soundcloud",
			id: "billieeilish/bad-guy",
			canonicalUrl: "https://soundcloud.com/billieeilish/bad-guy",
		});
	});

	it("recognises a SoundCloud share link without resolving it", () => {
		// #when
		const link = parseMediaLink("https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9");

		// #then
		expect(link).toEqual({ kind: "soundcloud-short-link", code: "2iQZMwo9IQ8wLY3vf9" });
	});

	it.each([
		"https://soundcloud.com/billieeilish/sets/album",
		"https://vimeo.com/123456",
		"",
	])("rejects %j", (input) => {
		// #when
		const link = parseMediaLink(input);

		// #then
		expect(link).toBeNull();
	});
});
```

`tests/unit/soundcloud/resolve-media-link.test.ts`:

```ts
import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMediaLink } from "$lib/resolve-media-link";

function redirectTo(location: string | null) {
	return vi.fn(async () => ({
		status: location ? 302 : 404,
		headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
	}));
}

describe("resolveMediaLink()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns a YouTube link without any network request", async () => {
		// #given
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const link = await resolveMediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

		// #then
		expect(link?.kind).toBe("youtube");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("follows a share link's redirect header to the track", async () => {
		// #given
		const fetchMock = redirectTo(
			"https://soundcloud.com/ilaytsa/crashout?si=34a2&utm_source=clipboard",
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const link = await resolveMediaLink("https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9");

		// #then
		expect(link).toEqual({
			kind: "soundcloud",
			id: "ilaytsa/crashout",
			canonicalUrl: "https://soundcloud.com/ilaytsa/crashout",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("rejects a share link that points at a playlist", async () => {
		// #given
		vi.stubGlobal("fetch", redirectTo("https://soundcloud.com/billieeilish/sets/album"));

		// #when
		const link = await resolveMediaLink("https://on.soundcloud.com/abc123");

		// #then
		expect(link).toBeNull();
	});

	it("reports a share-link lookup that throws, and rejects the link", async () => {
		// #given
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));

		// #when
		const link = await resolveMediaLink("https://on.soundcloud.com/abc123");

		// #then
		expect(link).toBeNull();
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ level: "warning" }),
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement `src/lib/media-link.ts`**

```ts
import {
	parseSoundCloudShortLinkCode,
	parseSoundCloudTrackUrl,
} from "$lib/soundcloud/soundcloud-url";
import { buildWatchUrl, extractVideoId } from "$lib/video-utils";

export type MediaLinkKind = "youtube" | "soundcloud";

export interface MediaLink {
	kind: MediaLinkKind;
	/** YouTube video ID, or SoundCloud `user/slug[/s-token]`. */
	id: string;
	canonicalUrl: string;
}

export type ParsedMediaLink =
	| MediaLink
	| { kind: "soundcloud-short-link"; code: string };

export const UNSUPPORTED_LINK_MESSAGE =
	"Paste a YouTube video or SoundCloud track link";

/**
 * Synchronous and browser-safe: the page calls it on every keystroke to
 * enable Download. A share link parses here, but only the server can follow
 * its redirect — see resolveMediaLink.
 */
export function parseMediaLink(input: string): ParsedMediaLink | null {
	const videoId = extractVideoId(input);
	if (videoId) {
		return { kind: "youtube", id: videoId, canonicalUrl: buildWatchUrl(videoId) };
	}
	const track = parseSoundCloudTrackUrl(input);
	if (track) return { kind: "soundcloud", ...track };
	const code = parseSoundCloudShortLinkCode(input);
	return code ? { kind: "soundcloud-short-link", code } : null;
}
```

- [ ] **Step 4: Implement `src/lib/resolve-media-link.ts`**

```ts
import * as Sentry from "@sentry/sveltekit";
import { type MediaLink, parseMediaLink } from "$lib/media-link";
import { parseSoundCloudTrackUrl } from "$lib/soundcloud/soundcloud-url";

const SHORT_LINK_TIMEOUT_MS = 5000;

/**
 * An on.soundcloud.com link is a plain 302 to the track page. Its Location is
 * read rather than followed, so the only request made is to a URL built from
 * a validated code, and wherever it points must itself parse as a track.
 */
async function resolveShortLink(code: string): Promise<MediaLink | null> {
	try {
		const response = await fetch(`https://on.soundcloud.com/${code}`, {
			redirect: "manual",
			signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
		});
		const location = response.headers.get("location");
		const track = location ? parseSoundCloudTrackUrl(location) : null;
		if (!track) {
			Sentry.addBreadcrumb({
				category: "soundcloud",
				level: "info",
				message: "Share link did not resolve to a track",
				data: { code, status: response.status },
			});
			return null;
		}
		return { kind: "soundcloud", ...track };
	} catch (error) {
		Sentry.captureException(error, {
			level: "warning",
			tags: { service: "soundcloud", operation: "resolve-short-link" },
			extra: { code },
		});
		return null;
	}
}

export async function resolveMediaLink(input: string): Promise<MediaLink | null> {
	const parsed = parseMediaLink(input);
	if (!parsed) return null;
	if (parsed.kind === "soundcloud-short-link") return resolveShortLink(parsed.code);
	return parsed;
}
```

- [ ] **Step 5: Run the tests** → PASS.
- [ ] **Step 6: Commit** `feat: parse YouTube and SoundCloud links into one MediaLink`.

### Task 11: Error classification per site

**Files:**
- Modify: `src/lib/yt-dlp-errors.ts` (a new import at line 1, the `ERROR_RULES` declaration at line 44, and lines 122–163)
- Modify: `tests/unit/services/yt-dlp-error-category.test.ts:167` and `:185` (a named fixture edit; see Step 3, item 6)
- Test: `tests/unit/services/yt-dlp-error-soundcloud.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { classifyYtDlpError, isRetryableYtDlpError } from "$lib/yt-dlp-errors";

describe("classifyYtDlpError() for SoundCloud", () => {
	it.each([
		["ERROR: [soundcloud] x: Unable to download JSON metadata: HTTP Error 404: Not Found", "user", false],
		["ERROR: [soundcloud] x: This video is not available from your location due to geo restriction", "user", false],
		["ERROR: [soundcloud] x: HTTP Error 429: Too Many Requests", "transient", false],
		["ERROR: [soundcloud] x: HTTP Error 403: Forbidden", "transient", true],
		["ERROR: [soundcloud] x: The read operation timed out", "transient", true],
	] as const)("classifies %j as %s (retryable: %s)", (message, category, retryable) => {
		// #when
		const classified = classifyYtDlpError(message, "soundcloud");

		// #then
		expect({ category: classified.category, retryable: classified.retryable }).toEqual({
			category,
			retryable,
		});
	});

	it("names SoundCloud, not YouTube, in its messages", () => {
		// #when
		const classified = classifyYtDlpError("ERROR: HTTP Error 403: Forbidden", "soundcloud");

		// #then
		expect(classified.message).toMatch(/SoundCloud/);
	});

	it("leaves a format error unknown so a real SoundCloud format change reaches Sentry", () => {
		// #when
		const classified = classifyYtDlpError(
			"ERROR: [soundcloud] 62986583: Requested format is not available",
			"soundcloud",
		);

		// #then
		expect(classified).toEqual({
			message: "Download failed. Please try a different track.",
			retryable: false,
			category: "unknown",
		});
	});

	it.each([
		"ERROR: [youtube] q9lZ4p5YRkY: Sign in to confirm you’re not a bot.",
		"ERROR: HTTP Error 403: Forbidden",
		"ERROR: something new",
	])("classifies %j for YouTube exactly as before", (message) => {
		// #when
		const explicit = classifyYtDlpError(message, "youtube");
		const defaulted = classifyYtDlpError(message);

		// #then
		expect(explicit).toEqual(defaulted);
		expect(isRetryableYtDlpError(message, "youtube")).toBe(isRetryableYtDlpError(message));
	});
});
```

- [ ] **Step 2: Run it to see it fail** (`"soundcloud"` is ignored, so the 404 comes back `unknown`).

- [ ] **Step 3: Implement.** In `src/lib/yt-dlp-errors.ts`:

1. Add `import type { MediaLinkKind } from "./media-link";` at the top.
2. Rename `ERROR_RULES` to `YOUTUBE_RULES`. Leave its contents byte-identical.
3. Rename `GENERIC_ERROR` to `YOUTUBE_GENERIC_ERROR`.
4. Add:

```ts
const SOUNDCLOUD_REFUSED_MESSAGE =
	"SoundCloud refused the download. Please try again in a few minutes.";

/**
 * SoundCloud has no bot-check, PO-token or SABR failure modes, so none of the
 * YouTube-specific rules apply. "Requested format is not available" is
 * deliberately absent: Go+ previews are refused before yt-dlp ever runs
 * (soundCloudRefusal), so one reaching here is a real format change and
 * belongs in `unknown`, where Sentry sees it.
 */
const SOUNDCLOUD_RULES: ErrorRule[] = [
	{
		pattern: /http error 404|404 not found/,
		message: "This track was removed, or it's private.",
		retryable: false,
		category: "user",
	},
	{
		pattern: /geo restriction|not available from your location|not available in your country/,
		message: "This track isn't available in the region the downloader runs from.",
		retryable: false,
		category: "user",
	},
	{
		pattern: /http error 429|too many requests/,
		message: "SoundCloud is limiting downloads right now. Please try again in a few minutes.",
		retryable: false,
		category: "transient",
	},
	{
		pattern: HTTP_403_PATTERN,
		message: SOUNDCLOUD_REFUSED_MESSAGE,
		retryable: true,
		category: "transient",
	},
	{
		pattern: EMPTY_FILE_PATTERN,
		message: SOUNDCLOUD_REFUSED_MESSAGE,
		retryable: false,
		category: "transient",
	},
	{
		pattern: /timed? ?out|etimedout/,
		message: "The request to SoundCloud timed out. Please try again.",
		retryable: true,
		category: "transient",
	},
	{
		pattern: /econnreset|econnrefused|enotfound|network error|socket hang up|fetch failed/,
		message: "A network error occurred while contacting SoundCloud. Please try again.",
		retryable: true,
		category: "transient",
	},
];

const RULES_BY_SITE: Record<MediaLinkKind, ErrorRule[]> = {
	youtube: YOUTUBE_RULES,
	soundcloud: SOUNDCLOUD_RULES,
};

const GENERIC_ERROR_BY_SITE: Record<MediaLinkKind, ClassifiedYtDlpError> = {
	youtube: YOUTUBE_GENERIC_ERROR,
	soundcloud: {
		message: "Download failed. Please try a different track.",
		retryable: false,
		category: "unknown",
	},
};
```

5. Give all three exported functions a `site: MediaLinkKind = "youtube"` parameter. `classifyYtDlpError` loops over `RULES_BY_SITE[site]` and falls back to `GENERIC_ERROR_BY_SITE[site]`. `parseYtDlpError` and `isRetryableYtDlpError` forward `site`.

6. **A named fixture edit.** `tests/unit/services/yt-dlp-error-category.test.ts:167` calls `userFailures.map(classifyYtDlpError)`, and `:185` calls `transientFailures.map(classifyYtDlpError)`. `.map` passes the array index as the new `site` argument, which fails at runtime (`RULES_BY_SITE[site] is not iterable`) and in `bun run check`. Change both to `.map((message) => classifyYtDlpError(message))`. Neither line is an `expect(` line, so the Task 20 audit stays clean. Don't add a `?? YOUTUBE_RULES` fallback instead: it hides the runtime error but not the type error.

- [ ] **Step 4: Run the tests.** `bun run test:run tests/unit/services` → PASS, including the existing classifier, category and canary tests.
- [ ] **Step 5: Commit** `feat(errors): classify yt-dlp failures per site; YouTube rules unchanged`.

### Task 12: Fetch SoundCloud tracks

**Files:**
- Create: `src/lib/soundcloud/soundcloud-track.ts`
- Test: `tests/unit/soundcloud/soundcloud-track.test.ts`

- [ ] **Step 1: Write the failing test.** The fixture values are real (`billieeilish/bad-guy`, 2026-09-20).

```ts
import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchSoundCloudTrack,
	parseTrackPage,
	SoundCloudTrackError,
} from "$lib/soundcloud/soundcloud-track";

const BAD_GUY_SOUND = {
	title: "bad guy",
	genre: "Alternative",
	label_name: "Darkroom/Interscope Records",
	release_date: "2019-03-29T00:00:00Z",
	display_date: "2019-03-29T00:00:00Z",
	duration: 194134,
	artwork_url: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-large.jpg",
	policy: "MONETIZE",
	user: {
		username: "Billie Eilish",
		avatar_url: "https://i1.sndcdn.com/avatars-V2fT1gZ1s4eokCrM-RnxA3g-large.jpg",
	},
	media: { transcodings: [{ snipped: false }, { snipped: false }] },
	publisher_metadata: {
		artist: "Billie Eilish",
		album_title: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
		isrc: "USUM71900764",
	},
};

function trackPage(sound: Record<string, unknown> | null): string {
	const hydration = [
		{ hydratable: "user", data: {} },
		...(sound ? [{ hydratable: "sound", data: sound }] : []),
	];
	return `<html><body><script>window.__sc_hydration = ${JSON.stringify(hydration)};</script></body></html>`;
}

function response(status: number, body: { text?: string; json?: unknown } = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		text: async () => body.text ?? "",
		json: async () => body.json,
	};
}

describe("parseTrackPage()", () => {
	it("reads every field the tags use", () => {
		// #when
		const result = parseTrackPage(trackPage(BAD_GUY_SOUND));

		// #then
		expect(result).toEqual({
			status: "found",
			track: {
				title: "bad guy",
				uploader: "Billie Eilish",
				creditedArtist: "Billie Eilish",
				albumTitle: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
				isrc: "USUM71900764",
				labelName: "Darkroom/Interscope Records",
				composer: undefined,
				genre: "Alternative",
				releaseDate: "2019-03-29T00:00:00Z",
				durationSeconds: 194,
				artworkUrl: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
				avatarUrl: "https://i1.sndcdn.com/avatars-V2fT1gZ1s4eokCrM-RnxA3g-t500x500.jpg",
				isPreviewOnly: false,
				isGeoBlocked: false,
			},
		});
	});

	it("flags a Go+ preview when every transcoding is snipped", () => {
		// #when
		const result = parseTrackPage(
			trackPage({ ...BAD_GUY_SOUND, media: { transcodings: [{ snipped: true }, { snipped: true }] } }),
		);

		// #then
		expect(result.status === "found" && result.track.isPreviewOnly).toBe(true);
	});

	it("flags a geo-blocked track", () => {
		// #when
		const result = parseTrackPage(trackPage({ ...BAD_GUY_SOUND, policy: "BLOCK" }));

		// #then
		expect(result.status === "found" && result.track.isGeoBlocked).toBe(true);
	});

	it("drops artwork served from anywhere but SoundCloud's CDN", () => {
		// #when
		const result = parseTrackPage(
			trackPage({ ...BAD_GUY_SOUND, artwork_url: "https://evil.example/artworks-x-large.jpg" }),
		);

		// #then
		expect(result.status === "found" && result.track.artworkUrl).toBeUndefined();
	});

	it("reports a page with no track as missing", () => {
		// #when
		const result = parseTrackPage(trackPage(null));

		// #then
		expect(result).toEqual({ status: "missing" });
	});

	it("reports unfamiliar markup as unrecognized", () => {
		// #when
		const result = parseTrackPage("<html><body>new layout</body></html>");

		// #then
		expect(result).toEqual({ status: "unrecognized" });
	});
});

describe("fetchSoundCloudTrack()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the page's track without touching oEmbed", async () => {
		// #given
		const fetchMock = vi.fn(async () => response(200, { text: trackPage(BAD_GUY_SOUND) }));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const track = await fetchSoundCloudTrack("https://soundcloud.com/billieeilish/bad-guy");

		// #then
		expect(track.labelName).toBe("Darkroom/Interscope Records");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("treats missing-on-page plus oEmbed 404 as unavailable, unreported", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes("/oembed") ? response(404) : response(200, { text: trackPage(null) }),
			),
		);

		// #when
		const error = await fetchSoundCloudTrack("https://soundcloud.com/a/gone").catch((e) => e);

		// #then
		expect(error).toBeInstanceOf(SoundCloudTrackError);
		expect(error.isUnavailable).toBe(true);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("falls back to oEmbed and reports once when the page markup is unrecognized", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes("/oembed")
					? response(200, {
							json: {
								title: "bad guy by Billie Eilish",
								author_name: "Billie Eilish",
								thumbnail_url: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
							},
						})
					: response(200, { text: "<html>new layout</html>" }),
			),
		);

		// #when
		const track = await fetchSoundCloudTrack("https://soundcloud.com/billieeilish/bad-guy");

		// #then
		expect(track).toMatchObject({ title: "bad guy", uploader: "Billie Eilish", isPreviewOnly: false });
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it("reports once and throws a non-unavailable error when page and oEmbed both fail", async () => {
		// #given
		vi.stubGlobal("fetch", vi.fn(async () => response(503)));

		// #when
		const error = await fetchSoundCloudTrack("https://soundcloud.com/a/b").catch((e) => e);

		// #then
		expect(error).toBeInstanceOf(SoundCloudTrackError);
		expect(error.isUnavailable).toBe(false);
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Implement `src/lib/soundcloud/soundcloud-track.ts`**

```ts
import * as Sentry from "@sentry/sveltekit";

const DEFAULT_TIMEOUT_MS = 10_000;
const HYDRATION = /window\.__sc_hydration\s*=\s*(\[.*?\]);\s*<\/script>/s;
const IMAGE_SIZE_SUFFIX = /-(?:large|t\d+x\d+|original)(\.\w+)$/;
const SOUNDCLOUD_IMAGE_HOST = /(?:^|\.)sndcdn\.com$/i;

export interface SoundCloudTrack {
	title: string;
	uploader: string;
	creditedArtist?: string;
	albumTitle?: string;
	isrc?: string;
	labelName?: string;
	composer?: string;
	genre?: string;
	/** The release date when the uploader set one, else the upload time (ISO 8601). */
	releaseDate?: string;
	durationSeconds?: number;
	artworkUrl?: string;
	avatarUrl?: string;
	isPreviewOnly: boolean;
	isGeoBlocked: boolean;
}

export class SoundCloudTrackError extends Error {
	constructor(
		message: string,
		public readonly isUnavailable: boolean = false,
	) {
		super(message);
		this.name = "SoundCloudTrackError";
	}
}

export type TrackPageResult =
	| { status: "found"; track: SoundCloudTrack }
	/** Page rendered with no track: deleted, private, or never existed. */
	| { status: "missing" }
	/** SoundCloud changed its markup. */
	| { status: "unrecognized" };

type PageFetchResult = TrackPageResult | { status: "failed"; error: Error };

interface HydratedSound {
	title?: string;
	genre?: string | null;
	label_name?: string | null;
	release_date?: string | null;
	display_date?: string | null;
	duration?: number | null;
	artwork_url?: string | null;
	policy?: string | null;
	user?: { username?: string; avatar_url?: string | null };
	media?: { transcodings?: { snipped?: boolean }[] };
	publisher_metadata?: {
		artist?: string | null;
		album_title?: string | null;
		isrc?: string | null;
		writer_composer?: string | null;
	} | null;
}

interface OEmbedResponse {
	title?: string;
	author_name?: string;
	thumbnail_url?: string;
}

function presentString(value: string | null | undefined): string | undefined {
	return value?.trim() || undefined;
}

export function isSoundCloudImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && SOUNDCLOUD_IMAGE_HOST.test(parsed.hostname);
	} catch {
		return false;
	}
}

/** SoundCloud serves every artwork at 500×500 JPEG; the page links the 100×100 `-large`. */
function coverSizedImageUrl(url: string | null | undefined): string | undefined {
	if (!url || !isSoundCloudImageUrl(url)) return undefined;
	return url.replace(IMAGE_SIZE_SUFFIX, "-t500x500$1");
}

function toTrack(sound: HydratedSound, title: string, uploader: string): SoundCloudTrack {
	const transcodings = sound.media?.transcodings ?? [];
	const publisher = sound.publisher_metadata ?? {};
	return {
		title,
		uploader,
		creditedArtist: presentString(publisher.artist),
		albumTitle: presentString(publisher.album_title),
		isrc: presentString(publisher.isrc),
		labelName: presentString(sound.label_name),
		composer: presentString(publisher.writer_composer),
		genre: presentString(sound.genre),
		releaseDate: presentString(sound.release_date) ?? presentString(sound.display_date),
		durationSeconds:
			typeof sound.duration === "number" && sound.duration > 0
				? Math.round(sound.duration / 1000)
				: undefined,
		artworkUrl: coverSizedImageUrl(sound.artwork_url),
		avatarUrl: coverSizedImageUrl(sound.user?.avatar_url),
		isPreviewOnly:
			sound.policy === "SNIP" ||
			(transcodings.length > 0 && transcodings.every((t) => t.snipped === true)),
		isGeoBlocked: sound.policy === "BLOCK",
	};
}

export function parseTrackPage(html: string): TrackPageResult {
	const json = html.match(HYDRATION)?.[1];
	if (!json) return { status: "unrecognized" };

	let entries: unknown;
	try {
		entries = JSON.parse(json);
	} catch {
		return { status: "unrecognized" };
	}
	if (!Array.isArray(entries)) return { status: "unrecognized" };

	const sound = entries.find(
		(entry): entry is { hydratable: "sound"; data: HydratedSound } =>
			entry?.hydratable === "sound",
	)?.data;
	if (!sound) return { status: "missing" };

	const title = presentString(sound.title);
	const uploader = presentString(sound.user?.username);
	if (!title || !uploader) return { status: "unrecognized" };

	return { status: "found", track: toTrack(sound, title, uploader) };
}

async function fetchTrackPage(canonicalUrl: string, timeout: number): Promise<PageFetchResult> {
	try {
		const response = await fetch(canonicalUrl, { signal: AbortSignal.timeout(timeout) });
		if (response.status === 404) return { status: "missing" };
		if (!response.ok) {
			return {
				status: "failed",
				error: new Error(`SoundCloud track page returned ${response.status}`),
			};
		}
		return parseTrackPage(await response.text());
	} catch (error) {
		return {
			status: "failed",
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

function describePage(page: PageFetchResult): string {
	return page.status === "failed" ? page.error.message : page.status;
}

async function fetchTrackViaOEmbed(
	canonicalUrl: string,
	timeout: number,
	page: PageFetchResult,
): Promise<SoundCloudTrack> {
	try {
		const response = await fetch(
			`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
			{ signal: AbortSignal.timeout(timeout) },
		);
		if (response.status === 403 || response.status === 404) {
			throw new SoundCloudTrackError("Track is unavailable or private", true);
		}
		if (!response.ok) {
			throw new Error(`SoundCloud oEmbed returned ${response.status}`);
		}
		const oembed = (await response.json()) as OEmbedResponse;
		const uploader = oembed.author_name?.trim() ?? "";
		const rawTitle = oembed.title?.trim() ?? "";
		const byline = ` by ${uploader}`;
		return {
			title: uploader && rawTitle.endsWith(byline) ? rawTitle.slice(0, -byline.length) : rawTitle,
			uploader,
			artworkUrl: coverSizedImageUrl(oembed.thumbnail_url),
			isPreviewOnly: false,
			isGeoBlocked: false,
		};
	} catch (error) {
		if (error instanceof SoundCloudTrackError) throw error;
		Sentry.captureException(error, {
			level: "warning",
			tags: { service: "soundcloud-track", operation: "fetch-oembed" },
			extra: { canonicalUrl, page: describePage(page) },
		});
		throw new SoundCloudTrackError("Failed to load track info");
	}
}

/**
 * Page first (it's the only source of label, album, ISRC, release date and
 * the preview flags), oEmbed second. A nonexistent track is a 200 with no
 * `sound` entry, so "missing" is confirmed against oEmbed before it is
 * believed: without that, a SoundCloud markup change would read as "every
 * track is unavailable" and never reach Sentry.
 *
 * Reports at most once per lookup, and never for a track that is genuinely
 * gone (oEmbed 403/404), which is normal operation.
 */
export async function fetchSoundCloudTrack(
	canonicalUrl: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<SoundCloudTrack> {
	const page = await fetchTrackPage(canonicalUrl, timeout);
	if (page.status === "found") return page.track;

	const track = await fetchTrackViaOEmbed(canonicalUrl, timeout, page);
	Sentry.captureException(
		page.status === "failed"
			? page.error
			: new Error(`SoundCloud track page was ${page.status}, but oEmbed found the track`),
		{
			level: "warning",
			tags: { service: "soundcloud-track", operation: "fetch-page" },
			extra: { canonicalUrl },
		},
	);
	return track;
}
```

- [ ] **Step 4: Run the test** → PASS.
- [ ] **Step 5: Commit** `feat(soundcloud): read track metadata from the page with an oEmbed fallback`.

### Task 13: SoundCloud metadata mapping and the track cache

**Files:**
- Create: `src/lib/soundcloud/soundcloud-metadata.ts`, `src/lib/soundcloud/soundcloud-track-cache.ts`
- Test: `tests/unit/soundcloud/soundcloud-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
	SOUNDCLOUD_GEO_BLOCKED_MESSAGE,
	SOUNDCLOUD_PREVIEW_ONLY_MESSAGE,
	soundCloudDetails,
	soundCloudRefusal,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import type { SoundCloudTrack } from "$lib/soundcloud/soundcloud-track";

const BAD_GUY: SoundCloudTrack = {
	title: "bad guy",
	uploader: "Billie Eilish",
	creditedArtist: "Billie Eilish",
	albumTitle: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
	isrc: "USUM71900764",
	labelName: "Darkroom/Interscope Records",
	genre: "Alternative",
	releaseDate: "2019-03-29T00:00:00Z",
	durationSeconds: 194,
	artworkUrl: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
	isPreviewOnly: false,
	isGeoBlocked: false,
};

describe("soundCloudTitleState()", () => {
	it("resolves identity from the title, credit and uploader", () => {
		// #when
		const state = soundCloudTitleState({
			...BAD_GUY,
			title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			uploader: "MERCILESS",
			creditedArtist: "blk.",
		});

		// #then
		expect(state).toEqual({
			videoTitle: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			artist: "blk.",
			trackTitle: "I Cant Fail",
		});
	});
});

describe("soundCloudDetails()", () => {
	it("maps album, year, genre, label, ISRC and duration", () => {
		// #when
		const details = soundCloudDetails(BAD_GUY);

		// #then
		expect(details).toEqual({
			year: 2019,
			genre: "Alternative",
			album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
			composer: undefined,
			duration: 194,
			label: "Darkroom/Interscope Records",
			isrc: "USUM71900764",
		});
	});

	it("never sets track or artist, which would override the resolved identity", () => {
		// #when
		const details = soundCloudDetails(BAD_GUY);

		// #then
		expect(Object.keys(details)).not.toContain("artist");
		expect(Object.keys(details)).not.toContain("track");
	});
});

describe("soundCloudRefusal()", () => {
	it.each([
		[{ isPreviewOnly: true }, SOUNDCLOUD_PREVIEW_ONLY_MESSAGE],
		[{ isGeoBlocked: true }, SOUNDCLOUD_GEO_BLOCKED_MESSAGE],
		[{}, null],
	])("refuses %j with %j", (overrides, expected) => {
		// #when
		const refusal = soundCloudRefusal({ ...BAD_GUY, ...overrides });

		// #then
		expect(refusal).toBe(expected);
	});
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Implement `src/lib/soundcloud/soundcloud-metadata.ts`**

```ts
import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import { resolveTrackIdentity } from "$lib/metadata/resolve-track-identity";
import type { VideoDetails } from "$lib/video-metadata";
import type { SoundCloudTrack } from "./soundcloud-track";

export const SOUNDCLOUD_PREVIEW_ONLY_MESSAGE =
	"This track is a 30-second SoundCloud Go+ preview and can't be downloaded in full.";
export const SOUNDCLOUD_GEO_BLOCKED_MESSAGE =
	"This track isn't available in the region the downloader runs from.";

function yearOf(isoDate: string | undefined): number | undefined {
	const year = Number.parseInt(isoDate?.slice(0, 4) ?? "", 10);
	return year > 1900 ? year : undefined;
}

/** The same shape the route's title state has had since PR #134. The uploader travels separately. */
export function soundCloudTitleState(track: SoundCloudTrack): DownloadTitle {
	const { artist, trackTitle } = resolveTrackIdentity({
		rawTitle: track.title,
		uploader: track.uploader,
		creditedArtist: track.creditedArtist,
		labelName: track.labelName,
	});
	return { videoTitle: track.title, artist, trackTitle };
}

/**
 * Deliberately omits `track` and `artist`: buildID3Tags prefers those over
 * the resolved identity, and SoundCloud's only candidates for them — the raw
 * upload title and `publisher_metadata.artist` — are what
 * resolveTrackIdentity already weighed, and sometimes rejected.
 */
export function soundCloudDetails(track: SoundCloudTrack): VideoDetails {
	return {
		year: yearOf(track.releaseDate),
		genre: track.genre,
		album: track.albumTitle,
		composer: track.composer,
		duration: track.durationSeconds,
		label: track.labelName,
		isrc: track.isrc,
	};
}

/** Why a track can't be downloaded, known before yt-dlp runs. */
export function soundCloudRefusal(track: SoundCloudTrack): string | null {
	if (track.isPreviewOnly) return SOUNDCLOUD_PREVIEW_ONLY_MESSAGE;
	if (track.isGeoBlocked) return SOUNDCLOUD_GEO_BLOCKED_MESSAGE;
	return null;
}
```

- [ ] **Step 4: Implement `src/lib/soundcloud/soundcloud-track-cache.ts`**

```ts
import type { MediaLink } from "$lib/media-link";
import { createSingleFlightCache } from "$lib/single-flight-cache";
import { fetchSoundCloudTrack, type SoundCloudTrack } from "./soundcloud-track";

const TRACK_TTL_MS = 10 * 60 * 1000;

const cache = createSingleFlightCache<SoundCloudTrack>();

/**
 * One page fetch per track across preview, details and download — the same
 * collapse video-details-cache.ts does for YouTube's yt-dlp extraction.
 */
export function getSoundCloudTrack(link: MediaLink): Promise<SoundCloudTrack> {
	return cache.get(link.id, () => fetchSoundCloudTrack(link.canonicalUrl), TRACK_TTL_MS);
}

export function clearSoundCloudTrackCache(): void {
	cache.clear();
}
```

- [ ] **Step 5: Run the tests** → PASS. `bun run check` → clean.
- [ ] **Step 6: Commit** `feat(soundcloud): map tracks to title state and ID3 details`.

### Task 14: Split the yt-dlp runner and add the SoundCloud arguments

**Files:**
- Modify: `src/lib/download-pipeline/try-yt-dlp.ts`
- Create: `src/lib/download-pipeline/try-soundcloud.ts`
- Test: `tests/unit/services/try-soundcloud.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

import {
	buildSoundCloudDownloadArgs,
	SOUNDCLOUD_FORMAT_SELECTOR,
} from "$lib/download-pipeline/try-soundcloud";

describe("buildSoundCloudDownloadArgs()", () => {
	it("builds the SoundCloud argv with no bgutil or YouTube extractor args", () => {
		// #when
		const args = buildSoundCloudDownloadArgs({
			videoUrl: "https://soundcloud.com/billieeilish/bad-guy",
			outputPath: "/tmp/out",
			ffmpegPath: "/usr/bin/ffmpeg",
			debugMode: false,
		});

		// #then
		expect(args).toEqual([
			"https://soundcloud.com/billieeilish/bad-guy",
			"-x",
			"--audio-format",
			"mp3",
			"--audio-quality",
			"128K",
			"-f",
			SOUNDCLOUD_FORMAT_SELECTOR,
			"--concurrent-fragments",
			"4",
			"--ffmpeg-location",
			"/usr/bin/ffmpeg",
			"--newline",
			"--no-playlist",
			"--no-update",
			"--js-runtimes",
			"node:/usr/bin/node",
			"-o",
			"/tmp/out.%(ext)s",
		]);
	});

	it("prefers MP3 and refuses Go+ preview snippets", () => {
		expect(SOUNDCLOUD_FORMAT_SELECTOR).toBe(
			"bestaudio[acodec=mp3][format_id!*=preview]/bestaudio[format_id!*=preview]",
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Split `src/lib/download-pipeline/try-yt-dlp.ts` without changing behavior.**
  1. Add a `YouTubeDownloadArgsInput` interface with `videoUrl`, `outputPath`, `bgutilPotUrl`, `ffmpegPath`, `pluginDir` and `debugMode`.
  2. Add `export function buildYouTubeDownloadArgs({ videoUrl, outputPath, bgutilPotUrl, ffmpegPath, pluginDir, debugMode }: YouTubeDownloadArgsInput): string[]`. Its body is the current lines 53–107 moved verbatim, meaning the `args` array with every comment plus the `debugMode` push. It ends with `return args;`.
  3. Add a `RunYtDlpDownloadInput` interface: `{ args: string[]; ytDlp: YtDlpInstance; send: (data: Record<string, unknown>) => void; signal?: AbortSignal }`.
  4. Add `export async function runYtDlpDownload({ args, ytDlp, send, signal }: RunYtDlpDownloadInput): Promise<void>`. Its body is the current lines 109–198 (the `withYtDlpConcurrencyLimit(...)` call) moved verbatim.
  5. Reduce `tryYtDlpDownload` to:

```ts
export async function tryYtDlpDownload({
	ytDlp,
	send,
	signal,
	...argsInput
}: TryYtDlpInput): Promise<void> {
	await runYtDlpDownload({
		args: buildYouTubeDownloadArgs(argsInput),
		ytDlp,
		send,
		signal,
	});
}
```

(These line numbers are for `origin/main` at `d07e423`, where PR #134 removed the old title fallback and `TitleState` from this file.)

Keep `TryYtDlpInput` as it is; the canary depends on it.

- [ ] **Step 4: Implement `src/lib/download-pipeline/try-soundcloud.ts`**

```ts
import { buildJsRuntimeArgs } from "$lib/yt-dlp-binary";
import { runYtDlpDownload, type YtDlpInstance } from "./try-yt-dlp";

/**
 * MP3 first: SoundCloud serves 128 kbps MP3 for most tracks, and taking it
 * means `--audio-format mp3` copies the stream (yt-dlp logs "file is already
 * in target format mp3") instead of re-encoding lossy AAC/Opus into lossy MP3.
 * `format_id!*=preview` refuses Go+ 30-second snippets, which yt-dlp itself
 * only deprioritises; a preview-only track then fails with "Requested format
 * is not available" rather than shipping 30 seconds as a finished download.
 */
export const SOUNDCLOUD_FORMAT_SELECTOR =
	"bestaudio[acodec=mp3][format_id!*=preview]/bestaudio[format_id!*=preview]";

export interface SoundCloudDownloadArgsInput {
	videoUrl: string;
	outputPath: string;
	ffmpegPath: string;
	debugMode: boolean;
}

/**
 * No bgutil plugin, PO-token or `youtube:` extractor args: those answer
 * YouTube's bot checks, and passing them would make SoundCloud downloads
 * depend on the bgutil-pot sidecar being configured and awake.
 * `buildJsRuntimeArgs()` is inert here but kept, so "every yt-dlp invocation
 * passes it" stays a rule without exceptions.
 */
export function buildSoundCloudDownloadArgs({
	videoUrl,
	outputPath,
	ffmpegPath,
	debugMode,
}: SoundCloudDownloadArgsInput): string[] {
	const args = [
		videoUrl,
		"-x",
		"--audio-format",
		"mp3",
		"--audio-quality",
		"128K",
		"-f",
		SOUNDCLOUD_FORMAT_SELECTOR,
		"--concurrent-fragments",
		"4",
		"--ffmpeg-location",
		ffmpegPath,
		"--newline",
		"--no-playlist",
		"--no-update",
		...buildJsRuntimeArgs(),
		"-o",
		`${outputPath}.%(ext)s`,
	];
	if (debugMode) {
		args.push("-v", "--list-formats");
	}
	return args;
}

export interface TrySoundCloudInput extends SoundCloudDownloadArgsInput {
	ytDlp: YtDlpInstance;
	send: (data: Record<string, unknown>) => void;
	signal?: AbortSignal;
}

export async function trySoundCloudDownload({
	ytDlp,
	send,
	signal,
	...argsInput
}: TrySoundCloudInput): Promise<void> {
	await runYtDlpDownload({
		args: buildSoundCloudDownloadArgs(argsInput),
		ytDlp,
		send,
		signal,
	});
}
```

- [ ] **Step 5: Run the tests.** `bun run test:run tests/unit/services tests/unit/canary` → PASS. The Task 1 argv characterization must still pass unchanged.
- [ ] **Step 6: Commit** `feat(soundcloud): SoundCloud yt-dlp argv; YouTube argv unchanged`.

### Task 15: SoundCloud cover art in `finalizeMp3`

**Files:**
- Modify: `src/lib/artwork.ts` (append)
- Modify: `src/lib/download-pipeline/finalize-mp3.ts`
- Test: `tests/unit/artwork-soundcloud.test.ts`; append to `tests/unit/services/finalize-mp3.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/artwork-soundcloud.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSoundCloudAlbumArt } from "$lib/artwork";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
const image = () => ({ ok: true, status: 200, arrayBuffer: async () => JPEG });
const searchResult = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("resolveSoundCloudAlbumArt()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the upload's own artwork before any store search", async () => {
		// #given
		const fetchMock = vi.fn(async (_url: string) => image());
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolveSoundCloudAlbumArt({
			artist: "The Chainsmokers",
			title: "Don't Let Me Down (W&W Remix)",
			artwork: { artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg" },
		});

		// #then
		expect(art?.buffer.byteLength).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://i1.sndcdn.com/artworks-x-t500x500.jpg");
	});

	it("searches the stores only when the upload has no artwork", async () => {
		// #given
		const fetchMock = vi.fn(async (url: string) =>
			url.includes("itunes.apple.com")
				? searchResult({ results: [{ artworkUrl100: "https://is1-ssl.mzstatic.com/a/100x100bb.jpg" }] })
				: image(),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolveSoundCloudAlbumArt({
			artist: "Billie Eilish",
			title: "bad guy",
			artwork: { avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg" },
		});

		// #then
		expect(art).not.toBeNull();
		expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
			"https://i1.sndcdn.com/avatars-x-t500x500.jpg",
		);
	});

	it("falls back to the uploader's avatar last", async () => {
		// #given
		const fetchMock = vi.fn(async (url: string) =>
			url.includes("itunes.apple.com")
				? searchResult({ results: [] })
				: url.includes("api.deezer.com")
					? searchResult({ data: [] })
					: image(),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const art = await resolveSoundCloudAlbumArt({
			artist: "Unknown",
			title: "Bootleg",
			artwork: { avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg" },
		});

		// #then
		expect(art).not.toBeNull();
		expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("https://i1.sndcdn.com/avatars-x-t500x500.jpg");
	});
});
```

In `tests/unit/services/finalize-mp3.test.ts`, make one fixture change:
- Add `resolveSoundCloudAlbumArtMock: vi.fn(() => Promise.resolve(null))` to the object returned by `vi.hoisted`.
- Add `resolveSoundCloudAlbumArtMock` to the `const { … } = vi.hoisted(...)` destructuring.
- Add `resolveSoundCloudAlbumArt: resolveSoundCloudAlbumArtMock` to the `vi.mock("$lib/artwork", …)` factory.

Then append:

```ts
describe("finalizeMp3() SoundCloud cover art", () => {
	it("uses the SoundCloud artwork order when SoundCloud artwork is given", async () => {
		// #given
		const filePath = await createTempMp3();
		resolveAlbumArtImageMock.mockClear();

		// #when
		await finalizeMp3({
			...finalizeInputFor(filePath),
			soundCloudArtwork: { artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg" },
		});

		// #then
		expect(resolveSoundCloudAlbumArtMock).toHaveBeenCalledWith({
			artist: "Test Artist",
			title: "Test Track",
			artwork: { artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg" },
		});
		expect(resolveAlbumArtImageMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement.** Append to `src/lib/artwork.ts`:

```ts
export interface SoundCloudArtwork {
	artworkUrl?: string;
	avatarUrl?: string;
}

interface ResolveSoundCloudAlbumArtInput {
	artist: string;
	title: string;
	artwork: SoundCloudArtwork;
}

async function soundCloudImage(url: string | undefined): Promise<AlbumArtImage | null> {
	const buffer = url ? await fetchThumbnailBuffer(url) : null;
	return buffer ? { buffer, mime: "image/jpeg" } : null;
}

/**
 * The reverse of the YouTube order: the upload's own artwork comes first.
 * SoundCloud is mostly remixes, edits and unreleased tracks, where a store
 * search for "artist title" returns the *original* release's cover. Store
 * artwork is only a fallback, and the uploader's avatar — what SoundCloud
 * itself shows for a track without artwork — is the last resort. The
 * artwork is already square (t500x500), so it is never cropped.
 */
export async function resolveSoundCloudAlbumArt({
	artist,
	title,
	artwork,
}: ResolveSoundCloudAlbumArtInput): Promise<AlbumArtImage | null> {
	try {
		const uploaded = await soundCloudImage(artwork.artworkUrl);
		if (uploaded) {
			console.log("[artwork] Using cover art from: soundcloud");
			return uploaded;
		}

		const official = await fetchOfficialArtwork(artist, title);
		if (official) {
			console.log("[artwork] Using cover art from: itunes");
			return { buffer: official, mime: "image/jpeg" };
		}

		const deezerUrl = await fetchDeezerArtworkUrl(artist, title);
		const deezer = deezerUrl ? await fetchBufferWithTimeout(deezerUrl, DEEZER_TIMEOUT) : null;
		if (deezer) {
			console.log("[artwork] Using cover art from: deezer");
			return { buffer: deezer, mime: "image/jpeg" };
		}

		const avatar = await soundCloudImage(artwork.avatarUrl);
		console.log(`[artwork] ${avatar ? "Using the uploader's avatar" : "No cover art resolved"}`);
		return avatar;
	} catch (err) {
		console.error("[artwork] SoundCloud cover art resolution failed:", err);
		Sentry.captureException(err, {
			level: "warning",
			tags: { service: "artwork", operation: "resolve-soundcloud-art" },
			extra: { artist, title },
		});
		return null;
	}
}
```

In `src/lib/download-pipeline/finalize-mp3.ts`:
1. Change the import to `import { resolveAlbumArtImage, resolveSoundCloudAlbumArt, type SoundCloudArtwork } from "$lib/artwork";`.
2. Add to `FinalizeMp3Input`:

```ts
	/** Present only for SoundCloud; selects its cover-art order. */
	soundCloudArtwork?: SoundCloudArtwork;
```

3. Add a doc comment above `videoId` (it has none): `/** YouTube video ID, or SoundCloud `user/slug`; also Sentry context. */`.
4. Destructure `soundCloudArtwork`, and replace the `resolveAlbumArtImage({...})` call with:

```ts
		const coverTitle = trackTitle || videoTitle;
		const image = soundCloudArtwork
			? await resolveSoundCloudAlbumArt({
					artist,
					title: coverTitle,
					artwork: soundCloudArtwork,
				})
			: await resolveAlbumArtImage({
					artist,
					title: coverTitle,
					videoId,
					fallback: thumbnail,
				});
```

- [ ] **Step 4: Run the tests.** `bun run test:run tests/unit/artwork.test.ts tests/unit/artwork-soundcloud.test.ts tests/unit/services/finalize-mp3.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(soundcloud): prefer the upload's own cover art`.

### Task 16: Per-source download preparation and the download route

**Files:**
- Create: `src/lib/download-pipeline/prepare-download.ts`
- Modify: `src/routes/api/download-stream/+server.ts`
- Modify: `tests/unit/api/download-stream.test.ts:116` and `:135` (D7 only)
- Test: `tests/unit/api/download-stream-soundcloud.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSoundCloudTrackMock, execMock } = vi.hoisted(() => ({
	getSoundCloudTrackMock: vi.fn(),
	execMock: vi.fn(),
}));
const mockEnv = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/soundcloud/soundcloud-track-cache", () => ({
	getSoundCloudTrack: getSoundCloudTrackMock,
}));
vi.mock("$lib/download-pipeline/yt-dlp-instance", () => ({
	getYTDlp: async () => ({ exec: execMock }),
}));
vi.mock("$lib/yt-dlp-binary", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/yt-dlp-binary")>()),
	buildJsRuntimeArgs: () => ["--js-runtimes", "node:/usr/bin/node"],
	ensureYtDlpBinary: async () => "/tmp/yt-dlp",
	ensureBgutilPlugin: async () => "/tmp/yt-dlp-plugins",
}));

import { SOUNDCLOUD_FORMAT_SELECTOR } from "$lib/download-pipeline/try-soundcloud";
import { SOUNDCLOUD_PREVIEW_ONLY_MESSAGE } from "$lib/soundcloud/soundcloud-metadata";
import { type SoundCloudTrack, SoundCloudTrackError } from "$lib/soundcloud/soundcloud-track";
import { GET } from "../../../src/routes/api/download-stream/+server";

const TRACK: SoundCloudTrack = {
	title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
	uploader: "MERCILESS",
	creditedArtist: "blk.",
	artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
	durationSeconds: 201,
	isPreviewOnly: false,
	isGeoBlocked: false,
};

function closingProcess() {
	return {
		on(event: string, callback: (code: number) => void) {
			if (event === "close") queueMicrotask(() => callback(0));
		},
	};
}

async function download(link: string): Promise<Record<string, unknown>[]> {
	const url = new URL(`http://localhost/api/download-stream?url=${encodeURIComponent(link)}`);
	const response = await GET({ url } as unknown as Parameters<typeof GET>[0]);
	const body = await response.text();
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

describe("GET /api/download-stream — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		execMock.mockImplementation(() => closingProcess());
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("downloads without the bgutil-pot sidecar configured", async () => {
		// #when
		const events = await download("https://soundcloud.com/mercilessbeats/i-cant-fail");

		// #then
		expect(execMock).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(events)).not.toMatch(/BGUTIL_POT_URL/);
	});

	it("runs the SoundCloud argv against the canonical URL", async () => {
		// #when
		await download("https://m.soundcloud.com/mercilessbeats/i-cant-fail?si=abc");
		const args = execMock.mock.calls[0]?.[0] as string[];

		// #then
		expect(args[0]).toBe("https://soundcloud.com/mercilessbeats/i-cant-fail");
		expect(args).toContain(SOUNDCLOUD_FORMAT_SELECTOR);
		expect(args).not.toContain("--plugin-dirs");
	});

	it("sends the resolved identity as the info event", async () => {
		// #when
		const events = await download("https://soundcloud.com/mercilessbeats/i-cant-fail");

		// #then
		expect(events).toContainEqual({
			type: "info",
			title: TRACK.title,
			artist: "blk.",
			track: "I Cant Fail",
		});
	});

	it("refuses a Go+ preview before spawning yt-dlp", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({ ...TRACK, isPreviewOnly: true });

		// #when
		const events = await download("https://soundcloud.com/mercilessbeats/i-cant-fail");

		// #then
		expect(events).toContainEqual({ type: "error", message: SOUNDCLOUD_PREVIEW_ONLY_MESSAGE });
		expect(execMock).not.toHaveBeenCalled();
	});

	it("reports an unavailable track without spawning yt-dlp", async () => {
		// #given
		getSoundCloudTrackMock.mockRejectedValue(new SoundCloudTrackError("gone", true));

		// #when
		const events = await download("https://soundcloud.com/mercilessbeats/gone");

		// #then
		expect(events).toContainEqual({ type: "error", message: "Track not found or unavailable" });
		expect(execMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run it to see it fail.** The route returns 400 `Invalid YouTube URL` for SoundCloud links.

- [ ] **Step 3: Create `src/lib/download-pipeline/prepare-download.ts`.** The YouTube half is today's route code (lines 124–203 on `origin/main` at `d07e423`) moved behind a function. It differs from that code in only three ways:
  - `if (videoId)` is gone, because it was always true.
  - The oEmbed uploader is returned as `uploader` instead of being only logged.
  - D9 applies.

  PR #134 removed `TitleState`. The title state is now `DownloadTitle` from `title-from-video-details.ts`, and the post-download fallback title stays in the route (Step 4).

  **Before you start, check for PR #133.** When this plan was written, PR #133 ("wait for the bgutil-pot sidecar before starting yt-dlp") was open, and it changes this exact block of the route.
  1. Run `git log --oneline d07e423..origin/main -- src/routes/api/download-stream/+server.ts`.
  2. Read the route's current lines 124–203.
  3. If a sidecar wait, or any other code not shown below, now sits in that block, stop and report NEEDS_CONTEXT, quoting what's there. The human will say where it goes in `prepareYouTubeDownload`. Don't drop it, and don't place it yourself.

```ts
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import type { SoundCloudArtwork } from "$lib/artwork";
import type { DownloadTitle } from "$lib/download-pipeline/title-from-video-details";
import { trySoundCloudDownload } from "$lib/download-pipeline/try-soundcloud";
import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";
import type { MediaLink } from "$lib/media-link";
import {
	soundCloudDetails,
	soundCloudRefusal,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import {
	type SoundCloudTrack,
	SoundCloudTrackError,
} from "$lib/soundcloud/soundcloud-track";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
import { getVideoDetails } from "$lib/video-details-cache";
import {
	fetchThumbnailBuffer,
	type ThumbnailImage,
	type VideoDetails,
} from "$lib/video-metadata";
import {
	fetchYouTubeMetadata,
	YouTubeMetadataError,
} from "$lib/youtube-metadata";
import { ensureBgutilPlugin } from "$lib/yt-dlp-binary";

type Send = (data: Record<string, unknown>) => void;

export interface DownloadAttemptInput {
	outputPath: string;
	ffmpegPath: string;
	debugMode: boolean;
	ytDlp: YtDlpInstance;
	signal: AbortSignal;
}

export interface PreparedDownload {
	titleState: DownloadTitle;
	/** The uploading channel. buildID3Tags uses it to recognise label uploads. */
	uploader: string;
	detailsPromise: Promise<VideoDetails | null>;
	thumbnailPromise: Promise<ThumbnailImage | null>;
	/** Present only for SoundCloud; selects its cover-art order in finalizeMp3. */
	soundCloudArtwork?: SoundCloudArtwork;
	runAttempt: (input: DownloadAttemptInput) => Promise<void>;
}

const BGUTIL_MISCONFIGURED_MESSAGE =
	"Server is misconfigured: BGUTIL_POT_URL is not set. Downloads cannot run without the bgutil-pot sidecar.";

function emptyTitleState(): DownloadTitle {
	return { videoTitle: "", artist: "", trackTitle: "" };
}

export function sendTitleInfo(send: Send, titleState: DownloadTitle): void {
	send({
		type: "info",
		title: titleState.videoTitle,
		artist: titleState.artist,
		track: titleState.trackTitle,
	});
}

async function prepareYouTubeDownload(
	link: MediaLink,
	send: Send,
): Promise<PreparedDownload | null> {
	send({ type: "status", message: "Getting video info..." });

	const titleState = emptyTitleState();
	let uploader = "";
	const detailsPromise: Promise<VideoDetails | null> = getVideoDetails(
		link.id,
		link.canonicalUrl,
	).catch(() => null);
	const thumbnailPromise: Promise<ThumbnailImage | null> = fetchThumbnailBuffer(
		link.id,
	).catch(() => null);

	try {
		const metadata = await fetchYouTubeMetadata(link.id);
		titleState.videoTitle = metadata.videoTitle;
		titleState.artist = metadata.artist;
		titleState.trackTitle = metadata.trackTitle;
		uploader = metadata.uploader;

		console.log("Got metadata from oEmbed:", {
			videoTitle: titleState.videoTitle,
			artist: titleState.artist,
			trackTitle: titleState.trackTitle,
			uploader: metadata.uploader,
		});

		sendTitleInfo(send, titleState);
	} catch (err) {
		if (err instanceof YouTubeMetadataError) {
			console.log("oEmbed metadata failed:", err.message);
			if (err.isUnavailable) {
				send({ type: "error", message: "Video not found or unavailable" });
				return null;
			}
		} else {
			console.error("Metadata fetch error:", err);
		}
	}

	send({ type: "status", message: "Starting download..." });

	const bgutilPotUrl = env.BGUTIL_POT_URL;
	if (!bgutilPotUrl) {
		send({ type: "error", message: BGUTIL_MISCONFIGURED_MESSAGE });
		Sentry.captureMessage("BGUTIL_POT_URL is unset", {
			level: "error",
			tags: { service: "download-stream", operation: "bgutil-pot-config" },
		});
		return null;
	}
	const pluginDir = await ensureBgutilPlugin();

	return {
		titleState,
		uploader,
		detailsPromise,
		thumbnailPromise,
		runAttempt: ({ outputPath, ffmpegPath, debugMode, ytDlp, signal }) =>
			tryYtDlpDownload({
				videoUrl: link.canonicalUrl,
				outputPath,
				bgutilPotUrl,
				ffmpegPath,
				pluginDir,
				debugMode,
				ytDlp,
				send,
				signal,
			}),
	};
}

/**
 * Everything knowable before yt-dlp runs is checked here, so a Go+ preview,
 * a geo-block or a deleted track never enters the retry loop or reaches
 * Sentry — like a private YouTube video, they are normal operation. A lookup
 * that failed for any other reason was already reported by
 * fetchSoundCloudTrack; the download goes ahead, as it does for YouTube when
 * oEmbed fails.
 */
async function prepareSoundCloudDownload(
	link: MediaLink,
	send: Send,
): Promise<PreparedDownload | null> {
	send({ type: "status", message: "Getting track info..." });

	let track: SoundCloudTrack | null = null;
	try {
		track = await getSoundCloudTrack(link);
	} catch (err) {
		if (err instanceof SoundCloudTrackError && err.isUnavailable) {
			send({ type: "error", message: "Track not found or unavailable" });
			return null;
		}
		console.error("SoundCloud metadata error:", err);
	}

	const refusal = track && soundCloudRefusal(track);
	if (refusal) {
		Sentry.addBreadcrumb({
			category: "download",
			level: "info",
			message: `Download rejected: ${refusal}`,
			data: { videoId: link.id },
		});
		send({ type: "error", message: refusal });
		return null;
	}

	const titleState = track ? soundCloudTitleState(track) : emptyTitleState();
	if (track) sendTitleInfo(send, titleState);

	send({ type: "status", message: "Starting download..." });

	return {
		titleState,
		uploader: track?.uploader ?? "",
		detailsPromise: Promise.resolve(track ? soundCloudDetails(track) : null),
		thumbnailPromise: Promise.resolve(null),
		soundCloudArtwork: {
			artworkUrl: track?.artworkUrl,
			avatarUrl: track?.avatarUrl,
		},
		runAttempt: ({ outputPath, ffmpegPath, debugMode, ytDlp, signal }) =>
			trySoundCloudDownload({
				videoUrl: link.canonicalUrl,
				outputPath,
				ffmpegPath,
				debugMode,
				ytDlp,
				send,
				signal,
			}),
	};
}

/** `null` means an error event was already sent and the stream should close. */
export function prepareDownload(
	link: MediaLink,
	send: Send,
): Promise<PreparedDownload | null> {
	return link.kind === "youtube"
		? prepareYouTubeDownload(link, send)
		: prepareSoundCloudDownload(link, send);
}
```

- [ ] **Step 4: Rewrite the route to use it.** Edits to `src/routes/api/download-stream/+server.ts`. Line numbers are for `origin/main` at `d07e423`, plus the few lines Phase 1's Task 6 added.

1. **Imports.**
   - Remove: `env`, `tryYtDlpDownload`, `getVideoDetails`, the whole `$lib/video-metadata` import, `buildWatchUrl` / `extractVideoId`, the whole `$lib/youtube-metadata` import, and `ensureBgutilPlugin`.
   - Keep: `titleFromVideoDetails`.
   - Add:
     - `import { prepareDownload, sendTitleInfo } from "$lib/download-pipeline/prepare-download";`
     - `import { type MediaLinkKind, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";`
     - `import { resolveMediaLink } from "$lib/resolve-media-link";`

2. **`reportDownloadFailure`.** Give it a fourth parameter `source: MediaLinkKind`, and add `source` to the `tags` object passed to `captureException` (D10).

3. **Validation.** Replace lines 82–87 (the `extractVideoId` check and `normalizedUrl`) with:

```ts
	const link = await resolveMediaLink(videoUrl);
	if (!link) {
		return new Response(UNSUPPORTED_LINK_MESSAGE, { status: 400 });
	}

	const videoId = link.id;
```

4. **The start of the `try` block.** Replace everything from `send({ type: "status", message: "Getting video info..." })` (line 124) through the end of the `retryWithBackoff(...)` call. That span includes the `titleState` object, the `sendTitleInfo` closure, the `uploader` variable from Task 6, the details and thumbnail promises, the oEmbed block, the BGUTIL gate and the plugin setup. Replace it with:

```ts
				const prepared = await prepareDownload(link, send);
				if (!prepared) {
					closeStream();
					return;
				}
				const { titleState } = prepared;

				const debugMode = url.searchParams.get("debug") === "1";
				const ytDlp = await getYTDlp();
				const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

				await retryWithBackoff(
					() =>
						prepared.runAttempt({
							outputPath,
							ffmpegPath: ffmpegInstaller.path,
							debugMode,
							ytDlp,
							signal: abortController.signal,
						}),
					{
						isRetryable: (error) =>
							isRetryableYtDlpError(
								error instanceof Error ? error.message : String(error),
								link.kind,
							),
						onRetry: () => {
							send({ type: "status", message: "Retrying download..." });
						},
						signal: abortController.signal,
					},
				);
```

5. **PR #134's fallback title** (the `if (!titleState.videoTitle) { … }` block after the missing-file check) stays where it is. Change only its two references:

```ts
				if (!titleState.videoTitle) {
					Object.assign(
						titleState,
						titleFromVideoDetails(await prepared.detailsPromise),
					);
					if (titleState.videoTitle) sendTitleInfo(send, titleState);
				}
```

6. **The `finalizeMp3({...})` call.** Set these fields:
   - `uploader: prepared.uploader`
   - `sourceUrl: link.canonicalUrl`
   - `detailsPromise: prepared.detailsPromise`
   - `thumbnailPromise: prepared.thumbnailPromise`
   - `soundCloudArtwork: prepared.soundCloudArtwork`

7. **The final `catch`.** Change it to `classifyYtDlpError(rawMessage, link.kind)` and `reportDownloadFailure(normalizedError, classified, videoId, link.kind)`.

8. **D7 test updates.** In `tests/unit/api/download-stream.test.ts`, change the two `expect(text).toBe("Invalid YouTube URL")` lines (116, 135) to `expect(text).toBe("Paste a YouTube video or SoundCloud track link")`.

- [ ] **Step 5: Run the route tests.** `bun run test:run tests/unit/api` → PASS, the new file included. `download-stream.test.ts`, `download-stream-reporting.test.ts` and PR #134's `download-stream-title-fallback.test.ts` must all pass with no other edits. Their `$lib/video-utils` mocks still drive the route, because `media-link.ts` imports `extractVideoId` and `buildWatchUrl` from that module.
- [ ] **Step 6: Commit** `feat(soundcloud): download SoundCloud tracks; move per-source prep out of the route`.

### Task 17: The preview and details routes

**Files:**
- Modify: `src/routes/api/preview/+server.ts`, `src/routes/api/preview/details/+server.ts`
- Modify: `tests/unit/api/preview.test.ts` (one mock-factory line; one D7 assertion at line 100)
- Test: `tests/unit/api/preview-soundcloud.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSoundCloudTrackMock } = vi.hoisted(() => ({ getSoundCloudTrackMock: vi.fn() }));
const mockEnv = vi.hoisted(() => ({ BGUTIL_POT_URL: "http://bgutil" }) as Record<string, string>);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/soundcloud/soundcloud-track-cache", () => ({
	getSoundCloudTrack: getSoundCloudTrackMock,
}));
vi.mock("$lib/artwork", () => ({ resolveArtworkUrl: vi.fn(async () => "https://store/art.jpg") }));
vi.mock("$lib/youtube-metadata", () => ({
	fetchYouTubeMetadata: vi.fn(),
	YouTubeMetadataError: class extends Error {},
}));

import { resolveArtworkUrl } from "$lib/artwork";
import { SOUNDCLOUD_PREVIEW_ONLY_MESSAGE } from "$lib/soundcloud/soundcloud-metadata";
import { type SoundCloudTrack, SoundCloudTrackError } from "$lib/soundcloud/soundcloud-track";
import { fetchYouTubeMetadata } from "$lib/youtube-metadata";
import { POST as previewPOST } from "../../../src/routes/api/preview/+server";
import { POST as detailsPOST } from "../../../src/routes/api/preview/details/+server";

const TRACK: SoundCloudTrack = {
	title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
	uploader: "MERCILESS",
	creditedArtist: "blk.",
	artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
	avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
	durationSeconds: 201,
	isPreviewOnly: false,
	isGeoBlocked: false,
};

/** `never` because the preview and details handlers type their events by different route IDs. */
function eventFor(url: string): never {
	return { request: { json: async () => ({ url }) } } as never;
}

describe("POST /api/preview — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("previews the resolved identity with the upload's own artwork", async () => {
		// #when
		const response = await previewPOST(eventFor("https://soundcloud.com/mercilessbeats/i-cant-fail"));

		// #then
		expect(await response.json()).toEqual({
			success: true,
			videoTitle: TRACK.title,
			artist: "blk.",
			title: "I Cant Fail",
			thumbnail: TRACK.artworkUrl,
			artwork: TRACK.artworkUrl,
			duration: 201,
		});
		expect(resolveArtworkUrl).not.toHaveBeenCalled();
		expect(fetchYouTubeMetadata).not.toHaveBeenCalled();
	});

	it("searches the stores only when the upload has no artwork", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({ ...TRACK, artworkUrl: undefined });

		// #when
		const data = await (await previewPOST(eventFor("https://soundcloud.com/a/b"))).json();

		// #then
		expect(data).toMatchObject({ thumbnail: TRACK.avatarUrl, artwork: "https://store/art.jpg" });
	});

	it("refuses a Go+ preview up front", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({ ...TRACK, isPreviewOnly: true });

		// #when
		const response = await previewPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ error: SOUNDCLOUD_PREVIEW_ONLY_MESSAGE });
	});

	it("answers 404 for an unavailable track", async () => {
		// #given
		getSoundCloudTrackMock.mockRejectedValue(new SoundCloudTrackError("gone", true));

		// #when
		const response = await previewPOST(eventFor("https://soundcloud.com/a/gone"));

		// #then
		expect(response.status).toBe(404);
	});

	it("never prewarms bgutil-pot for SoundCloud", async () => {
		// #given
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await previewPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});

describe("POST /api/preview/details — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("returns the duration from the cached track, with no yt-dlp run", async () => {
		// #when
		const response = await detailsPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(await response.json()).toEqual({ success: true, duration: 201 });
	});
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Implement the preview route.** In `src/routes/api/preview/+server.ts`:

1. **Imports.** Replace `import { extractVideoId } from "$lib/video-utils";` with:

```ts
import { type MediaLink, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";
import { resolveMediaLink } from "$lib/resolve-media-link";
import { soundCloudRefusal, soundCloudTitleState } from "$lib/soundcloud/soundcloud-metadata";
import { SoundCloudTrackError } from "$lib/soundcloud/soundcloud-track";
import { getSoundCloudTrack } from "$lib/soundcloud/soundcloud-track-cache";
```

2. **`previewSoundCloud`.** Add this above `POST`:

```ts
/**
 * The upload's own artwork is the preview image whenever it has one — the
 * same order resolveSoundCloudAlbumArt uses — so the cover a user sees is
 * the cover they get. No bgutil prewarm: SoundCloud never uses the sidecar.
 * fetchSoundCloudTrack already decided what to report, as fetchYouTubeMetadata
 * does for YouTube, so its errors are answered here without a second capture.
 */
async function previewSoundCloud(link: MediaLink): Promise<Response> {
	try {
		const track = await getSoundCloudTrack(link);
		const refusal = soundCloudRefusal(track);
		if (refusal) {
			return json({ error: refusal }, { status: 422 });
		}

		const { artist, trackTitle } = soundCloudTitleState(track);
		const artwork =
			track.artworkUrl ??
			(await resolveArtworkUrl(artist, trackTitle, {
				itunesSize: PREVIEW_ARTWORK_SIZE,
				timeout: PREVIEW_ARTWORK_TIMEOUT,
			}));

		return json({
			success: true,
			videoTitle: track.title,
			artist,
			title: trackTitle,
			thumbnail: track.artworkUrl ?? track.avatarUrl ?? "",
			artwork: artwork ?? undefined,
			duration: track.durationSeconds,
		});
	} catch (error) {
		if (!(error instanceof SoundCloudTrackError)) throw error;
		console.error("Preview error:", error.message);
		return error.isUnavailable
			? json({ error: "Track is unavailable or private" }, { status: 404 })
			: json({ error: "Failed to load preview" }, { status: 500 });
	}
}
```

3. **Validation in `POST`.** Replace the `extractVideoId` check (lines 48–51) with:

```ts
		const link = await resolveMediaLink(url);
		if (!link) {
			return json({ error: UNSUPPORTED_LINK_MESSAGE }, { status: 400 });
		}

		if (link.kind === "soundcloud") {
			return await previewSoundCloud(link);
		}

		const videoId = link.id;
```

Everything after that line stays as it is.

**The details route.** In `src/routes/api/preview/details/+server.ts`:

1. **Imports.** Replace `import { buildWatchUrl, extractVideoId } from "$lib/video-utils";` with imports of `UNSUPPORTED_LINK_MESSAGE`, `resolveMediaLink`, `soundCloudDetails` and `getSoundCloudTrack`.

2. **Lines 17–26.** Replace them with:

```ts
		const link = await resolveMediaLink(url);
		if (!link) {
			return json({ error: UNSUPPORTED_LINK_MESSAGE }, { status: 400 });
		}
		const videoId = link.id;

		const details =
			link.kind === "youtube"
				? await getVideoDetails(videoId, link.canonicalUrl, {
						timeout: DURATION_EXTRACTION_TIMEOUT_MS,
					})
				: await getSoundCloudTrack(link)
						.then(soundCloudDetails)
						.catch(() => null);
```

3. **The missing-duration capture.** Wrap it in `if (link.kind === "youtube") { … }`. For SoundCloud, the 500 response stays but nothing is captured. Put this comment above the `if`:

```ts
			// A SoundCloud track lacks a duration only when its page couldn't be
			// read, which fetchSoundCloudTrack already reported.
```

- [ ] **Step 4: Fixture and D7 updates in `tests/unit/api/preview.test.ts`.**
  - Add `buildWatchUrl: vi.fn((id: string) => \`https://www.youtube.com/watch?v=${id}\`),` to the `vi.mock("$lib/video-utils", …)` factory. `parseMediaLink` now calls it.
  - Change the `expect(data.error).toBe("Invalid YouTube URL");` line to `expect(data.error).toBe("Paste a YouTube video or SoundCloud track link");`. It's line 100 at `d07e423`, and line 101 once the factory line above is added, so find it by its text.

- [ ] **Step 5: Run the tests.** `bun run test:run tests/unit/api` → PASS.
- [ ] **Step 6: Commit** `feat(soundcloud): preview and details for SoundCloud tracks`.

### Task 18: Client validation, copy and e2e

Use @svelte-code-writer for the `.svelte` edits.

**Files:**
- Modify: `src/routes/+page.svelte` (lines 20–29, 43, 272, 403–404)
- Modify: `src/routes/+layout.svelte` (lines 27, 31, 36, 38), `src/app.html:29`
- Test: append to `tests/e2e/app.spec.ts`

- [ ] **Step 1: Write the failing e2e tests.** Add these inside `test.describe("dub-rip App", …)`:

```ts
	test("should accept a SoundCloud track link", async ({ page }) => {
		await page.route("**/api/preview/details", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true, duration: 194 }),
			}),
		);
		await page.route("**/api/preview", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success: true,
					videoTitle: "bad guy",
					artist: "Billie Eilish",
					title: "bad guy",
					thumbnail: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
					duration: 194,
				}),
			}),
		);
		await page.goto("/");

		await page
			.locator('input[data-slot="input"]')
			.fill("https://soundcloud.com/billieeilish/bad-guy");

		await expect(page.getByRole("button", { name: "Download" })).toBeEnabled({
			timeout: 5000,
		});
	});

	test("should keep Download disabled for a SoundCloud playlist link", async ({
		page,
	}) => {
		await page.goto("/");

		await page
			.locator('input[data-slot="input"]')
			.fill("https://soundcloud.com/billieeilish/sets/when-we-all-fall-asleep");

		await expect(page.getByRole("button", { name: "Download" })).toBeDisabled();
	});
```

- [ ] **Step 2: Run them to see them fail.** `bun run test:e2e` → the first new test fails (Download stays disabled).

- [ ] **Step 3: Implement.** In `src/routes/+page.svelte`:
  - Delete the `isValidYouTubeUrl` function (lines 20–29).
  - Add `import { parseMediaLink, UNSUPPORTED_LINK_MESSAGE } from "$lib/media-link";` with the other `$lib` imports, in alphabetical order.
  - Line 43 → `let isValidUrl = $derived(parseMediaLink(url) !== null);`
  - Line 272 → `error = UNSUPPORTED_LINK_MESSAGE;`
  - Line 403 → `placeholder="Paste a YouTube or SoundCloud link"`
  - Line 404 → `aria-label="YouTube or SoundCloud link"`

In `src/routes/+layout.svelte` and `src/app.html`, change "Download YouTube audio with rich metadata" to "Download YouTube and SoundCloud audio with rich metadata" everywhere it appears (the og and twitter description and image-alt tags, and the meta description).

- [ ] **Step 4: Run everything.** `bun run test:run && bun run test:e2e && bun run check && bun run lint` → green. If the e2e dev server returns 403 for client files in this worktree, see memory `dub-rip-worktree-vite-fs`: set `server.fs.strict: false` locally, and don't commit that change.
- [ ] **Step 5: Commit** `feat(ui): accept SoundCloud links`.

### Task 19: Documentation

**Files:** `.claude/CLAUDE.md`, `README.md`, `docs/error-reporting.md`

- [ ] **Step 1: Update `.claude/CLAUDE.md`.**
  - In the Project Overview, change "YouTube audio downloader" to "YouTube and SoundCloud audio downloader".
  - In "Before Committing", change "Test: valid URL → preview → download works" to "Test: a YouTube URL *and* a SoundCloud URL → preview → download works".
  - In the yt-dlp bullet "Every yt-dlp call is a YouTube request…", append: "SoundCloud downloads are the exception — not YouTube requests — but they take a slot in the same concurrency limiter."
  - Add this bullet to "Metadata (node-id3)":

```markdown
- Upload titles go through `cleanUploadTitle` → `parseArtistAndTitle` → `resolveTrackIdentity` (`src/lib/metadata/`) for both sources. Every pattern came from a real title; add the title that motivates a new one to the fixture tables in `tests/unit/metadata/`. A hyphen splits artist/title only with whitespace on one side (`Jay-Z`, `Blink-182`), a colon only when followed by whitespace (`5:00 AM`). Extra frames: TPUB label, TSRC ISRC, TPE4 remixer, WOAS source URL, TXXX `CATALOGNUMBER`.
```

  Then add a new section after "yt-dlp Integration":

```markdown
## SoundCloud Integration
- **Metadata comes from the track page, not yt-dlp.** `fetchSoundCloudTrack` reads the `sound` entry of `window.__sc_hydration` on `https://soundcloud.com/<user>/<slug>`: `label_name`, `publisher_metadata` (credited artist, album, ISRC), release date, genre, artwork, duration, and the Go+ preview flags. yt-dlp's SoundCloud extractor exposes none of label/album/ISRC/release date, and its `track` is only the raw upload title — which is why `soundCloudDetails` never sets `track` or `artist`. No API key or `client_id` is involved.
- **A nonexistent track is a 200 with no `sound` entry**, so "missing" is confirmed against oEmbed before it's believed: oEmbed 403/404 → unavailable (normal operation, unreported); oEmbed 200 → SoundCloud changed its markup, reported once as a warning, and the oEmbed data (title, uploader, artwork only) is used. Without that check a markup change would read as "every track is unavailable" with no Sentry signal.
- **One page fetch per track** — `getSoundCloudTrack` (single-flight, 10-minute TTL) serves preview, details and download.
- **Never pass bgutil/PO-token/`youtube:` args to a SoundCloud download, and never gate it on `BGUTIL_POT_URL`** — that's why `buildSoundCloudDownloadArgs` exists: SoundCloud keeps working when the sidecar is asleep or unconfigured.
- **The format selector prefers MP3 and refuses previews** (`bestaudio[acodec=mp3][format_id!*=preview]/…`): SoundCloud's 128 kbps MP3 is copied, not re-encoded, and a Go+ 30-second snippet can't ship as a complete track. Previews are normally refused earlier by `soundCloudRefusal` (policy `SNIP` or every transcoding `snipped`); a `Requested format is not available` that still reaches yt-dlp stays `unknown` on purpose, so a real format change reaches Sentry.
- **Artist precedence is title → `publisher_metadata.artist` → uploader**, measured on 152 real uploads (see `docs/superpowers/plans/2026-09-20-soundcloud-support.md`): the platform credit named the label, a repost channel, an editor or a truncated name often enough — even on ISRC-bearing distributor uploads — while an artist in the title was right. Don't promote it without new data.
- **Cover art: the upload's own artwork first**, then iTunes/Deezer, then the uploader's avatar — the reverse of YouTube, because SoundCloud is mostly remixes and edits, where a store search returns the original's cover.
- **`on.soundcloud.com/<code>` share links are a plain 302.** `resolveMediaLink` reads `Location` with `redirect: "manual"` and requires it to parse as a track URL; it never follows arbitrary redirects.
- **Error messages are per site** (`classifyYtDlpError(message, "soundcloud")`). YouTube's rules and wording are untouched, and the canary still uses only the YouTube patterns.
- **The canary stays YouTube-only.** A SoundCloud canary would add scheduled wake-ups (Railway Cost Practices) for a source with no failure history here. Revisit if SoundCloud failures show up in Sentry.
```

- [ ] **Step 2: Update `README.md`.** In the intro (line 3) and features (line 7), say YouTube and SoundCloud. In "How It Works" (line 105), change "User enters a YouTube URL" to "User enters a YouTube or SoundCloud URL". Replace the metadata sub-list under Features (lines 9–13) with the ID3 fields. List the ID3 fields: title, artist, album, year, genre, label, ISRC, remixer, catalog number, source URL, cover art.
- [ ] **Step 3: Update `docs/error-reporting.md`.** In the "Expected failures are not issues" section (line 148), change `ERROR_RULES` to `YOUTUBE_RULES`, because Task 11 renamed it. Add a short SoundCloud subsection next to the YouTube categories:
  - **User:** 404/private, geo-blocked, and Go+ previews (refused before yt-dlp runs).
  - **Transient:** 403, 429, timeouts, network errors.
  - **Unknown:** everything else, including `Requested format is not available`.
  - **Warnings:** page-markup or oEmbed failures from `fetchSoundCloudTrack`, reported once per lookup.
- [ ] **Step 4: Commit.** Git tracks the project instructions as `.claude/claude.md` (lowercase). On this Mac's case-insensitive filesystem, `git add .claude/CLAUDE.md` exits 0 but stages nothing, so use the tracked spelling:

```bash
git add .claude/claude.md README.md docs/error-reporting.md docs/superpowers/plans/2026-09-20-soundcloud-support.md
git diff --cached --stat
git commit -m "docs: document SoundCloud support and the upload-title pipeline"
```

Expected: `--stat` lists `.claude/claude.md`, `README.md` and `docs/error-reporting.md`, plus the plan if its checkboxes were ticked.

### Task 20: Verification and PR

- [ ] **Step 1: Audit test edits.** The expect audit (Guardrail rule 2) must show only the three D7 statements.
- [ ] **Step 2: Run the pre-commit agents** (`code-simplifier:code-simplifier`, then `security-auditor`). Point the security audit at `resolve-media-link.ts` (redirect handling), `soundcloud-url.ts` (host and path validation) and the artwork fetches (the `sndcdn.com` host check). Commit any fixes, then re-run `bun run test:run`.
- [ ] **Step 3: Check against real tracks locally.** Start the dev server with `preview_start`. Then:
  - Preview, then download, `https://soundcloud.com/billieeilish/bad-guy`, and inspect the file:

```bash
node -e 'const t=require("node-id3").read(process.argv[1]); delete t.image; delete t.raw; console.log(t)' "$HOME/Downloads/Billie Eilish - bad guy.mp3"
```

    Expected: `title: "bad guy"`, `artist: "Billie Eilish"`, `album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?"`, `year: "2019"`, `genre: "Alternative"`, `publisher: "Darkroom/Interscope Records"`, `ISRC: "USUM71900764"`, `audioSourceUrl: "https://soundcloud.com/billieeilish/bad-guy"`. The cover art is SoundCloud's.
  - Preview `https://soundcloud.com/ethmusic/lostin-powers-she-so-heavy`. Expected: artist `Lostin Powers`, title `She so Heavy (SneakPreview) Adrian Ackers Blueprint 1`.
  - Paste the share link `https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9`. Expected: it previews `ilaytsa/crashout`.
  - Paste a `/sets/` link and a profile link. Expected: Download stays disabled.
  - Paste `https://soundcloud.com/billieeilish/does-not-exist-xyz`. Expected: "Track is unavailable or private".
  - YouTube regression: download `https://www.youtube.com/watch?v=jNQXAC9IVRw`. Expected (Phase 1's output, which is `main` by now): title "Me at the zoo", artist "jawed", album "Me at the zoo", and `audioSourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw"`. Year and genre appear if yt-dlp's details succeed. There should be no publisher, ISRC or remixer.
- [ ] **Step 4: Open the PR, then test in its PR environment.** Railway creates `dub-rip-pr-<N>`. Download a SoundCloud track there. SoundCloud's behavior toward Railway's datacenter IPs is untested.
  - If the logs show `SoundCloud track page returned 403` (or 429), **stop and report.** The page is blocked from Railway, and the metadata design needs revisiting. The fallback candidate is SoundCloud's api-v2 `resolve` with a scraped `client_id`, which is what yt-dlp does.
  - If yt-dlp itself gets 403s, record it the same way.
- [ ] **Step 5: After merging, confirm on dub.rip.** Production leaves through different egress IPs than PR environments, so a pass in the PR environment is not a pass in production (memory `dub-rip-pr-env-not-prod-ip`). Download one SoundCloud track and one YouTube video on production.
- [ ] **Step 6:** Ask the human to merge or close the PR promptly, so its environment is torn down. The human merges.

---

## Considered and deferred

- **TCOP (copyright, from `c_line`).** Deferred: TPUB already carries the label, and the ℗/© strings are long and legalistic.
- **An explicit-content flag.** There's no standard ID3 frame for it (iTunes uses a private TXXX).
- **Splitting multiple artists into separate values.** node-id3 writes ID3v2.3, where a comma-joined TPE1 is the convention.
- **SoundCloud playlists (`/sets/`).** Rejected: the app downloads single tracks.
- **SoundCloud `tag_list` as a genre source.** Too noisy.
- **A separate concurrency limiter for SoundCloud.** The shared limiter bounds CPU and ffmpeg load. Revisit if SoundCloud traffic ever starves YouTube downloads.
- **Renaming `videoId`, `videoTitle` and `VideoPreview` to source-neutral names.** A mechanical rename across many files; do it as its own refactor PR.
- **The fallback title from PR #134.** `titleFromVideoDetails` (`src/lib/download-pipeline/title-from-video-details.ts`) still calls `parseArtistAndTitle` directly. It gets the separator fixes (D1, D2) and the uploader clean-up (D5), but not the title cleanup or reversal (D3, D4). It runs only when oEmbed fails. Moving it to `resolveTrackIdentity` would change what its existing tests expect, so do that as its own follow-up.
