# Deployment Strategy: Oracle Cloud + Railway

## Overview

This document outlines the deployment architecture for dub-rip, addressing the Cobalt authentication requirement and Vercel's lack of Python support.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Users                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Railway (Free Tier)                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              dub-rip SvelteKit App                    │  │
│  │  • Git-push deployment                                │  │
│  │  • Python via RAILPACK_DEPLOY_APT_PACKAGES (yt-dlp)   │  │
│  │  • COBALT_API_URL points to Oracle instance           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Private API)
┌─────────────────────────────────────────────────────────────┐
│              Oracle Cloud (Always-Free Tier)                 │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │  yt-session-generator│◄──│       Cobalt Instance       │ │
│  │  (port 8080)         │    │       (port 9000)           │ │
│  └─────────────────────┘    └─────────────────────────────┘ │
│  • ARM VM (4 OCPU, 24GB RAM - free forever)                  │
│  • Docker Compose deployment                                 │
│  • API key authentication (private to dub-rip)               │
│  • yt-session-generator handles YouTube BotGuard bypass      │
└─────────────────────────────────────────────────────────────┘
```

## Why This Architecture

| Requirement | Solution |
|-------------|----------|
| Free tier budget | Oracle (always-free VM) + Railway ($5 credit/month) |
| Cobalt authentication | Self-hosted instance - no Turnstile captcha needed |
| YouTube bot detection | yt-session-generator provides poToken & visitor_data |
| No user cookies needed | Cobalt doesn't require user authentication |
| Resilience | yt-dlp fallback on Railway (Python via env var) |
| Simple deployment | Git-push for app, Docker for Cobalt |
| Private access | API key restricts Cobalt to dub-rip only |

## Component Details

### 1. Oracle Cloud - Cobalt + yt-session-generator

**Resources (Always-Free Tier):**
- 4 Ampere A1 OCPUs
- 24 GB RAM
- 200 GB storage
- Unlimited egress within Oracle network

**Setup Steps:**
1. Create Oracle Cloud account (requires credit card but won't charge)
2. Create ARM-based Compute Instance (Ampere A1)
3. Install Docker and Docker Compose
4. Deploy Cobalt with yt-session-generator using docker-compose
5. Configure firewall to allow HTTPS traffic
6. Set up SSL certificate (Let's Encrypt)

**Docker Compose Configuration:**
```yaml
# docker-compose.yml
services:
  cobalt:
    image: ghcr.io/imputnet/cobalt:latest
    restart: unless-stopped
    ports:
      - "9000:9000"
    environment:
      - API_URL=https://your-domain.com/
      - API_PORT=9000
      - API_KEY_URL=file://keys.json
      # YouTube BotGuard bypass via yt-session-generator
      - YOUTUBE_SESSION_SERVER=http://yt-session:8080/
      - YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
    volumes:
      - ./keys.json:/keys.json:ro
    depends_on:
      - yt-session

  yt-session:
    image: ghcr.io/imputnet/yt-session-generator:webserver
    restart: unless-stopped
    # No ports exposed externally - only accessible by cobalt internally
```

**API Keys File (`keys.json`):**
```json
{
  "your-api-key-uuid-here": {
    "name": "dub-rip",
    "limit": 100
  }
}
```

**Note:** Generate a UUID for your API key (e.g., `uuidgen` on macOS/Linux). The client sends this key via `Authorization: Api-Key <uuid>` header.

### YouTube BotGuard Bypass

Since August 2024, YouTube requires a `poToken` (Proof of Origin Token) and `visitor_data` to verify requests come from genuine devices. Without valid tokens, streams return 403 errors or empty content.

**How it works:**
1. `yt-session-generator` runs a headless Chromium browser to solve BotGuard challenges
2. It exposes an HTTP API at `http://localhost:8080/token` that returns fresh tokens
3. Cobalt automatically calls this API when needed via `YOUTUBE_SESSION_SERVER`
4. The `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED` ensures compatibility with web-based tokens

**Key environment variables:**

| Variable | Value | Purpose |
|----------|-------|---------|
| `YOUTUBE_SESSION_SERVER` | `http://yt-session:8080/` | URL to session generator service |
| `YOUTUBE_SESSION_INNERTUBE_CLIENT` | `WEB_EMBEDDED` | Innertube client compatible with web poToken |

**Troubleshooting:**
- Check yt-session-generator logs: `docker compose logs yt-session`
- Verify token generation: `curl http://localhost:8080/token`
- Force token refresh: `curl http://localhost:8080/update`

### 2. Railway - dub-rip App

