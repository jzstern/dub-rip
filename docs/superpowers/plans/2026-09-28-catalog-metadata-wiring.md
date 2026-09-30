## 0. What I verified, and where the readers were wrong

Checked against the code, not the reports. Corrections that change the plan:

- **`judgeCandidates` takes two arguments** (`src/lib/metadata/catalog/judge-candidates.ts:329`), not three. The spec's File map is stale; write from the code.
- **`buildID3Tags` line numbers**: title `src/lib/video-metadata.ts:311`, artist `:312`, album `:318`, genre `:329`, year `:330`, `resolveLabel` `:337`, ISRC `:344`. (The soundcloud reader said 310/311 — off by one.)
- **`details.isrc` is only ever set on the SoundCloud path** — `grep isrc src/lib/video-metadata.ts` gives only the interface field (`:34`) and the write (`:344`). So `details?.isrc || canonical?.isrc` needs **no provenance flag**.
- **No existing download-stream test reaches the real `finalizeMp3`.** `download-stream-soundcloud.test.ts`, `download-stream.test.ts`, `download-stream-sidecar-wait.test.ts` all bail at `pathExists` (real `access` → ENOENT, or a mocked rejecting `access`) before `+server.ts:199`; `download-stream-reporting.test.ts:429` does make `.mp3` exist but cancels the body first, so the abort check at `+server.ts:191` throws before `finalizeMp3`; `download-stream-title-fallback.test.ts:51` mocks `finalizeMp3` outright. **Consequence: putting the lookup in `finalizeMp3` needs a new catalog mock in exactly one file — `tests/unit/services/finalize-mp3.test.ts`.** The download-and-tags and soundcloud readers were wrong that `download-stream-soundcloud.test.ts` would start making live calls (it would only if the lookup went into `prepare-download.ts`).
- **`searchITunes` and `searchDeezer` return `[]` without a fetch for a blank term** (`itunes-catalog.ts:98`, `deezer-catalog.ts:174`), so an empty query is network-free — but it still writes a `"|"` cache entry, so guard it.
- **`enrichFromAlbum` is not exported** (`lookup-catalog.ts:121`), and `lookupCatalogMetadata` returns the verdict only. That is the one real design constraint: a stage that needs *candidates* (for the artwork fallback) cannot also get *enrichment* from the public surface. It does not matter, because only the download enriches and only the preview and `/details` need candidates.
- **`CatalogSource` ("itunes"|"deezer") is assignable to `CoverArtSource`** (`artwork.ts:17`), so `{url, source}` needs no cast and no new union member.
- `tests/setup.ts` stubs **only** `@sentry/sveltekit`. Global `fetch` is live in every unit test that does not stub it itself.

**The one design decision I am making for you, stated once:** the `/api/preview` response keeps the **heuristic** `artist`/`title` and gains only the matched **artwork**; the canonical identity arrives from `/api/preview/details`. Reason: the spec's own sentence sanctions it ("Stage B should either hold the canonical fields back until the duration is in, or show them as provisional…"), it is the only arrangement in which `/details` can build the *same* query the preview built — because the client echoes the preview's `artist`/`title`, which must be heuristic or the re-judge is computed from a different query and gets a different cache key — and it is the reason **exactly one existing assertion changes**. If you want canonical-at-preview instead, §6 gives the exact extra cost.

---

## 1. Ordered edits

Every step leaves `bun run test` and `bun run check` green. Steps 1–3 add unused optional surface; nothing observes it yet.

### Step 1 — new file: `src/lib/metadata/catalog/catalog-cache.ts`

Complete contents:

```ts
import * as Sentry from "@sentry/sveltekit";
import { createSingleFlightCache } from "$lib/single-flight-cache";
import type {
	CatalogCandidate,
	CatalogVerdict,
	TrackQuery,
} from "./catalog-candidate";
import {
	CANDIDATE_TTL_MS,
	candidateCacheKey,
	CatalogUnavailableError,
	fetchCatalogCandidates,
	lookupCatalogMetadata,
} from "./lookup-catalog";
import { judgeCandidates } from "./judge-candidates";

/**
 * One candidate fetch per track across preview, details and download — the
 * same collapse soundcloud-track-cache.ts does for the track page and
 * video-details-cache.ts for yt-dlp's extraction.
 *
 * Candidates are cached; verdicts are not. Each stage re-judges the same
 * candidates with whatever evidence it has by then, so /details accepts on
 * duration what a preview could only weigh as text. That only works while all
 * three stages build the SAME query: artist and title always come from the
 * heuristic identity, never from a verdict and never from details.track /
 * details.artist, and only isrc and durationSeconds vary by stage.
 */
const cache = createSingleFlightCache<CatalogCandidate[]>();

export interface CatalogLookup {
	verdict: CatalogVerdict;
	/** Kept so an unmatched verdict can still answer the artwork question. */
	candidates: CatalogCandidate[];
}

const UNMATCHED: CatalogVerdict = {
	status: "unmatched",
	reason: "no-candidates",
};

/** A lookup can never fail a preview or a download; a judging bug is ours. */
function reportLookupBug(error: unknown, query: TrackQuery): void {
	Sentry.captureException(
		error instanceof Error ? error : new Error(String(error)),
		{
			level: "warning",
			tags: { service: "catalog", operation: "lookup" },
			extra: { artist: query.artist, title: query.title },
		},
	);
}

function isBlank(query: TrackQuery): boolean {
	return !query.artist.trim() && !query.title.trim();
}

/**
 * Preview and /details: judges the shared candidates and hands them back, so
 * artwork can fall back to today's order using the same responses. Never
 * enriches — the Deezer /album call belongs to the download.
 */
export async function sharedCatalogLookup(
	query: TrackQuery,
	{ timeout }: { timeout: number },
): Promise<CatalogLookup> {
	if (isBlank(query)) return { verdict: UNMATCHED, candidates: [] };

	let candidates: CatalogCandidate[] = [];
	try {
		candidates = await cache.get(
			candidateCacheKey(query),
			() => fetchCatalogCandidates(query, { timeout }),
			CANDIDATE_TTL_MS,
		);
	} catch (error) {
		if (!(error instanceof CatalogUnavailableError)) {
			reportLookupBug(error, query);
		}
		console.log("[catalog] unmatched reason=catalogs-unreachable");
		return { verdict: UNMATCHED, candidates: [] };
	}

	try {
		const verdict = judgeCandidates(query, candidates);
		console.log(
			verdict.status === "matched"
				? `[catalog] matched via=${verdict.via} source=${verdict.candidate.source}`
				: `[catalog] unmatched reason=${verdict.reason}`,
		);
		return { verdict, candidates };
	} catch (error) {
		reportLookupBug(error, query);
		return { verdict: UNMATCHED, candidates };
	}
}

/** The download: the same cached candidates, plus the Deezer album call for label and genre. */
export async function enrichedCatalogVerdict(
	query: TrackQuery,
	{ timeout }: { timeout: number },
): Promise<CatalogVerdict> {
	if (isBlank(query)) return UNMATCHED;
	try {
		return await lookupCatalogMetadata(query, { timeout, cache, enrich: true });
	} catch (error) {
		reportLookupBug(error, query);
		return UNMATCHED;
	}
}

/**
 * The cover the match proved, else today's order — iTunes first, then Deezer —
 * from the responses already in memory rather than a second pair of searches.
 */
export function catalogArtworkUrl({
	verdict,
	candidates,
}: CatalogLookup): string | undefined {
	const matched =
		verdict.status === "matched" ? verdict.metadata.artworkUrl : undefined;
	return (
		matched ??
		candidates.find((c) => c.source === "itunes" && c.artworkUrl)?.artworkUrl ??
		candidates.find((c) => c.artworkUrl)?.artworkUrl
	);
}

export function clearCatalogCandidateCache(): void {
	cache.clear();
}
```

