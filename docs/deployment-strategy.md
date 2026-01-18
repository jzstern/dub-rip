# Deployment Strategy: Railway

## Overview

This document outlines the deployment architecture for dub-rip on Railway, using a self-hosted Cobalt instance with yt-session-generator for YouTube BotGuard bypass.

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        Users                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Railway Project                           │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              dub-rip SvelteKit App                    │  │
│  │  • Git-push deployment                                │  │
│  │  • Python via RAILPACK_DEPLOY_APT_PACKAGES (yt-dlp)   │  │
│  │  • COBALT_API_URL points to internal Cobalt service   │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼ (Internal API)                │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │  yt-session-generator│◄──│       Cobalt Instance       │ │
│  │  (port 8080)         │    │       (port 9000)           │ │
│  │  Generates poToken   │    │  YOUTUBE_SESSION_SERVER=    │ │
│  │  for BotGuard bypass │    │  http://yt-session:8080/    │ │
│  └─────────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
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
```

### 2. Cobalt Instance

Self-hosted Cobalt API for YouTube downloads with BotGuard bypass.

**Docker Image:** `ghcr.io/imputnet/cobalt:latest`

**Environment Variables:**
```bash
# Required
API_URL=https://your-cobalt-hostname.up.railway.app/
API_PORT=9000
API_KEY_URL=file://keys.json

# YouTube BotGuard bypass
YOUTUBE_SESSION_SERVER=http://yt-session.railway.internal:8080/
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

### 3. yt-session-generator

Generates poToken and visitor_data for YouTube BotGuard bypass.

**Docker Image:** `ghcr.io/imputnet/yt-session-generator:webserver`

**Configuration:**
- No environment variables required
- Exposes HTTP API on port 8080
- Only accessible internally (no public exposure needed)

**API Endpoints:**
- `GET /token` - Returns current poToken and visitor_data
- `GET /update` - Forces token refresh

## Railway Setup Steps

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app) and create a new project
2. Name it something like `dub-rip-production`

### Step 2: Deploy yt-session-generator

1. Add a new service → Docker Image
2. Image: `ghcr.io/imputnet/yt-session-generator:webserver`
3. Service name: `yt-session`
4. No environment variables needed
5. No public networking (internal only)

### Step 3: Deploy Cobalt

1. Add a new service → Docker Image
2. Image: `ghcr.io/imputnet/cobalt:latest`
3. Service name: `cobalt`
4. Add environment variables:
   ```bash
   API_PORT=9000
   API_KEY_URL=file://keys.json
   YOUTUBE_SESSION_SERVER=http://yt-session.railway.internal:8080/
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

### Step 4: Deploy dub-rip

1. Add a new service → GitHub Repo
2. Select your dub-rip repository
3. Add environment variables:
   ```bash
   COBALT_API_URL=http://cobalt.railway.internal:9000
   COBALT_API_KEY=your-api-key-uuid
   RAILPACK_DEPLOY_APT_PACKAGES=python3
   ```
4. Enable public networking

### Step 5: Verify Deployment

1. Check yt-session-generator logs in Railway dashboard for successful startup
2. Check Cobalt logs for successful connection to yt-session-generator
3. Test dub-rip by downloading a YouTube video through the web interface
4. (Optional) To test internal services, use Railway's shell feature:
   - Open Railway dashboard → Select service → Click "Shell"
   - Run: `curl http://yt-session.railway.internal:8080/token`

> **Note:** Internal `.railway.internal` URLs are only accessible from within Railway's private network. You cannot `curl` these URLs from your local machine.

## Download Flow

```text
1. User enters YouTube URL
2. dub-rip validates URL and extracts video ID
3. dub-rip calls Cobalt API with authenticated request
4. Cobalt checks if it needs a fresh poToken
5. If needed, Cobalt requests token from yt-session-generator
6. yt-session-generator solves BotGuard challenge, returns tokens
7. Cobalt uses tokens to fetch YouTube stream
8. Cobalt returns stream URL to dub-rip
9. dub-rip fetches audio, applies ID3 metadata
10. MP3 streamed back to user's browser

Fallback path (if Cobalt fails):
3b. dub-rip falls back to yt-dlp with ffmpeg
4b. yt-dlp downloads audio directly
5b. Continue from step 9
```

## Cost Analysis

| Service | Railway Credits | Notes |
|---------|-----------------|-------|
| dub-rip | ~$2-3/month | Depends on traffic |
| Cobalt | ~$2-3/month | Depends on downloads |
| yt-session-generator | ~$1/month | Lightweight service |
| **Total** | **~$5-7/month** | Within free tier for low usage |

Railway provides $5/month in free credits. For personal use or low traffic, you may stay within the free tier.

## Maintenance

**Regular:**
- Monitor Railway dashboard for resource usage
- Check error logs for download failures
- Update Docker images when new versions release

**When YouTube Changes:**
- yt-session-generator is actively maintained
- Pull latest image: Railway will auto-deploy on image update
- Check [imputnet/yt-session-generator](https://github.com/imputnet/yt-session-generator) for issues

**Troubleshooting Commands (via Railway Shell):**

To run these commands, open Railway dashboard → Select service → Click "Shell":

```bash
# From any Railway service shell:

# Check yt-session-generator health
curl http://yt-session.railway.internal:8080/token

# Force token refresh
curl http://yt-session.railway.internal:8080/update
```

You can also check service logs directly in the Railway dashboard.

## Security Considerations

1. **API Key Protection**: Store in Railway environment variables
2. **Internal Networking**: yt-session-generator not exposed publicly
3. **HTTPS Only**: Railway provides automatic SSL
4. **Rate Limiting**: Cobalt has built-in rate limiting
5. **SSRF Protection**: Implemented in dub-rip's cobalt.ts

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Railway pricing changes | Monitor usage, set spending alerts |
| Cobalt API changes | Pin Docker image tag, test before updating |
| YouTube blocks BotGuard bypass | yt-dlp fallback, community updates |
| Service downtime | yt-dlp fallback provides resilience |

## References

- [Cobalt Documentation](https://github.com/imputnet/cobalt)
- [Cobalt API Environment Variables](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md)
- [yt-session-generator](https://github.com/imputnet/yt-session-generator)
- [Railway Documentation](https://docs.railway.app)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
