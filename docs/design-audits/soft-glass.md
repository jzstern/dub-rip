# Soft Glass — Animation & Material Craft Audit

Audited against `.claude/skills/improve-animations/AUDIT.md`, `review-animations/STANDARDS.md`, `emil-design-eng`, `apple-design`, and `find-animation-opportunities`. Scope: `src/routes/+page.svelte`, `src/lib/components/*.svelte`, `src/lib/components/ui/{button,input,progress}`, `src/app.css`.

## Findings

| # | Severity | Location | Violation | Fix |
| --- | --- | --- | --- | --- |
| 1 | High | `src/app.css:111` | Three large (20–28rem) ambient orbs each carry `filter: blur(72px)` while continuously animating `transform`. Filtered layers this size re-composite huge blurred textures every frame — the single biggest jank risk on the page, especially in Safari. Standards: keep animated-context blur well under 20px; prefer no filter at all. | Bake the softness into the paint instead of the compositor: replace the flat `background` + `filter: blur(72px)` with a `radial-gradient(circle, hsl(...) 0%, hsl(.../0) 70%)` falloff and delete the `filter`. Transform-only drift stays; visual result is near-identical at zero filter cost. |
| 2 | High | `src/lib/components/ui/progress/progress.svelte:24` | `transition-all` on the progress indicator (always a finding — animates unintended properties off-GPU). It also fights the rAF progress smoother, which already emits per-frame values; a default 150ms `all` transition adds lag on top of the smoothing engine. | `transition-transform duration-100 ease-linear` — constant motion → `linear`, transform-only, short enough not to lag the smoother. |
| 3 | Medium | `src/app.css:170` (`.glow-button`) | No pressed state. Hover lifts (`translateY(-1px)`) but `:active` gives zero feedback — the interface doesn't confirm it heard the press. Standard: `scale(0.95–0.98)` on `:active`, `transform 100–160ms ease-out`. | Add `.glow-button:active:not(:disabled) { transform: scale(0.98); }` and tighten the transform transition to `160ms var(--ease-out-strong)`. |
| 4 | Medium | `src/app.css:177` | Hover motion (`translateY(-1px)` + glow) is not gated behind `@media (hover: hover) and (pointer: fine)` — touch devices fire false hovers on tap and the button sticks in its hovered state. | Wrap the `:hover` rule in the hover-capability media query. |
| 5 | Medium | `src/routes/+page.svelte:291` | The glass card, the error panel (`:321`), and the progress panel (`:328`) all teleport in — conditional renders with no entrance. Apple materials guidance: glass should *materialize* (scale + fade), not pop. | Shared `panel-in` entrance: `opacity: 0; transform: scale(0.97) translateY(4px)` → settled, `280ms cubic-bezier(0.16, 1, 0.3, 1)` (never from `scale(0)`), fade-only under reduced motion. |
| 6 | Medium | `src/app.css:184` (`.glass-panel`) | Stacked translucency: `backdrop-filter: blur(14px)` panels render *inside* the 28px-blurred `.glass-card` — a backdrop filter of a backdrop filter. Apple: never stack light translucent surfaces; it doubles GPU cost and collapses legibility. | Nested panels drop to `blur(8px)` and raise fill opacity `0.35 → 0.45` so legibility comes from the fill, not the filter. |
| 7 | Medium | `src/app.css:18` | `--muted-foreground: 252 20% 42%` over a 55%-opaque glass fill on a bright aurora is borderline contrast. Vibrancy rule: over translucent surfaces use higher-contrast, not flat mid-gray. | Darken light-mode muted-foreground to `252 22% 34%` and brighten dark-mode to `252 25% 75%`. |
| 8 | Low | `src/app.css:158,172` | Hand-typed weak easings (`ease`, `0.25s`) scattered across `glass-input`, `glow-button` — no shared motion tokens. Built-in easings lack punch; five near-identical curves is a consolidation finding. | Introduce `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` (+ keep `ease` only for pure color/shadow hovers) and reference the token. |
| 9 | Low | `src/lib/components/AsciiVinyl.svelte` | (Fixed during merge.) Aura pulse previously ran a plain `ease-in-out`-ish default; now uses sine-like `cubic-bezier(0.37, 0, 0.63, 1)` with `--aura-min/max` custom properties so the download-active state deepens the pulse organically instead of linearly. | Already applied; verify reduced-motion keeps the static active glow. |
| 10 | Low | `src/lib/components/VideoPreview.svelte:57` | The duration badge arrives asynchronously (second fetch) and teleports into the row next to the artist. | 200ms opacity fade-in on the duration span (opacity-only, safe under reduced motion). |
| 11 | Low | `src/app.css` (global) | No `prefers-reduced-transparency` handling — the whole direction is translucency, and users who ask for reduced transparency get the worst of it. | Media query: raise glass fills to ~0.92 opacity and drop `backdrop-filter` on `.glass-card/.glass-input/.glass-panel`. |

## Rejected candidates (restraint)

- Input focus ring animation beyond the existing 250ms shadow transition — tens of interactions per session; existing feedback is sufficient.
- Stagger on card contents — a single card with three children isn't a group entrance; stagger would read as slowness.
- Animating `backdrop-filter` blur radius on card entry ("materialize") — animating the filter itself is exactly the GPU cost finding #1 removes; scale+fade reads as material arrival at a fraction of the cost.
- Spinner styling changes — `animate-spin` is already `linear` constant motion, correct per the easing decision order.
- Progress-bar shimmer/gradient sweep — decorative motion on functional data the user is actively reading.

## Opportunities implemented

Entrance choreography for the glass card and its panels (#5), press feedback (#3), duration badge fade (#10) — all inside the sub-300ms UI budget with `--ease-out-strong` / `cubic-bezier(0.16, 1, 0.3, 1)` curves.
