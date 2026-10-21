# DESIGN.md: TabulaVibe AI design system

_Version 2 ("calm confidence"), introduced 2026-10-21. The source of truth for tokens is
`frontend/src/index.css`; components live in `frontend/src/components/ui.tsx`._

## 1. Design principles

1. **Clarity before decoration.** Numbers, labels and explanations come first. Gradients, glows and motion only frame them.
2. **Trust is visible.** Every figure shows how it was calculated (KPI definitions, "values used / excluded", data health). Nothing is hidden behind an icon.
3. **Guide, don't gate.** A 4-step stepper, suggested analyses, sensible defaults and clear empty states mean a first-time user always knows the next action.
4. **Calm confidence.** Brand colour is used sparingly: hero keyword, primary actions, the active step, the lead KPI. Everything else is neutral.
5. **Accessible by default.** Native controls, visible focus, an icon plus text for every status, and a table for every chart. Reduced motion is respected.

## 2. Brand

| Element | Value |
|---|---|
| Name | **TabulaVibe AI** ("AI" in brand gradient text) |
| Logo mark | Bar-chart glyph (`ChartNoAxesColumn`) in a rounded square filled with the brand gradient |
| Brand gradient | `linear-gradient(135deg, var(--accent), var(--accent-2))`: indigo `#4f46e5` → violet `#7c3aed` (dark: `#818cf8` → `#a78bfa`) |
| Text gradient | indigo → violet → sky (`#0ea5e9`), used once per screen at most (hero headline) |
| Voice | Plain, specific, reassuring: "Nothing has been changed in your data", "Files are never stored", "Only you can see your reports" |

## 3. Colour tokens

