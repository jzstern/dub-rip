# yt-token-service

A Node.js HTTP sidecar that generates YouTube **PO Tokens** and **visitor data** for the self-hosted [Cobalt](https://github.com/imputnet/cobalt) instance running in the dub-rip Railway project.

Cobalt reaches this service over Railway's private network at `http://yt-token-service.railway.internal:8080/` (set via Cobalt's `YOUTUBE_SESSION_SERVER` env var). When YouTube's BotGuard challenges Cobalt's request, Cobalt pulls a fresh PO token from here to prove it's a "real" client.

## Why a custom service

The [upstream doc](../../docs/deployment-strategy.md) references `ghcr.io/imputnet/yt-session-generator:webserver`, which is fine but requires deploying a pre-built image in a separate Railway service. We run a tiny custom Node service instead so it deploys from the same repo (via `Dockerfile.yt-token`) and can be tuned independently (memory, logging, retry policy).

If this service becomes unreliable, switching back to `ghcr.io/imputnet/yt-session-generator:webserver` is a valid fallback — see "Failure modes" below.

## API

All read endpoints are `GET`/`HEAD`. `/get_pot` additionally accepts `POST` for Cobalt's [session-server protocol](https://github.com/imputnet/cobalt/blob/main/api/src/processing/helpers/youtube-session.js). Response bodies are JSON unless noted.

| Path | Method(s) | Status | Purpose |
|------|-----------|--------|---------|
| `/` or `/token` | `GET`, `HEAD` | `200` / `503` | Legacy endpoint. Returns `{ potoken, visitor_data, updated }`. Kept for backwards compatibility and manual debugging. |
| `/get_pot` | `GET`, `HEAD`, `POST` | `200` / `503` | **What Cobalt 11.7+ calls.** Same response shape as `/token`. Cobalt's `loadSession()` issues `POST` against the path `/get_pot` derived from its `YOUTUBE_SESSION_SERVER` env var. |
| `/health` or `/healthz` | `GET`, `HEAD` | **always `200`** | **Liveness probe.** Reports only whether the process is alive. Used by Railway's `healthcheckPath`. |
| `/ready` | `GET`, `HEAD` | `200` / `503` | **Readiness probe.** `200` only when a valid token is cached and ready to serve. |
| `/status` | `GET`, `HEAD` | `200` | Diagnostics: cache age, TTL remaining, backoff state, attempt counters, last error message + age. Useful for debugging without shelling in. |

**Response shape for `/token` and `/get_pot`** (matches Cobalt's expected format — lowercase `potoken`; Cobalt's `validateSession()` normalizes `potoken → poToken` and `visitor_data → contentBinding` internally):
```json
{
  "potoken": "MnVjJj...",
  "visitor_data": "CgtB...",
  "updated": 1737811800000
}
```

## Caching & retry behavior

- Tokens are cached for **1 hour** (`CACHE_TTL_MS`).
- If generation fails, the next attempt is blocked for **30s** (`FAILURE_BACKOFF_MS`); during this window, a stale cached token is returned if one exists.
- A **background refresh timer** re-runs generation:
  - Every 30s while no token is cached (recovers from transient failures without needing a client request).
  - Proactively ~10 min before expiry when a token is cached.
  - Capped at 5 min between attempts in the happy path.
- Per-attempt generation has a **30s timeout** (`GENERATION_TIMEOUT_MS`).

## Liveness vs. readiness (important)

Earlier versions made `/health` return 503 when no token was cached. That caused Railway to kill the deployment if the first PO-token generation failed — a restart loop that eventually hit `restartPolicyMaxRetries: 10` and marked the deploy as "crashed for too long".

The current design separates liveness from readiness:
- **Liveness (`/health`)**: Is the process running? If yes, 200.
- **Readiness (`/ready`)**: Is the cache populated? 200 only if yes.

Railway's `healthcheckPath` is intentionally pointed at `/health`, not `/ready`, so transient YouTube/BotGuard failures don't kill the service. Consumers (Cobalt) that need a real token still hit `/token`, which errors with 503 if generation is currently broken.

## Environment variables

