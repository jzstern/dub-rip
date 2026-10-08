# Sentry DUB-RIP-A / DUB-RIP-9: "This video is unavailable" is classified as `unknown`

Sentry: https://jzs-yw.sentry.io/issues/7645163641/ (DUB-RIP-A) and https://jzs-yw.sentry.io/issues/7645163632/ (DUB-RIP-9)

## Root cause

`src/lib/yt-dlp-errors.ts` classifies a removed or nonexistent YouTube video with the
`YOUTUBE_RULES` entry `pattern: /video unavailable/`. That pattern only matches yt-dlp's
`Video unavailable` wording. yt-dlp also emits the other wording, which the pattern misses:

```
ERROR: [youtube] xxxxxxxxxxx: This video is unavailable
```

Here "is" sits between the two words, so the regex never matches. The message then falls
through to `YOUTUBE_GENERIC_ERROR`, and three things go wrong:

- It is categorised `unknown`, so it is reported to Sentry at error level. A permanent,
  user-caused failure then looks like a new yt-dlp breakage. The 2026-09-28 events on
  DUB-RIP-A and DUB-RIP-9 (release dub-rip@8d6c31730521, tagged `category: unknown`) are
  exactly this.
- The user sees "Download failed. Please try a different video." instead of "This video is
  unavailable or private."
- It is non-retryable, which is correct and stays that way.

To reproduce: `classifyYtDlpError("ERROR: [youtube] xxxxxxxxxxx: This video is unavailable")`
returns `{ category: "unknown", ... }` on origin/main today.

## Change

1. **Failing test first**, in `tests/unit/services/yt-dlp-error-category.test.ts` (match the
   existing style there). Assert that the exact production stderr line above classifies as
   `category: "user"`, `retryable: false`, with message "This video is unavailable or private."
   Run it and confirm it fails because it gets `unknown`.
2. **Fix** `src/lib/yt-dlp-errors.ts`: widen the rule's pattern to cover both wordings, e.g.
   `/video (is )?unavailable/`. Keep the rule where it is, directly after the bot-check rule.
   Existing tests using `"ERROR: Video unavailable"` must still pass.
3. Confirm the test passes.

## Out of scope — do NOT touch

- Other rules, their order, or the bot-check/transient handling.
- `src/lib/youtube-metadata.ts` / oEmbed 400 handling (DUB-RIP-E, a separate issue).
- `/api/preview` JSON body parsing (DUB-RIP-F, a separate issue).
- `src/lib/video-metadata.ts`, which open PR #139 is editing.
- Any refactor, formatting churn, or dependency change.

## Verify

`bun run check && bun run lint && bun run test:run && bun run build`, all green.
