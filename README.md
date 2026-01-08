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

This project uses Claude Code with custom commands for streamlined development.

### Commands

| Command | Description |
|---------|-------------|
| `/review` | Code review for security, quality, and performance issues |
| `/security` | OWASP Top 10 security audit of the codebase |
| `/test` | Generate unit tests with Vitest |
| `/e2e` | Run Playwright E2E tests with failure analysis |
| `/compound` | Capture learnings to improve future development |

### Testing

```bash
bun run test        # Run unit tests
bun run test:e2e    # Run E2E tests
bun run test:e2e:ui # Run E2E tests with interactive UI
```

### Automated Hooks

- **Auto-format**: Files are formatted with Biome on save
- **Protected files**: Prevents accidental edits to `.env`, `bun.lock`, etc.
- **Context hints**: Suggests relevant commands based on your prompts

## License

MIT
