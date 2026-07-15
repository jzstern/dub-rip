# Tape Deck — Animation & Polish Audit

Audited against `.claude/skills/review-animations/STANDARDS.md`, `improve-animations/AUDIT.md`,
`emil-design-eng/SKILL.md`, and `apple-design/SKILL.md`. Personality target: warm analog
cassette — motion should feel mechanical, smooth, and unhurried but never sluggish.

## Findings

| # | Severity | Location | Violation | Fix |
| --- | --- | --- | --- | --- |
| 1 | HIGH | `src/lib/components/CassetteReels.svelte:19-26` | Constant rAF-driven rotation ignores `prefers-reduced-motion`. Decorative infinite movement is exactly what the media query exists for. | Read `matchMedia("(prefers-reduced-motion: reduce)")`; when reduced, stop the rAF loop and render the reels static. Keep the SVG visible (reduced motion ≠ zero UI). |
| 2 | HIGH | `src/lib/components/ui/button/button.svelte:10` (base variants) | `transition-all` animates unintended properties off-GPU — always a finding per STANDARDS §Performance. No press feedback either; buttons must confirm the press. | Replace `transition-all` with the default `transition` property list (colors/opacity/shadow/transform), `duration-150`, and add `active:scale-[0.97]` (press budget 100–160ms, subtle 0.95–0.98). |
| 3 | MEDIUM | `src/lib/components/ui/progress/progress.svelte:24` | Progress indicator uses `transition-all` (150ms default ease). Constant motion should be `linear` and only `transform` should animate. | `transition-transform duration-150 ease-linear`. |
| 4 | MEDIUM | `src/routes/+page.svelte:314-352` | Error block and the progress section pop in with no transition — a jarring change (AUDIT §8: teleporting state, occasional frequency → standard animation). | Enter with `opacity: 0; translateY(6px)` → settled, 220ms strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; reduced-motion keeps an opacity-only fade. |
| 5 | MEDIUM | `src/lib/components/CassetteReels.svelte:12` | Hover retargets reel speed 0.045 → 0.12 as a hard cut — a velocity discontinuity ("brick wall", apple-design §3). Same when a download starts. | Lerp the current speed toward the target each frame so the reels wind up/down like real tape transport. |
| 6 | MEDIUM | `src/lib/components/CassetteReels.svelte:50-52` | `isPaused` toggles `opacity-70` but the class only transitions `transform`, so opacity snaps. Hover scale also fires on touch taps (JS `mouseenter`, ungated). | Transition `[transform,opacity]`; gate hover state behind `matchMedia("(hover: hover) and (pointer: fine)")`. |
| 7 | LOW | `src/lib/components/VideoPreview.svelte:64-87` | Preview card enters with opacity-only keyframe and weak built-in `ease-out`. Physicality rule: pair opacity with a small transform; built-in easings are too weak. Reduced-motion sets `animation: none` — should keep the fade (gentler, not zero). | `translateY(6px)` + opacity over 220ms `cubic-bezier(0.23, 1, 0.32, 1)`; reduced-motion falls back to opacity-only fade. |
| 8 | LOW | `src/app.css` | No shared motion tokens; curves/durations are ad hoc. Cohesion finding per AUDIT §7. | Add `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1)` to `:root`; reference them from component styles. |

## Missed opportunities (additive)

- **Power LED** (`src/routes/+page.svelte` faceplate header): a static dot reads as a sticker.
  A slow breathing pulse (~3.2s ease-in-out, opacity 1 → 0.55, infinite) makes the deck feel
  powered on. Ambient and opacity-only, disabled under `prefers-reduced-motion`.
- **Reels react to download** (implemented during the main merge): `active` prop spins the
  reels faster while downloading — state indication in the tape motif.

## Explicitly cleared

- `PreviewSkeleton` `animate-pulse` — opacity-only, loading indication; acceptable under
  reduced motion (no positional movement).
- `VideoPreview` artwork `transition-opacity duration-300` on image load — correct property,
  correct purpose, already reduced-motion-gated.
- Input/button focus rings — instant focus feedback is correct; do not animate keyboard-driven
  focus (frequency rule).
- Wordmark/header — static is right; the hero already carries the motion budget in the reels.
