# Deployment Strategy: Railway

## Overview

This document outlines the deployment architecture for dub-rip on Railway, using a self-hosted Cobalt instance with a bgutil-pot sidecar. bgutil-pot serves **two** consumers: it provides PO tokens for the yt-dlp fallback, and it acts as Cobalt's `YOUTUBE_SESSION_SERVER` — which is what lets Cobalt resolve stream URLs at all (see [§ Why `YOUTUBE_SESSION_SERVER` must be set](#why-youtube_session_server-must-be-set)).

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
│  │  • COBALT_API_URL → cobalt-8x3f.railway.internal          │      │
│  │  • BGUTIL_POT_URL → bgutil-pot.railway.internal           │      │
│  └───────────────────────────────────────────────────────────┘      │
│         (Internal API)          (yt-dlp PO tokens, fallback)        │
│                ▼                              ▼                     │
│   ┌─────────────────────────┐    ┌────────────────────────┐         │
│   │  Cobalt Instance        │    │  bgutil-pot            │         │
│   │  (port 9000)            │───▶│  (port 4416)           │         │
│   └─────────────────────────┘    └────────────────────────┘         │
│         YOUTUBE_SESSION_SERVER → POST /get_pot every 5 min          │
│         (enables retrieve_player; see § below)                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Architecture

| Requirement | Solution |
|-------------|----------|
| Cobalt can resolve stream URLs | `YOUTUBE_SESSION_SERVER` → bgutil-pot, which flips Cobalt's `retrieve_player` to true |
| YouTube bot detection | bgutil-pot provides PO tokens for the yt-dlp fallback |
| Self-hosted Cobalt | No rate limits or auth requirements from public APIs |
| No user cookies needed | Cobalt + bgutil-pot handle authentication |
| Resilience | yt-dlp fallback when Cobalt fails |
| Simple deployment | Git-push for app, Docker templates for services |
| Internal networking | Services communicate via Railway's private network |

## Component Details

### 1. dub-rip App (SvelteKit)

The main web application that provides the user interface and orchestrates downloads.

**Deployment:**
- Connect GitHub repository to Railway
- Automatic deployment on push to main

**Environment Variables:**
```bash
# Required: Cobalt API configuration
COBALT_API_URL=http://cobalt.railway.internal:9000
COBALT_API_KEY=your-api-key-uuid

# Optional: If Cobalt returns public tunnel URLs
COBALT_TUNNEL_HOST=your-cobalt-hostname.up.railway.app

# Required: Python for yt-dlp fallback
RAILPACK_DEPLOY_APT_PACKAGES=python3

# Optional: Error monitoring
PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project
SENTRY_DSN=https://your-key@sentry.io/project

# Required: bgutil-pot sidecar for yt-dlp PO tokens
BGUTIL_POT_URL=http://bgutil-pot.railway.internal:4416
```

### 2. Cobalt Instance

Self-hosted Cobalt API for YouTube downloads with BotGuard bypass.

