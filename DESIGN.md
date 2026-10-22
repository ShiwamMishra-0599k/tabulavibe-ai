# DESIGN.md: TabulaVibe AI design system

_Version 2 ("calm confidence"), introduced 2026-10-21; choice screen, report files and phone layout rule added 2026-10-22 (v0.5.0). The source of truth for tokens is
`frontend/src/index.css`; components live in `frontend/src/components/ui.tsx`._

## 1. Design principles

1. **Clarity before decoration.** Numbers, labels and explanations come first. Gradients, glows and motion only frame them.
2. **Trust is visible.** Every figure shows how it was calculated (KPI definitions, "values used / excluded", data health). Nothing is hidden behind an icon.
3. **Guide, don't gate.** A clear choice between the AI and the Manual Analyst, a 4-step stepper, suggested analyses, sensible defaults and clear empty states mean a first-time user always knows the next action.
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
| Header | Floating glass "pill" (`rounded-[2rem]`, `sticky top-3`, `shadow-float`) on every size (Shashank, 2026-10-21). Phones: compact toolbar; below 430 px "New file"/"Sign in" are icon-only (text kept for screen readers); GitHub badge hidden below 640 px |
| Landing | Centred hero → upload zone (left, 1.5fr) + sample cards (right, 1fr) → 4-step "how it works" strip → privacy note. When sign-in is required and nobody is signed in, the upload zone shows "Sign in to upload your data" and samples are locked |
| **Choose analyst** (after upload) | Centred question "How would you like to analyse **file**?" + file chips (rows, columns, data health) → two large cards side by side from `md`, stacked on phones: **AI Analyst** (gradient border, gradient icon tile, AI mode badge, primary CTA) and **Manual Analyst** (plain border, soft icon tile, secondary CTA). Each card is one button (accessible names "AI Analyst" / "Manual Analyst") with four ✓ points |
| Mode bar | One line above either mode: mode name with icon (left) and a ghost "Switch to Manual Analyst" / "Switch to AI Analyst" button (right) |
| Manual Analyst | Mode bar → **4-step stepper** → step panel |
| AI Analyst | Mode bar → context form (phase 0) → live phase timeline → report card (PDF, PowerPoint, handover .md, run again) → page tabs (Overview, Data quality, Univariate, Bivariate, Multivariate, Insights, Plan & method) |
| Analyse | Builder (340 px) beside results from `lg`; stacked below `lg`, where the page scrolls to the results after a run |
| Report & export | Downloads card: **Download PDF**, **Download PowerPoint** (primary), results CSV, cleaned CSV (secondary), cleaning toggles → document-style on-screen report |

**Stepper:** steps are `role="tab"` buttons with accessible names "1. Preview" … "4. Report & export".
- Active: gradient icon tile plus accent ring. Done: green tick. Disabled: 45% opacity.
- From `sm` a 4-column grid; on phones a swipeable row of 128 px tabs (scrollbar hidden).

**Phone layout rule (all screens fit 320, 360 and 412 px wide phones):**
- Any single-column grid that can contain a wide table or chart uses `grid-cols-[minmax(0,1fr)]` (a plain `grid` track grows to its widest child and the phone zooms the page out).
- Wide tables scroll inside their card (`overflow-x-auto`); cards in grids get `min-w-0`.
- Card action controls take the full card width below `sm`; fixed-width selects become `w-full sm:w-72`.
- The chart-type switcher becomes a 4-column grid and shows icons only below 380 px.
- Verify by measurement: at each width, `window.innerWidth` must equal the device width on every screen.

## 6a. Report files (PDF and PowerPoint)

| Element | PowerPoint (16:9) | PDF (A4) |
|---|---|---|
| Cover | Full-bleed indigo→violet gradient, "TABULAVIBE AI", title, subtitle, meta line | Brand subtitle in accent, 22 pt title, meta line, 2 pt accent rule |
| Section | One slide per section, 0.12" accent bar on top, 26 pt title, footer | 14 pt heading kept with the next block |
| KPIs | White rounded cards, 3 per row (label, 28 pt value, definition) | 3-column grid |
| Charts | **Native PowerPoint charts** (editable): bars sorted largest on top, data labels, straight trend line, doughnut only when the server allows it; Indian digit grouping | Vector charts (ReportLab) starting at zero, sans-serif labels |
| Insights | One slide each: title, confidence/kind badge in the confidence colour, the seven questions in two columns | Card with a 3 pt left rule in the confidence colour |
| Fonts | Theme font (PowerPoint renders Unicode) | Embedded **DejaVu Sans** (₹, →, η, ρ) |
| Colours | Brand `#4f46e5`/`#7c3aed`, series `#2a78d6`…, ink `#0f1222`/`#474c63`, muted `#676c84` | Same |

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
