# Sentry DUB-RIP-E — oEmbed 400 for nonexistent video IDs reported as an outage

Issue: https://sentry.io/organizations/jzs-yw/issues/7758591946/ (DUB-RIP-E, 9 events, warning)

## Root cause
`fetchYouTubeMetadata` (src/lib/youtube-metadata.ts, the `!response.ok` block ~line 35) maps oEmbed 401/403 -> unavailable and 404 -> not found,
but YouTube answers a well-formed-but-nonexistent 11-char ID (e.g. `xxxxxxxxxxx`, `aaaaaaaaaaa`) with **HTTP 400**, not 404
(verified with curl 2026-10-06). That 400 falls through to `Sentry.captureException(... "oEmbed request failed: 400")` and a
`YouTubeMetadataError` without `isUnavailable`, so a user-input problem is reported as an upstream failure and the user gets a generic error.

## Change
In the `!response.ok` block, treat status 400 like 404: `throw new YouTubeMetadataError("Video not found", true)` before the Sentry capture.
Nothing else (do not touch 5xx handling, retries, or other files).

## Test first
In tests/unit/youtube-metadata.test.ts add a case: mocked fetch returns `{ok:false,status:400}` -> `fetchYouTubeMetadata("aaaaaaaaaaa")` rejects with
a `YouTubeMetadataError` with `isUnavailable === true` and `Sentry.captureException` is NOT called. Follow the existing 404 test's mocking style.
Confirm it fails before the fix. Optionally add a preview.test.ts assertion only if the existing 404 case has an obvious sibling.

## Verify
`bun run check && bun run lint && bun run test:run && bun run build`

## Out of scope
Any other status code, Sentry config, copy changes, refactors.
