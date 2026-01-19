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
- **Deployment**: Railway (with Cobalt + yt-session-generator)
- **Audio Processing**: Cobalt API (primary) + yt-dlp (fallback)

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

This project is configured to deploy on Railway with a self-hosted Cobalt instance for YouTube downloads.

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Railway Project                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   dub-rip app   │──│     Cobalt      │──│yt-session-  │  │
│  │   (SvelteKit)   │  │   (port 9000)   │  │ generator   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Services Required

1. **dub-rip** - This app (SvelteKit + Node.js)
2. **Cobalt** - YouTube download API (`ghcr.io/imputnet/cobalt:latest`)
3. **yt-session-generator** - BotGuard token generator (`ghcr.io/imputnet/yt-session-generator:webserver`)

### Environment Variables

```bash
# dub-rip service
COBALT_API_URL=http://cobalt.railway.internal:9000
COBALT_API_KEY=your-api-key-uuid
RAILPACK_DEPLOY_APT_PACKAGES=python3

# Cobalt service
API_URL=https://your-cobalt-url.up.railway.app/
API_KEY_URL=file://keys.json
YOUTUBE_SESSION_SERVER=http://yt-session.railway.internal:8080/
YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED
```

See [deployment-strategy.md](docs/deployment-strategy.md) for detailed setup instructions.

### PR Preview Environments

Pull requests from the same repository automatically get isolated Railway environments for testing (secrets aren't exposed to forks). Each PR environment:
- Inherits production environment variables
- Gets a unique preview URL
- Is automatically cleaned up when the PR closes

**Setup Requirements:**
1. Add `RAILWAY_TOKEN` secret (Railway API token) to GitHub repository settings
2. Add `RAILWAY_PROJECT_ID` variable (Railway project ID) to GitHub repository settings

## How It Works

1. User enters a YouTube URL
2. The frontend sends a request to `/api/download-stream`
3. The backend attempts to download via Cobalt API:
   - Cobalt requests a `poToken` from yt-session-generator (BotGuard bypass)
   - Cobalt fetches the audio stream from YouTube
   - On success: streams audio back to dub-rip
   - On failure: falls back to yt-dlp with ffmpeg
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
