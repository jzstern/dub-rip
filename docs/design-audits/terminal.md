# Terminal (phosphor CLI) design — animation & craft audit

Audited against `.claude/skills/improve-animations/AUDIT.md`, `.claude/skills/review-animations/STANDARDS.md`, `.claude/skills/emil-design-eng/SKILL.md`, `.claude/skills/apple-design/SKILL.md`, and `.claude/skills/find-animation-opportunities/SKILL.md`.

Personality: crisp, phosphor-CRT terminal. Motion budget is small and steppy — CLI output snaps, it does not float. Every fix below keeps that identity.

## Findings

| # | Severity | Category | Location | Violation | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Performance | `src/lib/components/DownloadButton.svelte:17`, `src/lib/components/ui/button/button.svelte:10`, `src/lib/components/ui/progress/progress.svelte:24`, `src/lib/components/AsciiVinyl.svelte:81` | `transition-all` / `transition: all` animates unintended properties off-GPU — always a finding (AUDIT.md §5) | Name the exact properties: `transition-[background-color,box-shadow,transform,opacity]` on the button, `transition-[color,transform]` on the vinyl. Progress indicator drops its CSS transition entirely — it is driven per-frame by the rAF smoother; a transition on top fights the smoother |
| 2 | HIGH | Physicality | `src/lib/components/DownloadButton.svelte:14-25` | Pressable element with no press feedback (AUDIT.md §3, emil-design-eng "Buttons must feel responsive") | `active:scale-[0.98]` with `transition: transform 160ms` on the strong curve `cubic-bezier(0.23, 1, 0.32, 1)`; subtle range 0.95–0.98 |
| 3 | HIGH | Accessibility | `src/lib/components/AsciiVinyl.svelte:58-74` | Constant decorative rAF rotation with no `prefers-reduced-motion` handling; the loop also runs forever even though CSS could not express this (JS is justified) but reduced-motion users still get perpetual motion (AUDIT.md §6) | Gate the rAF loop behind `matchMedia("(prefers-reduced-motion: reduce)")` — render one static frame when reduced. Reduced motion means gentler, not zero: the phosphor recolor (`text-primary` when active) still communicates state |
| 4 | MEDIUM | Physicality | `src/lib/components/VideoPreview.svelte:54-77` | Entrance is a pure opacity fade with no initial transform — "pure-fade entrances with no initial transform" is a hunt item (AUDIT.md §3) | Enter from `opacity: 0; transform: translateY(4px)` → settled, `200ms cubic-bezier(0.23, 1, 0.32, 1)`. Under reduced motion keep the opacity fade, drop the movement |
| 5 | MEDIUM | Cohesion & tokens | `src/app.css` (no motion tokens exist) | No shared easing/duration tokens; components hand-type built-in easings, which are too weak for deliberate motion (AUDIT.md §7, STANDARDS "Built-in CSS easings are too weak") | Add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` to `:root`; all new motion references the tokens |
| 6 | MEDIUM | Missed opportunity | `src/routes/+page.svelte:287` (terminal window Card) | The primary surface teleports in on load — a jarring appearance where a brief transition prevents it (AUDIT.md §8) | One-shot enter: `opacity: 0; transform: scale(0.985)` → settled, 200ms `var(--ease-out)`; opacity-only under reduced motion. Rare frequency (page load) → standard animation allowed |
| 7 | MEDIUM | Missed opportunity | `src/routes/+page.svelte:343-377` (status/progress block) | Status lines (`▸ downloading…`, title, bar) pop in all at once — everything-at-once group entrance where a 30–80ms stagger belongs (AUDIT.md §7) | CLI-authentic line-by-line entrance: each line `opacity: 0; translateY(3px)` → settled, 160ms `var(--ease-out)`, 45ms stagger via `animation-delay`. Decorative — never blocks interaction |
| 8 | LOW | Cohesion (terminal craft) | `src/routes/+page.svelte:357` + `src/lib/components/ui/progress/progress.svelte` | Progress renders as a smooth web bar — off-personality for a CLI; spec calls for crisp ticks or a `█████░░░` bar | Render an ASCII cell bar (`█` filled / `░` empty, 24 cells) derived from `roundedProgress`, with `role="progressbar"` + `aria-valuenow` for semantics. Discrete cell ticks ARE the terminal aesthetic — no transition wanted |
| 9 | LOW | Accessibility | `src/app.css:91-107` (`.terminal-cursor`, `.cursor-blink`) | Blink is already authentically steppy (`steps(1)` with 50% hold — correct, keep), but it loops forever with no reduced-motion handling | Under `prefers-reduced-motion: reduce`, stop the blink and hold the cursor solid (`animation: none; opacity: 1`) — state stays legible without flashing |
| 10 | LOW | Accessibility | `src/lib/components/PreviewSkeleton.svelte:1` | `animate-pulse` loops unconditionally; opacity-only so it is gentle, but trivially gateable | `motion-safe:animate-pulse` |

## Verified non-issues

- **Scanline overlay** (`src/app.css:72-85`): static `repeating-linear-gradient` on a `position: fixed`, `pointer-events: none` pseudo-element. No animation, no repaint storm, nothing flickers — no reduced-motion gate required.
- **Cursor blink easing** (`src/app.css:110-119`): `steps(1)` with a 50% hold is the terminal-authentic steppy blink the spec asks for — not a soft fade. Kept as-is (see #9 for the reduced-motion addition only).
- **Progress smoother rAF loop** (`src/routes/+page.svelte:43-65`): dynamic, data-driven motion — JS is the right tool per AUDIT.md §5; out of scope regardless (engine untouchable).
- **Input focus glow** (`src/lib/components/ui/input/input.svelte:49-50`): already transitions `color, box-shadow, border-color`, and a transition declared on the base class runs in both directions (focus in and out). Passes.
- **Duration badge / preview data**: functional data the user reads — correctly not animated beyond its container's entrance.

## Rejected candidates

- Animating the input on every keystroke / URL validation flash — tens-to-hundreds of times per session; frequency table says remove or drastically reduce.
- Typewriter effect on the `[ok] Downloaded!` line per progress event — progress events fire rapidly; keyframed typing would restart from zero on every retarget (AUDIT.md §4).
- Bounce on the terminal-window entrance — a crisp CLI has no spring personality; bounce is reserved for momentum-driven gestures (apple-design §4).
