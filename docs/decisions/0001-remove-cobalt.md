# 0001 — Remove Cobalt

- **Status:** Accepted
- **Date:** 2026-07-28
- **Supersedes:** `docs/cobalt-integration-spec.md` (deleted in the same change; see git history)

## Context

Cobalt was the primary download path and yt-dlp was the fallback. In practice that
arrangement had inverted itself without anyone noticing: Cobalt silently returned
`HTTP 200` with `content-length: 0` for most videos, so effectively all traffic fell
through to yt-dlp — whose datacenter IP YouTube then rate-limited, because it was
absorbing 100% of the load while nominally being a backstop.

The failure was invisible from the outside. Cobalt answered the API request with
`{status: "tunnel", url: …}` and no error; only the tunnel body was empty. Our client
treated an empty body as "Cobalt failed, fall back", so the user-visible symptom was a
generic yt-dlp error, several seconds later than necessary.

Root cause was measured inside the running production container (cobalt 11.7.1,
youtubei.js 17.0.1). See [Evidence](#evidence) for the raw numbers.

The short version: Cobalt probes the media URL with a `HEAD` request before streaming,
YouTube answers `403` to that HEAD, and Cobalt's error path ends the response with a
bare `res.end()`. That produces the 200-with-empty-body. But repairing the probe would
not have fixed anything, because googlevideo only serves roughly the **first 1 MB** of
those URLs before it starts returning 403 — the URLs Cobalt resolves carry no `pot`
parameter, and a gvs PO token cannot be attached after the fact. It has to be bound at
extraction time.

yt-dlp does not have this problem for the same videos: it binds a gvs PO token from the
`bgutil-pot` sidecar during extraction (`player_client=web_safari,mweb,tv`). Cobalt
11.7.1 cannot do this for our audio-only flow, and the web-family clients that could
would additionally need signature decipher, which throws
`must provide your own JavaScript evaluator` in Cobalt's container.

Keeping a broken Cobalt in front of yt-dlp was not merely useless, it was actively
harmful. Every failed Cobalt attempt still cost a real YouTube extraction from the same
rate-limited datacenter IP, making the rate-limiting it was supposed to protect us from
measurably worse.

## Decision

Remove Cobalt from the codebase entirely. yt-dlp (with `bgutil-pot` for PO tokens) is
the only download path.

Concretely: `src/lib/cobalt.ts`, `src/lib/download-pipeline/try-cobalt.ts` and the
unused `/api/download-cobalt` route are deleted; `/api/download-stream` calls yt-dlp
directly with no fallback branching; `COBALT_API_URL`, `COBALT_API_KEY` and
`COBALT_TUNNEL_HOST` are gone; `/api/health` no longer probes Cobalt; and the
`cobalt-8x3f` service block is removed from `railway.toml`.

`bgutil-pot` stays. yt-dlp depends on it, and without it downloads fail fast.

## Consequences

- **One download path, no silent fallback.** Failures now surface from the layer that
  actually failed instead of being masked by a preceding fake failure.
- **Fewer YouTube extractions per download.** Dropping the Cobalt attempt removes one
  round-trip against the rate-limited IP on every request.
- **`bgutil-pot` is now load-bearing, not optional.** `BGUTIL_POT_URL` must be set or
  `/api/download-stream` fails immediately with an explicit configuration error. This
  was previously survivable because Cobalt "usually succeeded" — which, per the above,
  it did not.
- **`DownloadMethod` narrows to `"yt-dlp"`.** The `downloadMethod` field stays on the
  SSE `complete` event so the wire contract is unchanged, but it now has exactly one
  possible value.
- **No resilience lost.** The removed fallback was already non-functional for the
  affected videos. For unaffected videos yt-dlp handles them too.
- **Deleting the Railway `cobalt-8x3f` service and its variables is a separate manual
  step.** This change removes the declaration from `railway.toml`; it does not delete
  the deployed service.
- **Reverting is not just a `git revert`.** Restoring Cobalt would mean re-provisioning
  the Railway service *and* solving the PO-token binding problem that made it useless.

## Evidence

Measured inside the running production container, cobalt 11.7.1 / youtubei.js 17.0.1.

### The 200-with-empty-body

Cobalt's `handleChunkedStream` (`api/src/stream/internal.js`) probes the media URL with
a `HEAD` request before streaming. YouTube returns **403** for HEAD on the affected
URLs, so Cobalt calls `cleanup()` — a bare `res.end()` — producing a 200 with an empty
body and no `content-type`.

That is only the first symptom.

### googlevideo serves ~1 MB, then 403s

| Request | Result |
|---|---|
| `GET bytes=0-0` | 206, `content-range: bytes 0-0/4557665` |
| `GET bytes=0-1048575` (1 MB) | 206 |
| `GET bytes=0-2097151` (2 MB) | **403** |
| sequential 1 MB chunks — first | 206 |
| sequential 1 MB chunks — second (`bytes=1048576-2097151`) | **403** |

Total retrievable: **1,048,576 of 4,557,665 bytes.**

So patching the HEAD probe into a ranged GET is *not* sufficient — it recovers the size
and then 403s on the very next chunk.

### The tokens

- The resolved URLs carry no `pot` parameter.
- Appending a gvs PO token afterwards does not lift the limit. It must be bound at
  extraction time.

### `retrieve_player` is a red herring

On Cobalt's default IOS client, both `retrieve_player: false` and `true` give
playability OK and 22 formats, and **both** 403 on HEAD. The "0 formats / UNPLAYABLE"
result that shows up in discussions of this bug only occurs on youtubei.js's default
WEB client, which Cobalt does not use for this flow.

### Not every video is affected

`dQw4w9WgXcQ` returns HEAD 200 with a full content-length and downloads fine. This is
why the failure went unnoticed for so long, and why it is a **bad smoke test** — a
green result on that video says nothing about the videos that were failing.

### Upstream

Unresolved as of this decision: [imputnet/cobalt#1565](https://github.com/imputnet/cobalt/issues/1565),
[#1455](https://github.com/imputnet/cobalt/issues/1455),
[#1475](https://github.com/imputnet/cobalt/issues/1475).

Upstream commit `068ae2f2` added a `transplant` retry for YouTube HEAD 403s. That
cannot converge for us: our 403 is deterministic, not transient.
