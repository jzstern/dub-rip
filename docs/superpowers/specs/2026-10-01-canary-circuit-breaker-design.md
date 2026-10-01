# Production canary Phase 2: egress circuit breaker

**Status:** design approved 2026-10-01 (persistence, confirmation re-probe, trip stages and budget unit chosen by the human). Not implemented.

**Goal:** when production's egress IP is refused by YouTube at the media fetch, route real YouTube downloads through a residential proxy, and route them back to the direct egress once the canary sees it healthy again. SoundCloud, metadata extraction and the canary itself are never proxied.

---

## Evidence this design rests on

### Upstream behaviour (yt-dlp `2026.08.19` = `3a08bea`, bgutil `2.0.0` = `37169ee`)

| Fact | Where |
| --- | --- |
| yt-dlp copies its proxy into every PO-token request (`PoTokenRequest.request_proxy`) | `yt_dlp/extractor/youtube/_video.py` L2878-2883 |
| The bgutil HTTP provider calls the sidecar with `proxies={'all': None}` and forwards the proxy in the `/get_pot` body as `proxy` | `plugin/yt_dlp_plugins/extractor/getpot_bgutil_http.py` L61, L124-134 |
| The bgutil server fetches every BotGuard/YouTube resource through that proxy; minters are cached per `[proxy, sourceAddress]` | `server/src/session_manager.ts` L165, L522-523 |
| yt-dlp honours `HTTP(S)_PROXY`/`ALL_PROXY` when `--proxy` is absent | `YoutubeDL.py` L4206-4220 |
| `-v` prints the proxy unredacted, twice: `Command-line config:` (`--proxy` is not in `PRIVATE_OPTS`) and `Proxy map:` | `utils/_utils.py` L4996-5011, `YoutubeDL.py` L4182 |
| `youtube:pot_trace=true` prints the proxy in the cache-key trace | `pot/_director.py` L146 |
| bgutil logs `Using proxy: user@host:port` on every mint (password masked with a first-match `String.replace`) | `session_manager.ts` L136-142 |
| bgutil `GET /minter_cache` returns cache keys containing the full proxy URL, password included | `server/src/main.ts` L180-182 |
| googlevideo media URLs are bound to the extracting IP (`ip=` parameter) | — |

Consequences:
- **PO tokens need no sidecar change.** Proxying yt-dlp makes the sidecar mint through the same proxy. The proxy must offer **sticky sessions**, so the mint and the media fetch leave from one residential IP.
- **`?debug=1` is reachable by anyone** on `/api/download-stream` and turns on `-v`. On a proxied run, that would write the credentials into the Railway logs.

### Production history

- No `media_refused` or `fragments_refused` verdict has been recorded since Railway Static Outbound IPs went in (2026-09-17). Over 20 canary runs (2026-09-23 → 09-27) the verdicts were 11 pass and 9 fail, split 6 `page_rate_limited` and 3 `player_bot_check`. That is an intermittent rate of about 45% that a proxy is not meant to absorb, so those stages never trip the breaker.
- GitHub's scheduled runs start 3–6 h late. If the breaker waited for two consecutive *scheduled* runs, it would trip 6–18 h after a block began.

---

## Decisions

| Question | Decision | Rejected |
| --- | --- | --- |
| Trip stages | `media_refused`, `fragments_refused` only | `page_rate_limited` / `player_bot_check`: ~45% intermittent, so the breaker would flap and spend |
| Persistence | Railway **volume** on `dub-rip`, one JSON file | Postgres/Redis (always-on cost × every PR env); Sentry check-in history (no stage); state carried by GitHub Actions (lost on wake between runs); Railway Bucket (runner-up: no deploy downtime, but needs an S3 client and another secret) |
| Detection latency | **15-minute confirmation re-probe** triggered from the workflow when the next verdict would change state | Waiting for the next scheduled run |
| Proxied calls | The **download process only** | Proxying `video-details-cache` too: it only reads metadata and never fetches media, and the download process does its own extraction from the same IP that fetches media |
| Budget | **Downloads per UTC day**, default 50; media bytes logged for calibration; the provider's spend cap is the true hard cap | Estimated bytes/day: yt-dlp's counters miss extraction and sidecar traffic |
| Budget exhausted | Route **direct** (free, sometimes succeeds) | Refusing the download |
| Proxy delivery to yt-dlp | `HTTPS_PROXY`/`HTTP_PROXY` in the **child's env**, never argv | `--proxy` argv |
| Half-open | No separate state: the canary always probes direct, so an open breaker is permanently half-open | — |

