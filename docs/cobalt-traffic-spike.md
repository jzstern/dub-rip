# Cobalt Traffic Spike: Why Cobalt Only Handles ~1/5 of YouTube Music Videos

Research spike following PR #50. Goal: figure out **why Cobalt falls back to yt-dlp for most popular music videos** now that the 0-byte tunnel bug is fixed, and recommend a single falsifiable next experiment.

This document is research-only. No code, config, or deployment changes were made while writing it.

## TL;DR

- Cobalt's self-hosted instance currently uses `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED`. PR #50 already tested `IOS` and `WEB` - neither helped. The five probe videos (four of which are official music videos) return `error.api.youtube.login` from Cobalt and fall through to yt-dlp.
- Under the hood, that error is raised inside the `playability.status` switch in `api/src/processing/services/youtube.js` (the `"LOGIN_REQUIRED"` case, around lines 260-265 of the file, `reason.endsWith("bot")` branch). It's triggered when YouTube's `player` response returns `playabilityStatus.status = LOGIN_REQUIRED` with a reason ending in `bot`. The upstream youtubei.js issue [LuanRT/YouTube.js#1119](https://github.com/LuanRT/YouTube.js/issues/1119) documents exactly this, notes it hits `WEB`, `ANDROID`, `iOS`, and `WEB_EMBEDDED`, and calls out `TV_EMBEDDED` as a working workaround.
- Our `yt-token-service` uses `youtube-po-token-generator` (YunzheZJU fork), which only produces **session-bound** tokens (`visitorData` + `poToken`, no `contentBinding` parameter - see [index.d.ts](https://github.com/YunzheZJU/youtube-po-token-generator/blob/main/index.d.ts)). `bgutil-ytdlp-pot-provider` produces **content-bound** tokens (accepts `content_binding` in `POST /get_pot` - see [its README](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tree/master/server)). However: Cobalt's `getYouTubeSession()` is called once at startup and cached (`api/src/processing/helpers/youtube-session.js:9,38-53`) with an empty POST body, then the same session is reused for every video. Cobalt never passes a per-video `content_binding`, so swapping providers alone does **not** unlock content-bound tokens.
- **Stronger finding:** for dub-rip's audio-only workload, Cobalt's `useSession` gate (`api/src/processing/services/youtube.js:176-186`) is always false, which means the poToken/visitor_data pipeline we carefully wired up in PR #50 is **not even in the critical path for our downloads**. Lines 85-86 set `po_token: undefined, visitor_data: undefined` when `useSession` is false. The `YOUTUBE_SESSION_INNERTUBE_CLIENT` env var we set is also dormant under this gate. The only env var that actually changes the client used is `CUSTOM_INNERTUBE_CLIENT`, which is currently unset (defaulting to `IOS`).
- Most likely driver of the failures (per multiple upstream cobalt maintainer/community comments, e.g. [imputnet/cobalt#1189](https://github.com/imputnet/cobalt/issues/1189) and the referenced dev.to writeup) is **Railway's datacenter IP reputation**, not the client choice or the poToken provider. This is structural to YouTube's bot scoring and cannot be fixed by swapping clients or providers alone.
- **Cheapest, most falsifiable next experiment:** set `CUSTOM_INNERTUBE_CLIENT=TV_EMBEDDED` on Cobalt (not `YOUTUBE_SESSION_INNERTUBE_CLIENT` - that variable is dormant for our workload, see Q3) and re-run the 5-video probe. Success = >=3/5 Cobalt hits without yt-dlp fallback. Runtime: one env-var change, one redeploy, one curl loop.

## The 5 Probe Videos

| Title | Artist | Video ID | URL | Current result |
|---|---|---|---|---|
| Never Gonna Give You Up | Rick Astley | `dQw4w9WgXcQ` | https://www.youtube.com/watch?v=dQw4w9WgXcQ | Cobalt OK (baseline) |
| Sleepwalker | akiaura, LONOWN, STM | `DrJ7grCnwUc` | https://www.youtube.com/watch?v=DrJ7grCnwUc | yt-dlp fallback |
| Despacito | Luis Fonsi ft. Daddy Yankee | `kJQP7kiw5Fk` | https://www.youtube.com/watch?v=kJQP7kiw5Fk | yt-dlp fallback |
| Gangnam Style | PSY | `9bZkp7q19f0` | https://www.youtube.com/watch?v=9bZkp7q19f0 | yt-dlp fallback |
| Counting Stars | OneRepublic | `hT_nvWreIhg` | https://www.youtube.com/watch?v=hT_nvWreIhg | yt-dlp fallback |

PR #50's test script already shows mixed results on a slightly different set: `dSA1oUhCdy8` -> yt-dlp, `dQw4w9WgXcQ` -> cobalt, `kJQP7kiw5Fk` -> yt-dlp. Despacito consistently falls back.

Failure mode observed in dub-rip logs post-PR-#50: `[Cobalt] API error for <id>: error.api.youtube.login` -> `[Cobalt] Failed, falling back to yt-dlp`. `error.api.youtube.login` parses as `isAuth: true` in [`src/lib/cobalt.ts:184-192`](../src/lib/cobalt.ts) via `parseErrorCode()` and is then retried through yt-dlp.

## Q1. Auth-requirement difference per video

**What I was asked:** fetch the YouTube player response for each probe video under each client (`WEB_EMBEDDED`, `IOS`, `WEB`, `ANDROID`, `YTMUSIC_ANDROID`, etc.) and record `playabilityStatus`, whether `streamingData.adaptiveFormats` carries direct `url` vs only `signatureCipher`, and `playableInEmbed`.

**What I was able to gather without touching production:** I do not have interactive access to the running Cobalt container or an isolated sandbox I can run youtubei.js in, so I could not produce per-video player dumps for this doc. That's exactly the experiment the human needs to greenlight, and it should be the **first action** in any follow-up PR (see "Recommendation" below).

**What the code tells us about where the difference arises:**

Cobalt calls `yt.getBasicInfo(o.id, { client: innertubeClient })` at [`api/src/processing/services/youtube.js:235`](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/youtube.js#L235). The resulting `playability_status` is switched on shortly after. `error.api.youtube.login` is only raised when:

```js
// api/src/processing/services/youtube.js (switch on playability.status)
case "LOGIN_REQUIRED":
    if (playability.reason.endsWith("bot")) {
        return { error: "youtube.login" }
```

So the four failing videos are getting `playabilityStatus.status = "LOGIN_REQUIRED"` with `reason` ending in `"bot"` (i.e. YouTube's "Sign in to confirm you're not a bot" page) - and the working baseline (Rick Astley) is getting `playabilityStatus.status = "OK"`. The shape of `streamingData.adaptiveFormats` doesn't matter for the failing cases because the `getBasicInfo` call never yields formats - it short-circuits at the playability switch. [LuanRT/YouTube.js#1119](https://github.com/LuanRT/YouTube.js/issues/1119) documents the same failure pattern across `WEB`, `ANDROID`, `iOS`, and `WEB_EMBEDDED` clients as of YouTube.js v16.0.1 (Cobalt 11.7.1 bundles v17.0.1 per PR #50, but the issue remained open against the newer version's behavior).

Why Rick Astley works and the others don't is almost certainly **not** intrinsic to those specific videos' copyright/age-restriction/embeddability bits (all five are public, non-age-gated, embeddable music videos). The most likely explanation - corroborated by the maintainer comment in [imputnet/cobalt#1189](https://github.com/imputnet/cobalt/issues/1189) ("the problem is with your datacenter IPs getting blocked ... you need a residential IP proxy") and the dev.to writeup surfaced alongside it - is that YouTube's bot scoring is **probabilistic per (IP, visitor_data, video_id) tuple**. Some requests score low enough to pass; most, from a Railway datacenter IP, don't. Rick Astley's massively-cached edge response may even be served from a different path that's less sensitive to scoring. That hypothesis would be confirmed by the player-dump experiment.

## Q2. poToken provider swap - would it actually help?

**Short answer: probably not as a standalone change, but it's a prerequisite for the real fix.** Evidence:

`youtube-po-token-generator` (what we use) exposes exactly this signature:

```ts
// https://github.com/YunzheZJU/youtube-po-token-generator/blob/main/index.d.ts
export function generate(): Promise<{ visitorData: string, poToken: string }>;
```

No parameters. It generates a **session-bound** token - the `visitorData` is the content binding. One `(poToken, visitorData)` pair is produced at service startup and reused for every video Cobalt downloads for up to `CACHE_TTL_MS = 60 * 60 * 1000` (1h) per [`services/yt-token/index.js:5`](../services/yt-token/index.js).

`bgutil-ytdlp-pot-provider` exposes:

```
POST /get_pot
  request:  { content_binding?: string, proxy?, bypass_cache?, challenge?, innertube_context?, ... }
  response: { poToken, contentBinding, expiresAt }
```

(per [server README](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tree/master/server)). It **can** generate a content-bound token if the caller passes a video ID in `content_binding`. Its implementation is `bgutils-js` + `jsdom` running the BotGuard interpreter in a `new Function(...)` - so it's technically the same execution approach as the Node `jsdom` path we already use, just with cleaner bindings.

**However** - and this is the load-bearing finding - **Cobalt does not currently pass a per-video content_binding to the session server.** Look at [`api/src/processing/helpers/youtube-session.js:38-53`](https://github.com/imputnet/cobalt/blob/main/api/src/processing/helpers/youtube-session.js#L38-L53):

```js
const loadSession = async () => {
    const sessionServerUrl = new URL(env.ytSessionServer);
    sessionServerUrl.pathname = "/get_pot";
    const newSession = await fetch(
        sessionServerUrl,
        { method: 'POST', dispatcher: defaultAgent }
    ).then(a => a.json());
    validateSession(newSession);
    ...
}
```

There is **no request body**. No `content_binding`, no video ID, nothing. `loadSession` is called once at startup and every `ytSessionReloadInterval` (300s per [`api/src/core/env.js:68`](https://github.com/imputnet/cobalt/blob/main/api/src/core/env.js#L68)). Whatever token comes back is cached in the module-level `session` variable (`youtube-session.js:9`) and reused via `getYouTubeSession()` (line 68) for every download.

And it gets worse: for dub-rip's audio-only workload, the cached poToken isn't even used on the wire. See Q3 below - `useSession` is always false for our requests, which means `cloneInnertube()` at lines 85-86 sets `po_token: undefined, visitor_data: undefined` when constructing the Innertube session. The poToken is fetched, cached, and never attached to the player request.

So even if we swap `youtube-po-token-generator` for `bgutil-ytdlp-pot-provider` today, Cobalt will still call `POST /get_pot` with an empty body, bgutil will generate a session-bound token (same as our current service - just via `bgutils-js` instead of the Yunzhe fork), Cobalt will still cache it and still not attach it to our audio-only player requests. The poToken is not the limiting factor for _this specific_ `error.api.youtube.login` loop.

The swap would only help in a world where Cobalt were patched to (a) forward the video ID in the session request AND (b) actually pass `po_token`/`visitor_data` into the audio-only code path. That's an upstream project, not a config flip, and not in scope for this spike.

## Q3. Innertube client mapping (upstream Cobalt source)

### What clients are allowed

The validation list comes from `youtubei.js`. Per [`api/src/core/env.js:1`](https://github.com/imputnet/cobalt/blob/main/api/src/core/env.js#L1):

```js
import { Constants } from "youtubei.js";
...
if (env.customInnertubeClient && !Constants.SUPPORTED_CLIENTS.includes(env.customInnertubeClient)) {
    console.error("CUSTOM_INNERTUBE_CLIENT is invalid. Provided client is not supported.");
```

`Constants.SUPPORTED_CLIENTS` from youtubei.js' [`src/utils/Constants.ts:71`](https://github.com/LuanRT/YouTube.js/blob/main/src/utils/Constants.ts#L71) is:

```ts
export const SUPPORTED_CLIENTS = [
  'IOS', 'WEB', 'MWEB', 'YTKIDS', 'YTMUSIC', 'ANDROID', 'ANDROID_VR',
  'YTSTUDIO_ANDROID', 'YTMUSIC_ANDROID', 'TV', 'TV_SIMPLY', 'TV_EMBEDDED',
  'WEB_EMBEDDED', 'WEB_CREATOR'
];
```

So `TV_EMBEDDED` is accepted as a value for `YOUTUBE_SESSION_INNERTUBE_CLIENT`. `YTMUSIC_ANDROID` (NAME `ANDROID_MUSIC` per youtubei.js `CLIENTS`) is also accepted.

### How env vars are read and which client wins

[`api/src/core/env.js:66-69`](https://github.com/imputnet/cobalt/blob/main/api/src/core/env.js#L66-L69):

```js
customInnertubeClient: env.CUSTOM_INNERTUBE_CLIENT,
ytSessionServer: env.YOUTUBE_SESSION_SERVER,
ytSessionReloadInterval: 300,
ytSessionInnertubeClient: env.YOUTUBE_SESSION_INNERTUBE_CLIENT,
```

Then [`api/src/processing/services/youtube.js:162-196`](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/youtube.js#L162-L196):

```js
162  let useHLS = o.youtubeHLS;
163  let innertubeClient = o.innertubeClient || env.customInnertubeClient || "IOS";
...
170  if (useHLS) {
171      innertubeClient = "IOS";
172  }
...
176  let useSession =
177      env.ytSessionServer && (
178          (
179              !useHLS
180              && innertubeClient === "IOS"
181              && (
182                  (quality > 1080 && o.codec !== "h264")
183                  || (quality > 1080 && o.codec !== "vp9")
184              )
185          )
186      );
...
189  if (o.subtitleLang) {
190      innertubeClient = "IOS";
191      useSession = false;
192  }
193
194  if (useSession) {
195      innertubeClient = env.ytSessionInnertubeClient || "WEB_EMBEDDED";
196  }
```

Two separate knobs:

- `CUSTOM_INNERTUBE_CLIENT`: the default client for all downloads. Currently unset in our Railway config per [`docs/deployment-strategy.md:88-89`](./deployment-strategy.md), so Cobalt uses its built-in default `IOS`.
- `YOUTUBE_SESSION_INNERTUBE_CLIENT`: the client Cobalt _switches to_ when it needs to use the poToken/visitor_data session. This is only triggered when `useSession` is true - which for our audio-only workload (no HLS, no subtitles, no quality>1080 logic) is **never**.

**Read that again.** For dub-rip's workload (`isAudioOnly: true`, no HLS, no subtitles, no 4K request) the `useSession` gate at youtube.js:176-186 is false (because `quality` comes in as `undefined`, `Number(undefined) = NaN`, and `NaN > 1080 === false`), which means:

1. `innertubeClient` stays at its line-163 value (`o.innertubeClient || env.customInnertubeClient || "IOS"`).
2. `useSession=false` is passed into `cloneInnertube()` at line 202, which at lines 85-86 makes `po_token` and `visitor_data` explicitly `undefined` in the Innertube session: `po_token: useSession ? sessionTokens?.potoken : undefined, visitor_data: useSession ? sessionTokens?.visitor_data : undefined`. **The poToken we generate is never sent with our player requests.**
3. The `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED` env var we set has **no effect**. Cobalt is hitting YouTube with `IOS` by default.
4. The `IOS` client is in `clientsWithNoCipher` (youtube.js:60), so it gets direct URLs without signature deciphering - which is why audio-only downloads worked end-to-end once PR #50 fixed the signature-decipher symptom (the decipher only runs for clients NOT in that list, and Rick Astley happens to get a playable iOS response).

So PR #50's note that "IOS and WEB neither helped" when tested is consistent: flipping `YOUTUBE_SESSION_INNERTUBE_CLIENT` between those values didn't change anything because the env var is dormant for our workload. The _actual_ client being used is whatever `CUSTOM_INNERTUBE_CLIENT` is set to, defaulting to `IOS`. And the poToken pipeline we carefully wired up in PR #50 is _not currently in the critical path_ for dub-rip's audio-only downloads.

### Music-specific handling in upstream

Cobalt's youtube.js does **not** auto-switch to `YTMUSIC_ANDROID` for music URLs - there is no URL-pattern check for `music.youtube.com` or VEVO artist channels. There is a "music metadata enrichment" block at youtube.js:309-318 that parses the `"Provided to YouTube by ..."` description fingerprint to populate album / copyright / release-date ID3-friendly fields, but that runs _after_ `getBasicInfo` succeeds. For our five probe videos, four of which are music, there is no special-case path. Everything hinges on the generic `innertubeClient` value.

`YTMUSIC_ANDROID` (NAME `ANDROID_MUSIC`) is in `clientsWithNoCipher` (youtube.js:60) so it would also give direct URLs, and is a reasonable alternate client to try. It is however subject to the same YouTube bot-scoring path as `ANDROID` and may not bypass the `LOGIN_REQUIRED` reason='bot' state any better.

### Why `TV_EMBEDDED` is the interesting lever

[LuanRT/YouTube.js#1119](https://github.com/LuanRT/YouTube.js/issues/1119) explicitly reports `TV_EMBEDDED` as bypassing the bot-detection state on the player endpoint when `WEB`, `ANDROID`, `iOS`, and `WEB_EMBEDDED` all fail. The mechanism is the same youtubei.js client enum, so it's a drop-in replacement via `CUSTOM_INNERTUBE_CLIENT=TV_EMBEDDED` on the Cobalt service. `TV_EMBEDDED` is **not** in `clientsWithNoCipher` (it's not in the list at youtube.js:60), so Cobalt will go through the `audio.decipher(innertube.session.player)` path at youtube.js:348-349 - which requires a working signature-decipher, which per PR #50 is working on Cobalt 11.7.1 + youtubei.js 17.0.1 now.

This is a single env-var flip and the most falsifiable change we can make in one PR.

## Q4. Concrete next-step recommendation

### Recommended experiment

**Set `CUSTOM_INNERTUBE_CLIENT=TV_EMBEDDED` on the Cobalt Railway service (do NOT change `YOUTUBE_SESSION_INNERTUBE_CLIENT`, do NOT swap the poToken provider, do NOT add new dependencies), redeploy Cobalt, and re-run the 5-video probe.**

Why this is the right single experiment:

- Isolates one variable (the default player-request client) from every other component we touched in PR #50.
- Targets the specific failure mode observed (`LOGIN_REQUIRED` with reason='bot' on `player` response) with the specific workaround documented upstream ([LuanRT/YouTube.js#1119](https://github.com/LuanRT/YouTube.js/issues/1119)).
- Costs one env-var change + one redeploy + one curl loop.
- Falsifiable in both directions: if it works, we get 3+/5 Cobalt hits and roll it out. If it doesn't, we've ruled out the client choice as the lever and the next experiment is either `YTMUSIC_ANDROID` (same style of change, different client) or residential-proxy routing - which is a much bigger decision and deserves its own doc.

### Success criterion

Run this loop against the Railway Cobalt service after the env-var change:

```bash
for url in \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  "https://www.youtube.com/watch?v=DrJ7grCnwUc" \
  "https://www.youtube.com/watch?v=kJQP7kiw5Fk" \
  "https://www.youtube.com/watch?v=9bZkp7q19f0" \
  "https://www.youtube.com/watch?v=hT_nvWreIhg"; do
  echo "=== $url ==="
  curl -sN --max-time 120 "https://dub.rip/api/download-stream?url=$url" \
    | grep -oE '"type":"(complete|error)"|"downloadMethod":"[^"]+"|"size":[0-9]+' | tail -3
done
```

**Pass: >=3 of 5 videos emit `"downloadMethod":"cobalt"` with non-zero `size` and `"type":"complete"`.**

**Fail: <3/5 Cobalt hits.** In that case, document the per-video outcome (which ones still hit `error.api.youtube.login`, which hit something new) and switch the spike to a residential-proxy or IP-reputation investigation - a follow-up PR, not a retry on this one.

### What I explicitly did NOT recommend

- **Swap `youtube-po-token-generator` for `bgutil-ytdlp-pot-provider` as an isolated change.** Q2 shows the call site in Cobalt doesn't pass a `content_binding`, so the token shape doesn't change from Cobalt's perspective. We'd swap one session-bound-token service for another. Only worth doing if we also patch Cobalt upstream to forward the video ID - which is a different PR.
- **Flip `YOUTUBE_SESSION_INNERTUBE_CLIENT`.** Q3 shows this variable is dormant for our audio-only workload; the only env var that matters is `CUSTOM_INNERTUBE_CLIENT`.
- **Add a residential proxy now.** Real answer if TV_EMBEDDED doesn't work, but a big architectural + cost decision. Deserves its own research doc and a separate greenlight.

## Open questions I could not resolve without production access

1. Per-video player-response dumps under each client. This needs shell access to the Cobalt container or a sandboxed youtubei.js probe. Would confirm that the failing videos all share `playabilityStatus.status = LOGIN_REQUIRED` + `reason.endsWith("bot")` vs Rick Astley's `status = OK`, or reveal a subtler differentiator.
2. Whether `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED` is actually dormant in our current deployment or whether some code path I missed triggers `useSession=true`. The audit of youtube.js:176-186 above says "dormant for audio-only, non-HLS, non-subtitle, quality<=1080 requests" but an end-to-end assertion would require log-probing the running Cobalt.
3. How YouTube's IP scoring classifies `cobalt.railway.internal`'s egress IP right now. Anecdotally (from [imputnet/cobalt#1189](https://github.com/imputnet/cobalt/issues/1189)) Railway/datacenter IPs are consistently flagged, but it's worth verifying with a direct Innertube probe from that service before assuming.

All three would be natural follow-ups if the TV_EMBEDDED experiment comes back <3/5.

## References

- PR #50: "docs(cobalt): version-pinning rationale + 0-byte tunnel runbook" - https://github.com/jzstern/dub-rip/pull/50
- Upstream Cobalt YouTube service: https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/youtube.js
- Upstream Cobalt env reader: https://github.com/imputnet/cobalt/blob/main/api/src/core/env.js
- Upstream Cobalt session helper: https://github.com/imputnet/cobalt/blob/main/api/src/processing/helpers/youtube-session.js
- Cobalt API env var docs: https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md
- youtubei.js client constants: https://github.com/LuanRT/YouTube.js/blob/main/src/utils/Constants.ts
- youtubei.js bot-detection workaround (TV_EMBEDDED): https://github.com/LuanRT/YouTube.js/issues/1119
- youtube-po-token-generator (our current provider): https://github.com/YunzheZJU/youtube-po-token-generator
- bgutil-ytdlp-pot-provider: https://github.com/Brainicism/bgutil-ytdlp-pot-provider
- yt-dlp PO Token Guide: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- Cobalt issue: persistent error.api.youtube.login: https://github.com/imputnet/cobalt/issues/1189
