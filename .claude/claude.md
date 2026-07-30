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

**Cobalt was removed (2026-07).** It was the primary download path and silently returned empty bodies for most videos. Do not reintroduce it without reading [`docs/decisions/0001-remove-cobalt.md`](../docs/decisions/0001-remove-cobalt.md) first.

### PR Preview Environments
PRs get isolated Railway environments via Railway's **native GitHub PR environments** (project Settings → Environments → PR environments). Railway creates `dub-rip-pr-<number>` from production, deploys it, and **auto-deletes it when the PR closes/merges** — no GitHub Actions workflow or `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` secrets involved.

PR environments inherit production variables and get unique domains.

**Do not re-add a custom PR-env GitHub workflow.** A hand-rolled `railway-pr.yml` previously ran alongside native PR envs, creating two environments per PR (`pr-N` *and* `dub-rip-pr-N`) and breaking teardown — orphaned envs piled up and billed idle compute 24/7. Use exactly one mechanism (native).

### Railway Cost Practices
PR environments — not production — are the dominant cost in this project (a July 2026 audit measured ~80% of usage coming from PR envs).

- **Keep PRs short-lived.** Every open PR holds a full environment (app + bgutil-pot). Close design-option/preview PRs once a direction is picked — branches survive, and reopening a PR redeploys its preview.
- **Never leave a PR env alive across releases.** Envs deployed from builds older than #57 generate PO tokens in-process, which produces constant outbound traffic that defeats Railway app-sleep — one such env ran awake continuously for 6 months (`dub-rip-pr-44`, Jan 30 → Jul 17, 2026).
- **Do not point an uptime monitor at `/api/health`.** It actively probes bgutil-pot, so any periodic pinger keeps both services awake 24/7. If external monitoring is ever needed, monitor a static asset or accept the sleep trade-off explicitly.
- **Workspace usage caps** (set 2026-07-17): soft $20 (email alert), hard $40 (Railway stops services). If a legitimate traffic spike hits the hard cap, raise it in workspace billing settings rather than removing it.

## yt-dlp Integration
- yt-dlp is the **only** download path — there is no fallback. A failure is user-visible.
- Requires Python3 in runtime (`RAILPACK_DEPLOY_APT_PACKAGES=python3`)
- Requires `BGUTIL_POT_URL`; the route returns an explicit config error without it
- **Do NOT use** `--cookies-from-browser` on Railway (no browser available)
- Some videos require authentication and cannot be downloaded
- Single video from playlist: `--no-playlist`
- Parse stderr for user-friendly error messages (see `parseYtDlpError`)
- **Always pass `buildJsRuntimeArgs()`** on every yt-dlp invocation. yt-dlp enables *only Deno* by default and our image has none, so without it yt-dlp reports `JS runtimes: none`, can't solve YouTube's `n` challenge, and every download fails with "Requested format is not available". A dev box with Deno installed hides this.
- **`player_client` must stay WebPO-only** (`web_safari,mweb,tv`). bgutil-pot mints WebPO tokens; yt-dlp's `default` chain leads with `visionos`/`android_vr`, which take a different token type — their formats win `bestaudio` and then 403 on the media fetch.
- **Every yt-dlp call is a YouTube request from one datacenter IP.** A single user download currently costs ~3 extractions (preview duration, `fetchVideoDetails`, the download itself). Bursts get the IP bot-checked for several minutes, so avoid adding call sites and don't load-test against a live environment.

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
