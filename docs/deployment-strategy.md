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
│  │  • Has Python available (yt-dlp fallback works)       │  │
│  │  • COBALT_API_URL points to Oracle instance           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Private API)
┌─────────────────────────────────────────────────────────────┐
│              Oracle Cloud (Always-Free Tier)                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Cobalt Instance                       │  │
│  │  • ARM VM (4 OCPU, 24GB RAM - free forever)           │  │
│  │  • Docker deployment                                  │  │
│  │  • API key authentication (private to dub-rip)        │  │
│  │  • Handles YouTube bot detection                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Why This Architecture

| Requirement | Solution |
|-------------|----------|
| Free tier budget | Oracle (always-free VM) + Railway ($5 credit/month) |
| Cobalt authentication | Self-hosted instance - no Turnstile captcha needed |
| YouTube bot detection | Cobalt handles this internally |
| No user cookies needed | Cobalt doesn't require user authentication |
| Resilience | yt-dlp fallback on Railway (has Python) |
| Simple deployment | Git-push for app, Docker for Cobalt |
| Private access | API key restricts Cobalt to dub-rip only |

## Component Details

### 1. Oracle Cloud - Cobalt Instance

**Resources (Always-Free Tier):**
- 4 Ampere A1 OCPUs
- 24 GB RAM
- 200 GB storage
- Unlimited egress within Oracle network

**Setup Steps:**
1. Create Oracle Cloud account (requires credit card but won't charge)
2. Create ARM-based Compute Instance (Ampere A1)
3. Install Docker
4. Deploy Cobalt with API key authentication
5. Configure firewall to allow HTTPS traffic
6. Set up SSL certificate (Let's Encrypt)

**Cobalt Configuration:**
```yaml
# docker-compose.yml
services:
  cobalt:
    image: ghcr.io/imputnet/cobalt:latest
    restart: unless-stopped
    ports:
      - "9000:9000"
    environment:
      - API_URL=http://localhost:9000/
      - API_PORT=9000
    volumes:
      - ./keys.json:/keys.json:ro  # API keys for authentication
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

### 2. Railway - dub-rip App

**Resources (Free Tier):**
- $5 credit/month (renews)
- Sufficient for small audience (tens to hundreds of downloads/day)
- Python available in runtime

**Environment Variables:**
```bash
COBALT_API_URL=https://your-oracle-instance.com
COBALT_API_KEY=your-api-key-here  # For authenticated requests

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

The current code already handles this - `COBALT_API_URL` hostname is automatically added to the allowlist.

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

**As Needed:**
- Update Cobalt Docker image when new versions release
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

## Migration Path from Vercel

1. **Phase 1**: Set up Oracle Cloud Cobalt instance
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
| YouTube blocks Cobalt | yt-dlp fallback, community Cobalt updates |

## Alternative Approaches Considered

1. **Vercel + External Cobalt**: Rejected - no free external Cobalt services
2. **All Railway**: Viable but uses more of free credit
3. **Fly.io**: Similar to Railway, less generous free tier
4. **User OAuth**: Adds friction, complexity
5. **Manual cookies**: Security risk, maintenance burden