Why two entry points rather than one: `enrichFromAlbum` is private to `lookup-catalog.ts`, so a function that composes `fetchCatalogCandidates` + `judgeCandidates` (the only way to keep the candidates) cannot enrich. Splitting by need costs one extra exported function and zero edits to `lookup-catalog.ts`; the price is that the `[catalog]` log line's format string appears twice, which I accept so the preview stage still reports a match rate.

### Step 2 — `src/lib/artwork.ts`: optional `preferredArtwork`

- After `interface CoverArt` (`:22`), add:
  ```ts
  /** A cover already proven to belong to this recording, so it is tried before the unverified searches. */
  export interface PreferredArtwork {
  	url: string;
  	source: CoverArtSource;
  }
  ```
- Add `preferredArtwork?: PreferredArtwork;` to `ResolveCoverArtInput` (`:24`), `ResolveAlbumArtImageInput` (`:197`) and `ResolveSoundCloudAlbumArtInput` (`:280`). **Optional, never `| null`.**
- New private helper next to `fetchBufferWithTimeout` (`:48`) — do **not** change `fetchBufferWithTimeout` itself, the thumbnail path shares it:
  ```ts
  /**
   * The https + mzstatic/dzcdn allowlist runs when the candidate is built, so a
   * followed redirect would escape it. A 3xx is treated as a miss.
   */
  async function fetchAllowlistedImage(url: string, timeout: number) {
  	const controller = new AbortController();
  	const timer = setTimeout(() => controller.abort(), timeout);
  	try {
  		const response = await fetch(url, {
  			signal: controller.signal,
  			redirect: "manual",
  		});
  		if (!response.ok) return null;
  		const bytes = await response.arrayBuffer();
  		return bytes.byteLength ? Buffer.from(bytes) : null;
  	} catch {
  		return null;
  	} finally {
  		clearTimeout(timer);
  	}
  }
  ```
- `resolveCoverArt` (`:238`, top of the try, before `fetchOfficialArtwork` at `:239`):
  ```ts
  if (preferredArtwork) {
  	const verified = await fetchAllowlistedImage(preferredArtwork.url, ITUNES_TIMEOUT);
  	if (verified) return { imageBuffer: verified, source: preferredArtwork.source };
  }
  ```
  Fall through on null — a dead CDN URL must not cost the track its cover.
- `resolveSoundCloudAlbumArt`: the same block **after** the upload's own artwork (`:307-311`) and **before** `fetchOfficialArtwork` (`:313`), logging `[artwork] Using cover art from: ${preferredArtwork.source}`. Placement is what keeps `tests/unit/artwork-soundcloud.test.ts:31` (`toHaveBeenCalledTimes(1)`) green and honours the comment at `:293-300`.
- `resolveAlbumArtImage` (`:211`): pass `preferredArtwork` straight through to `resolveCoverArt`.

Why here (Option A) and not a caller-side fetch: `soundCloudImage` (`:286`) is private, the `mime` decision and the Sentry tags live here, and the redirect gate lands in one function instead of three call sites. Zero assertions in either artwork test file change.

### Step 3 — `src/lib/video-metadata.ts`: optional `canonical`

- `ID3TagInput` (`:269`) gains two optional fields:
  ```ts
  	/** A proven catalog match. Outranks `details`, which outranks the heuristic values. */
  	canonical?: CanonicalMetadata;
  	/** SoundCloud's `label_name` is a clean distributor field and beats the catalog; YouTube's scraped ℗ line does not. */
  	trustPlatformLabel?: boolean;
  ```
  (import `CanonicalMetadata` as a type from `$lib/metadata/catalog/catalog-candidate`.)