---

## State machine

```
            trip verdict ×2 (consecutive)
  CLOSED ───────────────────────────────▶ OPEN
     ▲                                      │
     └──────────── ok verdict ×2 ───────────┘
                   (consecutive, direct)
```

Only verdicts that **reached the media fetch** say anything about whether the egress is refused for media: `ok`, `media_refused` and `fragments_refused`. Every other stage (`page_rate_limited`, `player_bot_check`, `format_unavailable`, `unknown`, `queue_full`) is **neutral** and leaves both streaks untouched. Those stages failed, or never ran, before any media request went out. "Consecutive" therefore means consecutive among media-reaching verdicts.

This matters most for closing. If the ~45% intermittent bot-check failures reset the healthy streak, an open breaker could stay open, and keep spending, for days while media was not being refused at all.

Each state keeps a single streak counter, which `applyCanaryVerdict(state, stage, now)` updates as follows.

| Current | Verdict | Effect |
| --- | --- | --- |
| closed | `media_refused` / `fragments_refused` | `consecutiveTrips += 1`; at 2 → **open** (`openedAt = now`, `consecutiveHealthy = 0`) |
| closed | `ok` | `consecutiveTrips = 0` |
| open | `ok` | `consecutiveHealthy += 1`; at 2 → **closed** (`consecutiveTrips = 0`, `openedAt = null`) |
| open | `media_refused` / `fragments_refused` | `consecutiveHealthy = 0` |
| any | neutral stage | unchanged (`lastVerdict` still recorded) |

The function returns `{ state, transition: { from, to, stage } | null, confirmInSeconds: 900 | null }`. `confirmInSeconds` is set only when **this verdict was media-reaching** and left its streak exactly one short of the threshold (closed with `consecutiveTrips === 1`, or open with `consecutiveHealthy === 1`). A neutral verdict never requests a re-probe, so an open breaker parked at `consecutiveHealthy === 1` does not add a YouTube request to every bot-checked run.

Streaks do not age out. A lone `media_refused` followed by days of neutral runs still counts as half a trip, deliberately: no evidence in between says media is being served, and the next media-reaching verdict settles it either way (an `ok` resets it). It is pure and takes `now` as an argument, so every row above is a table-driven test.

Threshold (2) and re-probe delay (900 s) are constants, not env vars (YAGNI).

## Routing a download

`resolveYouTubeEgress()` runs **once per YouTube download** in `/api/download-stream`. All retries of that download use the route it returns. Its result is `{ route: "direct" | "proxy", reason }`.

| `YT_PROXY_MODE` | Breaker | `YT_PROXY_URL` | Budget left | Route | `reason` |
| --- | --- | --- | --- | --- | --- |
| `force_off` | any | any | any | direct | `forced_off` |
| `auto` | closed | any | any | direct | `breaker_closed` |
| `auto` / `force_on` | open / any | unset | any | direct | `shadow` (logged "would proxy") |
| `auto` / `force_on` | open / any | set | yes | **proxy** (consumes 1) | `breaker_open` / `forced_on` |
| `auto` / `force_on` | open / any | set | no | direct | `budget_exhausted` |

- An unrecognised `YT_PROXY_MODE` is treated as `auto` and logged once.
- Shadow mode lets this ship to production before a proxy is bought: the state is tracked and visible, and nothing changes for users.
- The budget applies under `force_on` too; it is a safety cap, not a breaker feature.
- Budget is consumed when the route is resolved. A proxied download that then fails, is cancelled or hits `queue_full` still counts. This errs on the cheap side and keeps accounting in one place.

Never proxied:
- SoundCloud: `buildSoundCloudDownloadArgs` stays untouched.
- The canary: it calls `tryYtDlpDownload` with no proxy, so it keeps measuring the direct egress.
- `video-details-cache` and the preview/duration extractions.

## Proxied yt-dlp invocation

`tryYtDlpDownload` / `runYtDlpDownload` gain an optional `proxyUrl`. When it is set:
- `ytDlp.exec(args, { env: { ...process.env, HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl } })`. `YtDlpInstance.exec` widens to accept spawn options, which yt-dlp-wrap already supports. When `proxyUrl` is unset, exec is called exactly as today.
- **`debugMode` is forced false** (no `-v`, no `--list-formats`), whatever `?debug=1` says.
- The argv is otherwise identical: same format selector, `YOUTUBE_EXTRACTOR_ARG`, `buildJsRuntimeArgs()`, `--plugin-dirs` and bgutil `base_url`. No `--no-warnings`, and the `player_client` list is unchanged.
- It goes through the same `withYtDlpConcurrencyLimit`.

