# dub-rip Development Guidelines

## Project Overview
YouTube audio downloader with rich metadata (title, artist, album, artwork). Built with SvelteKit 5, TypeScript, shadcn-svelte, and Tailwind CSS.

## Tech Stack
- **Runtime**: Bun (preferred over npm/yarn/pnpm)
- **Framework**: SvelteKit 5 (Svelte 5 runes: $state, $props, $effect)
- **UI**: shadcn-svelte + Tailwind CSS v3
- **Styling**: Tailwind CSS with dark mode support
- **Backend**: yt-dlp-wrap, node-id3, ffmpeg
- **Code Quality**: Biome (linter + formatter)

## Code Formatting Rules

### Critical: Indentation
- **Project uses TABS, not spaces**
- All Svelte, TypeScript, and config files use tab indentation
- When editing files, preserve exact indentation from Read tool output
- Tab size: 2 spaces (visual display only, actual character is `\t`)

### When Using Edit Tool
1. **Always Read first**: Use Read tool before any Edit
2. **Match exactly**: Copy indentation exactly as shown after line numbers
3. **If Edit fails**: Use sed/awk for tab-heavy files
4. **Verify brackets**: Check all `{#if}`, `{/if}`, `{`, `}` match after edits

### Biome Configuration
- Biome is configured for tabs, double quotes, import organization
- **Never run** `biome check --write --unsafe` without explicit user approval
- Review all Biome suggestions before applying
- Biome may incorrectly mark used imports as unused - verify before removing

## Component Patterns

### Svelte 5 Runes
```svelte
<!-- State -->
let count = $state(0);
let user = $state<User | null>(null);

<!-- Props -->
let { title, onClick }: Props = $props();

<!-- Effects -->
$effect(() => {
	console.log('count changed:', count);
});
```

### shadcn-svelte Components
- Import from `$lib/components/ui/*`
- Use namespace imports for compound components: `import * as Card from "$lib/components/ui/card"`
- Props use `let { ... } = $props()` pattern
- Always import the component itself, not just types: `import { Progress } from "bits-ui"` (not `import type`)

### Component Structure
```svelte
<script lang="ts">
// 1. Imports
import { Component } from 'package';
import type { TypeOnly } from 'package';

// 2. Types/Interfaces
interface Props {
	title: string;
	optional?: boolean;
}

// 3. Props
let { title, optional = false }: Props = $props();

// 4. State
let loading = $state(false);

// 5. Functions
function handleClick() {
	// ...
}

// 6. Effects
$effect(() => {
	// ...
});
</script>

<!-- Template -->
<!-- Styles (if any) -->
```

## Error Handling Patterns

### Server-Side (API Routes)
```typescript
try {
	// ... operation
} catch (error: any) {
	// 1. Log full details to console
	console.error("Operation error details:", {
		message: error.message,
		stderr: error.stderr,
		stdout: error.stdout,
		stack: error.stack,
	});

	// 2. Parse for user-friendly messages
	let userMessage = "Operation failed";
	if (error.stderr?.includes("specific error")) {
		userMessage = "User-friendly explanation";
	}

	// 3. Return clean error
	return json({ error: userMessage }, { status: 500 });
}
```

### Client-Side (Svelte)
```typescript
try {
	// ... operation
} catch (err) {
	// Log to console for debugging
	console.error("Client error:", err);

	// Show user-friendly message
	error = err instanceof Error ? err.message : "Operation failed";
}
```

## File Organization

### Directory Structure
```
src/
├── lib/
│   ├── components/
│   │   ├── ui/           # shadcn components
│   │   ├── VideoPreview.svelte
│   │   └── ...
│   ├── types.ts          # Shared TypeScript interfaces
│   └── utils.ts          # Utility functions
├── routes/
│   ├── api/
│   │   ├── preview/+server.ts
│   │   └── download-stream/+server.ts
│   ├── +layout.svelte
│   └── +page.svelte
└── app.css
```

### Naming Conventions
- Components: PascalCase (e.g., `VideoPreview.svelte`)
- Utilities: camelCase (e.g., `formatDuration`)
- Types/Interfaces: PascalCase (e.g., `VideoPreview`, `PlaylistInfo`)
- API routes: kebab-case (e.g., `download-stream`)

## Testing Workflow

### Before Committing
1. Check dev server for compilation errors
2. Test happy path: paste URL → preview loads → download works
3. Test error cases: invalid URL, private video, truncated ID
4. Check browser console for errors
5. Verify no TypeScript errors: `bun run check`
6. Run linter: `bun run lint`

### Common Error Scenarios to Test
- Invalid/truncated YouTube URL
- Private or unavailable video
- Playlist URL (with checkbox unchecked/checked)
- Long playlist (500+ videos)
- Network timeout
- Concurrent downloads

## Development Commands

