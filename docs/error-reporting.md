# Error reporting

How failures reach Sentry, and the rules that keep the issue stream worth
reading.

## Setup

Sentry is entirely optional. With no DSN the SDK no-ops and the app behaves
normally, logging to the console — that's the local-development default.

| Variable | Where | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | Railway runtime | Server-side reporting |
| `PUBLIC_SENTRY_DSN` | Railway runtime | Browser-side reporting |
| `SENTRY_AUTH_TOKEN` | Railway **build** | Uploads source maps and creates the release |
| `RAILWAY_ENVIRONMENT_NAME` | Set by Railway | Becomes the Sentry `environment` |
| `RAILWAY_GIT_COMMIT_SHA` | Set by Railway | Becomes the Sentry `release` |

Without `SENTRY_AUTH_TOKEN` the build still succeeds — the Vite plugin logs a
warning and skips the upload — but every browser stack trace in Sentry stays
minified, which makes client-side issues close to useless. It is consumed at
build time; nothing reads it at runtime.

Use an **organization** auth token from
`https://jzs-yw.sentry.io/settings/auth-tokens/` (they start with `sntrys_` and
already carry the release and source-map scopes), not a personal token tied to
one account. Sentry shows the value once at creation.

Both DSN variables hold the **same value** — the project's client key. They are
split only because SvelteKit requires the `PUBLIC_` prefix to expose a variable
to the browser. A DSN is not a secret; it is designed to ship in client code.

### Environment and release

All environments share **one DSN and one Sentry project**. They're kept apart by
the `environment` tag, which is the setup Sentry is designed around — separate
projects would split issues, alerts, and release history for no benefit.

`resolveDeployEnvironment` decides the tag in this order:

1. **Explicit override** — `SENTRY_ENVIRONMENT` (server) or
   `PUBLIC_SENTRY_ENVIRONMENT` (browser). Any string Sentry accepts. Set these
   when a secrets manager should name the environment directly, or if the app
   ever moves off Railway.
2. **Railway inference** — `RAILWAY_ENVIRONMENT_NAME` equal to `production`
   becomes `production`; anything else (`dub-rip-pr-<number>`) becomes
   `preview`.
3. **Neither** — `development`. Not on Railway means local or CI.

Step 2 matters more here than in most projects: PR preview environments
**inherit production's variables**, including `SENTRY_DSN`. Without the
environment tag, an error from a throwaway PR environment is indistinguishable
from a real production incident.

The browser cannot read Railway's runtime environment, so `vite.config.ts`
inlines the Railway values at build time via `define`
(`__RAILWAY_ENVIRONMENT_NAME__`, `__RAILWAY_COMMIT_SHA__`). The
`PUBLIC_SENTRY_ENVIRONMENT` override is read at runtime, so changing it takes
effect on the next boot with no rebuild.

Traces are sampled **in production only**. PR environments are the dominant
Railway cost in this project and their performance data is never looked at.

### Verifying a deployment

`GET /api/health` reports what the running instance actually resolved:

```json
{
  "sentry": {
    "serverEnabled": true,
    "browserEnabled": true,
    "serverEnvironment": "production",
    "browserEnvironment": "production",
    "release": "dub-rip@0123456789ab"
  }
}
```

`serverEnvironment` and `browserEnvironment` come from different sources —
runtime env versus build-time constants — so **if they disagree, client and
server events are landing under different Sentry environments.** That usually
means the build didn't see `RAILWAY_ENVIRONMENT_NAME`; fix it by setting
`PUBLIC_SENTRY_ENVIRONMENT`, which is read at runtime.

`serverEnabled: false` means no DSN reached the container — nothing is being
reported at all, regardless of what the environment says. The DSN value itself
is never included in the response.

## The rules

### A caught error is an invisible error

SvelteKit's `handleError` — which `handleErrorWithSentry` wraps — only fires
for errors SvelteKit itself throws during render, navigation, or an
uninstrumented handler. Every route in this app catches its own failures and
returns a friendly message or an SSE `error` event, so `handleError` never sees
them.

That means **any new `catch` that swallows a failure has to report it itself**.
Otherwise the user sees "Failed to load preview", the console sees a stack
trace, and Sentry sees nothing at all.

### Report an incident once

The server reports its own failures. When the browser learns about a failure
the server already answered for, it records a **breadcrumb**, not an event:

- `ServerRejectionError` in `+page.svelte` marks a non-OK response from our own
  API, so the client catch skips reporting it.
- An SSE `error` event is a failure the download route already classified and
  reported.
- `/api/preview/details` returning no result means `fetchVideoDetails` already
  reported the underlying extraction failure.

Capturing on both sides files two issues for one incident and makes rate
trends meaningless.

The same rule decides *which layer* reports a metadata failure.
`fetchYouTubeMetadata` is the only place that still knows whether a failure was
an unavailable video, an oEmbed 5xx, or a timeout — callers receive all three as
the same `YouTubeMetadataError`. So it reports them itself (5xx and timeouts at
`warning`, unavailable videos not at all) and **callers never capture a
`YouTubeMetadataError`.** Routes still report anything else that reaches their
catch, since those are genuinely unexpected.

The same reasoning made `parseYtDlpError` pure. It used to call
`captureMessage` for unmatched errors, but retry logic calls it once per
attempt, so a single failed download could produce several events on top of the
route's own capture. **Keep it pure.**

### Expected failures are not issues

`classifyYtDlpError` assigns every yt-dlp failure a category, and that category
decides what Sentry sees:

| Category | Meaning | Sentry |
| --- | --- | --- |
| `user` | Private, unavailable, age-restricted, copyright-blocked | Breadcrumb only |
| `transient` | Bot-check, 403, timeout, network drop | `warning` (retries already exhausted) |
| `unknown` | Nothing matched | `error` |

A user pasting a private video is normal operation, not a defect. Reporting
those buried the real failures and burned quota. `unknown` is the important
one — it's how new yt-dlp and YouTube breakages announce themselves, so it
always gets full error level.

Process warnings follow the same logic: Node emits `warning` for routine
deprecations on nearly every boot, so only defect-indicating ones
(`MaxListenersExceededWarning`) become issues. The rest ride along as
breadcrumbs.

## What is covered

**Server**

- Uncaught exceptions and unhandled rejections (`registerProcessErrorHandlers`,
  which flushes before exiting so the crash isn't lost)
- Download failures, categorized as above
- Missing `BGUTIL_POT_URL` configuration
- Unexpected `/api/preview` and `/api/preview/details` failures
- yt-dlp binary and bgutil plugin download/install failures
- Metadata extraction failures
- Artwork resolution failures (`warning` — the track still ships, without a
  cover)

**Browser**

- Render and navigation errors (`handleErrorWithSentry`)
- Preview and details requests that fail at the network level
- Download stream transport drops — the server never sees these
- Failures saving the finished MP3 — purely client-side
- Malformed SSE payloads, which would indicate a protocol bug

## Deliberate exclusions

- **`/api/health`** does not report. It actively probes bgutil-pot, and any
  periodic pinger would file an event per poll. A real outage surfaces through
  the download route instead.
- **Artwork lookup misses** (no iTunes/Deezer match) are expected and return
  `null` silently. Only a thrown failure — usually the ffmpeg crop — is
  reported.
- **Thumbnail 404s** are expected; `maxresdefault.jpg` legitimately doesn't
  exist for many videos, hence the fallback chain.

## PII

`sendDefaultPii` is **on**, so events carry IP addresses, request headers, and
cookies. That's a deliberate debuggability trade-off for a public app; turn it
off in `buildSentryOptions` if the privacy cost outweighs it.
