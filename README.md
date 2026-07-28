# dub-rip

A simple web app to download YouTube audio with rich metadata including song title, artist name, album name, artwork, and release year.

## Features

- Download audio from YouTube videos
- Automatically embed metadata:
  - Song title
  - Artist name
  - Album name
  - Artwork/thumbnail
  - Release year
- Clean, simple UI
- Fast downloads with best audio quality

## Tech Stack

- **Frontend**: Svelte 5 + SvelteKit
- **Backend**: SvelteKit API routes
- **Deployment**: Railway (with bgutil-pot)
- **Audio Processing**: yt-dlp + ffmpeg

## Development

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun run dev
```

Build for production:

```bash
bun run build
```

## Deployment

This project is configured to deploy on Railway. Downloads run through yt-dlp, with a bgutil-pot sidecar supplying the PO tokens YouTube requires.

### Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Railway Project                              │
│  ┌─────────────────┐                       ┌──────────────────────┐  │
│  │   dub-rip app   │───────────────────────│     bgutil-pot       │  │
│  │   (SvelteKit)   │      PO tokens        │     (port 4416)      │  │
│  └─────────────────┘                       └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Services Required

1. **dub-rip** - This app (SvelteKit + Node.js)
2. **bgutil-pot** - PO token sidecar for yt-dlp (`brainicism/bgutil-ytdlp-pot-provider:1.3.1`)

> A self-hosted Cobalt instance used to sit in front of yt-dlp. It was removed in July 2026 — see [ADR 0001 — Remove Cobalt](docs/decisions/0001-remove-cobalt.md).

### Environment Variables

```bash
# dub-rip service
RAILPACK_DEPLOY_APT_PACKAGES=python3
# bgutil-ytdlp-pot-provider sidecar; required for yt-dlp PO tokens
BGUTIL_POT_URL=http://bgutil-pot.railway.internal:4416
```

See [deployment-strategy.md](docs/deployment-strategy.md) for detailed setup instructions.

### PR Preview Environments

Pull requests automatically get isolated Railway environments via Railway's **native GitHub PR environments** (enabled in the Railway project under Settings → Environments). Each PR environment:
- Is named `dub-rip-pr-<number>` and branches from production
- Inherits production environment variables
- Gets a unique preview URL (Railway comments it on the PR)
- Is automatically deleted by Railway when the PR is closed or merged

No GitHub Actions secrets are required for previews — Railway manages create/deploy/teardown through its GitHub integration. (A previous hand-rolled `railway-pr.yml` workflow was removed: running it alongside Railway-native PR envs created two environments per PR and broke teardown, leaving orphaned environments that accrued idle compute cost.)

> **Note on adding new env vars:** PR preview environments clone variables from production at creation time. If you add a new env var to the `dub-rip` service after a PR preview env was created, the preview env won't pick it up automatically. For env vars that the PR's code path depends on:
>
> - Add the var to production *before* opening the PR (preview clones from current production state), OR
> - Set the var manually on the PR preview env via the Railway dashboard / `railway variables --set` after the env is provisioned, OR
> - Push a new commit (or close + reopen the PR) to re-provision the preview env.
>
> This caught us during the bgutil-pot rollout: `BGUTIL_POT_URL` was set on production after the bgutil-cutover PR's preview env was created, so the preview env failed fast on the yt-dlp fallback path even though production worked.

## How It Works

1. User enters a YouTube URL
2. The frontend sends a request to `/api/download-stream`
3. The backend downloads with yt-dlp + ffmpeg, which requests a PO token from the bgutil-pot sidecar during extraction
4. Metadata is extracted (title, artist, album, artwork)
5. ID3 tags are embedded into the MP3
6. The file is streamed back to the user's browser

## AI-Assisted Development

This project uses Claude Code with custom configuration for streamlined development.

### Commands

| Command | Description |
|---------|-------------|
| `/review` | Code review for security, quality, and performance issues |
| `/security` | OWASP Top 10 security audit of the codebase |
| `/test` | Generate unit tests with Vitest |
| `/e2e` | Run Playwright E2E tests with failure analysis |
| `/compound` | Capture learnings to improve future development |
| `/interview` | Interactive planning and task breakdown |

### Plugins

These plugins are enabled for all contributors:

| Plugin | Description |
|--------|-------------|
| `frontend-design` | High-quality frontend interface generation |
| `code-review` | Automated code review for quality and standards |
| `typescript-lsp` | TypeScript language server integration |
| `code-simplifier` | Code clarity and maintainability improvements |

### Agents

Specialized agents available via the Task tool:

| Agent | Description |
|-------|-------------|
| `code-reviewer` | Reviews changed files for quality and security |
| `debugger` | Investigates errors and traces issues |
| `test-generator` | Generates Vitest unit tests |
| `e2e-runner` | Runs Playwright E2E tests |
| `security-auditor` | OWASP Top 10 vulnerability scanning |
| `codebase-search` | Semantic code search across the project |
| `media-interpreter` | Analyzes images, diagrams, and screenshots |
| `open-source-librarian` | Finds and evaluates open source libraries |

### Skills

| Skill | Description |
|-------|-------------|
| `planning-with-files` | Structured planning with todo files |
| `svelte-code-writer` | Official Svelte 5 docs lookup and autofixer CLI |
| `svelte-patterns` | Project-specific component templates and patterns |

### Hooks (Automatic)

| Hook | Trigger | Description |
|------|---------|-------------|
| `format-on-save` | PostToolUse (Edit/Write) | Auto-formats with Biome |
| `keyword-detector` | UserPromptSubmit | Suggests relevant commands |
| `check-comments` | PostToolUse (Edit/Write) | Validates code comments |
| `todo-enforcer` | Stop | Blocks exit with incomplete todos |

### Testing

```bash
bun run test        # Run unit tests
bun run test:e2e    # Run E2E tests
bun run test:e2e:ui # Run E2E tests with interactive UI
```

## License

MIT