### Package Management
```bash
bun install              # Install dependencies
bun add <package>        # Add dependency
bun add -d <package>     # Add dev dependency
bun remove <package>     # Remove dependency
```

### Development
```bash
bun run dev             # Start dev server
bun run build           # Production build
bun run preview         # Preview production build
bun run check           # Type check
bun run lint            # Lint code
bun run format          # Preview format changes
bun run format:write    # Apply formatting
```

### shadcn-svelte
```bash
bunx shadcn-svelte@latest add <component>  # Add component
bunx shadcn-svelte@latest init            # Initialize
```

## Common Pitfalls & Solutions

### Issue: Edit Tool Fails with Tab Indentation
**Solution**: Use sed/awk or write entire file section with Write tool

### Issue: Biome Removes Used Imports
**Solution**: Biome can't detect dynamic Svelte imports. Verify before accepting removals.

### Issue: "is not a function" Error
**Solution**: Import component as value, not type. `import { Component }` not `import type { Component }`

### Issue: Duplicate Closing Tags After Template Edit
**Solution**: Extract large template blocks into separate components to reduce editing surface area

### Issue: Preview Loading Indefinitely
**Solution**: Check console for API errors. Verify yt-dlp is installed and accessible.

## API Integration

### yt-dlp Usage
- Always use `--cookies-from-browser chrome` to avoid bot detection
- Use `--no-playlist` flag when downloading single video from playlist
- Use `--playlist-end 10` when fetching playlist info to avoid buffer overflow
- Parse stderr for user-friendly error messages

### Metadata Handling
- Use `node-id3` for writing ID3 tags (not ffmpeg)
- Title should NOT include artist name in ID3 tags
- Filename format: `Artist - Title.mp3`
- Parse video title for artist/title using common patterns (` - `, `: `, ` | `)

## UI/UX Guidelines

### Loading States
- Show spinner icon (lucide-svelte Loader2) instead of ellipses
- Use skeleton loaders for preview cards (not text)
- Hide previous content when showing skeleton

### Error Messages
- Never show raw command output to user
- Parse yt-dlp errors for common patterns
- Log full error details to console
- Show actionable, friendly messages

### Progress Feedback
- Show percentage, speed, and ETA during download
- Use Progress component from shadcn-svelte
- Auto-clear status after 2 seconds of completion

### Dark Mode
- Use system preference by default
- Apply on mount with matchMedia API
- Listen for system theme changes

## Git Workflow

### Commit Messages
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- Be specific: `fix: handle truncated YouTube IDs in preview`
- Include emoji: 🤖 Generated with Claude Code

### What to Commit
- Source code changes
- Configuration files
- Package.json/bun.lockb changes

### What NOT to Commit
- node_modules/
- .svelte-kit/
- .env files
- Downloaded MP3 files
- Temporary files

## Performance Considerations

### Bundle Size
- Use dynamic imports for large dependencies when possible
- Avoid importing entire libraries (import specific functions)
- Keep shadcn components minimal

### SSR Optimization
- Use `createRequire` for CommonJS modules in SSR context
- Mark external dependencies in vite.config.ts ssr.external
- Minimize server-side computation

## Security Notes

- Never commit API keys or credentials
- Validate all user inputs (URLs)
- Sanitize filenames to prevent path traversal
- Use `--no-warnings` to reduce log noise, but log errors
- Clean up temporary files after download

## AI-Assisted Development

### Available Commands
- `/review` - Comprehensive code review (security, quality, performance)
- `/security` - Security-focused audit (OWASP Top 10)
- `/test` - Generate unit tests with Vitest
- `/e2e` - Run Playwright E2E tests
- `/compound` - Capture learnings to improve future work

### Hooks (Automatic)
- **Auto-format**: TypeScript/Svelte files formatted with Biome after edits
- **Protected files**: Blocks edits to `.env`, `bun.lock`, `.git/`, `node_modules/`
- **Context hints**: Suggests relevant commands based on prompt keywords

### Compound Engineering Philosophy
Each unit of work should make subsequent work easier. After completing tasks:
1. Extract reusable patterns → add to this file
2. Document pitfalls discovered → add to Common Pitfalls section
3. Create tests that catch the issue → add to test suite
4. Update security notes if relevant

### Code Review Learnings
<!-- Add learnings from code reviews here -->

### Testing Strategy
```bash
bun run test        # Unit tests (Vitest)
bun run test:e2e    # E2E tests (Playwright)
bun run check       # TypeScript check
bun run lint        # Biome lint
```

## Resources

- [SvelteKit Docs](https://kit.svelte.dev)
- [Svelte 5 Runes](https://svelte.dev/docs/svelte/$state)
- [shadcn-svelte](https://shadcn-svelte.com)
- [Tailwind CSS](https://tailwindcss.com)
- [Biome](https://biomejs.dev)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
