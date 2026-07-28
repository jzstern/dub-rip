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

**Docker Image:** `brainicism/bgutil-ytdlp-pot-provider:1.3.1@sha256:1aaa43a0ca72dfca6a6d2129a0fb4a23465c25adb1b043f8aff829a20825646b` — pinned by both tag and digest (see [Image version pinning](#image-version-pinning); the BgUtils → BotGuard binding breaks when YouTube updates the player). Do NOT use `:latest`.

**Railway Service Name:** `bgutil-pot`

**Configuration:**
- No environment variables required (default port 4416 is fine)
- Internal networking only (no public exposure)
- Healthcheck: HTTP `GET /ping` returns 200 — `healthcheckPath = "/ping"` is set in `railway.toml`.

**No Python dependencies needed in dub-rip:** in HTTP-server mode the plugin only needs to be reachable as a `.zip` on yt-dlp's plugin path (we drop it via `--plugin-dirs`). No `pip install bgutil-ytdlp-pot-provider` required in the dub-rip container — and **do not add one**, since it would cause yt-dlp to load the plugin twice and error.

**Note on TOKEN_TTL:** the upstream README mentions a `TOKEN_TTL` env var, but it only applies to the script-method (option b) of the provider. When running as the HTTP server (option a, what we use), the cache TTL is fixed at the upstream default — there's no point setting it.

**Local development:** `BGUTIL_POT_URL` is unset by default, and downloads fail fast with an explicit configuration error in that case — there is no second path. Run the bgutil-pot Docker image locally to exercise downloads:

```bash
docker run --rm -d --init -p 4416:4416 --name bgutil brainicism/bgutil-ytdlp-pot-provider:1.3.1
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
2. Image: `brainicism/bgutil-ytdlp-pot-provider:1.3.1@sha256:1aaa43a0ca72dfca6a6d2129a0fb4a23465c25adb1b043f8aff829a20825646b` — pinned by tag and digest (see [Image version pinning](#image-version-pinning))
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

**Digest pinning:** `bgutil-pot` is pinned by digest in `railway.toml`. The tag is kept for human readability; the `@sha256:…` suffix is what Railway actually resolves and caches. This eliminates supply-chain risk from upstream image swaps under a tag.

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

Extraction succeeds and bgutil mints a token, but the media fetch 403s.

This means yt-dlp selected a format from a client bgutil **cannot** authorize. bgutil-pot issues *WebPO* tokens, usable only by the web-family clients. yt-dlp's `default` chain is `('visionos', 'android_vr', 'web')`; the first two need a different token type, yet their audio formats routinely win `-f bestaudio`, so the chosen URL goes out unauthorized.

Confirm by grepping deploy logs for which client bgutil was asked about:

```
[pot:bgutil:http] Generating a gvs PO Token for web_safari client via bgutil HTTP server
```

If the only client named there is not the one whose format got picked, that's the bug. **Fix:** keep `player_client` restricted to WebPO-capable clients (currently `web_safari,mweb,tv`) — never add `default`, `visionos`, or `android_vr` back.

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

3. **Check Sentry for the pattern.** The `Unmatched yt-dlp error` warnings (added by the parseYtDlpError breadcrumb improvement) will surface unusual yt-dlp error shapes. A flood of these starting around the same wall-clock time strongly suggests a YouTube-side change.

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

**When YouTube Changes:**
- Monitor [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) release notes for BotGuard-related updates.

**Troubleshooting Commands (via Railway Shell):**

To run these commands, open Railway dashboard → Select service → Click "Shell".

You can check service logs directly in the Railway dashboard.

## Security Considerations

1. **Internal Networking**: bgutil-pot is not exposed publicly
2. **HTTPS Only**: Railway provides automatic SSL
3. **Input Validation**: YouTube URLs are validated and video IDs extracted before reaching yt-dlp

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Railway pricing changes | Monitor usage, set spending alerts |
| YouTube blocks BotGuard bypass | Upstream bgutil/BgUtils updates; bump the pinned tag |
| bgutil-pot falls behind YouTube's player | Upgrade the image tag (see [Image version pinning](#image-version-pinning)) |
| Single download path — no fallback | Accepted deliberately; the previous fallback was non-functional. See [ADR 0001](decisions/0001-remove-cobalt.md) |
| Datacenter IP rate-limited by YouTube | Avoid adding yt-dlp call sites; don't load-test live environments |

## References

- [Railway Documentation](https://docs.railway.app)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [ADR 0001 — Remove Cobalt](decisions/0001-remove-cobalt.md)