| Name | Default | Purpose |
|------|---------|---------|
| `PORT` | `8080` | HTTP listen port. |
| `NODE_OPTIONS` | `--max-old-space-size=1024` (from Dockerfile) | Raised heap limit; `jsdom` (used by `youtube-po-token-generator`) is memory-hungry — 512 MB was insufficient and token generation OOM'd mid-VM. |

Railway-injected vars (`RAILWAY_PRIVATE_DOMAIN`, etc.) are not read by the service.

## Dependencies

- **Runtime**: Node 20 (alpine).
- **Single production dep**: [`youtube-po-token-generator`](https://www.npmjs.com/package/youtube-po-token-generator) (pulls `jsdom`, `tough-cookie`, etc. transitively).

`Dockerfile.yt-token` uses `npm ci` (not `npm ci --omit=dev`) because `youtube-po-token-generator` ships a nested shrinkwrap; `--omit=dev` at the top level incorrectly prunes transitively-required packages like `tough-cookie`. There are no top-level devDependencies, so the bundle size impact is zero.

## Local development

```bash
cd services/yt-token
npm install
npm run dev      # node --watch index.js
# or
npm start        # node index.js
```

Then:
```bash
curl -s http://localhost:8080/status | jq
curl -s http://localhost:8080/token | jq
```

## Deployment (Railway)

The service is built from `Dockerfile.yt-token` at the repo root and deployed as the `yt-token-service` Railway service. The project's `railway.toml` declares:

```toml
[services.yt-token-service.build]
dockerfilePath = "Dockerfile.yt-token"

[services.yt-token-service.deploy]
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

No public networking — reached only via Railway's private network from Cobalt.

## Failure modes & troubleshooting

**Symptom: Cobalt downloads fail with "no poToken in session response" or BotGuard errors.**
Check this service's `/status`. If `generationSuccesses` is 0 and `lastError` keeps recurring, `youtube-po-token-generator` is failing to complete the BotGuard challenge. Common causes:
- YouTube updated BotGuard and the library is out of date → bump `youtube-po-token-generator` version.
- Railway egress IP is rate-limited by YouTube → reproduce locally; if local works, it's an IP-reputation issue.
- `jsdom` native-dep mismatch in Alpine → switch base image to `node:20-slim` and rebuild.

**Symptom: Railway shows the deploy as "crashed" / "REMOVED".**
With the current code, only a real process crash can cause this (`/health` always returns 200 when the process is alive). `process.on('uncaughtException')` and `process.on('unhandledRejection')` log the full stack and *do not exit* — transient errors from `jsdom` during BotGuard evaluation shouldn't kill a service whose state is just a token cache, and a restart loop would be strictly worse than a zombie server that reports its own failures via `/status`. If you see a deploy marked REMOVED anyway, check the deploy logs for a synchronous fatal (e.g. `EADDRINUSE` on `server.on("error")`, which does `process.exit(1)`).

**Symptom: `/token` returns 503 for extended periods.**
The background refresh timer should keep trying every 30s. Hit `/status` to inspect `inBackoff`, `generationAttempts`, and `lastError`. If attempts are incrementing but `generationSuccesses` stays at 0, generation is broken upstream (YouTube or the library).

**Escape hatch: swap to the upstream image.**
If the Node service becomes persistently unreliable, replace the Railway service's build config with:

```text
Docker image: ghcr.io/imputnet/yt-session-generator:webserver
```

The response format is compatible; no app-side changes needed. See `docs/deployment-strategy.md` for details.

## Impact if this service is down

The main dub-rip app doesn't call this service directly — only Cobalt does. If yt-token-service is down:
1. Cobalt fails to get tokens → Cobalt-based downloads fail with auth/BotGuard errors.
2. The main app catches Cobalt errors and falls back to `yt-dlp` (see `src/routes/api/download-stream/+server.ts`).
3. `yt-dlp` generates its own PO token locally via the same library (`src/lib/yt-token.ts`).
4. Users see a successful download unless *both* paths fail.

So: this service failing is degraded, not broken. The healthcheck fix keeps it in a self-recovering state instead of a restart-loop-and-die state.
