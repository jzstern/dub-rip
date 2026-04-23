# yt-token-service

A Node.js HTTP sidecar that generates YouTube **PO Tokens** and **visitor data** for the self-hosted [Cobalt](https://github.com/imputnet/cobalt) instance running in the dub-rip Railway project.

Cobalt reaches this service over Railway's private network at `http://yt-token-service.railway.internal:8080/` (set via Cobalt's `YOUTUBE_SESSION_SERVER` env var). When YouTube's BotGuard challenges Cobalt's request, Cobalt pulls a fresh PO token from here to prove it's a "real" client.

## Why a custom service

The [upstream doc](../../docs/deployment-strategy.md) references `ghcr.io/imputnet/yt-session-generator:webserver`, which is fine but requires deploying a pre-built image in a separate Railway service. We run a tiny custom Node service instead so it deploys from the same repo (via `Dockerfile.yt-token`) and can be tuned independently (memory, logging, retry policy).

If this service becomes unreliable, switching back to `ghcr.io/imputnet/yt-session-generator:webserver` is a valid fallback — see "Failure modes" below.

## API

All endpoints are `GET`/`HEAD` only. Response bodies are JSON unless noted.

| Path | Status | Purpose |
|------|--------|---------|
| `/` or `/token` | `200` / `503` | Main endpoint. Returns `{ potoken, visitor_data, updated }` on success, plain-text error on failure. Cobalt calls this. |
| `/health` or `/healthz` | **always `200`** | **Liveness probe.** Reports only whether the process is alive. Used by Railway's `healthcheckPath`. |
| `/ready` | `200` / `503` | **Readiness probe.** `200` only when a valid token is cached and ready to serve. |
| `/status` | `200` | Diagnostics: cache age, TTL remaining, backoff state, attempt counters, last error message + age. Useful for debugging without shelling in. |

**Response shape for `/token`** (matches Cobalt's expected format — lowercase `potoken`):
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
| `NODE_OPTIONS` | `--max-old-space-size=256` (from Dockerfile) | Heap cap for the **parent HTTP server**. The parent never runs `jsdom`, so 256 MB is plenty; generation happens in a forked child (see below). |
| `WORKER_HEAP_MB` | `1536` (from Dockerfile) | Heap cap for the **per-generation child process** that runs `youtube-po-token-generator`. Passed as `--max-old-space-size` when `index.js` spawns `generate-worker.js`. |

Railway-injected vars (`RAILWAY_PRIVATE_DOMAIN`, etc.) are not read by the service.

## Architecture: process-isolated token generation

`index.js` is a small HTTP server that **never runs `youtube-po-token-generator` in-process**. On every cache miss it `spawn`s `generate-worker.js` as a short-lived Node child, gives it `--max-old-space-size=${WORKER_HEAP_MB}`, reads the token (or error) from the child's stdout, and returns. The child exits after a single generation.

**Why:** `youtube-po-token-generator` internally loads `jsdom` with `runScripts: 'dangerously'` and evals YouTube's 2.3 MB minified player `base.js`. That VM execution is wildly memory-hungry: it allocates into Node's V8 heap, and on failed BotGuard challenges the library re-enters a `while (true)` retry loop that spins up fresh `JSDOM` instances. In production (see PR #50 / #48), a single generation peaked at 1015 MB of a 1024 MB cap and OOM'd the whole service. Running generation in a forked child contains that blast radius:

- **Parent stays tiny** (~40-50 MB RSS in practice). When the child OOMs, the parent logs a failure, enters the existing 30 s backoff, and returns the stale cached token (or 503) to Cobalt — no service restart, no Railway restart loop.
- **Worker heap is independent**, so we can grant it a generous cap (1536 MB) without inflating the parent's baseline footprint.
- **Timeouts still fire from the parent** (`GENERATION_TIMEOUT_MS = 30 s`); a stuck child is `SIGKILL`'d and the failure path runs normally.

### What didn't work (and why)

- **Raising `NODE_OPTIONS=--max-old-space-size=2048+` on the in-process version.** Doesn't fix the root problem: V8 can't compact jsdom's closure-heavy retry graph fast enough, and one OOM still kills the HTTP server. Also inflates container memory even when idle.
- **Explicit `global.gc()` between generations.** The failure happens *during* one generation (V8 thrashes Mark-Compact at the heap limit), not between them. Explicit GC doesn't help a single peak that exceeds the cap.
- **Swapping to `brainicism/bgutil-ytdlp-pot-provider` as a Railway service.** A real alternative (and documented in [`docs/deployment-strategy.md`](../../docs/deployment-strategy.md)), but it replaces the library rather than fixing it, and conflicts with in-flight dep bumps. Keeping it as a documented escape hatch (see "Failure modes" below).

### Verification evidence

Locally reproduced the production OOM by running the in-process generator 5 times with `--max-old-space-size=1024`: `FATAL ERROR: Reached heap limit` at 1015 MB, parent crashed. After the fix, driving the same library through `generate-worker.js` with deliberately starved heaps (1536 MB):

- 3 of 5 worker runs OOM'd (SIGABRT in the child).
- Parent RSS stayed flat at 45-48 MB for the entire run.
- Successful generations took ~1 s; failures ~10 s (jsdom retry-loop thrash before the OOM fires).
- `/status` correctly reported `lastError` + `inBackoff` after each child failure, and served cached tokens for reads in between.

## Dependencies

- **Runtime**: Node 20 (alpine).
- **Two source files**: `index.js` (HTTP server + cache) and `generate-worker.js` (child process that calls the generator and writes JSON to stdout).
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
With the current code, only a real *parent* process crash can cause this (`/health` always returns 200 when the process is alive). Token generation runs in a forked child (see "Architecture" above), so a jsdom OOM during a BotGuard challenge kills the *child* — the parent logs `Worker failed (signal SIGABRT): worker ran out of memory ...` via `logError`, returns 503 to `/token`, and keeps serving. `process.on('uncaughtException')` and `process.on('unhandledRejection')` log the full stack and *do not exit*. If you see a deploy marked REMOVED, check the deploy logs for a synchronous fatal in the parent (e.g. `EADDRINUSE` on `server.on("error")`, which does `process.exit(1)`).

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