**Resources (Free Tier):**
- $5 credit/month (renews)
- Sufficient for small audience (tens to hundreds of downloads/day)
- Python available via `RAILPACK_DEPLOY_APT_PACKAGES=python3`

**Environment Variables:**
```bash
COBALT_API_URL=https://your-oracle-instance.com
COBALT_API_KEY=your-api-key-here  # For authenticated requests
COBALT_TUNNEL_HOST=your-oracle-instance.com  # For URL validation

# Required for yt-dlp fallback - installs Python3 in the runtime container
RAILPACK_DEPLOY_APT_PACKAGES=python3
```

**Setup Steps:**
1. Create Railway account
2. Connect GitHub repository
3. Set environment variables
4. Deploy via git push

### 3. Download Flow

```
1. User enters YouTube URL
2. App calls Cobalt API (Oracle instance)
   ├── Cobalt requests poToken from yt-session-generator
   ├── yt-session-generator returns valid tokens
   ├── Cobalt uses tokens to fetch YouTube stream
   ├── Success: Stream audio from Cobalt CDN
   └── Failure: Fall back to yt-dlp (Railway has Python)
3. Apply ID3 metadata
4. Return MP3 to user
```

## Code Changes Required

### 1. Add Cobalt API Key Support

```typescript
// src/lib/cobalt.ts
const COBALT_API_KEY = process.env.COBALT_API_KEY;

export async function requestCobaltAudio(youtubeUrl: string): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (COBALT_API_KEY) {
    headers["Authorization"] = `Api-Key ${COBALT_API_KEY}`;
  }

  // ... rest of function
}
```

### 2. Update Allowlist for Oracle Instance

The current code already handles this - `COBALT_API_URL` hostname is automatically added to the allowlist. Additionally, `COBALT_TUNNEL_HOST` can be set to allow tunnel URLs from the public hostname.

### 3. Railway Configuration

```toml
# railway.toml (optional - Railway auto-detects SvelteKit)
[build]
builder = "nixpacks"

[deploy]
startCommand = "bun run start"
```

## Cost Analysis

| Service | Cost | Notes |
|---------|------|-------|
| Oracle Cloud | $0 | Always-free ARM tier |
| Railway | $0-5/month | Free credit covers small usage |
| Domain (optional) | $10-15/year | Can use Railway's subdomain for free |
| **Total** | **$0-5/month** | |

## Maintenance

**Monthly:**
- Check Oracle VM health
- Review Railway usage (stay within free tier)
- Monitor yt-session-generator for token generation issues

**As Needed:**
- Update Cobalt Docker image when new versions release
- Update yt-session-generator when YouTube changes BotGuard
- Update dub-rip dependencies

**Monitoring:**
- Railway provides basic metrics
- Oracle Cloud has monitoring dashboards
- Add error tracking (Sentry) for proactive alerting

## Security Considerations

1. **API Key Protection**: Store in environment variables, never commit
2. **HTTPS Only**: Both Railway and Oracle should use HTTPS
3. **Rate Limiting**: Cobalt has built-in rate limiting
4. **SSRF Protection**: Already implemented in cobalt.ts (redirect validation)
5. **Private Instance**: API key prevents unauthorized access to Cobalt
6. **Internal Network**: yt-session-generator not exposed externally

## Migration Path from Vercel

1. **Phase 1**: Set up Oracle Cloud Cobalt instance with yt-session-generator
2. **Phase 2**: Test Cobalt integration locally with new instance
3. **Phase 3**: Deploy app to Railway
4. **Phase 4**: Update DNS/redirect from Vercel (if using custom domain)
5. **Phase 5**: Decommission Vercel deployment

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Oracle account termination | Keep backups, document setup for quick recreation |
| Cobalt API changes | Pin Docker image version, test before updating |
| Railway free tier limits | Monitor usage, optimize if needed |
| YouTube blocks Cobalt | yt-dlp fallback, community Cobalt/yt-session updates |
| BotGuard changes | yt-session-generator is actively maintained by imputnet |

## Alternative Approaches Considered

1. **Vercel + External Cobalt**: Rejected - no free external Cobalt services
2. **All Railway**: Viable but uses more of free credit
3. **Fly.io**: Similar to Railway, less generous free tier
4. **User OAuth**: Adds friction, complexity
5. **Manual cookies**: Security risk, maintenance burden
6. **Static poToken**: Rejected - tokens expire and need refresh

## References

- [Cobalt API Environment Variables](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md)
- [imputnet/yt-session-generator](https://github.com/imputnet/yt-session-generator)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