The bgutil call skips the proxy because the plugin sets `proxies={'all': None}`. A test asserts `BGUTIL_PLUGIN_VERSION === "2.0.0"` with a message pointing at this section, so a plugin bump forces a re-read of that behaviour.

## Secrets hygiene

`YT_PROXY_URL` is a Railway variable (Doppler in dev). **Within the `dub-rip` app service**, it never reaches a log line, a Sentry payload, argv, an SSE event or an HTTP response, and neither does its host.

**Known exception, outside our code:** the `bgutil-pot` sidecar logs `Using proxy: user@host:port` (password masked) on every mint. That line is unavoidable short of forking the image. IP-allowlist auth (item 1) leaves only `host:port` in it.

1. **Prefer IP-allowlist auth** at the provider, allowlisting production's three static egress IPs. The URL then carries no credentials. A credentialed URL is still needed to test from a PR env, because PR envs have no static IPs.
2. **`createProxyRedactor(proxyUrl: string | undefined)`** (`src/lib/egress/redact-proxy-secrets.ts`) is a pure factory. It never reads env itself, so it is safe to import from shared code.
   - The returned `redact(text)` replaces each of the following with `[proxy-redacted]`, longest first:
     - the full configured URL;
     - the URL's `userinfo@`;
     - the username and password, raw and percent-decoded. A component shorter than 4 characters is only redacted as part of the full URL or `userinfo`, so log text is not mangled.
   - With `proxyUrl` undefined, `redact` is the identity.
   - Server code obtains the instance via `getProxyRedactor()` in `resolve-youtube-egress.ts`, which reads `$env/dynamic/private`.
3. **In `runYtDlpDownload`**, every text path out of the child goes through `redact` **before** any `console.*`, `Sentry.*` or `send`:
   - each stderr chunk;
   - each warning breadcrumb;
   - each `ytDlpEvent` line sent over SSE;
   - **both** rejection paths.

   The rejection paths need care. yt-dlp-wrap reports a non-zero exit through its `error` event, with an Error whose message has the full stderr appended (`createError`, `dist/index.js` L172-174/L341-346). So:
   - the `on("error")` handlers must log `redact(err.message)`, not the raw error;
   - they must reject with `new Error(redact(err.message))`, not the wrap's Error;
   - likewise the `close` handler's constructed Error.

   As a result, nothing raw reaches download-stream's `console.error("Download error:")` / `captureException`. The canary is direct, so its redactor is the identity.
4. **Defence in depth in Sentry, server only:**
   - `hooks.server.ts` installs `beforeSend`, `beforeBreadcrumb` and `beforeSendLog`, which deep-walk string fields through `getProxyRedactor()`.
   - `sentry-options.ts` gains an optional `scrub` parameter that `hooks.server.ts` passes and `hooks.client.ts` does not.
   - The browser never sees the URL, and `$env/dynamic/private` never enters the client bundle.
5. `youtube:pot_trace` is never enabled. The spec notes this; no code change is needed.
6. **Human checks** that `bgutil-pot` has no public Railway domain, so `/minter_cache` (which returns the full URL) stays internal. The check covers production **and** any PR env used with a credentialed URL, because PR envs inherit every service, public domains included.

## Persistence

`src/lib/egress/breaker-store.ts`:
- **File:** `${RAILWAY_VOLUME_MOUNT_PATH}/egress-breaker.json`. Railway sets `RAILWAY_VOLUME_MOUNT_PATH` automatically when a volume is attached; volumes are mounted at container start, never at build or pre-deploy. Locally, the same variable can point at a scratch dir.
- **Shape (v1):**
  ```json
  { "version": 1,
    "breaker": { "state": "closed", "consecutiveTrips": 0, "consecutiveHealthy": 0,
                 "openedAt": null, "lastVerdict": { "stage": "ok", "at": "…" } },
    "budget": { "day": "2026-10-01", "proxiedDownloads": 0, "proxiedMediaBytes": 0,
                "warnedNearLimit": false, "warnedExhausted": false } }
  ```
- **Load:** lazily on first use, then cached in memory.
- **Writes:** write-through to a temp file, then `rename`, serialised on a promise chain (single process, single replica).
- **Failures:**

  | Condition | Behaviour | Reported |
  | --- | --- | --- |
  | `RAILWAY_VOLUME_MOUNT_PATH` unset | in-memory only, `persistence: "memory"` | health only |
  | Unreadable/corrupt/unknown version | start from the default (closed, zero budget) | one `Sentry.logger.warn` |
  | Write failure | keep the in-memory state, `persistence: "degraded"` | `Sentry.captureException`, once per process |

  The write-failure row is a caught error, so it reports itself (CLAUDE.md "a caught error is an invisible error").
