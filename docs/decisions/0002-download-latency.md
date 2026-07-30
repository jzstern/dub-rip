# 0002 — Where download latency actually goes

- **Status:** Accepted
- **Date:** 2026-07-29
- **Related:** [ADR 0001 — Remove Cobalt](0001-remove-cobalt.md), PR #102 (app-layer reliability hardening)

> **Scope note.** The measurements below were taken before #102 landed. #102
> independently shipped an extraction cache, retry, a concurrency cap and binary
> freshness. Where it already solved something identified here, this ADR defers to it and
> says so rather than restating it — see [Superseded by #102](#superseded-by-102).

## Context

Downloads felt slow and the assumed cause was transfer speed from YouTube. Measuring the
pipeline stage by stage showed that assumption was wrong, and turned up one outright bug.

All numbers below were measured against `dQw4w9WgXcQ` (3:33) from a residential IP on an
M-series Mac. Railway's shared vCPU is slower for the ffmpeg stage, and its datacenter IP
is subject to the bot-checking described in ADR 0001, so treat these as a floor.

| Stage | Measured |
|---|---|
| yt-dlp extraction (player + JS challenge + m3u8) | 3.1 s |
| Audio transfer, 3.27 MiB | **< 1 s** @ 9.8 MiB/s |
| ffmpeg opus → mp3 128k | 2.2 s |
| Full production arg set, end to end | 8.3 s |
| yt-dlp binary fetched on every cold boot | 40 MB / 7.8 s |

The transfer was never the bottleneck. The time is extraction, redundant work, and one
selector bug.

### The selector bug

`-f "bestaudio/best"` has an unbounded fallback. When `bestaudio` matches nothing, `/best`
means *the best muxed format* — i.e. video. Probing format selection 9 times across 3
videos under the production client set (`youtube:player_client=web_safari,mweb,tv`), **6 of
9 probes selected a muxed video format.** One real download fetched **84,460,004 bytes** of
1080p H.264 over 39 HLS fragments where a **3,433,755-byte** audio-only stream existed — 25×
the data, plus an extra `[FixupM3u8]` ffmpeg pass.

The trigger is that audio-only DASH formats are intermittently absent from YouTube's
response. Removing `--no-warnings` immediately surfaced two distinct causes, which is the
clearest argument for having removed it:

```text
WARNING: [youtube] <id>: mweb client https formats require a GVS PO Token which was not
         provided. They will be skipped as they may yield HTTP Error 403.
WARNING: [youtube] <id>: Some tv client https formats have been skipped as they are
         missing a URL. YouTube may have enabled the SABR-only streaming experiment for
         the current session.
```

The first is ours to fix and `bgutil-pot` already does in production. **The second is not.**
YouTube's SABR-only streaming experiment ([yt-dlp#12482](https://github.com/yt-dlp/yt-dlp/issues/12482))
strips direct URLs from the `tv` client's formats — which, per the note below, is the only
client in our set that offers audio-only DASH at all. When a session is bucketed into SABR
there may be **no** audio-only format to select, and the fallback is then the only path.
That is why the fallback *target* matters: a 15–23 MB 360p progressive stream versus an
80 MB 1080p HLS one.

**How often does this actually fire in production? Less than the local numbers suggest.** The
9 probes above ran on a workstation with no `bgutil-pot`, so formats needing a GVS PO token
were being filtered out — which is precisely what pushes selection onto `/best`. A download
run against a deployed PR environment, with the sidecar minting real tokens, selected
**format 251** (audio-only opus, 3.27 MiB) and produced a correct 3,487,570-byte MP3.

So the local frequency was inflated by the missing sidecar and should not be read as a
production rate. The bug is still real — `/best` is genuinely unbounded, and the SABR
condition below can strip the `tv` client's formats even when tokens are fine — but the
bounded fallback is better understood as cheap insurance against a tail case than as a fix
for something happening on every download. It costs nothing either way.

Two further things worth recording, both verified:

- **`tv` is the only client in our set that supplies audio-only DASH formats.** `web`,
  `web_safari` and `mweb` supply none. It is load-bearing — do not remove it. This is a
  second, independent reason to keep the client list exactly as ADR 0001 left it.
- **`--no-warnings` was hiding the diagnostic.** yt-dlp emits
  `WARNING: [youtube] <id>: mweb client https formats require a GVS PO Token which was not
  provided. They will be skipped...` — precisely the signal needed to tell how often this
  fires in production.

### Work performed and then discarded

`--embed-thumbnail`, `--add-metadata` and both `--parse-metadata` pairs were entirely
wasted. `NodeID3.write` *replaces* the whole ID3 tag, so everything yt-dlp embedded was
destroyed milliseconds later. Verified directly:

```text
after simulated yt-dlp embed:  ["title","artist","comment","image","raw"]
after app NodeID3.write:       {"hasImage": false, "raw": ["title","artist","album","raw"]}
```

The cost was a thumbnail HTTP fetch, a webp→png conversion, and two extra ffmpeg rewrites
of the MP3 (`[Metadata]`, `[EmbedThumbnail]`).

### Extractions per download

Three, against an IP that YouTube already bot-checks: `/api/preview/details` for duration,
`fetchVideoDetails` for ID3 metadata, and the download itself. A single `--dump-json`
already carries what the first two need — `duration`, `upload_date`, `release_date`,
`categories`, `track`, `artist`, `album`, `album_artist`, `composer`, `bpm` — so calls 1 and
2 requested the same document twice, seconds apart.

**#102 fixed this** with `video-details-cache.ts` (10-minute TTL, single-flight dedup, wired
into both call sites). Recorded here only because the measurement is what motivated looking,
and because it corroborates the cost of an extraction independently.

### Cold start

