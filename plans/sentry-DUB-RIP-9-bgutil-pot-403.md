# DUB-RIP-9 — media-fetch HTTP 403 from a stale bgutil-pot pin

Sentry: https://jzs-yw.sentry.io/issues/7645163632/ (`DUB-RIP-9`, `GET /api/download-stream`)

## Root cause

The `bgutil-pot` sidecar is pinned to **1.3.1** by tag *and digest*, so it cannot pick up
upstream fixes on its own. YouTube began rejecting the WebPO tokens 1.3.1 mints
(upstream issue Brainicism/bgutil-ytdlp-pot-provider#242 — "GVS has occasionally rejected the
tokens generated with this project's server, responding with HTTP 403s", reproduced there on
**yt-dlp 2026.07.04 with the `web_safari` client**, i.e. this repo's exact pinned toolchain).

Because a token *is* still produced, yt-dlp does not skip the affected formats the way it
skips `mweb` formats with no GVS token — it keeps them, and the media fetch then returns
`HTTP Error 403: Forbidden`. `classifyYtDlpError` maps that to the bot-check message, which
is why the symptom reads like the bot-check bug PR #109 already fixed. It is not: player PO
tokens still mint correctly.

Fixed upstream in **1.3.2** (2026-08-21): "Mint WebPO tokens from the homepage challenge +
ytcfg, mitigating 403s for clients in certain A/B tests". The A/B gating explains the
episodic event pattern.

**Confirmed reproduction against production (2026-09-08):**
`GET https://dub.rip/api/download-stream?url=https://www.youtube.com/watch?v=_hc_X9c1Nbg`
streams `Generating a player PO Token for web_safari client via bgutil HTTP server`, then
`Downloading 1 format(s): 251`, then fails with the bot-check message. Downloads are broken
now, not intermittently.

## Target version: 2.0.0, not 1.3.2

2.0.0 contains the 1.3.2 fix **and** patches a high-severity RCE
(GHSA-qpv9-8xfj-xx9m, CVSS 8.8 AV:A, affects all versions `< 2.0.0`).

The 2.0.0 plugin hard-fails on a major-version mismatch with the server
("Plugin and server major versions are mismatched … to proceed"), so the image tag and
`BGUTIL_PLUGIN_VERSION` **must move together in the same commit**.

**Do not add a `--host`/`-H` flag.** 2.0.0's README (line 55) states the Docker image still
binds all interfaces *inside* the container so port forwarding works; only the host port
publishing changed. Railway private networking to `bgutil-pot.railway.internal:4416`
therefore keeps working unchanged.

## Verified constants (do not re-derive)

- image digest `2.0.0` → `sha256:ed86b6fdd5e430ddd7c8ce1adb55e1ab54db7c7dbc1bcbf3a82454a85b971164`
- plugin zip `2.0.0` sha256 → `bce874dfa25896c2798e0f4f8147b7b22e785479eb1e459ab232bf2506c95016`
- (current plugin zip sha256, being replaced) `b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38`

## Write the test first

Add a **lockstep invariant** test (new file `tests/unit/services/bgutil-version-lockstep.test.ts`):
read `railway.toml`, parse the `brainicism/bgutil-ytdlp-pot-provider:<tag>@sha256:<digest>`
image, and assert `<tag> === BGUTIL_PLUGIN_VERSION` imported from `scripts/yt-dlp-pin.mjs`.

Confirm it fails first by bumping only one of the two, then make it pass by bumping both.

Be honest in the PR body: this test encodes the *drift* invariant the upstream plugin
enforces at runtime. **No test can encode "YouTube rejects 1.3.1's tokens"** — that is
upstream state, not repo state.

## Files to change

1. `railway.toml:14` — image → `brainicism/bgutil-ytdlp-pot-provider:2.0.0@sha256:ed86b6fdd5e430ddd7c8ce1adb55e1ab54db7c7dbc1bcbf3a82454a85b971164`
2. `scripts/yt-dlp-pin.mjs:19` — `BGUTIL_PLUGIN_VERSION` → `"2.0.0"`
3. `scripts/yt-dlp-pin.mjs` — `ASSET_SHA256[BGUTIL_PLUGIN_FILENAME]` → the 2.0.0 zip sha256 above
4. `tests/unit/services/baked-binaries.test.ts:39` — `PINNED_BGUTIL_VERSION` → `"2.0.0"`
5. `tests/unit/services/bgutil-plugin.test.ts:59` — release URL `…/download/2.0.0/…`
6. `docs/deployment-strategy.md:80,117` — version + digest; `:96` local docker run → `-p 127.0.0.1:4416:4416`
7. `README.md:63` — version
8. `.env.example:12` — version **and** `-p 127.0.0.1:4416:4416`

On 6 + 8: the advisory is explicit that Docker users must publish to loopback
(`-p 127.0.0.1:4416:4416`) or stay vulnerable *even after updating*. This repo's own docs
currently tell developers to run the vulnerable form on their laptop. Fix the command
wherever it appears.

## Out of scope — do not touch

- **The yt-dlp pin (2026.07.04).** The 2026.08.19 changelog contains no YouTube 403/GVS fix;
  bumping it is unrelated risk. Leave it.
- Extractor args / `YOUTUBE_EXTRACTOR_ARG`, the format selector, `yt-dlp-errors.ts`
  classification, retry logic, Sentry config/sampling.
- Any app-logic, UI, or copy change. No refactors, no formatting churn, no dependency bumps
  beyond the two pinned bgutil constants.

## Verify

`bun run check && bun run lint && bun run test:run && bun run build`

## PR

Branch `fix/sentry-dub-rip-9-bgutil-pot-403` from `origin/main`. Link the Sentry issue and
upstream #242 + the advisory. **Do not merge** — this is flagged for Jeremy's review
(touches `railway.toml`, is a major dependency bump, and the fix cannot be verified without
deploying).
