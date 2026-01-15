# Cobalt Integration Spec

## Problem

yt-dlp on Vercel (serverless) cannot access YouTube cookies, causing download failures due to:
- Bot detection (403/429 errors)
- Age-restricted video blocks
- Rate limiting

The current `--cookies-from-browser chrome` flag only works locally.

## Solution: Cobalt Primary + yt-dlp Metadata

Use [Cobalt](https://cobalt.tools/) for reliable audio extraction, keep yt-dlp for rich metadata.

```
┌─────────────────────────────────────────────────────┐
│                    User Request                      │
└────────────────────────┬────────────────────────────┘
                         │
                    ┌────▼────┐
                    │ yt-dlp  │ ← Fetch metadata (works without auth)
                    │metadata │
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ Cobalt  │ ← Download audio (handles bot detection)
                    │   API   │
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ Proxy   │ ← Stream through server
                    │ + Tag   │ ← Apply ID3 metadata
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ Return  │
                    │  MP3    │
                    └─────────┘
```

## Why This Architecture

| Component | Responsibility | Why |
|-----------|---------------|-----|
| Cobalt API | Audio download | Handles YouTube auth/bot detection |
| yt-dlp | Metadata extraction | Rich metadata works without auth |
| Server proxy | Stream + tag | Inject ID3 tags before user receives file |

## Cobalt API Integration

### Endpoint
```
POST https://api.cobalt.tools/api/json
```

### Request
```typescript
interface CobaltRequest {
  url: string;           // YouTube URL
  isAudioOnly: true;     // Audio extraction
  aFormat: 'mp3';        // Output format
  filenameStyle: 'basic'; // Optional: filename pattern
}
```

### Response
```typescript
interface CobaltResponse {
  status: 'stream' | 'redirect' | 'error';
  url?: string;          // Download URL (when status is 'stream' or 'redirect')
  text?: string;         // Error message (when status is 'error')
}
```

### Example
```typescript
const response = await fetch('https://api.cobalt.tools/api/json', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    isAudioOnly: true,
    aFormat: 'mp3'
  })
});

const data = await response.json();
if (data.status === 'stream' || data.status === 'redirect') {
  // data.url contains the direct download URL
}
```

## Implementation Plan

### Phase 1: Add Cobalt Download Route

Create `/api/download-cobalt/+server.ts`:

1. Accept YouTube URL from client
2. Fetch metadata via yt-dlp (no cookies needed for public info)
3. Request audio from Cobalt API
4. Stream Cobalt response through server
5. Apply ID3 tags using node-id3
6. Return tagged MP3 to client

### Phase 2: Modify Download Flow

Update `/api/download-stream/+server.ts`:

1. Try Cobalt first (most reliable)
2. Fall back to yt-dlp if Cobalt fails
3. Report which method succeeded in response

### Phase 3: Error Handling

- Cobalt rate limits → fall back to yt-dlp
- Cobalt unavailable → fall back to yt-dlp
- Both fail → show clear error with explanation
- Timeout handling for serverless (Vercel 10s/60s limits)

## Considerations

### Vercel Timeout Limits
- Hobby: 10 seconds
- Pro: 60 seconds
- Large files may timeout; consider streaming response

### Cobalt Limitations
- Public API may have rate limits
- Audio quality options limited
- No direct metadata; hence yt-dlp hybrid

### Future Enhancements
- MusicBrainz API for additional metadata enrichment
- Self-hosted Cobalt instance if rate limited
- Caching metadata to reduce yt-dlp calls

## References

- [Cobalt API Docs](https://github.com/imputnet/cobalt/blob/main/docs/api.md)
- [yt-dlp Options](https://github.com/yt-dlp/yt-dlp#options)
- [node-id3](https://github.com/Zazama/node-id3)
