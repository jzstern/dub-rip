# Deployment Strategy: Railway

## Overview

This document outlines the deployment architecture for dub-rip on Railway, using a self-hosted Cobalt instance with yt-session-generator for YouTube BotGuard bypass.

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
│  │  • COBALT_API_URL → cobalt.railway.internal               │      │
│  │  • BGUTIL_POT_URL → bgutil-pot.railway.internal           │      │
│  └───────────────────────────────────────────────────────────┘      │
│         (Internal API)          (yt-dlp PO tokens, fallback)        │
│                ▼                              ▼                      │
│   ┌─────────────────────────┐    ┌────────────────────────┐         │
│   │  Cobalt Instance        │    │  bgutil-pot            │         │
│   │  (port 9000)            │    │  (port 4416)           │         │
│   └─────────────────────────┘    └────────────────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Architecture

| Requirement | Solution |
|-------------|----------|
| YouTube bot detection | yt-session-generator provides poToken & visitor_data |
| Self-hosted Cobalt | No rate limits or auth requirements from public APIs |
| No user cookies needed | Cobalt + session generator handles authentication |
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

**Docker Image:** `ghcr.io/imputnet/cobalt:11.7.1` (pin to a specific version, see [Cobalt version pinning](#cobalt-version-pinning) below — do NOT use `:latest`)

**Environment Variables:**
```bash
# Required
API_URL=https://your-cobalt-hostname.up.railway.app/
API_PORT=9000
API_KEY_URL=file://keys.json

# YouTube BotGuard bypass
# YOUTUBE_SESSION_SERVER intentionally unset — see "Why YOUTUBE_SESSION_SERVER is unset" below
YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
```

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

### 4. bgutil-pot

Sidecar HTTP server that generates YouTube PO tokens for the yt-dlp fallback path. Uses [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) (the same upstream Cobalt's `youtubei.js` depends on) to solve YouTube's BotGuard challenge headlessly without a Google account.

**Why a separate service:** BotGuard requires loading and evaluating ~2.3 MB of YouTube's `base.js` in a JS runtime. Running this in-process inside the SvelteKit container allocated ~1 GB and SIGABRTed the entire web process mid-request. Isolating it in its own container caps the blast radius and lets the heavy runtime stay warm across requests.

**Docker Image:** `brainicism/bgutil-ytdlp-pot-provider:1.3.1` — **pin to a specific version tag, not `:latest`** (same rationale as [Cobalt version pinning](#cobalt-version-pinning); the BgUtils → BotGuard binding breaks when YouTube updates the player).

**Railway Service Name:** `bgutil-pot`

**Configuration:**
- No environment variables required (default port 4416 is fine)
- Internal networking only (no public exposure)
- Healthcheck: HTTP `GET /ping` returns 200 — set `healthcheckPath = "/ping"` if you add a `railway.toml` stanza for it (this project currently configures image-based services via the Railway dashboard, not `railway.toml`).

**No Python dependencies needed in dub-rip:** in HTTP-server mode the plugin only needs to be reachable as a `.zip` on yt-dlp's plugin path (we drop it via `--plugin-dirs`). No `pip install bgutil-ytdlp-pot-provider` required in the dub-rip container — and **do not add one**, since it would cause yt-dlp to load the plugin twice and error.

**Note on TOKEN_TTL:** the upstream README mentions a `TOKEN_TTL` env var, but it only applies to the script-method (option b) of the provider. When running as the HTTP server (option a, what we use), the cache TTL is fixed at the upstream default — there's no point setting it.

**Local development:** `BGUTIL_POT_URL` is unset by default. The yt-dlp fallback fails fast in that case. This is acceptable because (a) Cobalt usually succeeds, and (b) developers can run the bgutil-pot Docker image locally if they need to exercise the fallback path:

```bash
docker run --rm -d --init -p 4416:4416 --name bgutil brainicism/bgutil-ytdlp-pot-provider:1.3.1
# add BGUTIL_POT_URL=http://127.0.0.1:4416 to your dev Doppler config
doppler run -- bun run dev
```

Production and PR-preview environments get the var via Railway service vars; no `.env` files involved.

**Upgrade procedure:** Same shape as Cobalt — bump the tag, redeploy, verify with a known-bad video, update this doc's pinned tag.

## Railway Setup Steps

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app) and create a new project
2. Name it something like `dub-rip-production`

### Step 2: Deploy Cobalt

1. Add a new service → Docker Image
2. Image: `ghcr.io/imputnet/cobalt:11.7.1` — **pin to a specific version tag, not `:latest`** (see [Cobalt version pinning](#cobalt-version-pinning))
3. Service name: `cobalt`
4. Add environment variables:
   ```bash
   API_PORT=9000
   API_KEY_URL=file://keys.json
   # YOUTUBE_SESSION_SERVER intentionally unset — see "Why YOUTUBE_SESSION_SERVER is unset" below
   YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
   ```
5. Add a volume mount for `keys.json`:
   - Mount path: `/keys.json`
   - Content: Your API keys JSON
6. **Keep Cobalt internal-only** (no public networking needed)
   - dub-rip communicates with Cobalt via Railway's private network
   - This reduces attack surface and prevents unauthorized API access

> **Note:** If you need to expose Cobalt publicly (e.g., for debugging), add:
> ```bash
> API_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
> ```
> Then enable public networking on port 9000. Remember to disable this after debugging.

### Step 3: Deploy bgutil-pot

1. Add a new service → Docker Image
2. Image: `brainicism/bgutil-ytdlp-pot-provider:1.3.1` — **pin to a specific version tag, not `:latest`** (see [Cobalt version pinning](#cobalt-version-pinning) for rationale; same logic applies here)
3. Service name: `bgutil-pot`
4. No environment variables required
5. **Keep bgutil-pot internal-only** (no public networking needed)
   - dub-rip communicates with bgutil-pot via Railway's private network at `http://bgutil-pot.railway.internal:4416`
6. Healthcheck: `GET /ping` returns 200 when the service is ready

### Step 3.5: Deploy dub-rip

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

### Step 4: Verify Deployment

1. Check yt-token-service logs in Railway dashboard for successful startup
2. Check Cobalt logs for successful connection to yt-token-service
3. Test dub-rip by downloading a YouTube video through the web interface
4. (Optional) To test internal services, use Railway's shell feature:
   - Open Railway dashboard → Select service → Click "Shell"
   - Run: `curl http://yt-token-service.railway.internal:8080/token`

> **Note:** Internal `.railway.internal` URLs are only accessible from within Railway's private network. You cannot `curl` these URLs from your local machine.

## Download Flow

```text
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
6b. Continue from step 9
```

## Cost Analysis

| Service | Railway Credits | Notes |
|---------|-----------------|-------|
| dub-rip | ~$2-3/month | Depends on traffic |
| Cobalt | ~$2-3/month | Depends on downloads |
| bgutil-pot | ~$1-2/month | Idle most of the time |
| **Total** | **~$5-8/month** | Within free tier for low usage |

Railway provides $5/month in free credits. For personal use or low traffic, you may stay within the free tier.

## Cobalt version pinning

Pin the Cobalt service to a specific version tag (e.g. `ghcr.io/imputnet/cobalt:11.7.1`), not `:latest`.

**Why:** Railway resolves `:latest` to an image digest at deploy time and caches that digest. The deployment keeps running the same digest forever — even when upstream `:latest` moves on. A plain "redeploy" redeploys the same digest. So `:latest` gives you the false sense of freshness without the freshness.

**Why it matters specifically for Cobalt:** Cobalt's YouTube extractor depends on [`youtubei.js`](https://github.com/LuanRT/YouTube.js), which reverse-engineers YouTube's signature-decipher algorithm from `player.js`. YouTube ships player changes frequently (often weekly). When `youtubei.js` is more than a few months old, specific videos begin returning empty tunnel bodies (see [symptom: 0-byte tunnel responses](#symptom-0-byte-tunnel-responses-signature-decipher-failure) below).

**To upgrade:**

1. Check the [upstream Cobalt releases](https://github.com/imputnet/cobalt/releases) / [tags](https://github.com/imputnet/cobalt/tags) for the latest version.
2. Railway dashboard → `cobalt` service → Settings → Source → Image → change the tag (e.g. `ghcr.io/imputnet/cobalt:11.7.1` → `ghcr.io/imputnet/cobalt:11.8.0`).
3. Deploy. Verify with a known-bad video (see below) before closing the ticket.
4. Update this doc's pinned tag to match.

## Symptom: 0-byte tunnel responses (signature decipher failure)

**User-visible symptom:** Some YouTube videos fail with _"This video requires authentication. Please try a different video or try again later."_ even though they are not age-restricted, private, or region-blocked. Other videos work fine.

**What's happening under the hood:**

1. dub-rip asks Cobalt for a tunnel URL — Cobalt responds `{status: "tunnel", url: ...}`, no error.
2. dub-rip GETs the tunnel URL — it returns `HTTP 200` with a **0-byte body**.
3. dub-rip treats that as a Cobalt failure and falls back to yt-dlp.
4. yt-dlp also fails (YouTube bot-checks the Railway IP) and surfaces the generic auth error.

The root cause is Cobalt's `youtubei.js` version no longer matches YouTube's current player. Cobalt hands out tunnel URLs whose stream requests fail silently behind the scenes.

**Diagnose in 3 steps:**

1. **Confirm Cobalt itself is the layer that's failing.** POST to Cobalt's root endpoint directly (Cobalt 11.x takes the download request on `POST /` — the `/api/json` path was only used in pre-10.x releases), then curl the tunnel URL it returns:
   ```bash
   # From a Railway shell — Cobalt is internal-only by default (see Step 3
   # above), so target the .railway.internal hostname:
   COBALT_URL=http://cobalt.railway.internal:9000/
   # Or, when debugging with public networking temporarily enabled:
   # COBALT_URL=https://<cobalt-host>/

   TUNNEL_URL=$(curl -s -X POST "$COBALT_URL" \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Api-Key <COBALT_API_KEY>' \
     -d '{"url":"https://www.youtube.com/watch?v=<id>","downloadMode":"audio","audioFormat":"mp3"}' \
     | jq -r .url)
   curl -sv "$TUNNEL_URL" -o /tmp/probe.bin
   ls -la /tmp/probe.bin   # if this is 0 bytes, Cobalt is the problem
   ```
   Test a known-working video too (e.g. `dQw4w9WgXcQ`) for a working baseline.
2. **Confirm the signature-decipher failure in Cobalt logs:**
   ```bash
   railway logs --service cobalt --environment production | grep -E '\[YOUTUBEJS\]\[Player\]'
   ```
   `Failed to extract signature decipher algorithm.` confirms it.
3. **Check the `youtubei.js` version in the running container.** `railway ssh` passes the quoted string to a remote shell, so pipes work; anchor the grep so it matches only the pnpm directory entry for the package (not substring matches like `youtubei` parent or versioned deps):
   ```bash
   railway ssh --service cobalt --environment production \
     "ls /app/node_modules/.pnpm/ | grep '^youtubei.js@'"
   ```
   If the version is more than a few months behind [upstream](https://github.com/LuanRT/YouTube.js/releases), upgrade Cobalt (see [Cobalt version pinning](#cobalt-version-pinning)).

**Fix:** Upgrade Cobalt. It is almost never an app-side bug in dub-rip.

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

## Why `YOUTUBE_SESSION_SERVER` is unset

Cobalt's `YOUTUBE_SESSION_SERVER` env var was previously set to `http://yt-token-service.railway.internal:8080/`, which caused Cobalt to poll `yt-token-service` for a PO token to attach to outbound YouTube requests. In practice this never did anything for our workload:

- Cobalt's [`useSession` gate](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/youtube.js#L176-L186) is the only path that attaches the token from the session server.
- That gate evaluates to false for audio-only requests (the only kind dub-rip makes).
- The result: `yt-token-service` was being polled every ~5 minutes by Cobalt, generating a steady stream of `UND_ERR_CONNECT_TIMEOUT` log lines, and the token it returned was being thrown away.

Unsetting `YOUTUBE_SESSION_SERVER` on the Cobalt service stopped the polling. With the service confirmed to have no active callers, `yt-token-service` was subsequently decommissioned (see [§ Decommissioned: yt-token-service](#decommissioned-yt-token-service-2026-06)).

This is **separate** from the yt-dlp fallback's PO-token needs. yt-dlp gets its PO token from the [`bgutil-pot`](#4-bgutil-pot) sidecar, not from `yt-token-service`.

Background: [PR #52 research notes](https://github.com/jzstern/dub-rip/pull/52) (closed; investigation only).

## Decommissioned: yt-token-service (2026-06)

`yt-token-service` was a Node sidecar that generated PO tokens for Cobalt via `YOUTUBE_SESSION_SERVER`. After confirming Cobalt's `useSession` gate never fires for audio-only requests (see [§ Why YOUTUBE_SESSION_SERVER is unset](#why-youtube_session_server-is-unset)), the service had no active callers. We carried it for several weeks in case the session path got re-enabled, then removed it for the operational simplification.

If you need PO tokens for Cobalt again, restoring the service is `git revert <this commit>` plus redeploying. The custom Node implementation had forked-child OOM isolation; if you don't need that resilience, the upstream image `ghcr.io/imputnet/yt-session-generator:webserver` is a drop-in alternative.

PO tokens for the yt-dlp fallback path are still served by `bgutil-pot` (see [§ 4. bgutil-pot](#4-bgutil-pot)). That's a separate concern from Cobalt's session server and is unaffected.

## Maintenance

**Regular:**
- Monitor Railway dashboard for resource usage
- Check error logs for download failures
- Update Docker images when new versions release — especially Cobalt (see [Cobalt version pinning](#cobalt-version-pinning))

**When YouTube Changes:**
- Monitor [imputnet/yt-session-generator](https://github.com/imputnet/yt-session-generator) and Cobalt release notes for BotGuard-related updates.
- If Cobalt's `useSession` gate is ever re-enabled (e.g. via `CUSTOM_INNERTUBE_CLIENT=TV_EMBEDDED`), see [§ Decommissioned: yt-token-service](#decommissioned-yt-token-service-2026-06) for restore options.

**Troubleshooting Commands (via Railway Shell):**

To run these commands, open Railway dashboard → Select service → Click "Shell".

You can check service logs directly in the Railway dashboard.

## Security Considerations

1. **API Key Protection**: Store in Railway environment variables
2. **Internal Networking**: Cobalt and bgutil-pot are not exposed publicly
3. **HTTPS Only**: Railway provides automatic SSL
4. **Rate Limiting**: Cobalt has built-in rate limiting
5. **SSRF Protection**: Implemented in dub-rip's cobalt.ts

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Railway pricing changes | Monitor usage, set spending alerts |
| Cobalt API changes | Pin Docker image tag (never `:latest` — see [Cobalt version pinning](#cobalt-version-pinning)); test before updating |
| Cobalt `youtubei.js` falls behind YouTube's player | Upgrade Cobalt image tag; diagnosis runbook at [symptom: 0-byte tunnel responses](#symptom-0-byte-tunnel-responses-signature-decipher-failure) |
| YouTube blocks BotGuard bypass | yt-dlp fallback, community updates |
| Service downtime | yt-dlp fallback provides resilience |

## References

- [Cobalt Documentation](https://github.com/imputnet/cobalt)
- [Cobalt API Environment Variables](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md)
- [yt-session-generator](https://github.com/imputnet/yt-session-generator)
- [Railway Documentation](https://docs.railway.app)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
