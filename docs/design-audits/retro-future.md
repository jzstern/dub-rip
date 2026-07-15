# Retro-Future (Y2K Chrome) — Animation & Craft Audit

Audited against `.claude/skills/improve-animations/AUDIT.md`, `review-animations/STANDARDS.md`, `emil-design-eng`, `apple-design`, and `find-animation-opportunities`. Scope: `src/routes/+page.svelte`, `src/lib/components/*.svelte`, `src/app.css`.

## Findings

| # | Severity | Category | Location | Violation | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Performance | `src/lib/components/DownloadButton.svelte:17` | `transition-all` animating `box-shadow` and `filter: brightness()` on hover — both paint-per-frame, off the compositor; `transition: all` is always a finding | Pre-render the hover glow as an absolutely-positioned layer and cross-fade it via `opacity` (`transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)`); transition `transform, opacity` only |
| 2 | HIGH | Physicality / feedback | `src/lib/components/DownloadButton.svelte` | Primary pressable element has no `:active` press feedback | `active:scale-[0.98]` with `transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1)` (budget: 100–160ms) |
| 3 | MEDIUM | Accessibility | `src/lib/components/AsciiVinyl.svelte:71-74` | rAF loop spins the vinyl unconditionally — continuous movement with no `prefers-reduced-motion` handling; also regenerates a 35x35 char grid every frame for users who asked for less motion | Skip starting the rAF loop when `(prefers-reduced-motion: reduce)` matches; render one static frame |
| 4 | MEDIUM | Performance | `src/lib/components/AsciiVinyl.svelte:81` | `transition-all` on the `pre` — transitions `filter: drop-shadow(...)` (paint-expensive on a full text block) between idle/active states | Narrow to `transition-[color,transform]`; the cyan→magenta drop-shadow swap rides the color change without being independently tweened |
| 5 | MEDIUM | Cohesion / tokens | `src/app.css` (absent) | No motion tokens; components hand-type `duration-300`, `duration-200` with the browser's weak default curves | Add `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` to `:root`; reference it from all new motion |
| 6 | MEDIUM | Missed opportunity | `src/routes/+page.svelte:315-319` | Error panel teleports in/out — jarring appearance for a state the user must read | Enter via 200ms `opacity 0→1` + `translateY(4px)→0`, `cubic-bezier(0.23, 1, 0.32, 1)`, reduced-motion → opacity only |
| 7 | LOW | Physicality | `src/lib/components/VideoPreview.svelte:66` | `preview-in` is a pure fade with no initial transform ("nothing appears from nothing") | Start from `opacity: 0; transform: translateY(4px)`; keep 200ms ease-out; reduced-motion block already present |
| 8 | LOW | Missed opportunity | `src/routes/+page.svelte:268-354` | Hero (vinyl/wordmark) and card pop in all at once on load — no entrance, no stagger | One-shot rise-in: `opacity 0→1` + `translateY(8px)→0`, 300ms `--ease-out-strong`, card delayed 80ms with `backwards` fill; reduced-motion → fade only |
| 9 | LOW | Missed opportunity | `src/app.css:84-110` (grid horizon) | The perspective grid is static; a slow in-plane scroll would sell the Y2K horizon at zero paint cost | Animate `translateY(0→56px)` (one pattern period) inside the existing `perspective/rotateX` transform, `7s linear infinite`, compositor-only, gated behind `prefers-reduced-motion: no-preference` |

## Considered and rejected (restraint)

- **Chrome wordmark sheen sweep** — with `background-clip: text` the sweep must animate `background-position`, which repaints the text every frame. A transform/opacity-only implementation needs a duplicated overlay glyph layer; complexity outweighs a once-per-load 600ms flourish. Rejected on the transform/opacity-only rule.
- **Progress bar neon trail** — the indicator already carries a static neon glow; animating `box-shadow` with `roundedProgress` is paint-per-frame during the busiest moment of the app (download + rAF smoother already running). Rejected on performance.
- **Scanlines** — already static repeating gradients (no flicker, no animation cost). Correct as-is; do not animate.
- **Vinyl hover play/pause toy** — superseded by main's download-driven `active` prop; spin speed as state indication is the right purpose (state indication > decoration).
- **Input focus glow** — already a discrete `focus-visible` style change, not a transition; focus changes are high-frequency and should snap. Correct as-is.
