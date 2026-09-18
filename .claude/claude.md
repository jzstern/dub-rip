# dub-rip Development Guidelines

## Project Overview
YouTube audio downloader with rich metadata. Built with SvelteKit 5, TypeScript, shadcn-svelte, Tailwind, yt-dlp, node-id3.

## Tech Stack
- **Runtime**: Bun (not npm/yarn/pnpm)
- **Framework**: SvelteKit 5 with Svelte 5 runes (`$state`, `$props`, `$effect`)
- **UI**: shadcn-svelte + Tailwind v3 (dark mode supported)
- **Code Quality**: Biome (linter + formatter)

## Critical Rules

### Indentation
- **TABS only** (not spaces) - tab size 2 for display
- Always Read before Edit; match indentation exactly
- If Edit fails on tab-heavy files, use Write tool instead

### Biome
Handles formatting/linting. Run `bun run lint` before committing.
- **Never run** `--unsafe` without approval (false positives on Svelte imports)

### Svelte 5 Patterns
- State: `let count = $state(0)`
- Props: `let { title }: Props = $props()`
- Effects: `$effect(() => { ... })`
- shadcn: Import from `$lib/components/ui/*`, namespace imports for compound components
- Import components as values, not types (`import { X }` not `import type { X }`)

For full templates, see `.claude/skills/svelte-patterns/`

### Error Handling
- Server: Log full error to console, return user-friendly message
- Client: Log to console, show friendly message via state
- Never expose raw command output to users

## File Organization
- Components: `src/lib/components/` (PascalCase.svelte)
- UI components: `src/lib/components/ui/` (shadcn)
- Types: `src/lib/types.ts`
- API routes: `src/routes/api/` (kebab-case)

