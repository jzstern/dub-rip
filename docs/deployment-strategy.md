# Deployment Strategy: Railway

## Overview

This document outlines the deployment architecture for dub-rip on Railway: the SvelteKit app downloads via yt-dlp, with a bgutil-pot sidecar supplying the PO tokens yt-dlp needs.

> **Cobalt was removed (2026-07).** It used to be the primary download path. It silently
> returned empty bodies for most videos, so all traffic fell through to yt-dlp anyway
> while still costing a YouTube extraction per attempt. See
> [ADR 0001 — Remove Cobalt](decisions/0001-remove-cobalt.md) for the measurements and
> the reasoning.

### Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                       Users                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Railway Project                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │              dub-rip SvelteKit App                        │      │
│  │  • Git-push deployment                                    │      │
│  │  • Python via RAILPACK_DEPLOY_APT_PACKAGES (yt-dlp)       │      │
│  │  • BGUTIL_POT_URL → bgutil-pot.railway.internal           │      │
│  └───────────────────────────────────────────────────────────┘      │
│                     (yt-dlp PO tokens)                              │
│                              ▼                                      │
│                  ┌────────────────────────┐                         │
│                  │  bgutil-pot            │                         │
│                  │  (port 4416)           │                         │
│                  └────────────────────────┘                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Architecture

| Requirement | Solution |
|-------------|----------|
| YouTube bot detection | bgutil-pot provides the PO tokens yt-dlp binds at extraction time |
| No user cookies needed | bgutil-pot solves BotGuard headlessly, no Google account |
| Simple deployment | Git-push for app, Docker template for the sidecar |
| Internal networking | Services communicate via Railway's private network |

## Component Details

### 1. dub-rip App (SvelteKit)

The main web application that provides the user interface and orchestrates downloads.

