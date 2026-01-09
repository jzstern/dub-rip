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

For full templates, see `skills/svelte-patterns/`

### Error Handling
- Server: Log full error to console, return user-friendly message
- Client: Log to console, show friendly message via state
- Never expose raw command output to users

## File Organization
- Components: `src/lib/components/` (PascalCase.svelte)
- UI components: `src/lib/components/ui/` (shadcn)
- Types: `src/lib/types.ts`
- API routes: `src/routes/api/` (kebab-case)

## yt-dlp Integration
- Always use `--cookies-from-browser chrome` (bot detection)
- Single video from playlist: `--no-playlist`
- Playlist info: `--playlist-end 10` (avoid buffer overflow)
- Parse stderr for user-friendly error messages

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
- **Always use git worktree** for new work: `git worktree add ../dub-rip-<branch> <branch>`
- **Never commit to main** - always use branches
- Clean up after merge: `git worktree remove ../dub-rip-<branch>`
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