All colours are CSS custom properties on `:root`, mapped to Tailwind with `@theme inline`
(e.g. `bg-surface`, `text-ink-2`, `border-line`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | `#f6f7fb` | `#0a0c16` | App background (with soft brand glows) |
| `--surface` | `#ffffff` | `#121528` | Cards |
| `--surface-2` | `#f3f4f9` | `#181c33` | Table headers, inset areas, hover |
| `--surface-3` | `#e9ebf4` | `#20253f` | Tracks (rings, meters, switches), skeletons |
| `--glass` | white 72% | surface 72% | Sticky header, tooltips (with backdrop blur) |
| `--ink` | `#0f1222` | `#eef0fb` | Primary text |
| `--ink-2` | `#474c63` | `#b6bad3` | Secondary text |
| `--ink-muted` | `#676c84` | `#8d92b0` | Captions, axis labels (≥ 4.5:1 on surfaces) |
| `--line` / `--line-strong` | `#e4e6ef` / `#d0d4e1` | `#252a47` / `#353b60` | Hairlines / control borders |
| `--accent` | `#4f46e5` | `#818cf8` | Brand, focus ring, active states |
| `--accent-soft` / `--accent-text` | `#eef0ff` / `#4338ca` | `#1d2046` / `#a5b4fc` | Soft buttons, chips, links |
| `--good` / `--good-soft` | `#047857` / `#e6f6ee` | `#34d399` / `#0e2a21` | Success, healthy |
| `--warn` / `--warn-soft` | `#8a4b06` / `#fff4df` | `#fbbf24` / `#2c220c` | Warnings, excluded values |
| `--bad` / `--bad-soft` | `#b42323` / `#fdecec` | `#f87171` / `#321517` | Errors, destructive hover |

**Chart series** (`--series-1` … `--series-8`) use the validated categorical palette, which passes
colour-vision-deficiency checks in both modes. Never replace a series colour with the brand colour.
Series colours are for marks only; text always uses ink tokens.

**Themes.** Light is the default; dark follows `prefers-color-scheme`. The header toggle (Light / System /
Dark) sets `html[data-theme]` and stores the choice in `localStorage` (`tabulavibe-theme`), failing safely
when storage is blocked. Both theme blocks must be kept in sync: the media query and `[data-theme='dark']`.

## 4. Typography

| Role | Style |
|---|---|
| Typeface | **Inter Variable**, self-hosted via `@fontsource-variable/inter` (no request to Google Fonts) |
| Hero H1 | `text-4xl sm:text-5xl font-bold tracking-tight`, `text-balance` |
| Card title | `text-base font-semibold tracking-tight` |
| KPI value | `text-2xl sm:text-3xl font-bold tracking-tight tabular` |
| Body | `text-sm` (14 px) with `text-ink-2` |
| Captions / hints | `text-xs text-ink-muted` |
| Numbers in tables | `.tabular` (tabular figures) and right-aligned |

## 5. Shape, depth and spacing

- **Radius:**
  - controls `rounded-xl` (12 px)
  - cards `rounded-2xl` (16 px)
  - hero and report surfaces `rounded-3xl` (24 px)
  - badges `rounded-full`
- **Shadows:** `shadow-soft` for resting controls, `shadow-card` for cards, `shadow-float` for hero, report and tooltips. Primary buttons get a coloured glow.
- **Highlight border:** `.gradient-border` (brand gradient hairline) marks the *one* most important card in a view: the upload zone, data health, suggestions, the lead KPI, AI when enabled.
- **Spacing:**
  - cards `p-4 sm:p-6`
  - gaps between sections `gap-4`/`gap-5`
  - page padding `px-4`, max width `max-w-7xl`

## 6. Layout

| Screen | Layout |
|---|---|
| Landing | Centred hero → upload zone (left, 1.5fr) + sample cards (right, 1fr) → 4-step "how it works" strip → privacy note |
| Workspace | Sticky glass header (sticky from `sm`; static on phones to save space) → full-width **4-step stepper** → step panel |
| Analyse | Builder (340 px) beside results from `lg`; stacked below `lg`, where the page scrolls to the results after a run |
| Report | Download toolbar → document-style report with a gradient title band (it prints as plain dark text) |

**Stepper:** steps are `role="tab"` buttons with accessible names "1. Preview" … "4. Report & export".
- Active: gradient icon tile plus accent ring. Done: green tick. Disabled: 45% opacity.
- Below `md`, each step shows only an icon and a short label (4-column grid, no sideways scrolling).

## 7. Components (`ui.tsx`)

| Component | Notes |
|---|---|
| `Button` | Variants `primary` (gradient + glow), `secondary`, `ghost`, `soft`; sizes `sm/md/lg`; optional lucide `icon`; `busy` swaps the icon for a spinner and sets `aria-busy`; subtle press scale |
| `Card` | Optional `icon` chip, `title`, `subtitle`, `actions`, `highlight` (gradient border) |
| `IconChip` | Tinted square holding an icon; tones `accent / brand / good / warn / bad / neutral` |
| `Alert` | Icon plus text for `error` (`role=alert`), `warning`, `info`, `success` (`role=status`) |
| `Badge` | Pill with optional icon; used for types, counts and statuses |
| `Stat` | Icon chip + label + value + hint |
| `ProgressRing` | Data-health gauge (`role=img`, label "Data health: N%"); good ≥ 95, accent ≥ 80, otherwise warn |
| `Meter` | Per-column completeness bar with the same thresholds |
| `Toggle` | A **native checkbox** restyled as a switch (`.switch`), so keyboard, screen-reader and test behaviour stays native |
| `Skeleton` | Shimmer placeholder for loading states |

Icons come from **lucide-react** (v1 names, e.g. `ChartColumn`, `TriangleAlert`, `LoaderCircle`). Decorative
icons are `aria-hidden`. Column types have fixed icons (`lib/icons.ts`): number `Hash`, date `Calendar`,
yes/no `ToggleLeft`, category `Tag`, text `Type`, empty `CircleDashed`.

## 8. Data visualisation rules

- One measure per chart (never two y-axes). A selector switches the measure.
- **Trend:** area chart with a 2 px straight line (no smoothing, so no implied values between periods), 8 px dots with a surface ring, and a 22% → 0% gradient wash.
- **Comparison:** horizontal bars, sorted, max 24 px thick, 6 px rounded ends, top 20 shown, compact value labels.
- **Share:** donut (62–92% radius, 1.5° gaps, rounded ends).
  - Only when the server allows it (one sum or count measure, non-negative, 2–8 groups).
  - The centre shows the server's KPI total. The legend is HTML with percentages.
- **Tooltips:** frosted glass, group name, formatted value and row count.
- Every chart has `role="img"` with a descriptive `aria-label`, and a table view one click away.
- Animations are off on charts (stable screenshots and printing).

## 9. Motion

| Motion | Spec |
|---|---|
| Section entrance | `.animate-rise` (fade + 8 px rise, 350 ms; staggered 50–120 ms on landing and KPIs) |
| Hover lift | cards and suggestion buttons `-translate-y-0.5` plus a stronger shadow |
| Press | buttons `scale(0.98)` |
| Loading | skeleton shimmer, spinning loader icon |
| Gauges | ring stroke animates over 800 ms |
| Reduced motion | `prefers-reduced-motion: reduce` collapses every animation and transition to ~0 ms |

## 10. Content patterns

- Every step has a **"Next: …" primary button** (bottom right) with an arrow.
- Empty states use a large gradient icon tile, one sentence and the next action. Example: "Your dashboard will appear here".
- Error copy says what happened and what to do. It never shows codes or stack traces.
- Privacy reassurance appears where data is handed over: upload, AI panel, footer.

## 11. Accessibility checklist

- [x] All inputs have visible `<label>`s; icon-only buttons have `aria-label`
- [x] Focus ring: 2 px accent outline, 2 px offset (`:focus-visible`)
- [x] Text contrast ≥ 4.5:1 for body and captions in both themes
- [x] Status = icon + text (never colour alone); charts have tables
- [x] Tables: `<caption>`, `scope`, focusable scroll containers
- [x] Native checkboxes (switches are styled checkboxes)
- [x] Reduced motion respected; no auto-playing animation after entry
- [x] Works from 360 px phones to wide desktops (verified with Playwright desktop + Pixel 7)

## 12. Changing the design

1. Change tokens in `index.css`, in **both** dark blocks.
2. Keep accessible names stable. The unit and E2E tests use them, e.g. `"2. Data quality"`, `"Run analysis"`, `"Load sample: …"`, `"Table"`.
3. Run `npm run typecheck && npm run lint && npm test && npm run test:e2e`. The E2E run saves light/dark, desktop/mobile screenshots under `frontend/test-results/` for visual review.