Both Railway services have `Sleep when inactive: true`. Production deploy logs:

```text
20:31:47.721  Starting Container
20:31:48.378  Listening on http://0.0.0.0:8080
20:31:48.378  Downloading yt-dlp binary...
20:31:48.378  Downloading yt-dlp_linux from .../releases/download/2026.07.04/yt-dlp_linux
```

`/tmp` is ephemeral, so a 40 MB fetch repeats on every container start. `hooks.server.ts`
prewarms at boot, but on a sleeping low-traffic app most sessions are cold, and
`/api/preview/details` awaits `ensureYtDlpBinary()` — so the preview stalls behind it.

This measurement predates #102, which addressed the *long-lived instance* half of the problem:
a stale binary is now refreshed in the background on a 24h TTL, deliberately still tracking
`releases/latest` so upstream extraction fixes arrive as YouTube changes. That intent stands.
What it cannot reach is a container that has no cached binary at all — which, under app-sleep,
is most sessions.

## Decision

1. **Bound the format fallback**: `bestaudio[vcodec=none]/bestaudio/18/best[height<=360]/best`,
   plus `--concurrent-fragments 4` for the fragmented fallback. Worst case becomes a ~15–23 MB
   360p progressive stream instead of 1080p HLS.
2. **Stop suppressing warnings.** Drop `--no-warnings`; log warnings and attach them as Sentry
   breadcrumbs. Add `--no-update` so the pinned binary's version-age notice does not bury them.
3. **Delete the discarded postprocessors**: `--embed-thumbnail`, `--add-metadata`,
   `--parse-metadata`.
4. **Bake a pinned yt-dlp binary and the bgutil plugin into the image at build time** as a
   *floor* beneath #102's background refresh, serving them only when `/tmp` is empty and then
   calling `refreshBinaryInBackground()` immediately. #102's freshness intent is preserved
   whole; this covers only the cold container its TTL cannot reach. Prewarm the `bgutil-pot`
   sidecar from `/api/preview` so its BotGuard bootstrap is off the download's critical path.
5. **Stop shipping the MP3 as base64 over SSE.** The `complete` event now carries a single-use
   token; the browser fetches the file from `/api/download-file`, which streams it and unlinks
   it. Removes 33% wire inflation (3,409,848 B → 4,546,464 chars measured) and the server-side
   double buffering.

## Superseded by #102

Two items from the original investigation are **not** in this change, because #102 landed
first and did them better:

- **The extraction cache.** `video-details-cache.ts` covers it, and it feeds #102's retry and
  concurrency layers as well.
- **Replacing `releases/latest` with a hard pin.** #102 chose freshness deliberately and
  designed around the latency cost with a background refresh. Reversing that would trade a
  real reliability property (upstream extraction fixes arriving as YouTube changes) for a
  risk that its cooldown already bounds. The pin here sits underneath it as a cold-start
  floor instead.

## Consequences

- The pathological 80 MB case is gone. The measured 8.3 s end-to-end case became 4.7 s.
- **`--load-info-json` was evaluated and rejected.** It would remove the download's own
  extraction, but YouTube format URLs expire and yt-dlp skips expired ones with HTTP 403 —
  reintroducing exactly the silent-fallback class of failure ADR 0001 exists to prevent. Revisit
  only with an explicit, loud failure path.
- **A container replaced mid-handoff loses the download.** The token registry is in-process and
  the temp file is container-local, so a deploy, crash or sleep/wake between the SSE `complete`
  event and the browser's fetch takes both with it. Observed once on a PR environment during a
  force-push redeploy. The base64 payload could not fail this way — the bytes were already in the
  event.

  Accepted rather than fixed. The window is milliseconds, and the alternatives are all worse:
  auto-retrying costs a fresh YouTube extraction against the IP that ADR 0001 says is already
  rate-limited, and persisting the file needs a volume. Instead the endpoint logs the miss (an
  unlogged 404 there is indistinguishable from a client bug — that cost real diagnosis time
  once) and the client says what actually recovers it, with the URL and preview left on screen
  so re-downloading is one click.
- **A temp file now outlives its request.** Ownership passes to the token registry, which unlinks
  on transfer or on TTL expiry (swept on access, not on a timer — a timer would be background
  activity on a service deliberately allowed to sleep). A container restart clears any strays.
- **The filename now reaches an HTTP header.** It is derived from YouTube titles, so
  `Content-Disposition` is built with an escaped ASCII fallback plus RFC 5987 `filename*`, and is
  regression-tested against CRLF injection.
- **Railpack build-artifact preservation is confirmed.** Verified on the PR environment for this
  change — the build log shows `[fetch-yt-dlp] yt-dlp_linux 2026.07.04 → /app/bin/yt-dlp
  (39924536 bytes)` and the boot log shows `Using baked yt-dlp binary at /app/bin/yt-dlp`
  followed by `Refreshing yt-dlp binary in the background...`. The blocking
  `Downloading yt-dlp binary...` that production logs at every container start is gone. The
  `/tmp` fallback stays regardless, since nothing guarantees a future builder behaves the same.
- **Do not benchmark this against production.** Per `.claude/CLAUDE.md`, bursts get the datacenter
  IP bot-checked for several minutes. Measure locally or in a short-lived PR environment.

## Open thread: SABR

If YouTube's SABR-only experiment becomes the default rather than a bucketed session, audio-only
formats stop being reachable through the WebPO-capable clients and every download degrades to
transcoding a 360p video. Nothing in this ADR fixes that — it bounds the damage. Watch
[yt-dlp#12482](https://github.com/yt-dlp/yt-dlp/issues/12482); the warnings are no longer
suppressed, so Sentry breadcrumbs will show the rate climbing before users report it.
