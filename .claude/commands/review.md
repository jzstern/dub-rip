# Code Review

Perform a comprehensive code review of staged/changed files.

## Instructions

1. **Get changed files**: Run `git diff --name-only HEAD` to see what's changed
2. **Read each changed file** and analyze against these criteria:

### Security Review
- Path traversal vulnerabilities (check for `../` in user inputs)
- Command injection (check yt-dlp command construction)
- Unvalidated URL inputs
- Sensitive data exposure in logs
- XSS in rendered content

### Code Quality
- TypeScript strict typing (no `any` unless justified)
- Proper error handling (try/catch with user-friendly messages)
- Svelte 5 runes usage ($state, $props, $effect)
- Tab indentation (not spaces)

### Performance
- Unnecessary re-renders in Svelte components
- Large bundle imports (prefer tree-shaking)
- Memory leaks (unsubscribed effects)

### Best Practices
- Component structure matches CLAUDE.md guidelines
- Proper imports (value imports, not type-only for components)
- Consistent naming conventions

3. **Output format**:
```
## Review Summary

### Critical Issues
- [File:Line] Issue description

### Warnings
- [File:Line] Warning description

### Suggestions
- [File:Line] Suggestion

### Passed Checks
- List what looks good
```

4. **Run validation**: Execute `bun run check` and `bun run lint` to catch additional issues.
