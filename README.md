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
- **Deployment**: Vercel
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

This project is configured to deploy on Vercel. Simply connect your repository to Vercel and it will automatically deploy.

The project uses:
- `@sveltejs/adapter-vercel` for serverless deployment
- Extended function timeout (300s) for long downloads
- Automatic yt-dlp binary installation

## How It Works

1. User enters a YouTube URL
2. The frontend sends a POST request to `/api/download`
3. The backend uses yt-dlp to:
   - Download the audio from the video
   - Extract metadata from YouTube
   - Embed metadata into the MP3 file
   - Add artwork/thumbnail
4. The file is streamed back to the user's browser for download

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