**Docker Image:** `ghcr.io/imputnet/cobalt:11.7.1@sha256:63186dd68afd57ce3bb1f62cc4c139f5fa95b9c3e87a3cf5c6e4c7a570523f62` — pinned by both tag (human-readable) and digest (what Railway actually pulls). See [Cobalt version pinning](#cobalt-version-pinning) below. Do NOT use `:latest`.

**Environment Variables:**
```bash
# Required
API_URL=https://your-cobalt-hostname.up.railway.app/
API_PORT=9000
API_KEY_URL=file://keys.json

# REQUIRED — without this Cobalt builds no youtubei.js Player and every
# tunnel returns a 0-byte body. Points at the existing bgutil-pot service;
# do NOT point it at yt-session-generator (wrong protocol).
# See "Why YOUTUBE_SESSION_SERVER must be set" below.
YOUTUBE_SESSION_SERVER=http://bgutil-pot.railway.internal:4416

# Only consulted when Cobalt's useSession gate fires (>1080p non-h264/vp9).
# dub-rip is audio-only, so this never applies to our traffic.
YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
```

> Railway's config-as-code (`railway.toml`) covers service sources, build and deploy settings — **not** environment variables. `YOUTUBE_SESSION_SERVER` has to be set per-environment via the dashboard or `railway variables --set`, which is why it is documented here rather than committed.

**API Keys File (`keys.json`):**
```json
{
  "your-api-key-uuid": {
    "name": "dub-rip",
    "limit": 100
  }
}
```

Generate a UUID for your API key:
```bash
uuidgen
```

### 3. bgutil-pot

Sidecar HTTP server that generates YouTube PO tokens. Uses [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) (the same upstream Cobalt's `youtubei.js` depends on) to solve YouTube's BotGuard challenge headlessly without a Google account.

**Two consumers, one service:**

| Consumer | How it calls | What it needs from the response |
|---|---|---|
| yt-dlp fallback | `bgutil-ytdlp-pot-provider` plugin via `BGUTIL_POT_URL` | the WebPO token, used to authorize the media fetch |
| Cobalt | `YOUTUBE_SESSION_SERVER` → `POST /get_pot` every 5 min | only that the response *exists* — it flips `retrieve_player` to true. See [§ Why `YOUTUBE_SESSION_SERVER` must be set](#why-youtube_session_server-must-be-set) |

Cobalt sends no request body; bgutil mints its own visitor data when `content_binding` is absent. The two consumers get separate cache entries and do not interfere.

**Why a separate service:** BotGuard requires loading and evaluating ~2.3 MB of YouTube's `base.js` in a JS runtime. Running this in-process inside the SvelteKit container allocated ~1 GB and SIGABRTed the entire web process mid-request. Isolating it in its own container caps the blast radius and lets the heavy runtime stay warm across requests.

**Docker Image:** `brainicism/bgutil-ytdlp-pot-provider:1.3.1@sha256:1aaa43a0ca72dfca6a6d2129a0fb4a23465c25adb1b043f8aff829a20825646b` — pinned by both tag and digest (same rationale as [Cobalt version pinning](#cobalt-version-pinning); the BgUtils → BotGuard binding breaks when YouTube updates the player). Do NOT use `:latest`.

**Railway Service Name:** `bgutil-pot`

**Configuration:**
- No environment variables required (default port 4416 is fine)
- Internal networking only (no public exposure)
- Healthcheck: HTTP `GET /ping` returns 200 — `healthcheckPath = "/ping"` is set in `railway.toml`.

**No Python dependencies needed in dub-rip:** in HTTP-server mode the plugin only needs to be reachable as a `.zip` on yt-dlp's plugin path (we drop it via `--plugin-dirs`). No `pip install bgutil-ytdlp-pot-provider` required in the dub-rip container — and **do not add one**, since it would cause yt-dlp to load the plugin twice and error.

**Note on TOKEN_TTL:** the upstream README mentions a `TOKEN_TTL` env var, but it only applies to the script-method (option b) of the provider. When running as the HTTP server (option a, what we use), the cache TTL is fixed at the upstream default — there's no point setting it.

**Local development:** `BGUTIL_POT_URL` is unset by default. The yt-dlp fallback fails fast in that case. This is acceptable because (a) Cobalt usually succeeds, and (b) developers can run the bgutil-pot Docker image locally if they need to exercise the fallback path:

```bash
docker run --rm -d --init -p 4416:4416 --name bgutil brainicism/bgutil-ytdlp-pot-provider:1.3.1
# add BGUTIL_POT_URL=http://127.0.0.1:4416 to your dev Doppler config
doppler run -- bun run dev
```

Production and PR-preview environments get the var via Railway service vars; no `.env` files involved.

**Upgrade procedure:** Same shape as Cobalt — bump both the tag and digest in `railway.toml` and in this doc (see [Capturing a digest](#capturing-a-digest)), redeploy, verify with a known-bad video.

## Railway Setup Steps

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app) and create a new project
2. Name it something like `dub-rip-production`

### Step 2: Deploy Cobalt

> **`railway.toml` handles this.** The `cobalt-8x3f` service is now declared in `railway.toml` with a digest-pinned image. For a clean install, Railway will provision it automatically — no manual dashboard step required. The steps below remain for reference or when re-provisioning into an existing project.

1. Add a new service → Docker Image
2. Image: `ghcr.io/imputnet/cobalt:11.7.1@sha256:63186dd68afd57ce3bb1f62cc4c139f5fa95b9c3e87a3cf5c6e4c7a570523f62` — pinned by tag and digest (see [Cobalt version pinning](#cobalt-version-pinning))
3. Service name: `cobalt-8x3f`
4. Add environment variables (these are **not** covered by `railway.toml` — see the note in [§ 2. Cobalt Instance](#2-cobalt-instance)):
   ```bash
   API_PORT=9000
   API_KEY_URL=file://keys.json
   # REQUIRED — see "Why YOUTUBE_SESSION_SERVER must be set" below.
   # Without it every tunnel body is 0 bytes.
   YOUTUBE_SESSION_SERVER=http://bgutil-pot.railway.internal:4416
   YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
   ```
   Then confirm the startup log shows `[✓] poToken & visitor_data loaded successfully!` before testing.
5. Add a volume mount for `keys.json`:
   - Mount path: `/keys.json`
   - Content: Your API keys JSON
   - **`API_KEY_URL` must point at that file.** Cobalt has no plain `API_KEY` variable — setting one has no effect, and with `API_KEY_URL` unset Cobalt accepts **every** request, authenticated or not.
6. **Keep Cobalt internal-only** (no public networking needed)
   - dub-rip communicates with Cobalt via Railway's private network
   - This reduces attack surface and prevents unauthorized API access

> **Note:** If you need to expose Cobalt publicly (e.g., for debugging), add:
> ```bash
> API_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
> ```
> Then enable public networking on port 9000. Remember to disable this after debugging — a publicly-reachable Cobalt with no working `API_KEY_URL` is an open downloader running on your Railway bill.

### Step 3: Deploy bgutil-pot

> **`railway.toml` handles this.** The `bgutil-pot` service is now declared in `railway.toml` with a digest-pinned image. For a clean install, Railway will provision it automatically — no manual dashboard step required. The steps below remain for reference or when re-provisioning into an existing project.

1. Add a new service → Docker Image
2. Image: `brainicism/bgutil-ytdlp-pot-provider:1.3.1@sha256:1aaa43a0ca72dfca6a6d2129a0fb4a23465c25adb1b043f8aff829a20825646b` — pinned by tag and digest (see [Cobalt version pinning](#cobalt-version-pinning) for rationale; same logic applies here)
3. Service name: `bgutil-pot`
4. No environment variables required
5. **Keep bgutil-pot internal-only** (no public networking needed)
   - dub-rip communicates with bgutil-pot via Railway's private network at `http://bgutil-pot.railway.internal:4416`
6. Healthcheck: `GET /ping` returns 200 when the service is ready — set via `healthcheckPath` in `railway.toml`

### Step 4: Deploy dub-rip

1. Add a new service → GitHub Repo
2. Select your dub-rip repository
3. Add environment variables:
   ```bash
   COBALT_API_URL=http://cobalt.railway.internal:9000
   COBALT_API_KEY=your-api-key-uuid
   RAILPACK_DEPLOY_APT_PACKAGES=python3
   BGUTIL_POT_URL=http://bgutil-pot.railway.internal:4416
   ```
4. Enable public networking

### Step 5: Verify Deployment

1. Check Cobalt and bgutil-pot deploy logs in the Railway dashboard for successful startup
2. **Confirm Cobalt loaded a session.** Its startup log must contain:
   ```text
   [✓] poToken & visitor_data loaded successfully!
   ```
   If instead you see `[!] Failed loading poToken & visitor_data`, Cobalt is running with `retrieve_player: false` and every download will silently return 0 bytes — check `YOUTUBE_SESSION_SERVER` and that bgutil-pot is up.
3. Test dub-rip by downloading a YouTube video through the web interface. Verify the tunnel actually carries bytes, not just that Cobalt returned a URL — that is the failure mode this whole runbook exists for.
4. (Optional) To test internal services, use Railway's shell feature:
   - Open Railway dashboard → Select service → Click "Shell"
   - Run: `curl http://bgutil-pot.railway.internal:4416/ping`
   - Cobalt's own session call: `curl -X POST http://bgutil-pot.railway.internal:4416/get_pot` — should return JSON with `contentBinding` and `poToken`

> **Note:** Internal `.railway.internal` URLs are only accessible from within Railway's private network. You cannot `curl` these URLs from your local machine.

## Download Flow

```text
0. At startup (and every 5 min after), Cobalt POSTs bgutil-pot /get_pot.
   Success is what makes retrieve_player true — without it, steps 4-5 still
   "succeed" but hand back a tunnel that streams 0 bytes.
1. User enters YouTube URL
2. dub-rip validates URL and extracts video ID
3. dub-rip calls Cobalt API with authenticated request
4. Cobalt fetches YouTube stream
5. Cobalt returns stream URL to dub-rip
6. dub-rip fetches audio, applies ID3 metadata
7. MP3 streamed back to user's browser

Fallback path (if Cobalt fails):
3b. dub-rip falls back to yt-dlp
4b. yt-dlp asks bgutil-pot for a PO token via http://bgutil-pot.railway.internal:4416
5b. yt-dlp downloads audio with the PO token and `mweb` player client
6b. Continue from step 6 (ID3 metadata, stream to user)
```

## Cost Analysis

| Service | Railway Credits | Notes |
|---------|-----------------|-------|
| dub-rip | ~$2-3/month | Depends on traffic |
| Cobalt | ~$2-3/month | Still sleeps when idle — the session-server poll does **not** defeat app-sleep. See [Cost and operational consequences](#cost-and-operational-consequences) |
| bgutil-pot | ~$1-2/month | Reported a 49-day process uptime when probed; now also serves Cobalt's session polls |
| **Total** | **~$5-8/month** | Within free tier for low usage |

Railway provides $5/month in free credits. For personal use or low traffic, you may stay within the free tier.

Production steady-state has historically measured closer to ~$2.50/month across all three services; PR preview environments, not production, dominate spend. See [Railway Cost Practices](../.claude/CLAUDE.md).

## Cobalt version pinning

Pin the Cobalt service to a specific version tag (e.g. `ghcr.io/imputnet/cobalt:11.7.1`), not `:latest`.

**Why:** Railway resolves `:latest` to an image digest at deploy time and caches that digest. The deployment keeps running the same digest forever — even when upstream `:latest` moves on. A plain "redeploy" redeploys the same digest. So `:latest` gives you the false sense of freshness without the freshness.

**Why it matters specifically for Cobalt:** Cobalt's YouTube extractor depends on [`youtubei.js`](https://github.com/LuanRT/YouTube.js), which reverse-engineers YouTube's signature-decipher algorithm from `player.js`. YouTube ships player changes frequently (often weekly). When `youtubei.js` is more than a few months old, specific videos begin returning empty tunnel bodies (see [symptom: 0-byte tunnel responses](#symptom-0-byte-tunnel-responses) below).

**Digest pinning:** Both `cobalt-8x3f` and `bgutil-pot` are pinned by digest in `railway.toml`. The tag is kept for human readability; the `@sha256:…` suffix is what Railway actually resolves and caches. This eliminates supply-chain risk from upstream image swaps under a tag.

### Capturing a digest

Use these commands to capture a digest for a new image version:

```bash
# GHCR (cobalt) — get an anonymous token, then fetch the manifest headers:
TOKEN=$(curl -s "https://ghcr.io/token?service=ghcr.io&scope=repository:imputnet/cobalt:pull" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -sI "https://ghcr.io/v2/imputnet/cobalt/manifests/<TAG>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  | grep -i "docker-content-digest"

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

1. Check the [upstream Cobalt releases](https://github.com/imputnet/cobalt/releases) / [tags](https://github.com/imputnet/cobalt/tags) for the latest version.
2. Capture the new digest using the commands in [Capturing a digest](#capturing-a-digest) above.
3. Update both `railway.toml` (`services.cobalt-8x3f.source.image`) and this doc's pinned tag + digest.
4. Deploy. Verify with a known-bad video (see below) before closing the ticket.

## Symptom: 0-byte tunnel responses

**User-visible symptom:** Some YouTube videos fail with _"This video requires authentication. Please try a different video or try again later."_ even though they are not age-restricted, private, or region-blocked. Other videos work fine.

**What's happening under the hood:**

1. dub-rip asks Cobalt for a tunnel URL — Cobalt responds `{status: "tunnel", url: ...}`, no error.
2. dub-rip GETs the tunnel URL — it returns `HTTP 200` with a **0-byte body**.
3. dub-rip treats that as a Cobalt failure ([`try-cobalt.ts`](../src/lib/download-pipeline/try-cobalt.ts) throws on `byteLength === 0`) and falls back to yt-dlp.
4. yt-dlp also fails (YouTube bot-checks the Railway IP) and surfaces the generic auth error.

There are **two** distinct causes, and they are easy to confuse because the user-visible symptom is identical. Check them in this order — the first is a one-line config check, the second needs an image bump:

| # | Cause | Tell | Fix |
|---|---|---|---|
| 1 | `retrieve_player` is false — Cobalt built no youtubei.js `Player` at all | `YOUTUBE_SESSION_SERVER` unset **and** no `COOKIE_PATH` | [Set the session server](#why-youtube_session_server-must-be-set) |
| 2 | `youtubei.js` no longer matches YouTube's player | `[YOUTUBEJS][Player]` decipher errors in logs | [Upgrade Cobalt](#cobalt-version-pinning) |

> **Cause 1 was the real one in July 2026**, and the runbook below originally only described cause 2 — which sent the investigation chasing a Cobalt upgrade that was never going to help (Cobalt was already on the newest release). Rule this one out first: it costs one `railway variables` call.
>
> Its signature is distinctive: Cobalt returns a tunnel with an **OK playability status and a normal-looking format list**, yet the bytes never arrive. Note that a missing `Player` does *not* always show up as an error — with the `IOS` client (Cobalt's default) playability still reports `OK`, which is exactly why this failed silently for so long.

**Diagnose:**

0. **Check `retrieve_player` first.** If neither of these is set on the Cobalt service, stop here — you have cause 1:
   ```bash
   railway variables --service cobalt-8x3f --environment production --kv \
     | grep -E '^(YOUTUBE_SESSION_SERVER|COOKIE_PATH)='
   ```
   Confirm from the other side too — a healthy Cobalt logs this line at startup:
   ```text
   [✓] poToken & visitor_data loaded successfully!
   ```
1. **Confirm Cobalt itself is the layer that's failing.** POST to Cobalt's root endpoint directly (Cobalt 11.x takes the download request on `POST /` — the `/api/json` path was only used in pre-10.x releases), then curl the tunnel URL it returns:
   ```bash
   # From a Railway shell — target the .railway.internal hostname:
   COBALT_URL=http://cobalt-8x3f.railway.internal:9000/
   # Or, when debugging with public networking enabled:
   # COBALT_URL=https://cobalt-8x3f-production.up.railway.app/

   TUNNEL_URL=$(curl -s -X POST "$COBALT_URL" \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Api-Key <COBALT_API_KEY>' \
     -d '{"url":"https://www.youtube.com/watch?v=<id>","downloadMode":"audio","audioFormat":"mp3"}' \
     | jq -r .url)
   curl -sv "$TUNNEL_URL" -o /tmp/probe.bin
   ls -la /tmp/probe.bin   # if this is 0 bytes, Cobalt is the problem
   ```
   Always test a known-working video too (e.g. `dQw4w9WgXcQ`) in the same run. It is the control: if it *also* fails, you are looking at a transient YouTube bot-check on the datacenter IP, not a Cobalt defect — see [Testing without tripping YouTube](#testing-without-tripping-youtube).
2. **Confirm the signature-decipher failure in Cobalt logs** (cause 2 only):
   ```bash
   railway logs --service cobalt-8x3f --environment production | grep -E '\[YOUTUBEJS\]\[Player\]'
   ```
   `Failed to extract signature decipher algorithm.` confirms it. **No such line means it is not cause 2** — go back to cause 1.
3. **Check the `youtubei.js` version in the running container.** `railway ssh` passes the quoted string to a remote shell, so pipes work; anchor the grep so it matches only the pnpm directory entry for the package (not substring matches like `youtubei` parent or versioned deps):
   ```bash
   railway ssh --service cobalt-8x3f --environment production \
     "ls /app/node_modules/.pnpm/ | grep '^youtubei.js@'"
   ```
   If the version is more than a few months behind [upstream](https://github.com/LuanRT/YouTube.js/releases), upgrade Cobalt (see [Cobalt version pinning](#cobalt-version-pinning)).

### Settling it definitively: probe inside the container

When the layers are hard to separate, run youtubei.js directly inside the Cobalt container with everything held constant except the variable under test. Write the probe to **`/app`** — not `/tmp`, where module resolution fails — and delete it afterwards.

```bash
railway link --project 2db93306-9ef6-4f23-99e8-d57dbad321ce \
  --environment production --service cobalt-8x3f
```

```js
// /app/probe.mjs — reproduces Cobalt's real call path
import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ retrieve_player: false });  // flip this
const info = await yt.getBasicInfo('kJQP7kiw5Fk', { client: 'IOS' });  // Cobalt's default client
console.log('player=', !!yt.session.player,
            'status=', info.playability_status?.status,
            'formats=', info.streaming_data?.adaptive_formats?.length ?? 0);
```

Two things make or break this probe:

- **Pass `{ client: 'IOS' }` explicitly.** youtubei.js defaults to the `WEB` client, which reports `UNPLAYABLE`/0 formats under conditions where Cobalt's actual `IOS` path reports `OK`. A probe without the client argument measures a different code path than production runs.
- **Pass `retrieve_player` explicitly.** It defaults to `true` in youtubei.js, so a bare `Innertube.create()` reproduces the *fixed* state, not the broken one.

The service sleeps when idle, so send it an HTTP request first or `railway ssh` fails with "not running or in an unexpected state".

**Fix:** depends on which cause you landed on — see the table above. It is almost never an app-side bug in dub-rip.

## Testing without tripping YouTube

Every Cobalt or yt-dlp probe is a YouTube request from one datacenter IP, and a single user-facing download already costs **~3 extractions** (preview duration, `fetchVideoDetails`, the download itself).

Roughly 8–10 extractions inside a few minutes gets that IP bot-checked, after which *every* request comes back as `{"status":"error","error":{"code":"error.api.youtube.login"}}`. That maps to Cobalt's `LOGIN_REQUIRED` branch where the reason string ends in `"bot"` — i.e. YouTube's literal "Sign in to confirm you're not a bot":

```js
case "LOGIN_REQUIRED":
    if (playability.reason.endsWith("bot")) return { error: "youtube.login" };
```

Rules that keep a debugging session from poisoning its own results:

- **Space probes ~60s apart** and keep a run under ~4 videos.
- **Always include a control video** (`dQw4w9WgXcQ`). If the control still returns bytes, the IP is not globally blocked and a failure is real; if the control fails too, wait ~15 minutes and re-run before concluding anything.
- **`error.api.youtube.login` on a video that used to return 0 bytes is not necessarily a regression** — it is what a bot-checked IP looks like. Re-test after a cooldown before touching config.
- **Suspect your own testing first.** A sudden failure across the board is far more likely to be self-inflicted than a genuine regression.

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

Extraction succeeds and bgutil mints a token, but the media fetch 403s.

This means yt-dlp selected a format from a client bgutil **cannot** authorize. bgutil-pot issues *WebPO* tokens, usable only by the web-family clients. yt-dlp's `default` chain is `('visionos', 'android_vr', 'web')`; the first two need a different token type, yet their audio formats routinely win `-f bestaudio`, so the chosen URL goes out unauthorized.

Confirm by grepping deploy logs for which client bgutil was asked about:

```
[pot:bgutil:http] Generating a gvs PO Token for web_safari client via bgutil HTTP server
```

If the only client named there is not the one whose format got picked, that's the bug. **Fix:** keep `player_client` restricted to WebPO-capable clients (currently `web_safari,mweb,tv`) — never add `default`, `visionos`, or `android_vr` back.

## Symptom: yt-dlp fallback fails on all videos with "Unmatched yt-dlp error" / "Requested format is not available"

**User-visible symptom:** Videos that previously worked via the yt-dlp fallback (when Cobalt failed) now also fail. Users see _"Download service couldn't verify with YouTube"_ or _"Download failed. Please try a different video."_ even for videos Cobalt itself can't handle.

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

3. **Check Sentry for the pattern.** The `Unmatched yt-dlp error` warnings (added by the parseYtDlpError breadcrumb improvement) will surface unusual yt-dlp error shapes. A flood of these starting around the same wall-clock time strongly suggests a YouTube-side change.

**Fix:**

Bump the bgutil-pot tag. Check [the bgutil-ytdlp-pot-provider releases](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases) for a release published after YouTube's change. Update `railway.toml` (or the Railway dashboard if not yet declarative) and redeploy. Verify with a known-bad video before closing the ticket.

If the upstream hasn't released a fix yet, there's no app-side action — wait. dub-rip will degrade to "Cobalt-only" for videos that need PO tokens, which still covers most real traffic.

## Why `YOUTUBE_SESSION_SERVER` must be set

> **Corrected 2026-07-27.** This section previously argued the opposite — that the var was dead weight because Cobalt's `useSession` gate never fires for audio-only requests. The gate analysis was right; the conclusion was wrong. It missed a second, ungated code path that depends on the same function. Leaving the var unset is what caused every 0-byte tunnel described in [§ Symptom: 0-byte tunnel responses](#symptom-0-byte-tunnel-responses).

```bash
YOUTUBE_SESSION_SERVER=http://bgutil-pot.railway.internal:4416
```

### What it actually does (it is not about PO tokens)

The obvious reading — "the session server supplies a PO token that Cobalt attaches to YouTube requests" — is true, and irrelevant for dub-rip. The load-bearing effect is a side effect.

In `api/src/processing/services/youtube.js`:

```js
const rawCookie = getCookie('youtube');
const cookie = rawCookie?.toString();

const sessionTokens = getYouTubeSession();
const retrieve_player = Boolean(sessionTokens || cookie);   // <-- the line that matters
// ...
innertube = await Innertube.create({ retrieve_player, cookie, /* ... */ });
```

`retrieve_player` is **not** behind the `useSession` gate. It is true whenever *either* a session server returned tokens *or* a YouTube cookie is configured. With neither, it is false — and youtubei.js 17.0.1 then skips player creation entirely (`core/Session.js:68`):

```js
options.retrieve_player === false ? undefined : await Player.create(/* ... */)
```

No `Player` means no signature-decipher and no stream-URL resolution. Measured inside the production container. **Always record which Innertube client a measurement used** — the two behave differently, and conflating them sends you down the wrong path:

| client | config | `session.player` | playability | adaptive formats | media fetch |
|---|---|---|---|---|---|
| `WEB` (youtubei.js default) | `retrieve_player: false` | false | UNPLAYABLE "Video unavailable" | 0 | — |
| `WEB` | `retrieve_player: true` | true | OK | 24 | — |
| `IOS` (**Cobalt's actual client**) | `retrieve_player: true` + poToken | true | OK | 22 | **HTTP 206, 262144 bytes** |

And the live tunnel behaviour that motivated all of this, with `YOUTUBE_SESSION_SERVER` unset:

| video | tunnel status | bytes |
|---|---|---|
| `kJQP7kiw5Fk` | `tunnel` | **0** |
| `q9lZ4p5YRkY` | `tunnel` | **0** |
| `9bZkp7q19f0` | `tunnel` | **0** |
| `dQw4w9WgXcQ` (control) | `tunnel` | 3,410,369 |

Two things to take from this:

- **The `IOS` path does not announce the failure.** Cobalt maps any non-`OK` playability to an error, so the fact that it returned a tunnel at all proves playability was `OK` on the client it actually uses. The `WEB` row's "UNPLAYABLE / 0 formats" is a *different code path* — informative about what the missing `Player` does, but not the literal production symptom. The production symptom is `OK` + a tunnel that streams nothing.
- **Not every video needs the `Player`.** `dQw4w9WgXcQ` returned identical bytes before and after the fix. That makes it a good control, and a bad smoke test — passing on it alone tells you nothing.

**The tokens themselves are surplus.** The `useSession` gate — the only path that passes `po_token`/`visitor_data` into `Innertube.create` — requires a >1080p non-h264/vp9 request on the iOS client. dub-rip only ever requests audio, so the gate never fires and both values go in as `undefined`. The session server earns its place purely by making `getYouTubeSession()` return something truthy.

Cobalt does pass the raw `potoken` as the 10th constructor argument to youtubei.js's `Session` regardless of the gate. Verified harmless for our workload: an IOS-client extraction carrying that token returns `HTTP 206` on the media fetch, not `403`.

### Use bgutil-pot as the session server, not yt-session-generator

Cobalt's own [env-var docs](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md) still point `YOUTUBE_SESSION_SERVER` at [`yt-session-generator`](https://github.com/imputnet/yt-session-generator). **That image does not work with Cobalt 11.x.** The protocol changed; the docs did not.

Cobalt 11.7.1 `processing/helpers/youtube-session.js`:

```js
const sessionServerUrl = new URL(env.ytSessionServer);
sessionServerUrl.pathname = "/get_pot";
const newSession = await fetch(sessionServerUrl, { method: 'POST', /* ... */ }).then(a => a.json());
```

`yt-session-generator:webserver` serves exactly four routes — `/`, `/token`, `/update`, `/404` — and returns `404 Not Found` as `text/plain` for anything else. So `POST /get_pot` 404s, `.json()` throws, `loadSession()` logs `Failed loading poToken & visitor_data`, `session` stays `undefined`, and `retrieve_player` stays `false`. Deploying it buys a fourth service, a fourth cost line, and zero behavior change.

`bgutil-pot` — already running here for the yt-dlp fallback — serves `POST /get_pot` natively, and Cobalt's `validateSession` normalizes bgutil's exact response keys:

```js
sessionResponse.visitor_data ??= sessionResponse.contentBinding;  // bgutil returns contentBinding
sessionResponse.potoken     ??= sessionResponse.poToken;          // bgutil returns poToken
```

Verified handshake, run from inside the Cobalt container:

```text
POST http://bgutil-pot.railway.internal:4416/get_pot
  http 200 application/json; charset=utf-8
  keys: contentBinding,poToken,expiresAt
  VALID -> potoken len 804 | visitor_data len 520
```

Cobalt sends no request body; bgutil generates its own visitor data when `content_binding` is absent. One service, two consumers.

### Cost and operational consequences

**Polling does not defeat app-sleep — measured.** `ytSessionReloadInterval` is a hardcoded `300` in Cobalt's `core/env.js` (not configurable by env var), so a *running* Cobalt POSTs bgutil-pot every 5 minutes. The obvious worry is that this keeps the service awake 24/7 and blows the app-sleep rule in [Railway Cost Practices](../.claude/CLAUDE.md).

It does not. With `YOUTUBE_SESSION_SERVER` set, Cobalt was observed **asleep** ~13 minutes after its last *inbound* request (`railway ssh` refused with "Send a request to wake the service"). Railway's sleep decision is driven by inbound traffic; Cobalt's outbound poll doesn't count, and the poll stops while the service is asleep. **No cost regression** — leave `Sleep when inactive` on.

**Waking is a full restart, and that re-runs a race.** Railway restarts the container rather than resuming it — a wake produces a fresh `Starting Container` and a second `poToken & visitor_data loaded successfully!` in the same deployment's logs. Two consequences:

- *Good:* the session is re-fetched on every boot, so the fix is durable across sleep cycles. It does not depend on the poll.
- *Bad:* `setup()` kicks the initial token load off **asynchronously**, while `PLAYER_REFRESH_PERIOD` caches the Innertube instance for **15 minutes**. A request landing in the second or two before the first token arrives builds a player-less Innertube that is then cached for 15 minutes. Because every idle period ends in a restart, this race is live in normal operation, not just at deploy time.

There is no config knob for the race. If it shows up in practice — an isolated 0-byte failure right after an idle period, recovering ~15 minutes later — that is the strongest argument for the cookie file below, whose load path is `await`ed before Cobalt serves traffic and therefore cannot race.

After any deploy, wait for `[✓] poToken & visitor_data loaded successfully!` before testing.

**Each poll costs one YouTube call.** Cobalt sends no request body, so bgutil has no `content_binding` to key on and mints fresh visitor data via `Innertube.create()` every time — always a cache miss on `youtubeSessionDataCaches`. The expensive BotGuard *minter* is still cached (`_minterCache`), so this is cheap, but it is one extra outbound YouTube request per 5 minutes from the same datacenter IP whenever Cobalt is awake.

### Alternative: a cookie file on a volume

`retrieve_player` is `Boolean(sessionTokens || cookie)`, so a YouTube cookie flips the same boolean with no session server, no polling, and no fourth service. Cobalt reads `COOKIE_PATH` at startup; `getCookie('youtube')` returns a random entry from it.

Trade-offs versus the session server:

- **Keeps app-sleep.** No 5-minute poll, so Cobalt still sleeps when idle. Cheaper.
- **No cold-start race.** `loadFromFile()` is awaited before Cobalt serves traffic, so `retrieve_player` is true from the very first request.
- **Needs a Railway volume.** `COOKIE_PATH` is a file path, and Cobalt rewrites that file every 60 seconds whenever YouTube rotates cookies (`WRITE_INTERVAL` in `processing/cookie/manager.js`), so the mount must be writable and persistent.
- **Needs a non-empty cookie.** `getCookie` returns `undefined` for an empty array, so `{"youtube": []}` does **not** work — the file needs at least one non-empty string entry. A dummy value is enough to flip the boolean, but Cobalt will then send it to YouTube on every request and persist whatever `Set-Cookie` comes back, tying the datacenter IP to a durable pseudo-session.

We chose the session server because it needs no volume, no fabricated credential, and reuses a service that was already running.

This is all **separate** from the yt-dlp fallback's PO-token needs — though it now happens to share the same provider. See [§ 3. bgutil-pot](#3-bgutil-pot).

Background: [PR #52 research notes](https://github.com/jzstern/dub-rip/pull/52) (closed; investigation only).

## Decommissioned: yt-token-service (2026-06)

`yt-token-service` was a Node sidecar that generated PO tokens for Cobalt via `YOUTUBE_SESSION_SERVER`. After (incorrectly) concluding that Cobalt's `useSession` gate never firing meant the session server was useless, the service was judged to have no active callers and was removed. See [§ Why `YOUTUBE_SESSION_SERVER` must be set](#why-youtube_session_server-must-be-set) for why that conclusion was wrong — unsetting the var is what broke Cobalt.

**Do not restore it.** The role it filled is now filled by `bgutil-pot`, which was already deployed for the yt-dlp fallback and speaks the protocol Cobalt 11.x actually uses. There is no reason to run a fourth service.

> ⚠️ **This section previously recommended `ghcr.io/imputnet/yt-session-generator:webserver` as a "drop-in alternative". It is not one, and neither is the original `yt-token-service`.** Cobalt 11.x POSTs to `/get_pot`; `yt-session-generator` only serves `GET /token` and `/update` and 404s everything else, so `loadSession()` fails, `session` stays `undefined`, and `retrieve_player` stays `false` — the exact broken state. Cobalt's own upstream docs still carry this stale recommendation.

**Update (2026-06-09):** the lingering Railway `yt-token-service` *service object* was deleted from the production environment. It still built from this repo via a Dockerfile that no longer exists, so it auto-deployed and failed on every PR (preview environments are cloned from production via `railway environment new --copy production`, then Railway auto-builds repo-connected services on push). With it removed from production, new PR environments no longer inherit it.

PO tokens for the yt-dlp fallback path are still served by `bgutil-pot` (see [§ 3. bgutil-pot](#3-bgutil-pot)).

## Maintenance

**Regular:**
- Monitor Railway dashboard for resource usage
- Check error logs for download failures
- Update Docker images when new versions release — especially Cobalt (see [Cobalt version pinning](#cobalt-version-pinning))

**When YouTube Changes:**
- Monitor Cobalt and [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) release notes for BotGuard-related updates.
- **bgutil-pot is now a hard dependency of Cobalt, not just of the yt-dlp fallback.** If bgutil-pot is down when Cobalt boots, Cobalt starts with `retrieve_player: false` and silently serves 0-byte tunnels. After any bgutil-pot incident or image bump, restart Cobalt too and confirm `[✓] poToken & visitor_data loaded successfully!`.
- If Cobalt's `useSession` gate is ever re-enabled (e.g. via `CUSTOM_INNERTUBE_CLIENT=TV_EMBEDDED`), the token contents start mattering as well as their existence.

**Troubleshooting Commands (via Railway Shell):**

To run these commands, open Railway dashboard → Select service → Click "Shell".

You can check service logs directly in the Railway dashboard.

## Security Considerations

1. **API Key Protection**: Store in Railway environment variables
2. **Internal Networking**: bgutil-pot is internal-only. **Cobalt currently is not** — see the open issue below
3. **HTTPS Only**: Railway provides automatic SSL
4. **Rate Limiting**: Cobalt has built-in rate limiting
5. **SSRF Protection**: Implemented in dub-rip's cobalt.ts

> ### ⚠️ Open issue: production Cobalt accepts unauthenticated requests
>
> `cobalt-8x3f` has a public domain (`cobalt-8x3f-production.up.railway.app`) **and** no working API-key auth, so anyone on the internet can drive it as a free YouTube downloader billed to this Railway workspace. Beyond cost, that traffic shares the datacenter IP that YouTube bot-checks, so abuse degrades the real product.
>
> The cause is a variable-name mismatch: the service has `API_KEY` set, but **Cobalt has no such variable** — it reads `API_KEY_URL`, which is unset. With no key file loaded, Cobalt serves everyone. Verified: both a no-header request and one with a bogus `Authorization: Api-Key` returned a valid tunnel.
>
> Two independent fixes, either sufficient:
> - Disable public networking on the service (dub-rip reaches it over `cobalt-8x3f.railway.internal` regardless), or
> - Mount `keys.json` and set `API_KEY_URL=file://keys.json` with the UUID dub-rip already sends as `COBALT_API_KEY`.
>
> Left unfixed here deliberately: it is outside the scope of the session-server fix, and enabling auth without first confirming the key file matches `COBALT_API_KEY` would take production down.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Railway pricing changes | Monitor usage, set spending alerts |
| Cobalt API changes | Pin Docker image tag (never `:latest` — see [Cobalt version pinning](#cobalt-version-pinning)); test before updating |
| Cobalt `youtubei.js` falls behind YouTube's player | Upgrade Cobalt image tag; diagnosis runbook at [symptom: 0-byte tunnel responses](#symptom-0-byte-tunnel-responses) |
| `YOUTUBE_SESSION_SERVER` unset or bgutil-pot down at Cobalt boot | Cobalt serves 0-byte tunnels silently; confirm the startup token log, [runbook](#symptom-0-byte-tunnel-responses) |
| Upstream docs recommend an incompatible session server | Use bgutil-pot, never `yt-session-generator` — [why](#use-bgutil-pot-as-the-session-server-not-yt-session-generator) |
| YouTube blocks BotGuard bypass | yt-dlp fallback, community updates |
| Debugging trips YouTube's bot-check and masks the real state | [Testing without tripping YouTube](#testing-without-tripping-youtube) |
| Service downtime | yt-dlp fallback provides resilience |

## References

- [Cobalt Documentation](https://github.com/imputnet/cobalt)
- [Cobalt API Environment Variables](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md)
- [Railway Documentation](https://docs.railway.app)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