**Deployment:**
- Connect GitHub repository to Railway
- Automatic deployment on push to main
- `bun run build` runs `scripts/fetch-yt-dlp.mjs` first, which bakes a pinned yt-dlp and the bgutil plugin into `bin/` (see [yt-dlp version pinning and the baked binary](#yt-dlp-version-pinning-and-the-baked-binary))
- Healthcheck (set in the Railway dashboard — this service isn't declared in `railway.toml`, only bgutil-pot is): plain `GET /api/health`, **never** `GET /api/health?probe=bgutil`. The `?probe=bgutil` form contacts the sidecar and returns 503 while it's asleep, which is normal, not an outage — pointed at a healthcheck, that would get the app itself restart-looped for a dependency that isn't actually down. See [Sidecar prewarm from the preview request](#sidecar-prewarm-from-the-preview-request) below for the other place this sleep behavior matters.

**Environment Variables:**
```bash
# Required: Python for yt-dlp
RAILPACK_DEPLOY_APT_PACKAGES=python3

# Required: bgutil-pot sidecar for yt-dlp PO tokens
BGUTIL_POT_URL=http://bgutil-pot.railway.internal:4416

# Optional: Error monitoring
PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project
SENTRY_DSN=https://your-key@sentry.io/project
```

### 2. bgutil-pot

Sidecar HTTP server that generates the YouTube PO tokens yt-dlp binds at extraction time. Uses [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) (the same upstream Cobalt's `youtubei.js` depends on) to solve YouTube's BotGuard challenge headlessly without a Google account.

**Why a separate service:** BotGuard requires loading and evaluating ~2.3 MB of YouTube's `base.js` in a JS runtime. Running this in-process inside the SvelteKit container allocated ~1 GB and SIGABRTed the entire web process mid-request. Isolating it in its own container caps the blast radius and lets the heavy runtime stay warm across requests.

**Docker Image:** `brainicism/bgutil-ytdlp-pot-provider:2.0.0@sha256:ed86b6fdd5e430ddd7c8ce1adb55e1ab54db7c7dbc1bcbf3a82454a85b971164` — pinned by both tag and digest (see [Image version pinning](#image-version-pinning); the BgUtils → BotGuard binding breaks when YouTube updates the player). Do NOT use `:latest`.

**Railway Service Name:** `bgutil-pot`

**Configuration:**
- No environment variables required (default port 4416 is fine)
- Internal networking only (no public exposure)
- Healthcheck: HTTP `GET /ping` returns 200 — `healthcheckPath = "/ping"` is set in `railway.toml`.

**No Python dependencies needed in dub-rip:** in HTTP-server mode the plugin only needs to be reachable as a `.zip` on yt-dlp's plugin path (we drop it via `--plugin-dirs`). No `pip install bgutil-ytdlp-pot-provider` required in the dub-rip container — and **do not add one**, since it would cause yt-dlp to load the plugin twice and error.

**Note on TOKEN_TTL:** the upstream README mentions a `TOKEN_TTL` env var, but it only applies to the script-method (option b) of the provider. When running as the HTTP server (option a, what we use), the cache TTL is fixed at the upstream default — there's no point setting it.

**Local development:** `BGUTIL_POT_URL` is unset by default, and downloads fail fast with an explicit configuration error in that case — there is no second path. Run the bgutil-pot Docker image locally to exercise downloads:

```bash
docker run --rm -d --init -p 127.0.0.1:4416:4416 --name bgutil brainicism/bgutil-ytdlp-pot-provider:2.0.0
# add BGUTIL_POT_URL=http://127.0.0.1:4416 to your dev Doppler config
doppler run -- bun run dev
```

Production and PR-preview environments get the var via Railway service vars; no `.env` files involved.

**Upgrade procedure:** bump both the tag and digest in `railway.toml` and in this doc (see [Capturing a digest](#capturing-a-digest)), redeploy, verify with a known-bad video.

## Railway Setup Steps

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app) and create a new project
2. Name it something like `dub-rip-production`

### Step 2: Deploy bgutil-pot

> **`railway.toml` handles this.** The `bgutil-pot` service is now declared in `railway.toml` with a digest-pinned image. For a clean install, Railway will provision it automatically — no manual dashboard step required. The steps below remain for reference or when re-provisioning into an existing project.

1. Add a new service → Docker Image
2. Image: `brainicism/bgutil-ytdlp-pot-provider:2.0.0@sha256:ed86b6fdd5e430ddd7c8ce1adb55e1ab54db7c7dbc1bcbf3a82454a85b971164` — pinned by tag and digest (see [Image version pinning](#image-version-pinning))
3. Service name: `bgutil-pot`
4. No environment variables required
5. **Keep bgutil-pot internal-only** (no public networking needed)
   - dub-rip communicates with bgutil-pot via Railway's private network at `http://bgutil-pot.railway.internal:4416`
6. Healthcheck: `GET /ping` returns 200 when the service is ready — set via `healthcheckPath` in `railway.toml`

### Step 3: Deploy dub-rip

1. Add a new service → GitHub Repo
2. Select your dub-rip repository
3. Add environment variables:
   ```bash
   RAILPACK_DEPLOY_APT_PACKAGES=python3
   BGUTIL_POT_URL=http://bgutil-pot.railway.internal:4416
   ```
4. Enable public networking

### Step 4: Verify Deployment

1. Check the bgutil-pot deploy logs in the Railway dashboard for successful startup
2. Test dub-rip by downloading a YouTube video through the web interface
3. (Optional) To test internal services, use Railway's shell feature:
   - Open Railway dashboard → Select service → Click "Shell"
   - Run: `curl http://bgutil-pot.railway.internal:4416/ping`

> **Note:** Internal `.railway.internal` URLs are only accessible from within Railway's private network. You cannot `curl` these URLs from your local machine.

## Download Flow

```text
1. User enters YouTube URL
2. dub-rip validates URL and extracts video ID
3. dub-rip runs yt-dlp
4. yt-dlp asks bgutil-pot for a PO token via http://bgutil-pot.railway.internal:4416
5. yt-dlp binds the token at extraction time and downloads the audio
6. dub-rip applies ID3 metadata
7. MP3 streamed back to user's browser
```

There is no fallback path. See [ADR 0001](decisions/0001-remove-cobalt.md) for why the
previous Cobalt-first arrangement was removed rather than repaired.

## Cost Analysis

| Service | Railway Credits | Notes |
|---------|-----------------|-------|
| dub-rip | ~$2-3/month | Depends on traffic |
| bgutil-pot | ~$1-2/month | Idle most of the time |
| **Total** | **~$3-5/month** | Within free tier for low usage |

Railway provides $5/month in free credits. For personal use or low traffic, you may stay within the free tier.

## Image version pinning

Pin service images to a specific version tag, never `:latest`.

**Why:** Railway resolves `:latest` to an image digest at deploy time and caches that digest. The deployment keeps running the same digest forever — even when upstream `:latest` moves on. A plain "redeploy" redeploys the same digest. So `:latest` gives you the false sense of freshness without the freshness.

**Why it matters for bgutil-pot:** its BgUtils → BotGuard binding is tied to YouTube's current player, which ships changes frequently (often weekly). A stale bgutil-pot mints PO tokens YouTube rejects (see [symptom: BotGuard lag](#symptom-yt-dlp-fails-on-all-videos-with-unmatched-yt-dlp-error--requested-format-is-not-available) below).

**Digest pinning:** `bgutil-pot` is pinned by digest in `railway.toml`. The tag is kept for human readability; the `@sha256:…` suffix is what Railway actually resolves and caches. This removes tag-retargeting and deployment-drift risk — the tag can't be silently repointed at different content under us. It does **not** protect against a compromised publisher or vulnerabilities in the image itself; reviewing what a new digest contains before bumping it is still on us.

### Capturing a digest

Use these commands to capture a digest for a new image version:

```bash
# Docker Hub (bgutil-pot):
TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:brainicism/bgutil-ytdlp-pot-provider:pull" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -sI "https://registry-1.docker.io/v2/brainicism/bgutil-ytdlp-pot-provider/manifests/<TAG>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  | grep -i "docker-content-digest"
```

**To upgrade:**

1. Check [the bgutil-ytdlp-pot-provider releases](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases) for the latest version.
2. Capture the new digest using the commands in [Capturing a digest](#capturing-a-digest) above.
3. Update both `railway.toml` (`services.bgutil-pot.source.image`) and this doc's pinned tag + digest.
4. Deploy. Verify with a known-bad video (see below) before closing the ticket.

## yt-dlp version pinning and the baked binary

**The pin lives in `scripts/yt-dlp-pin.mjs`** (`YTDLP_VERSION`, `BGUTIL_PLUGIN_VERSION`). Both the build step and `src/lib/yt-dlp-binary.ts` import it rather than restating the values — plain `node`/`bun` can't import the TypeScript module, so the dependency points that way round. It is deliberately side-effect-free: importing the build script itself would pull its fs, network and CLI entrypoint into the server bundle.

**The pin is a floor, not a ceiling.** The runtime still resolves `releases/latest` on a 24h background refresh, and that is deliberate — yt-dlp ships extraction fixes as YouTube changes, and a frozen binary eventually stops working. The baked pin exists only so a *cold* container has something to run instantly instead of blocking on a 40 MB fetch. Once the background refresh lands, `/tmp` wins and the pin is out of the picture until the next cold start.

So the pin needs to be a version known to work, not necessarily the newest. Upstream has shipped releases that regressed YouTube throughput ~30x ([yt-dlp#15036](https://github.com/yt-dlp/yt-dlp/issues/15036)), and that is exactly what you don't want frozen into the image.

**To upgrade yt-dlp:** bump `YTDLP_VERSION`, open a PR, and download a real video in the PR's preview environment before merging. Watch throughput, not just success.

### Cold starts and the baked binary

Both services sleep when inactive, so most sessions on a low-traffic app start cold. The yt-dlp binary is ~40 MB and `/tmp` is ephemeral, so every container start used to re-download it (measured at 7.8s on a fast connection) — and `/api/preview/details` awaits `ensureYtDlpBinary()`, putting that fetch in front of the user's first preview.

`scripts/fetch-yt-dlp.mjs` now downloads it at build time into `bin/`, which the deploy image carries. When `/tmp` is empty, `ensureYtDlpBinary()` returns `bin/yt-dlp` without waiting on anything, and starts the background refresh only once that binary is past the same 24h TTL the `/tmp` cache uses. The baked binary's mtime is when its bytes were fetched, so the TTL reads as "how old is this image" — a container running a week-old build still refreshes, while a freshly built one skips a GitHub API call and a 40 MB download it would almost certainly answer with the bytes already baked in. A baked binary missing its executable bit is ignored, since the `/tmp` fallback would otherwise already have been skipped.

**How often this branch actually runs.** Less often than "every cold start" suggests: `/tmp` survives app-sleep wake cycles within a deployment, so only the *first* container start after a deploy finds it empty. Production deployment `073ed0f` logged `Using baked yt-dlp binary at /app/bin/yt-dlp` once, two minutes after it went live, and not again across roughly thirty restarts over the following five days — every one of those took the `/tmp` branch. So the baked path is a per-deployment cost, not a per-wake one. It still sits in front of that deployment's first user, and preview environments redeploy on every push, which is where it adds up. `ensureBgutilPlugin()` does the same with `bin/yt-dlp-plugins/` — that one is pinned end to end, because the plugin and the sidecar speak a versioned protocol.

**The `/tmp` download path is still there and must stay.** It is the safety net for when the bake doesn't reach the deploy image. Same reason the fetch script exits 0 on failure: an unreachable GitHub at build time costs startup latency, not a broken deploy.

`bin/` is gitignored — it's a build artifact, and the binary is platform-specific (`yt-dlp_macos` locally, `yt-dlp_linux` on Railway).

**Verify a deploy actually got the baked binary.** The app logs its decision once at boot:

```text
Using baked yt-dlp binary at /app/bin/yt-dlp
```

If you instead see `No baked yt-dlp binary found; falling back to runtime download` followed by `Downloading yt-dlp binary...`, the bake did not survive into the deploy image. Downloads still work; they're just slow again. Check that Railpack ran the build script and preserved `bin/`.

On a *freshly deployed* instance that line should stand alone. `Refreshing yt-dlp binary in the background...` immediately after it means the baked binary is reading as older than the TTL — either the image genuinely is (fine, that's the refresh doing its job) or the builder normalized file mtimes in the image layer, which would make every cold start refresh again. Check the deploy's age before assuming the latter.

### Sidecar prewarm from the preview request

`POST /api/preview` fires a fire-and-forget `GET ${BGUTIL_POT_URL}/ping` after URL validation. bgutil-pot sleeps too, and its first PO token costs a BotGuard bootstrap (~2.3 MB of YouTube's `base.js`) on top of the container start. A user pastes a URL seconds before clicking Download, so the ping moves that wake off the download's critical path at zero idle cost — it was going to happen anyway, just later and in front of the user.

It pings `/ping` (the healthcheck) and never `/get_pot`, which would make the sidecar do real BotGuard work speculatively. The call is not awaited, is bounded by an `AbortSignal.timeout`, and swallows its own rejection, so a dead sidecar cannot affect the preview response.

## Removed: the 0-byte-tunnel runbook

This doc used to carry a Cobalt setup section, a Cobalt version-pinning rule, and a
diagnostic runbook for "0-byte tunnel responses" that told you to upgrade Cobalt. That
diagnosis was wrong, and Cobalt is gone — see
[ADR 0001 — Remove Cobalt](decisions/0001-remove-cobalt.md) for what was actually
happening and the measurements behind it. The deleted content is in git history.

## Symptom: yt-dlp fails on every video — check the JS runtime first

**Check this before assuming upstream BotGuard lag (next section).** The two produce overlapping symptoms, but this one is a config bug on our side and is instant to rule out.

yt-dlp needs a JavaScript runtime to solve YouTube's `n` challenge, and **it enables only Deno by default** — a Node binary sitting on `PATH` is *not* picked up automatically. Our image ships Node and no Deno, so for a long time production ran with no runtime at all:

```
[debug] JS runtimes: none
[debug] [youtube] [jsc] JS Challenge Providers: bun (unavailable), deno (unavailable),
        node (unavailable), quickjs (unavailable)
```

Downstream that looks like `n challenge solving failed`, then `Only images are available for download`, then `Requested format is not available` — and because extraction never completes, bgutil is never even asked for a PO token.

`buildJsRuntimeArgs()` in `src/lib/yt-dlp-binary.ts` fixes this by passing `--js-runtimes node:<process.execPath>`, pointing yt-dlp at the interpreter already running the server.

**Verify:** hit `/api/download-stream?debug=1&url=…` and grep the deploy logs for `JS runtimes:`. It must name a runtime (`node-24.x`), never `none`.

**Reproduce locally** (a dev box usually has Deno, which masks the bug):

```bash
env PATH=/usr/bin:/bin /tmp/yt-dlp -v --simulate -f bestaudio \
  --extractor-args "youtube:player_client=web_safari" "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## Symptom: `unable to download video data: HTTP Error 403: Forbidden`

Extraction succeeds, but the media fetch 403s. In the SSE stream the tell is a download that stops right after the format is chosen, with no `Destination:` line, on every retry:

```
[youtube] <id>: Downloading visionos player API JSON
[info] <id>: Downloading 1 format(s): 251
```

yt-dlp picked a format whose URL YouTube refuses to serve to this requester. bgutil-pot issues *WebPO* tokens, usable only by clients in `WEBPO_CLIENTS` (`yt_dlp/extractor/youtube/pot/utils.py`), so a format from a client outside that set goes out with no token. That was `android_vr` on the 2026.07.04 pin, and it is why `player_client` was once hand-pinned to `web_safari,mweb,tv`.

It is also `visionos`, the 2026.08.19 lead. On 2026-09-16 its direct https audio (itag 251) downloaded cleanly from a Railway PR env, then 403d on every production attempt with the same code, video, and format (Sentry DUB-RIP-9, release `629b020`). The difference is the egress IP, which a PR env does not share — **a PR-env pass cannot rule this symptom out; verify on dub.rip.**

**What did not fix it:** trying HLS audio first (`bestaudio[protocol^=m3u8]`, itags 233/234 on `visionos`). On 2026-09-17 production fetched the HLS manifest, then all 34 fragments were refused (403, escalating to 401) and skipped, and yt-dlp failed with `ERROR: The downloaded file is empty` — the same refusal, surfacing as an empty file because fragment errors go to stdout. Both DASH and HLS media were blocked; the block was on the IP, not the format.

**What fixed it:** a different egress IP. Enabling Railway Static Outbound IPs on the `dub-rip` service and redeploying restored downloads immediately (2026-09-17). The setting turned out to be three addresses, not one, and the next day YouTube throttled the watch page from production's egress; which of the three (or how many) is flagged is unknown — see [the 2026-09-18 section](#symptom-watch-page-http-error-429-then-the-bot-check-2026-09-18). Check the current state with:

```bash
railway outbound-network status --service dub-rip --environment production --json
```

Railway does not guarantee static addresses are dedicated, and sustained traffic can get them flagged too. If this symptom returns on the static IPs, the durable option is routing yt-dlp through a residential proxy (`--proxy`).

**This is exactly the failure `POST /api/canary` exists to catch within hours instead of days** — see the Production Canary section in [`../.claude/claude.md`](../.claude/claude.md#production-canary). It classifies this exact symptom as stage `media_refused` (or `fragments_refused` for the HLS-fragment variant below) and only means anything because it runs inside the `dub-rip` service itself: a canary on a separate service, in a GitHub Action, or in a PR environment shares none of production's egress IP and would have passed throughout this entire incident, the same way the PR env above did.

Do **not** exclude the client with `player_client=default,-visionos`: that leaves only `web`, which YouTube serves SABR-only at this pin (`YouTube is forcing SABR streaming for this client`), so the download fails with "Requested format is not available" instead. And do not go back to a hand-picked list — that list is what YouTube bot-checked on 2026-09-14 (next section).

## Symptom: watch page `HTTP Error 429`, then the bot check (2026-09-18)

Production extractions failed, and what reached Sentry was the bot check — the message the next section is about. The raw stderr of every failing run (production logs) shows a watch-page 429 ahead of it, in this order:

```
WARNING: [youtube] <id>: Unable to download webpage: HTTP Error 429: Too Many Requests
ERROR: [youtube] <id>: Sign in to confirm you’re not a bot
```

The `production-canary` Sentry monitor failed with stage `player_bot_check`, and a real download of `cpGHMGOeg-o` failed the same way. At the time the canary labelled the run `player_bot_check` because it pattern-matches the run's stderr for the bot check, which is what the `ERROR` line says; the 429 sits only in the `WARNING` line above it, so the label never mentioned it ([PR #125](https://github.com/jzstern/dub-rip/pull/125) gives a 429 its own `page_rate_limited` stage, so this holds only on builds without that change). **Read the raw stderr, not the stage.** The `HTTP Error 429` warning ahead of the bot check is what separates this from the two causes in the next section.

**What a 429 costs** (read from yt-dlp 2026.08.19 source, not reproduced): `_download_webpage_with_retries` retries only errors that are *not* HTTP 403/429, so `--extractor-retries` and `--retry-sleep` never apply and the run carries on without the page. It then has no visitor data — `_extract_visitor_data` is fed only the webpage and player `ytcfg`, never the `initial data API JSON` response. For the `web` client that means the player calls carry no visitor id and `web` gets no GVS PO token (yt-dlp warns `Missing required Visitor Data`). It does **not** cost the *player* PO token: that binds to the video id (`get_webpo_content_binding` in `pot/utils.py`), and `_video.py` fetches one whenever the page yielded no player response, so with `fetch_pot=always` it is minted. At 17:44 UTC bgutil-pot logged ~10 fresh tokens for the failing video, yt-dlp logged `[pot:bgutil:http] Generating a player PO Token for web client`, and the download still failed.

What is established is the outcome, not a mechanism: in the failing runs a watch-page 429 was followed by the bot check. Whether the missing visitor id and GVS token are what turned one into the other is not established — successes appear to lose the watch page too (see below), and why `visionos`, which takes no PO token, did not serve the video on the failing runs is unexplained.

**What it was not:**

- **A cold bgutil-pot sidecar.** At 17:44 UTC the sidecar was awake and minted ~10 fresh tokens for the failing video, and the download still failed.
- **Stale or missing player PO tokens.** Same evidence: the player token was minted for the failing video.
- **A YouTube-side change hitting everyone** — see the matched pair below.
- **Our own traffic, in the 03:57–16:44 UTC window that day:** the only yt-dlp traffic in it was the canary. Earlier days are not covered — sustained traffic can flag the addresses.

**The matched pair.** At 18:03:47 UTC, one `POST /api/preview/details` for the canary video `jNQXAC9IVRw` went to dub.rip and one to the PR env `dub-rip-pr-124`, at the same instant. Production returned a 500 with the identical 429 → bot-check stderr; the PR env returned a 200 (duration 19, 3.3 s). Same yt-dlp pin, argv and video, same instant. The difference to expect is the egress IP — a PR env does not share production's, per the Production Canary section of [`../.claude/claude.md`](../.claude/claude.md#production-canary) — but that is taken from those docs, not measured: neither IP was observed. So "YouTube is throttling production's egress IP" is the best-supported explanation, and the one remaining gap is that the addresses themselves were not observed.

This is the only way to ask "is it the IP?" without a shell in production. It costs one yt-dlp extraction per environment, so keep it to one pair; every call is a request from a datacenter IP, and bursts get that IP bot-checked for several minutes.

**Three addresses, not one.** As of 2026-09-18 `railway outbound-network status --service dub-rip --environment production --json` shows `staticIp.highAvailability: true` with three addresses in iad: 162.220.234.241 (zone eqdc4a), 152.55.180.240 and 152.55.180.241 (zone eqdc16a). "The egress IP" in this document and in `claude.md` means whichever of them a request left from. **Which of them is flagged, or how many, is unknown**, and it can't be read off a run: `railway logs --network` shows only the container's private `10.240.x.x` source, never the public address.

**Unexplained: the 03:57 UTC canary passed** on the same deployment, binary and argv. Its stderr is unknowable — successful runs discarded it, because the stderr listener was attached to the wrong object ([PR #123](https://github.com/jzstern/dub-rip/pull/123) fixes that) — so it can't be said whether that run met a 429.

**What production logs look like.** Every production run inspected on 2026-09-17/18 — the successes (deployments 90aee016 and 94d4b6b9, and the 03:57 canary) and the failures alike — logs `Downloading web player API JSON`. Per yt-dlp source, that line appears when the watch page's own player response is unavailable. (`Downloading iframe API JS` and `Downloading player <id>-main` also appear on healthy runs, so they mark nothing.) *Inference, not measured:* from Railway's IP the watch page is frequently or always unusable, so `web` routinely makes an explicit player call. A dev-box log looks different (see the webpage-client note in [`../.claude/claude.md`](../.claude/claude.md#yt-dlp-integration)).

**Investigating without a shell in production:**

- `railway ssh` needs an SSH key registered on the Railway account (`railway ssh keys add|github`) — an account-level change, not made here.
- `railway run` executes locally, so it proves nothing about egress.
- `railway logs --json` gives every line a nanosecond timestamp. In two failing runs (10:52 and 16:06 UTC) every line of a run carried the same timestamp — an observation from those two runs, taken to mean a run's log lines are flushed together — so ordering *within* a run can't be read from Railway timestamps.

**Open decision — neither option has been taken, and this section does not choose one:**

1. **Rotate or re-provision the Static Outbound IPs.** It is dashboard state with no trace in the repo, switching IPs is what fixed the 2026-09-16/17 refusal above, and Railway does not guarantee the addresses are dedicated. With three addresses and no way to tell which is flagged, it is unclear which to replace.
2. **Route yt-dlp through a residential proxy (`--proxy`).** The durable fallback named in the 403 section. Nothing for it exists yet: no proxy is wired in, and the circuit breaker described as Phase 2 in the Production Canary section of `claude.md` is a design, not code.

## Symptom: `Sign in to confirm you're not a bot` while bgutil-pot is healthy

Every video fails. The sidecar is up, `/api/health?probe=bgutil` is green, `BGUTIL_POT_URL` is
set, the plugin loads — and yt-dlp still gets bot-checked. There are two different causes, and
the extraction log tells them apart. Check which one you have before touching anything.

The same message also follows a throttled watch page: if the raw stderr shows `Unable to download webpage: HTTP Error 429` ahead of it, see [the 2026-09-18 section](#symptom-watch-page-http-error-429-then-the-bot-check-2026-09-18). That incident had tokens minted for the failing video — the signature of the next subsection — but that subsection's *diagnosis*, burned clients, is not what happened: a matched request from a PR env with the same argv and video succeeded at the same instant, so the block followed the egress IP rather than the client list (which the subsection already allows for, at its end).

### Tokens are being minted → the clients are burned

Each attempt logs `Generating a player PO Token …`, bgutil-pot logs a fresh `poToken:` for the
same video ID, and **every** attempt also logs:

```
WARNING: [youtube] No title found in player responses; falling back to title from initial data.
```

The token pipeline is working; YouTube has stopped serving those clients from this IP. This is
what happened on 2026-09-14 to the hand-picked `web_safari,mweb,tv` list — onset on a release
unchanged for 41 days, surviving restarts of both services and four deploys. Sentry showed zero
events of this signature in the prior 90 days.

**Fix:** follow yt-dlp's `default` chain (`YOUTUBE_EXTRACTOR_ARG` in `src/lib/yt-dlp-binary.ts`),
which moves with upstream as YouTube shifts. Verify from a PR env, never locally — a residential
IP hides this failure entirely. If the default clients are bot-checked from Railway too, the
block is on the IP rather than the clients, and no client choice will fix it.

### No token line at all → `fetch_pot` is not forcing one

The giveaway is a **negative**: no `Generating a … PO Token …` line for a client that issued a
player request. First rule out the normal case, which is narrower than it looks. `visionos` takes
no PO token, so a run it served legitimately logs none. But `web` is requested on every run
(`_extract_player_responses` loops over every client in the list): from a usable watch page it
reuses the page's player response with no API call, and without one it makes the explicit
`Downloading web player API JSON` call. Production logs show that call on every inspected run, so
there a missing token line is normal only when **no** `Downloading web player API JSON` line
appears. Once one does, `web` issued a player request, and no `Generating a player PO Token` line
beside it means this cause.

bgutil was never asked. yt-dlp's default `fetch_pot=auto` mints a token only when the client's
own policy demands one, and `web` declares the *player* token optional
(`PlayerPoTokenPolicy(required=False)` in the shared `WEB_PO_TOKEN_POLICIES`,
`yt_dlp/extractor/youtube/_base.py`). The innertube player request therefore goes out bare, and
from a datacenter IP YouTube answers it with the bot check. A GVS token — the one clients *do*
ask for — arrives too late, since it authorizes media URLs the player response never returned.

**Fix:** `fetch_pot=always`, which is part of `YOUTUBE_EXTRACTOR_ARG` in
`src/lib/yt-dlp-binary.ts`. It overrides the per-client policy and covers the player context.
If the sidecar is unreachable yt-dlp warns and continues token-less, so it degrades no worse
than `auto` did.

**Reproduce locally without a datacenter IP** — `player_skip=webpage` forces the player-API
path a bot-checked webpage would have forced anyway, and the contrast is the whole diagnosis:

```bash
yt-dlp -v --dump-json --skip-download --plugin-dirs ./bin/yt-dlp-plugins \
  --extractor-args "youtube:player_client=web;player_skip=webpage" \
  --extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416" \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | grep "PO Token for"
```

Without `fetch_pot=always` that prints only a `gvs` token. With it appended to the first
`--extractor-args`, a `player` token appears for `web`.

## Symptom: yt-dlp fails on all videos with "Unmatched yt-dlp error" / "Requested format is not available"

**User-visible symptom:** Videos that previously downloaded fine now fail. Users see _"Download service couldn't verify with YouTube"_ or _"Download failed. Please try a different video."_

**What's happening under the hood:**

YouTube ships changes to its BotGuard implementation periodically. The `bgutil-ytdlp-pot-provider` plugin and the [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) library track those changes upstream, but there's a lag — sometimes hours, sometimes a few days. While the upstream catches up, bgutil-pot generates PO tokens that YouTube rejects, and yt-dlp comes back empty-handed.

**Diagnose in 3 steps:**

1. **Confirm bgutil-pot is the failing layer.** From a Railway shell:
   ```bash
   curl -X POST http://bgutil-pot.railway.internal:4416/get_pot \
     -H 'Content-Type: application/json' \
     -d '{"content_binding":"hQrmtwhztnc"}'
   ```
   Compare against the bgutil-pot deploy logs for `Failed to generate IntegrityToken` or `Challenge timeout` lines. If those appear and persist across multiple `/get_pot` requests, BotGuard is the issue.

2. **Check the upstream tracker.** Open [Brainicism/bgutil-ytdlp-pot-provider issues](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/issues) and [LuanRT/BgUtils issues](https://github.com/LuanRT/BgUtils/issues). A recent "BotGuard broken after YouTube update" issue means you're in a known window.

3. **Check Sentry for the pattern.** Filter the `dub-rip` project to `environment:production` and the `download-stream` service. Two tags matter here: `category:unknown` is an error shape our classifier has never seen, and `category:transient` is a bot-check or 403 that survived every retry. A flood of either starting around the same wall-clock time strongly suggests a YouTube-side change. Note that expected failures (private, age-restricted, copyright) never appear as issues by design — see [`error-reporting.md`](./error-reporting.md).

**Fix:**

Bump the bgutil-pot tag. Check [the bgutil-ytdlp-pot-provider releases](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases) for a release published after YouTube's change. Update `railway.toml` (or the Railway dashboard if not yet declarative) and redeploy. Verify with a known-bad video before closing the ticket.

If the upstream hasn't released a fix yet, there's no app-side action — wait. yt-dlp is the only download path, so downloads stay broken until the token provider catches up.

## Decommissioned services

### Cobalt (2026-07)

Removed as the primary download path. It returned `HTTP 200` with an empty body for most videos, so traffic fell through to yt-dlp anyway while still spending a YouTube extraction per attempt. Not repairable at our layer: googlevideo caps the resolved URLs at ~1 MB because they carry no `pot` parameter, and a PO token has to be bound at extraction time. See [ADR 0001 — Remove Cobalt](decisions/0001-remove-cobalt.md).

Deleting the Railway `cobalt-8x3f` service object and its `COBALT_*` variables is a manual step, separate from removing it from `railway.toml`.

### yt-token-service (2026-06)

`yt-token-service` was a Node sidecar that generated PO tokens for Cobalt via `YOUTUBE_SESSION_SERVER`. Cobalt's `useSession` gate never fired for audio-only requests (the only kind dub-rip made), so the tokens it produced were thrown away while the service was polled every ~5 minutes. It was removed once confirmed to have no active callers.

**Update (2026-06-09):** the lingering Railway *service object* was deleted from the production environment. It still built from this repo via a Dockerfile that no longer exists, so it auto-deployed and failed on every PR (preview environments are cloned from production via `railway environment new --copy production`, then Railway auto-builds repo-connected services on push). With it removed from production, new PR environments no longer inherit it. Restoring now means recreating the Railway service, not just `git revert` + redeploy.

Background: [PR #52 research notes](https://github.com/jzstern/dub-rip/pull/52) (closed; investigation only). This was always separate from yt-dlp's PO-token needs, which [`bgutil-pot`](#2-bgutil-pot) serves and still serves.

## Maintenance

**Regular:**
- Monitor Railway dashboard for resource usage
- Check error logs for download failures
- Update Docker images when new versions release (see [Image version pinning](#image-version-pinning))
- The `production-canary` Sentry monitor should show a check-in roughly every
  6 hours; a missed check-in or 2 consecutive `error` check-ins means
  production downloads are broken *right now* (see the Production Canary
  section in [`../.claude/claude.md`](../.claude/claude.md#production-canary))

**When YouTube Changes:**
- Monitor [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) release notes for BotGuard-related updates.

**Troubleshooting Commands (via Railway Shell):**

To run these commands, open Railway dashboard → Select service → Click "Shell".

You can check service logs directly in the Railway dashboard.

## Security Considerations

1. **Internal Networking**: bgutil-pot is not exposed publicly
2. **Transport**: public ingress to the app terminates on Railway-provided HTTPS. App-to-sidecar traffic (`http://bgutil-pot.railway.internal:4416`) is plain HTTP over Railway's private network, which never leaves the project and is not reachable from the internet.
3. **Input Validation**: YouTube URLs are validated and video IDs extracted before reaching yt-dlp

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Railway pricing changes | Monitor usage, set spending alerts |
| YouTube blocks BotGuard bypass | Upstream bgutil/BgUtils updates; bump the pinned tag |
| bgutil-pot falls behind YouTube's player | Upgrade the image tag (see [Image version pinning](#image-version-pinning)) |
| Single download path — no fallback | Accepted deliberately; the previous fallback was non-functional. See [ADR 0001](decisions/0001-remove-cobalt.md) |
| Datacenter IP rate-limited by YouTube | Avoid adding yt-dlp call sites; don't load-test live environments |
| A yt-dlp release regresses download speed | Version is pinned in `scripts/fetch-yt-dlp.mjs`; bumps are deliberate and verified in a PR env |
| Baked `bin/` missing from the deploy image | Runtime `/tmp` download still works; boot log names which path was taken |

## References

- [Railway Documentation](https://docs.railway.app)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [ADR 0001 — Remove Cobalt](decisions/0001-remove-cobalt.md)