- **Budget day rollover:** the budget resets when `day` differs from today's UTC date, at read time.
- Each PR env gets its own (empty) volume, so its breaker is independent. That is the desired isolation.

## Budget

`consumeProxyBudget(budget, today, limit)` is pure and returns `{ budget, allowed, crossedNearLimit, crossedExhausted }`. `YT_PROXY_DAILY_DOWNLOAD_LIMIT` defaults to 50; a non-positive or non-numeric value means 50.
- **At 80%:** one `Sentry.logger.warn("YouTube proxy budget nearly used", …)` per day.
- **On the first refusal:** one `Sentry.logger.error("YouTube proxy budget exhausted", …)` per day.

  The human can attach Sentry log alerts to these messages.
- **After a proxied download completes:** its media bytes (yt-dlp's final `downloaded_bytes`/file size) are added to `proxiedMediaBytes`, for comparison against the provider's dashboard.

## Canary integration

`POST /api/canary`, after `runCanaryDownload()`:
1. `recordCanaryVerdict(classification.stage)` applies the state machine and persists the result.
2. A transition is logged with `Sentry.logger.warn("YouTube egress breaker opened", {from, to, stage, …})`. A close uses `.info("… closed")`. `captureMessage` is never used, for the reason recorded in `report-canary-check-in.ts`.
3. The response gains `breaker: { state, transition, confirmInSeconds, consecutiveTrips, consecutiveHealthy }`, so the GitHub Actions run logs record the breaker history alongside the verdicts.

The Sentry check-in flow is unchanged. The confirmation re-probe is a second check-in. Two consecutive trip verdicts then also reach `failureIssueThreshold: 2`, so a confirmed block opens one Sentry Issue. That is intended.

`.github/workflows/canary.yml`:
- After the first call, if `jq -r '.breaker.confirmInSeconds // empty' response.json` is non-empty, the workflow sleeps that long and POSTs once more, printing the second response. There is at most one re-probe per run.
- The job gets `timeout-minutes: 30` and `concurrency: { group: canary, cancel-in-progress: false }`. That way a `workflow_dispatch` during a scheduled run's sleep queues behind it, instead of interleaving verdicts or causing a second re-probe.

Cost: one extra YouTube request, made only when a transition is pending.

## Observability

`GET /api/health` (liveness form) gains:
```json
"youtubeEgress": { "mode": "auto", "state": "closed", "proxyConfigured": false,
  "persistence": "volume", "openedAt": null, "consecutiveTrips": 0, "consecutiveHealthy": 0,
  "lastVerdict": { "stage": "ok", "at": "…" },
  "budget": { "day": "…", "proxiedDownloads": 0, "limit": 50, "proxiedMediaBytes": 0 } }
```
- Reading this loads the state file. That is a local disk read, not a network probe, so the cheap-healthcheck contract holds.
- The output never includes the proxy URL or host.
- `/api/health` is public, so the breaker state and budget counters become public. This is accepted deliberately: they reveal no secret, and they are the cheapest way to check the breaker from anywhere.
- Each download records a Sentry breadcrumb `egress: <route>/<reason>` (no URL), so a failed proxied download's issue shows which route it took.

## Files

New, under `src/lib/egress/`:
- `breaker-state.ts`: types, `applyCanaryVerdict`, constants
- `proxy-budget.ts`: `consumeProxyBudget`, rollover
- `breaker-store.ts`: load/save, persistence mode, serialised writes
- `redact-proxy-secrets.ts`: redactor and `scrubSentryPayload` walker
- `resolve-youtube-egress.ts`: mode/env parsing, routing table, budget consumption, breadcrumb
- `report-breaker-transition.ts`: `Sentry.logger` entries for transitions and budget thresholds

Changed:
- `try-yt-dlp.ts` (`proxyUrl`, env spawn, debug override, redaction)
- `prepare-download.ts` (thread `proxyUrl` into the YouTube `runAttempt` only)
- `routes/api/download-stream/+server.ts` (resolve egress once for YouTube links)
- `routes/api/canary/+server.ts`
- `routes/api/health/+server.ts`
- `sentry-options.ts` (optional `scrub` parameter); `hooks.server.ts` passes it, `hooks.client.ts` does not
- `.github/workflows/canary.yml`
- `.claude/CLAUDE.md` (replace the "Phase 2 (not built)" bullet; add runbook rows)
- `docs/deployment-strategy.md` (the proxy option becomes "wired, breaker-driven")

## Testing (BDD, `#given/#when/#then`)

- **breaker-state:** every row of the transition table, including that each neutral stage leaves both streaks untouched in both states, that an `ok` between two trip verdicts resets the count, and that `confirmInSeconds` is set only one step short of a threshold.
- **proxy-budget:** under the limit, exactly at 80%, exhausted, day rollover, invalid limit → 50.
- **breaker-store:** round-trip on a temp dir, corrupt JSON → default + warn, unknown version → default, unset dir → memory, write failure → degraded + one `captureException`, concurrent writes serialised (the last write wins, with no torn file).
- **resolve-youtube-egress:** every row of the routing table, unknown mode → auto.
- **try-yt-dlp:**
  - with `proxyUrl`, exec receives env `HTTPS_PROXY`/`HTTP_PROXY` and argv contains no proxy string;
  - `debugMode: true` + proxy produces no `-v`;
  - without `proxyUrl`, args and exec call are identical to today.
- **Secrets (the "never appears" suite):**
  - with a credentialed `YT_PROXY_URL`, feed a fake yt-dlp whose stderr echoes the URL, the `Proxy map:` line, and a percent-encoded password. Cover both a failure delivered through the `error` event, with an Error shaped like yt-dlp-wrap's `createError` (stderr appended to the message), and one delivered through `close` with a non-zero code;
  - assert the URL, username and password are absent from every `console.*` spy call, every `Sentry.addBreadcrumb`/`captureException`/`logger.*` argument, every SSE `send` payload and the rejected error's message;
  - the Sentry scrub hooks strip all three from a synthetic event, breadcrumb and log;
  - `hooks.client.ts` installs no scrub and imports nothing from `$env/dynamic/private`;
  - the health and canary responses contain none of them.
- **Canary route:** a trip verdict is recorded and the response carries `breaker`; a transition logs via `Sentry.logger`, never `captureMessage`.
- **Plugin pin guard:** `BGUTIL_PLUGIN_VERSION === "2.0.0"`.

`bun run check`, `bun run lint`, `bun run test` must pass.

## Verification plan (a PR-env pass is not a production pass)

1. **PR env:** human sets `YT_PROXY_MODE=force_on` and a credentialed `YT_PROXY_URL` on the PR env only. Download a YouTube video, then check:
   - the MP3 arrives;
   - the PR env's logs show bgutil minting through the proxy (`Using proxy:` with the password masked);
   - no full URL appears in the app logs, even with `?debug=1`;
   - the provider dashboard shows the bytes.

   This proves the proxied code path and the token-through-proxy claim, not production.
2. **Production, shadow:** merge with `YT_PROXY_URL` unset and a volume mounted. Confirm `/api/health` shows `persistence: "volume"` and `state: "closed"`, and that canary responses in the GitHub Actions logs carry `breaker`.
3. **Production, live:** once the proxy is bought and allowlisted, set `YT_PROXY_URL`. Briefly set `force_on`, download on dub.rip, check the Railway logs and the provider's dashboard, then return to `auto`.

## For the human to provision (not done by this work)

- A residential proxy with **sticky sessions**, IP-allowlist auth for production's three static IPs if offered, and a **hard monthly spend cap** in the provider's dashboard.
- A Railway volume on `dub-rip` (production), with any mount path (`RAILWAY_VOLUME_MOUNT_PATH` is provided automatically). Accept:
  - a few seconds of downtime per redeploy;
  - a single replica;
  - a small volume cost added to every PR env, which inherits the volume (to be noted under Railway Cost Practices).

  Serverless/app-sleep is unaffected according to Railway's docs.
- Railway variables `YT_PROXY_URL` (secret), optionally `YT_PROXY_MODE` and `YT_PROXY_DAILY_DOWNLOAD_LIMIT`. Note that PR envs inherit production's variables, so a production `YT_PROXY_URL` also reaches every PR env (they start closed, so they stay direct unless forced).
- Sentry log alerts on "YouTube egress breaker opened" and "YouTube proxy budget exhausted".
- Confirm `bgutil-pot` has no public domain, in production and in any PR env used with a credentialed URL (Secrets hygiene §6).

## Out of scope

- Proxying for `page_rate_limited` / `player_bot_check`.
- Per-download sticky-session IDs.
- A SoundCloud canary.
- Multiple replicas.
