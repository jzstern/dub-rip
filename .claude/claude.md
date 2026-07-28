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
- `COBALT_API_URL` - Internal Cobalt service URL (e.g., `http://cobalt-8x3f.railway.internal:9000`)
- `COBALT_API_KEY` - API key for authenticated Cobalt requests
- `RAILPACK_DEPLOY_APT_PACKAGES` - Set to `python3` for yt-dlp fallback (Railway doesn't include Python by default)
- `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` - Sentry error tracking

On the **`cobalt-8x3f`** service (not the app):
- `YOUTUBE_SESSION_SERVER=http://bgutil-pot.railway.internal:4416` — **load-bearing.** Cobalt computes `retrieve_player = Boolean(sessionTokens || cookie)` on an ungated code path, so with this unset (and no `COOKIE_PATH`) it builds no youtubei.js `Player` and **every tunnel returns a 0-byte body** while still reporting `status: "tunnel"`. Point it at `bgutil-pot`, never at `yt-session-generator` — Cobalt 11.x POSTs `/get_pot`, which that image doesn't serve. Details: [`docs/deployment-strategy.md`](../docs/deployment-strategy.md#why-youtube_session_server-must-be-set).

**Cobalt version pin:** the `cobalt-8x3f` Railway service must use a specific image tag (`ghcr.io/imputnet/cobalt:<version>`), never `:latest`. Upstream updates `youtubei.js` frequently to keep up with YouTube's player; a stale Cobalt silently returns 0-byte tunnel bodies for some videos. See [`docs/deployment-strategy.md`](../docs/deployment-strategy.md#cobalt-version-pinning) for the pinning rationale and the 0-byte-body diagnostic runbook.

**0-byte tunnels have two causes** — check `YOUTUBE_SESSION_SERVER` before assuming a stale image. A missing `Player` does not surface as an error: with Cobalt's default `IOS` client, playability still reports `OK`.

**Don't let debugging poison your own results.** Roughly 8–10 YouTube extractions within a few minutes gets the datacenter IP bot-checked, after which everything returns `error.api.youtube.login` ("Sign in to confirm you're not a bot"). Space probes ~60s apart, always include a control video (`dQw4w9WgXcQ`), and suspect your own testing before suspecting a regression.

### PR Preview Environments
PRs get isolated Railway environments via Railway's **native GitHub PR environments** (project Settings → Environments → PR environments). Railway creates `dub-rip-pr-<number>` from production, deploys it, and **auto-deletes it when the PR closes/merges** — no GitHub Actions workflow or `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` secrets involved.

PR environments inherit production variables and get unique domains.

**Do not re-add a custom PR-env GitHub workflow.** A hand-rolled `railway-pr.yml` previously ran alongside native PR envs, creating two environments per PR (`pr-N` *and* `dub-rip-pr-N`) and breaking teardown — orphaned envs piled up and billed idle compute 24/7. Use exactly one mechanism (native).

### Railway Cost Practices
PR environments — not production — are the dominant cost in this project (production steady-state is ~$2.50/mo across all three services; a July 2026 audit measured ~80% of usage coming from PR envs).

- **Keep PRs short-lived.** Every open PR holds a full 3-service environment (app + cobalt + bgutil-pot). Close design-option/preview PRs once a direction is picked — branches survive, and reopening a PR redeploys its preview.
- **Never leave a PR env alive across releases.** Envs deployed from builds older than #57 generate PO tokens in-process, which produces constant outbound traffic that defeats Railway app-sleep — one such env ran awake continuously for 6 months (`dub-rip-pr-44`, Jan 30 → Jul 17, 2026).
- **Do not point an uptime monitor at `/api/health`.** It actively probes cobalt and bgutil-pot, so any periodic pinger keeps all three services awake 24/7 (~+$10–12/mo). If external monitoring is ever needed, monitor a static asset or accept the sleep trade-off explicitly.
- **Workspace usage caps** (set 2026-07-17): soft $20 (email alert), hard $40 (Railway stops services). If a legitimate traffic spike hits the hard cap, raise it in workspace billing settings rather than removing it.

## yt-dlp Integration
- yt-dlp is used as a **fallback** when Cobalt fails (primary download method is Cobalt)
- Requires Python3 in runtime (`RAILPACK_DEPLOY_APT_PACKAGES=python3`)
- **Do NOT use** `--cookies-from-browser` on Railway (no browser available)
- Some videos require authentication and cannot be downloaded via yt-dlp fallback
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
