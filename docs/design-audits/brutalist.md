# Brutalist Direction — Animation & Craft Audit

Audited against `.claude/skills/improve-animations/AUDIT.md`, `review-animations/STANDARDS.md`, `emil-design-eng/SKILL.md`, `apple-design/SKILL.md`, and `find-animation-opportunities/SKILL.md`. Personality: Swiss editorial brutalism — motion must be scarce, fast, decisive; hard cuts tolerated; transform/opacity only.

## Findings

| # | Severity | Category | Location | Violation | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Performance / Interruptibility | `src/lib/components/ui/progress/progress.svelte:24` | `transition-all` on the progress indicator. It animates unintended properties off-GPU, and it fights the rAF progress smoother (`createProgressSmoother` retargets `displayProgress` every frame; a CSS transition layered on top adds constant lag and mush). | Remove the transition entirely — the smoother is the animation. Indicator class becomes `bg-primary h-full w-full flex-1`. |
| 2 | HIGH | Feedback | `src/lib/components/DownloadButton.svelte:17` | Primary pressable element has no `:active` press feedback, and hover uses `brightness-90` (a filter, mushy) with `transition-none`. Skill: press feedback `scale(0.95–0.98)` at 100–160ms ease-out; hover should be a crisp state change. | Crisp color inversion on hover (`hover:bg-foreground hover:text-background`), `active:scale-[0.98]`, `transition-[transform,background-color,color] duration-[120ms] ease-out-strong`; `motion-reduce:active:scale-100` keeps color feedback, drops movement. |
| 3 | MEDIUM | Purpose & frequency | `src/lib/components/AsciiVinyl.svelte:26` | Record mark spins continuously (12s linear) while idle — decorative constant motion on an always-visible element with no purpose ("it looks cool" fails the gate). | Static at rest; spin (1.4s linear) only while `active` (downloading) — motion becomes state indication. Hard-cut start is on-brand. Reduced motion drops the spin. |
| 4 | MEDIUM | Missed opportunity | `src/routes/+page.svelte` (error block) | Error panel teleports in — a jarring change with no bridge. Purpose: preventing a jarring change; frequency: occasional. | 140ms reveal, `opacity: 0; translateY(2px)` → settled, `var(--ease-out-strong)`; reduced motion keeps the fade, drops the translate. |
| 5 | MEDIUM | Cohesion & tokens | `src/lib/components/VideoPreview.svelte:55`, `DownloadButton`, `AsciiVinyl` | No shared motion tokens; built-in `ease-out` is too weak for deliberate motion, and each component hand-types its own timing. | Add `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` in `app.css` + `ease-out-strong` in Tailwind `transitionTimingFunction`; use it in every transition/animation. |
| 6 | LOW | Missed opportunity | `src/routes/+page.svelte` (hero) | Page loads with zero moment of arrival; the accent is purely static. Craft direction: the accent used kinetically — a rule that draws in on load, once, fast. | Accent rule under the hero draws in via `scaleX(0) → 1`, `transform-origin: left`, 360ms `var(--ease-out-strong)`, once; none under reduced motion. |
| 7 | LOW | Accessibility | `src/lib/components/PreviewSkeleton.svelte:1` | `animate-pulse` not gated for `prefers-reduced-motion` (Tailwind does not gate it). | Add `motion-reduce:animate-none`. Loader spinner stays — reduced motion keeps comprehension-aiding state indication. |
| 8 | LOW | Craft (focus state) | `src/routes/+page.svelte` (Input class) | `focus-visible:ring-0` strips the ring and nothing replaces it — keyboard focus on the URL field is invisible. | Crisp accent cut: `focus-visible:border-accent` (instant, no tween — brutalist). |

## Deliberately rejected

- **Progress section entrance animation** — appears in direct response to a click; instant feedback beats a tween (Response principle: kill latency).
- **Rolling/slot-machine digits on the oversized % numeral** — the rAF smoother already updates it every frame; per-change roll animation would fight it and add churn. `tabular-nums` (already present) is the correct fix.
- **Header/footer rail entrances or hover motion** — structural chrome seen constantly; frequency tier says no.
- **Stagger on preview metadata lines** — two lines of text inside a 160ms card reveal; stagger would read as lag, not craft.
- **Spring physics anywhere** — nothing here is gesture-driven; springs would contradict the hard-edged editorial identity.

## Verdict

The direction needs very little motion — the identity carries the design. The leverage is in removing the two things that fight the engine (`transition-all` on the smoothed bar, the aimless idle spin) and making the three motions that remain (press, error reveal, load rule) fast, tokenized, and decisive.