- `buildID3Tags` (`:302`), one tier inserted above `details` in each chain:
  - `:311` → `const title = (canonical?.title || details?.track || trackTitle || videoTitle || "").trim();`
  - `:312` → `const finalArtist = (canonical?.artist || details?.artist || artist || "Unknown Artist").trim();`
  - `:318` → `const album = (canonical?.album || details?.album || title || "Unknown Album").trim();`
  - `:329` → `const genre = canonical?.genre || details?.genre; if (genre) tags.genre = genre;`
  - `:330` → `const year = canonical?.year ?? details?.year; if (typeof year === "number") tags.year = String(year);`
  - `:337` → `platformLabel: trustPlatformLabel ? (details?.label ?? canonical?.label) : (canonical?.label ?? details?.label),`
  - `:344` → `const isrc = details?.isrc || canonical?.isrc; if (isrc) tags.ISRC = isrc;` (`details.isrc` is SoundCloud-only, so this is already the spec's order.)
  - Leave `:313` `performerInfo`, `:319` `composer`, `:331` `bpm`, `:345` `remixArtist`, `:347` `userDefinedText`, `:352` `audioSourceUrl`, `:354` `image` untouched. TPE4 re-derives itself from the resolved `tags.title`, so "extractRemixer on the catalog title" needs no code.
  - `titleCredits` at `:334` keeps reading `videoTitle` — the catalog number lives in the upload title, not the catalog's.

Every canonical-derived field stays behind an `if`, which is what keeps `tests/unit/metadata/id3-enrichment.test.ts:57` (the only exhaustive key-set assertion) green.

### Step 4 — `src/lib/download-pipeline/finalize-mp3.ts`: fetch the verdict, thread it three ways

`FinalizeMp3Input`, `PreparedDownload` and the route are **unchanged**. Inside `finalizeMp3`:

- Declare above the try (`:114`), because the filename is built at `:180`, outside it:
  ```ts
  let canonical: CanonicalMetadata | undefined;
  ```
- Inside the try, between `:118` and `:120`:
  ```ts
  const [details, thumbnail] = await Promise.all([detailsPromise, thumbnailPromise]);

  /** The heuristic identity, so preview, /details and this share one cache key. */
  const verdict = signal?.aborted
  	? undefined
  	: await enrichedCatalogVerdict(
  			{
  				artist,
  				title: trackTitle,
  				isrc: details?.isrc,
  				durationSeconds: details?.duration,
  			},
  			{ timeout: DOWNLOAD_CATALOG_TIMEOUT_MS },
  		);
  if (verdict?.status === "matched") canonical = verdict.metadata;

  const preferredArtwork = canonical?.artworkUrl
  	? { url: canonical.artworkUrl, source: canonical.source }
  	: undefined;
  ```
  with `const DOWNLOAD_CATALOG_TIMEOUT_MS = 6000;` at module scope.
- `:121-132`: add `...(preferredArtwork ? { preferredArtwork } : {})` to **both** resolver calls. The conditional spread (rather than `preferredArtwork: undefined`) is what makes `finalize-mp3.test.ts:346`'s exact-object assertion safe by construction rather than by vitest's undefined-key leniency.
- `:134-142`: add `canonical,` and `trustPlatformLabel: Boolean(soundCloudArtwork),` to the `buildID3Tags` call. `soundCloudArtwork` is already this function's platform discriminator (`:121`, and `prepare-download.ts:268` always sets it for SoundCloud), so no new input is needed.
- `:180`:
  ```ts
  const filename = buildDownloadFilename({
  	artist: canonical?.artist || artist,
  	trackTitle: canonical?.title || trackTitle,
  	videoTitle,
  });
  ```
  Keep this narrow `||` form rather than deriving the filename from `tags`: `tags.title`/`tags.artist` default to `"Unknown Title"`/`"Unknown Artist"` (`:322`, `:312`), so deriving from them would turn today's `audio.mp3` into `Unknown Artist - Unknown Title.mp3`.
- **Do not** import anything new from `$lib/video-metadata` — `finalize-mp3.test.ts:31` replaces that whole module with a factory exporting only `buildID3Tags`.
- **Do not** send a new status event; `download-stream-sidecar-wait.test.ts:183` pins the first three.

Test file change (an addition, no approval needed): `tests/unit/services/finalize-mp3.test.ts`, alongside the mocks at `:26-37`:
```ts
vi.mock("$lib/metadata/catalog/catalog-cache", () => ({
	enrichedCatalogVerdict: vi.fn(async () => ({ status: "unmatched", reason: "no-candidates" })),
}));
```

### Step 5 — `src/routes/api/preview/+server.ts`

- Drop the `resolveArtworkUrl` import (`:4`); import `catalogArtworkUrl`, `sharedCatalogLookup`.
- Keep `PREVIEW_ARTWORK_TIMEOUT = 4000` as the lookup budget and pass it **explicitly** — `sharedCatalogLookup`'s callee defaults to 6000 (`lookup-catalog.ts:31`), which would silently widen the preview by 50%.
- Keep `PREVIEW_ARTWORK_SIZE = 300` and use it for a preview-only downscale, because candidates are built at 600 (`itunes-catalog.ts:16,49`) for a 56 px card:
  ```ts
  /** The card is 56 px; the candidate URL is built at 600. A no-op for Deezer covers. */
  function previewSized(url: string | undefined): string | undefined {
  	return url?.replace("600x600bb", `${PREVIEW_ARTWORK_SIZE}x${PREVIEW_ARTWORK_SIZE}bb`);
  }
  ```
- YouTube branch (`:109-123`), leaving `prewarmBgutilPot()` at `:107` exactly where it is so the wake still overlaps the awaited work:
  ```ts
  const metadata = await fetchYouTubeMetadata(videoId);
  const lookup = await sharedCatalogLookup(
  	{ artist: metadata.artist, title: metadata.trackTitle },
  	{ timeout: PREVIEW_ARTWORK_TIMEOUT },
  );

  return json({
  	success: true,
  	videoTitle: metadata.videoTitle,
  	artist: metadata.artist,
  	title: metadata.trackTitle,
  	thumbnail: metadata.thumbnailUrl,
  	artwork: previewSized(catalogArtworkUrl(lookup)),
  });
  ```
- SoundCloud branch (`previewSoundCloud`, `:62-78`), after the `soundCloudRefusal` 422 so a refused track spends no catalog calls:
  ```ts
  const { artist, trackTitle } = soundCloudTitleState(track);
  const lookup = await sharedCatalogLookup(
  	{
  		artist,
  		title: trackTitle,
  		isrc: track.isrc,
  		durationSeconds: track.durationSeconds,
  	},
  	{ timeout: PREVIEW_ARTWORK_TIMEOUT },
  );
  const artwork = track.artworkUrl ?? previewSized(catalogArtworkUrl(lookup));
  ```
  The response object keeps its current seven keys verbatim. The upload's own cover still wins, so the cover shown is still the cover written.
- Response shape: **no new keys on either branch.** `src/lib/types.ts` is untouched.

Test file changes: add the catalog mock to `tests/unit/api/preview.test.ts` (top, next to `:28-30`) and to `tests/unit/api/preview-soundcloud.test.ts` (next to `:14-16`), defaulting to unmatched-with-no-candidates. Re-point three `#given` blocks at the mocked lookup instead of `resolveArtworkUrl` (`preview.test.ts:192`, `:244`; `preview-soundcloud.test.ts:76-79`). One assertion changes — see §4.

### Step 6 — `src/routes/api/preview/details/+server.ts`

- Keep the SoundCloud **track** alive; `soundCloudDetails` deliberately withholds `artist`/`track` (`soundcloud-metadata.ts:27-32`), so after today's `.then(soundCloudDetails)` the route has no identity to query with:
  ```ts
  const track =
  	link.kind === "soundcloud"
  		? await getSoundCloudTrack(link).catch(() => null)
  		: null;
  const details =
  	link.kind === "youtube"
  		? await getVideoDetails(videoId, link.canonicalUrl, {
  				timeout: DURATION_EXTRACTION_TIMEOUT_MS,
  			})
  		: track && soundCloudDetails(track);
  ```
- Leave the null-details breadcrumb (`:40-48`) and the missing-duration branch (`:50-67`) **exactly** as they are. Run the lookup only on the success path at `:69-72`, so `preview-details.test.ts:252` and `preview-soundcloud.test.ts:162` cannot move.
- New local helper, reading the identity the client echoes (see Step 7) and falling back to the yt-dlp JSON:
  ```ts
  function detailsQuery(
  	link: MediaLink,
  	details: VideoDetails,
  	track: SoundCloudTrack | null,
  	body: { artist?: unknown; title?: unknown },
  ): TrackQuery {
  	if (track) {
  		const { artist, trackTitle } = soundCloudTitleState(track);
  		return {
  			artist,
  			title: trackTitle,
  			isrc: track.isrc,
  			durationSeconds: track.durationSeconds,
  		};
  	}
  	/** The preview's own identity, so both stages hit one cache entry. */
  	const echoed =
  		typeof body.artist === "string" && typeof body.title === "string"
  			? { artist: body.artist, title: body.title }
  			: null;
  	const identity =
  		echoed ??
  		(details.artist || details.track
  			? { artist: details.artist ?? "", title: details.track ?? "" }
  			: resolveTrackIdentity({
  					rawTitle: details.title ?? "",
  					uploader: details.uploader,
  					labelName: details.label,
  				}).let); // see note
  	return { ...identity, durationSeconds: details.duration };
  }
  ```
  (Write the last branch plainly: `const id = resolveTrackIdentity({...}); identity = { artist: id.artist, title: id.trackTitle };` — there is no `.let` in TS, that line is shorthand in this plan, not code.) Attacker-influenceable text is fine: `collapseWhitespace` caps at 300 chars (`normalize-text.ts:14,42`) and the query credit is parsed once per lookup (`judge-candidates.ts` comment at the `queryCredit` line).
- Success return:
  ```ts
  const { verdict } = await sharedCatalogLookup(query, {
  	timeout: DETAILS_CATALOG_TIMEOUT_MS, // 4000
  });

  return json({
  	success: true,
  	duration: details.duration,
  	...(verdict.status === "matched"
  		? {
  				artist: verdict.metadata.artist,
  				title: verdict.metadata.title,
  				...(verdict.metadata.artworkUrl
  					? { artwork: previewSizedArtwork(verdict.metadata.artworkUrl) }
  					: {}),
  			}
  		: {}),
  });
  ```
  Match-only keys, no `canonical: null`. Never `enrich: true` here.
- The lookup is inside the handler's own `try`, whose catch (`:73-88`) 500s and files `operation: "load-details"`; `sharedCatalogLookup` never throws, which is why no extra `.catch` is needed — but do not remove that guarantee from the cache module.

Test file changes (additions): catalog mock in `tests/unit/api/preview-details.test.ts` (and `clearCatalogCandidateCache()` in its `beforeEach` at `:119-126` if you prefer the real module) and in `tests/unit/api/preview-soundcloud.test.ts`. Without them these files would make live iTunes/Deezer requests.

### Step 7 — `src/routes/+page.svelte`

- `loadPreview` (`:97-103`): capture the parsed body and echo the identity:
  ```ts
  const previewData = await response.json();
  preview = previewData;

  fetch("/api/preview/details", {
  	method: "POST",
  	headers: { "Content-Type": "application/json" },
  	body: JSON.stringify({
  		url: targetUrl,
  		artist: previewData.artist,
  		title: previewData.title,
  	}),
  })
  ```
- The merge (`:113-125`) becomes key-conditional, so the real `{success:true}` path (`details/+server.ts:66`, and the e2e mock at `app.spec.ts:51`) cannot blank the card:
  ```ts
  .then((details) => {
  	if (url !== targetUrl || !preview || !details?.success) return;
  	preview = {
  		...preview,
  		...(typeof details.duration === "number" ? { duration: details.duration } : {}),
  		...(details.artist ? { artist: details.artist } : {}),
  		...(details.title ? { title: details.title } : {}),
  		...(details.artwork ? { artwork: details.artwork } : {}),
  	};
  })
  ```
  The existing `url === targetUrl` guard is enough here: nothing is ever *withdrawn*, so an out-of-order response for the same URL can only re-apply the same canonical values. (If you later show canonical at the preview, this needs the monotonic request id the client-ui reader described.)
- `src/lib/components/VideoPreview.svelte:12-22`: make the failure latch per-URL, because `/details` can now replace `preview.artwork` after mount:
  ```svelte
  let failedArtwork = $state<string | null>(null);
  let imageSrc = $derived(
  	preview.artwork && preview.artwork !== failedArtwork ? preview.artwork : preview.thumbnail,
  );
  function handleArtworkError() {
  	if (preview.artwork) failedArtwork = preview.artwork;
  }
  ```
  `tests/unit/components/video-preview.test.ts:125` ("falls back to the thumbnail when official artwork fails to load") stays green: one artwork URL, errored, still yields the thumbnail src.
- `src/lib/types.ts`: **no change.** `artist`, `title`, `artwork`, `duration` already exist and the `/details` response is untyped at the call site.

### Step 8 — `docs/error-reporting.md`

Add the `service: "catalog"` row (warning level, `operation: "lookup"`, a miss is normal and unreported). The spec assigns this file to Stage B; it currently has no `catalog` mention.

---

## 2. The exact `TrackQuery` at each call site

One rule, everywhere: **`artist` and `title` come from the heuristic identity — never from a verdict, never from `details.track`/`details.artist`.** Only `isrc` and `durationSeconds` differ by stage. That is what makes `candidateCacheKey` (`lookup-catalog.ts:88`, which folds in the search term and the normalized ISRC and ignores duration) identical across all four sites, which is requirements 5 and 6.

**(a) YouTube preview** — `src/routes/api/preview/+server.ts`, after `fetchYouTubeMetadata` (`:109`):
| field | value | note |
|---|---|---|
| `artist` | `metadata.artist` | `resolveTrackIdentity` over the oEmbed title (`youtube-metadata.ts:24`) |
| `title` | `metadata.trackTitle` | never `metadata.videoTitle` |
| `isrc` | omitted | oEmbed has none, and `details.isrc` is never set for YouTube |
| `durationSeconds` | omitted | oEmbed has none — so a YouTube preview can only ever match `via: "agreement"` |
| options | `{ timeout: PREVIEW_ARTWORK_TIMEOUT }` (4000), no enrich | |

**(b) YouTube `/details`** — after the `details.duration` guard (`:69`):
| field | value | note |
|---|---|---|
| `artist` | `body.artist` when it is a string, else `details.artist`, else `resolveTrackIdentity(details.title, details.uploader, details.label).artist` | the echo is what guarantees the shared key |
| `title` | `body.title` when it is a string, else `details.track`, else that same `.trackTitle` | |
| `isrc` | omitted | |
| `durationSeconds` | `details.duration` | the new evidence; a `number > 0`, already `Math.round`ed (`video-metadata.ts:153-156`) |
| options | `{ timeout: 4000 }`, no enrich | normally a cache hit, so ~0 ms |

**(c) SoundCloud preview** — `previewSoundCloud`, after the refusal 422 (`:60`):
| field | value | note |
|---|---|---|
| `artist` | `soundCloudTitleState(track).artist` | already computed at `:62` |
| `title` | `soundCloudTitleState(track).trackTitle` | **never** `track.title` — the raw title carries `PREMIERE |` and `[Reboot Records]`, and an unclassifiable bracket is identity-class, i.e. a guaranteed miss |
| `isrc` | `track.isrc` raw | `presentString`-trimmed at `soundcloud-track.ts:106`; `normalizeIsrc` runs inside the key and the fetch, so do not pre-normalize |
| `durationSeconds` | `track.durationSeconds` | ms→s, rounded, `> 0` only (`soundcloud-track.ts:112-115`); `undefined` on the oEmbed fallback |
| options | `{ timeout: PREVIEW_ARTWORK_TIMEOUT }`, no enrich | |

SoundCloud's `/details` query is byte-identical (same cached track, same helper), so the SoundCloud verdict is **not provisional** and cannot change between stages — `/details` still returns the canonical fields, or the card correction would work on one platform and silently not the other.

**(d) Download** — inside `finalizeMp3`, after `Promise.all([detailsPromise, thumbnailPromise])`:
| field | value | note |
|---|---|---|
| `artist` | the `artist` argument | = the preview's `metadata.artist`, or `titleFromVideoDetails(...).artist` on the oEmbed-failure path (`download-stream/+server.ts:176-182`), or `soundCloudTitleState(track).artist` |
| `title` | the `trackTitle` argument | plainly, **not** `trackTitle \|\| videoTitle` — the `||` would diverge from the preview's key |
| `isrc` | `details?.isrc` | SoundCloud only; identical to what the preview passed |
| `durationSeconds` | `details?.duration` | yt-dlp for YouTube, `soundCloudDetails` for SoundCloud — no new extraction either way |
| options | `{ timeout: 6000, enrich: true }` | the one Deezer `/album` call for label and genre |

---

## 3. Where the verdict is fetched, and how it is threaded

| stage | fetched in | function | what is threaded |
|---|---|---|---|
| preview | `src/routes/api/preview/+server.ts:109` (YT) and `:62` (SC) | `sharedCatalogLookup` → `catalogArtworkUrl` | the artwork URL only |
| `/details` | `src/routes/api/preview/details/+server.ts:69` | `sharedCatalogLookup` | `metadata.artist`, `metadata.title`, `metadata.artworkUrl` into the JSON, match-only |
| download | `src/lib/download-pipeline/finalize-mp3.ts`, between `:118` and `:120` | `enrichedCatalogVerdict` | `canonical` → tags; `canonical.artist/.title` → filename; `{url, source}` → artwork |

`finalizeMp3` is the only function that already holds the resolved `details` (so the duration is in hand), the artwork decision (`:121`), the tag build (`:134`) and the filename build (`:180`) — fetching there means **no change to `FinalizeMp3Input`, `PreparedDownload`, `VideoDetails`, `prepare-download.ts`, the SSE `info` event, or `download-stream/+server.ts`**, which is what leaves all five download-stream test files untouched. It also lands inside the try/catch at `:114-174`, so a lookup bug can never fail a download.

Parameters added, exhaustively:

| function | file:line | new parameter |
|---|---|---|
| `buildID3Tags` / `ID3TagInput` | `src/lib/video-metadata.ts:269` | `canonical?: CanonicalMetadata`, `trustPlatformLabel?: boolean` |
| `resolveCoverArt` / `ResolveCoverArtInput` | `src/lib/artwork.ts:24` | `preferredArtwork?: PreferredArtwork` |
| `resolveAlbumArtImage` / `ResolveAlbumArtImageInput` | `src/lib/artwork.ts:197` | `preferredArtwork?: PreferredArtwork` |
| `resolveSoundCloudAlbumArt` / `ResolveSoundCloudAlbumArtInput` | `src/lib/artwork.ts:280` | `preferredArtwork?: PreferredArtwork` |
| `POST /api/preview/details` request body | `src/routes/api/preview/details/+server.ts:14` | optional `artist`, `title` strings |

Nothing else. `resolveArtworkUrl` keeps its signature (the spec promises that) and its tests, and becomes unused by production code — leave it; deleting it is a separate cleanup.

---

## 4. Existing assertions that must change — the approval list

**Exactly one.**

| # | file:line | old | new | avoidable? |
|---|---|---|---|---|
| 1 | `tests/unit/api/preview.test.ts:227-231` — test "queries artwork with the parsed artist and track title" (`:208`) | `expect(resolveArtworkUrl).toHaveBeenCalledWith("Rick Astley", "Never Gonna Give You Up", { itunesSize: 300, timeout: 4000 })` | `expect(sharedCatalogLookup).toHaveBeenCalledWith({ artist: "Rick Astley", title: "Never Gonna Give You Up" }, { timeout: 4000 })` | **No**, not while requirement 6 holds. The lookup makes 2 searches (iTunes `limit=10` + Deezer `limit=10`) and `resolveArtworkUrl` makes 2 more; keeping both is 4 searches per preview where today there are 2. Same intent, same single assertion, same test name. |

Escape hatch if you refuse it: keep `resolveArtworkUrl` as a last-resort fallback that runs only when `catalogArtworkUrl(lookup)` is `undefined`. The assertion then passes verbatim (the happy-path test's mocked lookup produces no artwork), at the cost of 2 redundant searches on exactly the miss case — which the spec's line "artwork falls back to today's order **using the same responses**" rules out.

Nothing else changes. These are the ones I checked and confirmed stay green, so they are not "fixed" by accident while the files are open:

- `preview.test.ts:205` (`data.artwork` toBe `.../300x300bb.jpg`) and `:255` (`toBeUndefined`) — **#given rewires only**: point the mocked lookup at that artwork URL / at an unmatched verdict with no candidates. The `expect` lines stay byte-identical (the downscale helper is a no-op on a `300x300bb` URL).
- `preview.test.ts:128`, `:129`, `:130`, `:179` (videoTitle / artist / title) — unchanged, because the preview keeps the heuristic identity.
- `preview.test.ts:156` (`not.toHaveProperty("duration")`) — unchanged; never put a candidate's duration in the preview body.
- `preview.test.ts:432`, `:446`, `:460`, `:475`, `:487`, `:499`, `:511` (bgutil prewarm, stubbed global `fetch`) — unchanged **only with the new catalog mock**; without it the stub records catalog calls (`:475`, `:487`) and the never-resolving stub at `:492` hangs the handler so `:499` times out instead of failing.
- `preview-soundcloud.test.ts:61-69` (whole-body `toEqual`) — unchanged: heuristic artist/title, `artwork: TRACK.artworkUrl` (the upload's cover still wins), no new keys.
- `preview-soundcloud.test.ts:70` (`resolveArtworkUrl` not called) — unchanged, now vacuous; leave it.
- `preview-soundcloud.test.ts:87-90` (`artwork: "https://store/art.jpg"`) — **#given rewire only**: that URL moves onto the mocked candidate.
- `preview-soundcloud.test.ts:101-104`, `:119` (the 422 and the 404) — unchanged, and they are what enforce "a refused track costs no catalog calls".
- `preview-soundcloud.test.ts:131` (`fetchMock` not called) — unchanged with the catalog mock. Note its comment's claim stops being true of production; narrowing it to `not.toHaveBeenCalledWith(stringContaining("/ping"), …)` would itself be a changed expectation, so leave it.
- `preview-soundcloud.test.ts:147` (`{success:true,duration:201}`) and `:161-162` (`{success:true}`) — unchanged: match-only keys plus an unmatched mock.
- `preview-details.test.ts:140` (`{success:true,duration:213}`) and `:155` (`{success:true,duration:214}`) — unchanged, and structurally so: those fixtures are `mockYtDlpJson({duration: 213})` with no `title`/`uploader`/`track`/`artist`, so `detailsQuery` yields a blank identity, `sharedCatalogLookup` returns early, and no key is added.
- `preview-details.test.ts:214`, `:252`, `:265`, `:280` — unchanged; the lookup runs after the missing-duration branch, and `execFileMock` is still called once.
- `finalize-mp3.test.ts:222-238` (typed `FinalizeMp3Input` literal) — unchanged; `FinalizeMp3Input` gains nothing.
- `finalize-mp3.test.ts:31` (`vi.mock("$lib/video-metadata", () => ({ buildID3Tags }))`) — unchanged, provided `finalize-mp3.ts` adds no runtime import from that module.
- `finalize-mp3.test.ts:322-327`, `:346-350` (exact-object `resolveSoundCloudAlbumArt` call), `:351` — unchanged with the conditional `preferredArtwork` spread and an unmatched mock.
- `id3-enrichment.test.ts:25`, `:43`, `:57` (`Object.keys(tags).sort()` — the only exhaustive key set), `:75` — unchanged; every canonical field stays conditional.
- `video-metadata.test.ts:399`, `:431`, `:454`, `:472`, `:491` — unchanged; `canonical` is optional and sits strictly above `details`, never replacing it.
- `download-stream-soundcloud.test.ts:117`, `download-stream-title-fallback.test.ts:102`, `:122`, `:138`, `:163` — unchanged; the `info` event and the route's `finalizeMp3` arguments are untouched. (`toContainEqual` at `:117`/`:122` is containment, but nothing new is emitted anyway.)
- `download-stream-sidecar-wait.test.ts:183` (first three status messages) — unchanged; no status for the lookup.
- `artwork.test.ts` — **no assertion changes at all**, including the order pins at `:103`, `:194`, `:268`, `:405` and the `result?.source` trio at `:436`, `:458`, `:476`. The `{url, source}` shape is why `source` stays honest without a new union member; the order pins survive because the new branch adds no fetch when the option is absent.
- `artwork-soundcloud.test.ts:31`, `:32`, `:59`, `:84` — unchanged, and `:31` (`toHaveBeenCalledTimes(1)`) is the assertion that dictates the preferred URL goes *after* the upload's own artwork.
- `video-preview.test.ts` — all twelve `VideoPreviewType` literals compile (no required field added; vitest does not type-check, so read `bun run check`'s verdict) and `:125-128` survives the latch change.
- `preview-skeleton.test.ts:25` (`placeholders.length).toBe(3)`) — unchanged; no third card line.
- `tests/e2e/app.spec.ts:47`, `:51`, `:54`, `:76`, `:101`, `:147`, `:167-172` — unchanged; the routes are stubbed and the handler never runs. `:167`'s `img[alt="Test Title"]` is safe only because that test lets the real `/details` fail, so add a `/details` stub there and at `:101` — an addition, not a change.

---

## 5. Tests to add

1. `tests/unit/metadata/catalog/catalog-cache.test.ts` — two lookups for the same query fetch candidates once (stub `fetch`, count calls), and `clearCatalogCandidateCache()` resets it.
2. same file — a `CatalogUnavailableError` is not cached: the next call refetches, while an empty `[]` result is cached.
3. same file — `sharedCatalogLookup` returns `unmatched` and never touches the cache for a blank artist+title.
4. same file — a judging exception is captured at `warning` with `service: "catalog"` and answered with `unmatched`.
5. same file — `catalogArtworkUrl` prefers the matched candidate's cover, then the first iTunes candidate's, then any candidate's, and is `undefined` with none.
6. `tests/unit/api/preview.test.ts` — the YouTube preview queries the catalog with the parsed identity and the 4 s budget (the rewritten assertion #1).
7. `tests/unit/api/preview.test.ts` — a matched verdict supplies `data.artwork` from the matched candidate, downscaled to `300x300bb`.
8. `tests/unit/api/preview.test.ts` — an unmatched verdict still supplies `data.artwork` from the top iTunes candidate (the `Adele – Hello` class of miss).
9. `tests/unit/api/preview.test.ts` — a matched verdict does **not** change `data.artist`/`data.title` (the preview stays heuristic and provisional-free).
10. `tests/unit/api/preview-soundcloud.test.ts` — the SoundCloud query carries the upload's ISRC and duration.
11. `tests/unit/api/preview-soundcloud.test.ts` — a refused (Go+) track runs no lookup at all.
12. `tests/unit/api/preview-soundcloud.test.ts` — the upload's own cover still wins over a matched candidate's.
13. `tests/unit/api/preview-details.test.ts` — a matched verdict adds `artist`, `title` and `artwork` to the 200 body.
14. `tests/unit/api/preview-details.test.ts` — an unmatched verdict adds nothing, so the body is still `{success, duration}`.
15. `tests/unit/api/preview-details.test.ts` — the query carries `durationSeconds` from the yt-dlp extraction, and prefers the client-echoed artist/title over the yt-dlp-derived ones.
16. `tests/unit/api/preview-details.test.ts` — a lookup that throws still returns the duration with status 200 and files no `load-details` issue.
17. `tests/unit/api/preview-details.test.ts` — a preview followed by `/details` for the same URL fetches candidates once (the missing half of requirement 5).
18. `tests/unit/services/finalize-mp3.test.ts` — the catalog query is built from the heuristic `artist`/`trackTitle` plus `details.isrc`/`details.duration`, with `enrich: true`.
19. `tests/unit/services/finalize-mp3.test.ts` — a matched verdict renames the file to `Canonical Artist - Canonical Title.mp3`.
20. `tests/unit/services/finalize-mp3.test.ts` — a matched verdict's `artworkUrl` reaches both resolvers as `preferredArtwork` with its `source`, and is absent when unmatched.
21. `tests/unit/services/finalize-mp3.test.ts` — a lookup rejection neither fails the download nor changes the filename.
22. `tests/unit/video-metadata.test.ts` — `canonical` outranks `details` for title, artist, album, year and genre, and is ignored when absent.
23. `tests/unit/video-metadata.test.ts` — `canonical.album` being `undefined` on a compilation falls through to `details.album`.
24. `tests/unit/video-metadata.test.ts` — `trustPlatformLabel: true` keeps SoundCloud's `label_name` over the catalog label; `false` lets the catalog label beat YouTube's scraped ℗ line.
25. `tests/unit/video-metadata.test.ts` — `remixArtist` is derived from the **canonical** title on a match (no new code, but it is the spec's TPE4 row).
26. `tests/unit/metadata/id3-enrichment.test.ts` — an unmatched verdict adds no ID3 key (the exhaustive key set again, with `canonical: undefined` passed explicitly).
27. `tests/unit/artwork.test.ts` — `resolveCoverArt` returns the preferred URL's bytes with the preferred `source` and makes no iTunes search; and falls through to today's order when that URL fails.
28. `tests/unit/artwork.test.ts` — the preferred fetch is issued with `redirect: "manual"` and a 3xx counts as a miss.
29. `tests/unit/artwork-soundcloud.test.ts` — the preferred URL is tried after the upload's artwork and before iTunes.
30. `tests/unit/components/video-preview.test.ts` — a new `preview.artwork` after a previous one errored is rendered (the latch is per-URL).
31. `tests/e2e/app.spec.ts` — stub `/api/preview` with a heuristic identity and `/api/preview/details` with a canonical one; the card's title and artist update in place.
32. `tests/unit/metadata/catalog/canonical-identity-characterization.test.ts` — extend with the wired end state for the corpus titles, per the spec's "a separate canonical characterization test".

---

## 6. Do NOT do in this PR

- **Don't canonicalise `artist`/`title` in the `/api/preview` response.** It makes the preview verdict visible and therefore retractable, which needs either an always-present `canonical: null` on `/details` (breaks `preview-details.test.ts:140`, `:155`, `preview-soundcloud.test.ts:147`, `:162` — four approvals) or a second `heuristic` field on the preview body (breaks the whole-body `toEqual` at `preview-soundcloud.test.ts:61`), plus a monotonic request id in `+page.svelte` because the debounce `$effect` re-previews an unchanged URL whenever `error`, `loading` or `downloadComplete` change (`:154`, `:158`, `:175`). If you want it anyway, that is the exact bill: 1 extra response field, 4 changed `toEqual`s or 1 changed `toEqual`, and the request-id guard.
- **Don't add a provenance field to `VideoDetails`** for the label split. `soundcloud-metadata.test.ts:51` is a strict whole-object `toEqual`; the `trustPlatformLabel` input on `ID3TagInput` honours the spec's field table with no test change.
- **Don't write the canonical identity into `details.track`/`details.artist`.** `soundcloud-metadata.test.ts:67-68` pins their absence, and that slot's whole purpose is keeping SoundCloud's raw title and publisher credit out — the type cannot tell "raw SoundCloud artist (forbidden)" from "canonical artist (required)".
- **Don't put the lookup in `prepare-download.ts`.** It would widen or duplicate the SSE `info` event (`download-stream-soundcloud.test.ts:117`, `download-stream-title-fallback.test.ts:122`, both exact-equality) and make `download-stream-soundcloud.test.ts` call the live catalogs, since it mocks neither `$lib/artwork` nor `fetch`. `finalizeMp3` already has everything.
- **Don't send canonical fields through the SSE stream.** The client reads only `data.title` (`+page.svelte:299`) and never renders `videoTitle` or `completedFilename`; the filename already comes back on the `complete` event.
- **Don't add `album`, `year`, `genre`, `label` or `isrc` to either route's response.** Nothing renders them (`VideoPreview.svelte:47-52` is title + artist + duration chip), the download re-judges and tags server-side, and a Deezer-only match can carry an album name that download-time enrichment then drops (`lookup-catalog.ts:138`).
- **Don't add a "verified" badge or a third card line.** `preview-skeleton.test.ts:25` pins three `.bg-muted` blocks to the card's geometry, and a mark that can vanish teaches distrust. If you want provenance visible, suffix the existing artist line — no skeleton change, no test change.
- **Don't turn `enrich` on at the preview or `/details`.** It is one Deezer `/album` call per keystroke pause for fields neither stage shows.
- **Don't key the shared cache on the media-link id.** Judging query B against candidates fetched for query A is unsound; the key must stay the search term (`lookup-catalog.ts:82-93`).
- **Don't cache verdicts.** The whole staged-evidence design depends on re-judging cached candidates.
- **Don't emit a new status message for the lookup.** `download-stream-sidecar-wait.test.ts:183` pins the first three positionally, and one log line per verdict is the spec's budget.
- **Don't change `fetchBufferWithTimeout` to `redirect: "manual"` globally.** It serves the YouTube thumbnail and the sndcdn paths too; the new gate belongs in its own helper.
- **Don't delete `resolveArtworkUrl`** even though production stops calling it. The spec promises its signature, `artwork.test.ts` covers it, and removing it is a separate cleanup.
- **Don't move `prewarmBgutilPot()` (`preview/+server.ts:107`)** or await anything before it — the wake must overlap the now-awaited lookup.
- **Don't reuse `lookupCatalogMetadata`'s 6000 ms default at the preview.** Pass 4000 explicitly, or the preview's budget silently grows by 50%.

**Known deviations to put in the PR description, not to fix here:** a SoundCloud preview goes from zero outbound store calls to 2 (3 with an ISRC) — the spec's own Stage B table signs up for this, and it is the one place requirement 6 does not hold; and a download reached with no preview (a direct curl, the canary) pays 2 net-new searches against 1 saved iTunes search, because the cost table assumed a warm cache.