## Railway Deployment
Required environment variables for production:
- `BGUTIL_POT_URL` - Internal bgutil-pot service URL (e.g., `http://bgutil-pot.railway.internal:4416`). Downloads fail fast without it.
- `RAILPACK_DEPLOY_APT_PACKAGES` - Set to `python3` for yt-dlp (Railway doesn't include Python by default)

Optional:
- `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` - Sentry error tracking. Deploys work without them; errors just go to logs only.
- `SENTRY_AUTH_TOKEN` - **Consumed at build time.** Without it the build still succeeds but uploads no source maps, so every browser stack trace in Sentry stays minified. Use an *organization* auth token from `https://jzs-yw.sentry.io/settings/auth-tokens/`; those carry the release/source-map scopes already.

### Error Reporting
See [`docs/error-reporting.md`](../docs/error-reporting.md) for the full policy. The rules that bite if forgotten:

- **A caught error is an invisible error.** Every route here catches its own failures and returns a friendly message, so SvelteKit's `handleError` never fires. Any new `catch` that swallows a failure must call `Sentry.captureException` itself, or the failure will not exist as far as Sentry is concerned.
- **Report an incident once.** The server reports its own failures, so the browser only leaves a breadcrumb for anything the server already answered for (`ServerRejectionError` in `+page.svelte`, SSE `error` events). Capturing on both sides files two issues for one incident.
- **Expected failures are not issues.** A private/age-restricted/copyright-blocked video is normal operation — `classifyYtDlpError` marks these `category: "user"` and they get a breadcrumb, never an event. Only `transient` (warning) and `unknown` (error) reach Sentry.
- **`parseYtDlpError` is pure — keep it that way.** Retry logic calls it once per attempt, so reporting from inside it multiplied one failure into several events.
- **One DSN, one project — environments are separated by the `environment` tag.** Resolution order is explicit override (`SENTRY_ENVIRONMENT` / `PUBLIC_SENTRY_ENVIRONMENT`) → Railway inference (`RAILWAY_ENVIRONMENT_NAME`: `production` vs everything-else-is-`preview`) → `development`. PR envs inherit production's variables, so without this tag their errors are indistinguishable from real ones. `RAILWAY_GIT_COMMIT_SHA` becomes the release; the browser can't read Railway vars at runtime, so `vite.config.ts` inlines them via `define`.
- **`GET /api/health` reports what an instance actually resolved** (`.sentry`). If `serverEnvironment` and `browserEnvironment` disagree, client and server events are landing in different Sentry environments — set `PUBLIC_SENTRY_ENVIRONMENT`, which is read at runtime.
- **Traces are sampled in production only** (`resolveTracesSampleRate`), for the same cost reasons as the Railway practices below.

**Image version pin:** the `bgutil-pot` Railway service must use a specific image tag + digest, never `:latest`. Railway caches whatever digest `:latest` resolved to at first deploy, so `:latest` gives the illusion of freshness without the freshness. See [`docs/deployment-strategy.md`](../docs/deployment-strategy.md#image-version-pinning).

**Production egresses through Railway Static Outbound IPs (enabled 2026-09-17).** The previous egress IP was refused by YouTube for every media fetch — DASH formats 403'd, HLS fragments 403'd then 401'd — and no client or format change fixed it; switching IPs did, immediately. This is dashboard state with no trace in the repo, so check it with `railway outbound-network status --service dub-rip --environment production --json` rather than assuming. Railway does not guarantee the addresses are dedicated, and sustained traffic can get them flagged too; the durable fallback is a residential proxy. See [`docs/deployment-strategy.md`](../docs/deployment-strategy.md).

**Cobalt was removed (2026-07).** It was the primary download path and silently returned empty bodies for most videos. Do not reintroduce it without reading [`docs/decisions/0001-remove-cobalt.md`](../docs/decisions/0001-remove-cobalt.md) first.

### PR Preview Environments
PRs get isolated Railway environments via Railway's **native GitHub PR environments** (project Settings → Environments → PR environments). Railway creates `dub-rip-pr-<number>` from production, deploys it, and **auto-deletes it when the PR closes/merges** — no GitHub Actions workflow or `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` secrets involved.

PR environments inherit production variables and get unique domains.

**Do not re-add a custom PR-env GitHub workflow.** A hand-rolled `railway-pr.yml` previously ran alongside native PR envs, creating two environments per PR (`pr-N` *and* `dub-rip-pr-N`) and breaking teardown — orphaned envs piled up and billed idle compute 24/7. Use exactly one mechanism (native).

### Railway Cost Practices
PR environments — not production — are the dominant cost in this project (a July 2026 audit measured ~80% of usage coming from PR envs).

- **Keep PRs short-lived.** Every open PR holds a full environment (app + bgutil-pot). Close design-option/preview PRs once a direction is picked — branches survive, and reopening a PR redeploys its preview.
- **Never leave a PR env alive across releases.** Envs deployed from builds older than #57 generate PO tokens in-process, which produces constant outbound traffic that defeats Railway app-sleep — one such env ran awake continuously for 6 months (`dub-rip-pr-44`, Jan 30 → Jul 17, 2026).
- **Do not point an uptime monitor at `/api/health?probe=bgutil`.** That query form is the only one that actively probes bgutil-pot, and any periodic pinger against it keeps both services awake 24/7. Plain `GET /api/health` (no query params) is a cheap liveness check with no network probe, on purpose — it's also what the app service's own Railway healthcheck must use, since a probing default would return 503 whenever the sidecar is merely asleep (normal operation) and get the app restart-looped for it. If external monitoring is ever needed, hit plain `/api/health`, monitor a static asset, or accept the sleep trade-off explicitly — never the `?probe=bgutil` form.
- **Workspace usage caps** (set 2026-07-17): soft $20 (email alert), hard $40 (Railway stops services). If a legitimate traffic spike hits the hard cap, raise it in workspace billing settings rather than removing it.

## Production Canary

From 2026-09-14 05:05 UTC, every production download failed for ~2 days before
anyone noticed: Sentry captured the errors, but traffic is too low for
rate-based alerts to fire, and an earlier 15×403 warning (2026-08-30) was also
missed. `POST /api/canary` exists to catch the next one within hours.

- **It must run inside the `dub-rip` service — never a separate service, a
  GitHub Action running yt-dlp itself, or a PR environment.** Railway Static
  Outbound IPs are per-service, and YouTube's blocking follows the egress IP.
  This already misled the 2026-09-14 incident once: a PR env download
  succeeded on the exact code and video that 403'd in production, because the
  PR env doesn't share production's IP. A canary anywhere else can pass while
  production is silently broken. GitHub Actions (`.github/workflows/canary.yml`,
  6-hourly cron + `workflow_dispatch`) only *triggers* the endpoint; it never
  downloads anything itself.
- **It reuses the exact production code path**, unmodified:
  `tryYtDlpDownload` from `try-yt-dlp.ts` (same argv, format selector, extractor
  args), and the shared `withYtDlpConcurrencyLimit` limiter (`yt-dlp-concurrency.ts`)
  so it queues behind real users rather than starving them. A full queue is
  recorded as a skip (`queue_full`), not a failure.
  See `src/lib/canary/run-canary-download.ts`.
- **It always answers 200** once authenticated (`Authorization: Bearer
  <CANARY_TOKEN>`, constant-time compared, 404 if `CANARY_TOKEN` is unset, 401
  on a bad token), even when the run fails — the GitHub workflow only fails on
  401/404/5xx/unreachable, so alerting lives in exactly one place: Sentry.
  Never log the token.
- **It reports through a Sentry Cron Monitor** (`src/lib/canary/report-canary-check-in.ts`),
  `in_progress` → `ok`/`error`, opening an issue only after 2 consecutive
  failures and alerting on a missed check-in. Sentry's check-in payload has no
  room for custom tags, and `captureMessage` was tried and reverted — it opens
  its own Issue on the very first failure, independent of
  `failureIssueThreshold`, which reintroduces "two issues for one incident" a
  full cycle before the monitor's own threshold ever fires. `Sentry.logger`
  (`enableLogs: true` in `sentry-options.ts`) carries the same `stage`/`itag`/
  `detail` context as a searchable log entry instead, without ever opening an
  Issue itself.
- **Runbook**, keyed off the `stage` a failed run reports
  (`src/lib/canary/classify-canary-run.ts`):
  | Stage | Likely cause | Fix |
  | --- | --- | --- |
  | `media_refused` / `fragments_refused` | The egress IP is blocked (media fetch or every HLS fragment 403s/401s) | Rotate the Railway Static Outbound IP, or move to a residential proxy — see [`docs/deployment-strategy.md`](../docs/deployment-strategy.md) |
  | `page_rate_limited` | YouTube 429s the watch page from the egress IP (`Unable to download webpage: HTTP Error 429`). yt-dlp doesn't retry it and has no visitor data afterwards, so the run's ERROR line is a bot-check — but the first failure is IP throttling, not a client-list problem | Rotate the Railway Static Outbound IP, or move to a residential proxy — see [`docs/deployment-strategy.md`](../docs/deployment-strategy.md). Don't touch the client list |
  | `player_bot_check` | A bot-check with no watch-page 429 (a 429 is classified as `page_rate_limited` above): YouTube is bot-checking the current client list before any format is even chosen | Check `_DEFAULT_CLIENTS` in yt-dlp's `_video.py` against `YOUTUBE_EXTRACTOR_ARG` — don't hand-pick a list (see the `player_client` history in `yt-dlp-binary.ts`) |
  | `format_unavailable` | SABR-only response / no downloadable format for this client | Format selector or client-list problem, not an IP block — see `try-yt-dlp.ts`'s format selector comment |
  | `unknown` | Nothing recognized | Treat like any `unknown`-category yt-dlp failure — new yt-dlp/YouTube breakage, read the `detail` from the canary's Sentry Log entry or the endpoint's JSON response |
- **Cost**: one real yt-dlp invocation against production every 6 hours, from
  the same egress IP and through the same concurrency limiter real users use.
  It wakes the sleeping app and bgutil-pot sidecar on the same schedule (see
  the Railway Cost Practices above) — this is expected, not a leak, and is why
  the interval is 6h and not tighter. Never point anything at this endpoint on
  a shorter interval or in a load test.
- **Phase 2** (not built): a circuit breaker that reroutes real downloads
  through a residential proxy after 2 consecutive `media_refused`/
  `fragments_refused` canary checks, while the canary keeps probing the direct
  egress so the breaker can close again. See the PR that introduced Phase 1
  for the open design questions (state persistence across sleep/restart,
  bgutil-pot's own IP-bound PO tokens, cost caps, keeping the proxy URL out of
  logs/Sentry).

## yt-dlp Integration
- yt-dlp is the **only** download path — there is no fallback. A failure is user-visible.
- Requires Python3 in runtime (`RAILPACK_DEPLOY_APT_PACKAGES=python3`)
- Requires `BGUTIL_POT_URL`; the route returns an explicit config error without it
- **Do NOT use** `--cookies-from-browser` on Railway (no browser available)
- Some videos require authentication and cannot be downloaded
- Single video from playlist: `--no-playlist`
- Parse stderr for user-friendly error messages (see `parseYtDlpError`)
- **Always pass `buildJsRuntimeArgs()`** on every yt-dlp invocation. yt-dlp enables *only Deno* by default and our image has none, so without it yt-dlp reports `JS runtimes: none`, can't solve YouTube's `n` challenge, and every download fails with "Requested format is not available". A dev box with Deno installed hides this.
- **`player_client` follows yt-dlp's `default` chain** (`visionos,web` on 2026.08.19) — do not hand-pick a list. It was pinned to `web_safari,mweb,tv` until 2026-09-14, when YouTube began bot-checking all three from Railway: every download failed with "Sign in to confirm you're not a bot" while bgutil-pot minted valid tokens for each attempt, on a release unchanged for 41 days. A hand-picked list is frozen at the moment someone picked it; the default moves with upstream as YouTube shifts. `visionos` takes no PO token at all (`VISIONOS` is absent from `WEBPO_CLIENTS` in `youtube/pot/utils.py`), so any download `visionos` serves never touches bgutil-pot; only a fallback to `web` does, and how often that fallback happens has not been measured. The pin existed to stop a non-WebPO lead client's formats winning `bestaudio` and then 403ing on the media fetch. That hazard is real with `visionos` too: on 2026-09-16 its direct https audio (itag 251) downloaded cleanly from a PR env but 403d on every production attempt. Trying HLS audio first (the format selector in `try-yt-dlp.ts`) did not fix it — every HLS fragment was refused too; a new egress IP did (see the static-IP note under Railway Deployment). Never answer that 403 with `player_client=default,-visionos` — it leaves only `web`, which is SABR-only at this pin, so no downloadable audio remains. Re-read `_DEFAULT_CLIENTS` in `yt_dlp/extractor/youtube/_video.py` when bumping the pin.
- **Tokens minted but every attempt logs `No title found in player responses` means the clients are burned, not the token pipeline.** That warning on *every* attempt, alongside `Generating a player PO Token …` lines and bgutil-pot logging a fresh `poToken:` for the same video ID, is what the 2026-09-14 outage looked like. Don't debug the sidecar when you see it — the fix is on the client side.
- **The webpage client does not announce itself, and its silence is not a fault.** yt-dlp reads one client's player response straight out of the watch page rather than making a separate innertube call — whichever client `_DEFAULT_WEBPAGE_CLIENT` in `_video.py` names (`web` on 2026.08.19, `web_safari` on 2026.07.04). That client prints no `Downloading … client config` / `… player API JSON` lines, and takes no *player* PO token, because it issues no player request to attach one to. A healthy 2026.08.19 log reads `Downloading webpage` → `Downloading visionos player API JSON`, with nothing for `web`. Force the explicit call with `--extractor-args "youtube:player_skip=webpage"` to see which path a release takes.
- **`fetch_pot=always` is not optional, and it is not a tuning knob.** Under yt-dlp's default `fetch_pot=auto`, a PO token is minted only when the *client's own policy* marks one required or recommended — and `web` (like `web_safari`, via the shared `WEB_PO_TOKEN_POLICIES`) declares `PlayerPoTokenPolicy(required=False)`. So when a download falls back to `web`, its innertube **player** request goes out with no token, YouTube bot-checks it from Railway's datacenter IP, and it fails with "Sign in to confirm you're not a bot" *while bgutil-pot sits there healthy and is never asked for anything*. It is inert for `visionos`, which takes no WebPO token either way — so a missing `Generating a player PO Token …` line is **normal** whenever `visionos` served the video, and only a fault when `web` issued a player request. Both arg builders share `YOUTUBE_EXTRACTOR_ARG` in `src/lib/yt-dlp-binary.ts` so the two halves can't drift apart — add new call sites through that constant, never by writing the string out again.
- **Never add `--no-warnings` to a yt-dlp invocation.** A missing PO token is reported by yt-dlp *only* as a warning; the ERROR that reaches Sentry is the downstream bot-check, which names no cause. Suppressing warnings is what made the failure above take a full extraction trace to diagnose. Use `--no-update` for the one warning that genuinely is noise (the pinned binary's "older than 90 days" notice).
- **Every yt-dlp call is a YouTube request from one datacenter IP.** `video-details-cache.ts` collapses the preview and metadata lookups into one extraction, so a download now costs ~1-2 rather than 3 — route any new metadata read through that cache rather than spawning yt-dlp again. Bursts get the IP bot-checked for several minutes, so don't load-test against a live environment.

### Pinned version + baked binary
- **The version pin lives in `scripts/yt-dlp-pin.mjs`** (`YTDLP_VERSION`, `BGUTIL_PLUGIN_VERSION`). Both the build script and `src/lib/yt-dlp-binary.ts` import it — plain `node`/`bun` can't import the TS module (`$env/dynamic/private`), so the dependency runs pin → both. Bump the pin there and nowhere else, and keep that module side-effect-free or the build script lands in the server bundle.
- **The pin expires fast — `ASSET_SHA256` is what holds, not `YTDLP_VERSION`.** The version pin governs only the baked binary, and only until the first background refresh: `ensureYtDlpBinary()` prefers `/tmp` over the bake, and `isBinaryStale()` measures the *bake time*, so any deployment older than 24h leaves the pinned version behind on its first request. Treat `YTDLP_VERSION` as "the version a cold container starts on", never as "the version production runs". What survives that is `ASSET_SHA256` and the host allowlist, which apply on every path — see the integrity bullet below.
- **The refresh is deliberate, not a gap.** `ensureYtDlpBinary()` still tracks `releases/latest` on a 24h background refresh, deliberately — yt-dlp ships extraction fixes as YouTube changes, and a frozen binary eventually stops working. Don't "simplify" that away. **Both branches gate that refresh on `isBinaryStale()`** — the baked binary's mtime is its bake time, so an old image still refreshes and a fresh one doesn't. Gating it is not the simplification this bullet warns about: refreshing the baked branch unconditionally spent each deployment's first request re-fetching 40 MB identical to the pin already on disk. Note `/tmp` survives app-sleep wakes, so the baked branch runs about once per deployment, not once per cold start — don't reach for it to explain repeated refreshes in the logs, which are the `/tmp` TTL. Pin a version known to work, not necessarily the newest (yt-dlp#15036 regressed throughput ~30x), and verify a bump by downloading a real video in a PR env. A PR-env pass proves the code path, not production: YouTube's blocking follows the egress IP, and on 2026-09-16 a download that passed in a PR env 403d in production with identical code. Confirm on dub.rip after deploying.
- **`bun run build` bakes `bin/yt-dlp` and `bin/yt-dlp-plugins/`** so a cold container doesn't re-fetch a 40 MB binary into ephemeral `/tmp` (measured 7.8s, in front of the user's first preview). `bin/` is gitignored and platform-specific.
- **Keep the `/tmp` download fallback.** It's the safety net for a deploy image that didn't carry `bin/`. Same reason the fetch script exits 0 when GitHub is *unreachable* — a failed bake costs latency, not a broken deploy. That tolerance stops at the bytes: an `AssetIntegrityError` (digest mismatch, or an asset with no recorded digest) exits 1 and fails the build on purpose. Exiting 0 there would hand CI a green build with no `bin/` and silently push the problem onto the runtime fallback. Keep the two branches distinguished by error *type*, never by message text.
- **Nothing is *downloaded* unverified.** Every fetch of yt-dlp or the bgutil plugin — build-time bake and runtime refresh alike — is hashed and compared before it is written, and its URL must sit under `getReleaseAssetPrefix(repo)`. Note the scope precisely: the plugin is re-verified on *every* path, including the `/tmp` and baked copies, because one pinned digest covers every copy of it. The binary is verified at download time only — a `latest`-tracked file has no single expected digest to re-check `/tmp` against — so this is not a claim that the process only ever executes verified bytes.
- **The allowlist pins the repository, not just the host — this is load-bearing.** github.com serves release assets for *every* account, so "it is on github.com" is not a trust boundary. On the common path (`latest` past the pin) the digest the bytes are held to comes from the same API response as the URL, so a response naming some other account's asset alongside that asset's real digest would verify against itself. Requiring the `/yt-dlp/yt-dlp/releases/download/` path is what stops that. Compare `parsed.origin + parsed.pathname`, never the raw string — the WHATWG parser normalises `..` and percent-encoded traversal first.
- **Digest resolution, in order:** when the resolved tag equals `YTDLP_VERSION` the in-repo `ASSET_SHA256` entry wins; otherwise the `digest` the releases API reports for that asset. **If neither resolves, the download is refused.** That is safe because both refresh branches keep serving the binary already on disk; only a cold container with no bake has nothing to fall back on, and that path already hard-fails when GitHub is down. Two limits worth knowing rather than rediscovering: the pin-vs-API cross-check only fires when GitHub is *honest* (a hostile response just names a different tag), so treat it as a re-published-asset canary, not a defence; and none of this detects a compromise of yt-dlp's own release pipeline, which is inherent to tracking `releases/latest`.
- The boot log says which path was taken (`Using baked yt-dlp binary at …` vs `No baked yt-dlp binary found…`). Check it after any change to the build or the deploy image.
- **`POST /api/preview` fire-and-forget pings `${BGUTIL_POT_URL}/ping`** to wake the sleeping sidecar while the user is still reading the preview. Use `/ping` (the healthcheck), never `/get_pot` — the latter does real BotGuard work speculatively. Never await it, always bound it with `AbortSignal.timeout`, always swallow the rejection.

## Metadata (node-id3)
- Use node-id3 for ID3 tags (not ffmpeg)
- Title should NOT include artist name
- Filename: `Artist - Title.mp3`
- Parse video title with patterns: ` - `, `: `, ` | `

## Commands
```bash
bun run dev          # Dev server
bun run build        # Production build
bun run check        # TypeScript check
bun run lint         # Biome lint
bun run test         # Unit tests (Vitest)
bun run test:e2e     # E2E tests (Playwright)
```

## Before Committing
- Check dev server for compilation errors
- Run `bun run check` and `bun run lint`
- Run code-simplifier and security-auditor agents
- Test: valid URL → preview → download works
- Test error cases: invalid URL, private video, playlist edge cases

## Git Workflow
- **Never commit to main** - always use feature branches (superpowers handles worktree setup)
- Only share a branch with another Claude session if explicitly requested
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- PR template: `.github/PULL_REQUEST_TEMPLATE.md`
- **Always generate tests** for new functionality before committing
- **Always update PR description** when adding commits - keep "How to test" current
- Never commit: node_modules, .svelte-kit, .env, downloaded MP3s

## Security
- Never commit credentials
- Validate URLs, sanitize filenames (path traversal)
- Clean up temp files after download

## Performance
- Dynamic imports for large dependencies
- Import specific functions, not entire libraries
- Use `createRequire` for CommonJS in SSR; mark in `ssr.external`

## AI-Assisted Development

### Commands
`/review`, `/security`, `/test`, `/e2e`, `/compound`, `/interview`

### Hooks (Automatic)
format-on-save, keyword-detector, check-comments, todo-enforcer

### Documentation Maintenance
- **README.md**: Update when adding features, changing setup, adding dependencies
- **CLAUDE.md**: Update when discovering patterns/pitfalls, adding commands/hooks
- After tasks: "Would a new developer need to know this?" → update relevant docs

## Resources
[SvelteKit](https://kit.svelte.dev) · [Svelte 5](https://svelte.dev/docs/svelte/$state) · [shadcn-svelte](https://shadcn-svelte.com) · [Tailwind](https://tailwindcss.com) · [Biome](https://biomejs.dev) · [yt-dlp](https://github.com/yt-dlp/yt-dlp)
