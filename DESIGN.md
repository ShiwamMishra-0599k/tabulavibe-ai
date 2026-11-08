# DESIGN.md: TabulaView.ai design system

_Version 3 ("editorial"), specified and implemented 2026-11-08. It replaces version 2 ("calm confidence":
indigo/violet gradients, glass and glows). The source of truth for tokens is `frontend/src/index.css`; components live
in `frontend/src/components/ui.tsx`; report-file colours are the constants at the top of
`backend/app/report_export.py`._

> **TabulaView.ai — Intelligent by function. Elegant by design.**

## 1. Brand colours (locked)

These three colours are the official brand colours. No substitutions, no extra brand hues.

| Token | Hex | Share of the screen | Application |
|---|---|---|---|
| **Cream** | `#F3EEE3` | ~60% | Main canvas, backgrounds |
| **Ink Black** | `#111111` | ~30% | Sidebar, typography, structure |
| **Burnt Orange** | `#D9541E` | ~10% | Primary CTA, active states, highlights |

The 60 / 30 / 10 split is a budget. Before shipping a screen, check by eye that orange is the smallest of the three.
If orange reads as a background, there is too much of it.

## 2. Design rules

1. **No purple, blue, neon or gradients.** This covers backgrounds, borders, text, icons, shadows, charts, report
   files and the logo. Every `linear-gradient` / `radial-gradient` from v2 is removed.
2. **Flat surfaces, subtle borders, natural shadows.** Depth comes from a 1 px warm hairline and, where needed, a
   low, soft, warm-tinted shadow. No glass, no backdrop blur, no glows.
3. **Orange is used strategically, never as a dominant background.** It marks the primary action, the current
   state and the one thing to look at. It is never used for a page, a section or a large card.
4. **Ink-black typography on cream surfaces.** Body text is never orange, grey-on-grey or white-on-cream.
5. **Refined editorial aesthetic with enterprise-grade usability.** The look borrows from print: a serif display
   face, generous whitespace, hairline rules, strong hierarchy. Usability stays enterprise-grade: dense tables,
   keyboard access, clear states and AA contrast are kept in full.

The v2 principles still apply in this palette: clarity before decoration, trust is visible (every figure shows how
it was calculated), guide don't gate, accessible by default.

## 3. Colour tokens

All colours stay CSS custom properties on `:root`, mapped to Tailwind with `@theme inline`. **Token names are kept
from v2** (`--page`, `--surface`, `--ink`, `--accent`, …) so components change by value, not by class name.

### 3.1 Light theme (default)

| Token | Value | Use | Contrast on Cream |
|---|---|---|---|
| `--page` | `#F3EEE3` Cream | App background (flat; no glows) | — |
| `--surface` | `#FBF8F2` | Cards, panels, table bodies (a lighter paper) | — |
| `--surface-2` | `#ECE5D7` | Table headers, inset areas, hover rows | — |
| `--surface-3` | `#E2D9C7` | Tracks (rings, meters, switches), skeletons | — |
| `--ink` | `#111111` Ink Black | Primary text, headings, icons | 16.3:1 |
| `--ink-2` | `#3A3631` | Secondary text | 10.4:1 |
| `--ink-muted` | `#6B645A` | Captions, axis labels, hints | 5.1:1 (4.7:1 on `--surface-2`) |
| `--line` | `#DDD5C5` | Hairlines, card borders, table rules | — |
| `--line-strong` | `#C7BDA9` | Control borders (inputs, selects, secondary buttons) | — |
| `--accent` | `#D9541E` Burnt Orange | Primary button fill, active indicator, focus ring, highlight mark | 3.5:1 (non-text only) |
| `--accent-hover` | `#C2481A` | Primary button hover / pressed | — |
| `--accent-text` | `#A8400F` | Orange **text**: links, active tab label, "Now:" label | 5.3:1 |
| `--accent-soft` | `#F7E1D4` | Selected chip, user chat bubble, active row tint (small areas only) | — |
| `--accent-ink` | `#111111` | Text and icons on an orange fill | 4.7:1 on `#D9541E` |
| `--good` / `--good-soft` | `#2F6B3A` / `#E3EBDD` | Success, healthy, "Numbers checked" | 5.5:1 |
| `--warn` / `--warn-soft` | `#8A5A00` / `#F4E7C8` | Warnings, excluded values | 5.1:1 |
| `--bad` / `--bad-soft` | `#A1271E` / `#F5DCD6` | Errors, destructive actions | 6.4:1 |
| `--info` / `--info-soft` | `#3A3631` / `#ECE5D7` | Info alerts (neutral ink, **not blue**) | 10.4:1 |

**Sidebar (Ink Black):**

| Token | Value | Use |
|---|---|---|
| `--rail` | `#111111` | Sidebar background |
| `--rail-ink` | `#F3EEE3` | Sidebar text and icons (16.3:1) |
| `--rail-muted` | `#A39C90` | Section labels, inactive items (6.9:1) |
| `--rail-line` | `#2A2825` | Dividers inside the sidebar |
| `--rail-active` | `#D9541E` | 3 px left bar on the active item (4.7:1 against ink) |

### 3.2 Contrast rules (measured, WCAG 2.2)

- **Never put white or cream text on Burnt Orange.** White is 4.0:1 and cream 3.5:1, both below AA for normal text.
  Primary buttons use **Ink Black labels on orange** (4.7:1).
- **Never use `#D9541E` for body or small text on cream** (3.5:1). Use `--accent-text` `#A8400F` (5.3:1).
- `#D9541E` on cream is fine for non-text marks: focus rings, active bars, chart highlights, icons next to a text
  label (≥ 3:1).
- Warning (`--warn`, ochre) and brand orange must not be confused. Warnings always carry the `TriangleAlert` icon and
  a text label. Never use orange alone to mean "warning".

### 3.3 Dark theme ("Ink")

Dark mode is kept (Light / System / Dark toggle, `html[data-theme]`, both blocks in sync). It inverts the 60/30
split: ink canvas, cream type. Orange keeps its role.

| Token | Value | Notes |
|---|---|---|
| `--page` | `#111111` | |
| `--surface` / `-2` / `-3` | `#1C1B19` / `#252320` / `#302D29` | Warm, never blue-black |
| `--ink` / `--ink-2` / `--ink-muted` | `#F3EEE3` / `#D6CFC2` / `#A8A196` | 14.9 / — / 6.7:1 on surface |
| `--line` / `--line-strong` | `#2E2B27` / `#433F39` | |
| `--accent` / `--accent-text` | `#D9541E` / `#E8662F` | Accent text 5.2:1 on surface |
| `--accent-ink` | `#111111` | Same as light |
| `--good` / `--warn` / `--bad` | `#6FB07A` / `#E0A93A` / `#E8776C` | 6.7 / 8.1 / 6.0:1 |
| `--rail` | `#0A0A0A` | A step darker than the page so the sidebar still reads as structure |

### 3.4 Chart colours

Charts follow the same discipline as the UI: **ink for data, orange for the point of interest, warm neutrals for
everything else.**

| Chart | Colouring |
|---|---|
| Bars (comparison) | All bars `--chart-base` `#3A3631` (dark: `#D6CFC2`). The highest value, or the group the user selected, is `#D9541E`. |
| Trend (line/area) | Line `--ink`, 2 px. Area fill is a **flat** 8% ink tint (no gradient wash). The latest point is an orange dot. |
| Donut (share, 2–8 groups) | Categorical palette below, in order. Orange is not in it: the largest slice is not highlighted by colour. |
| Gridlines / axes | `--line` / `--ink-muted` |

**Categorical palette (`--series-1` … `--series-8`, warm, no blue or purple):**

| Theme | Colours, in order |
|---|---|
| Light | `#111111` ink · `#A8471F` rust · `#5A2814` umber · `#B8862B` ochre · `#34503F` pine · `#8FA477` sage · `#7D6D5C` taupe · `#C4A35A` straw |
| Dark | `#F3EEE3` cream · `#C2552C` rust · `#8E3A1E` umber · `#D9B25A` ochre · `#8FBF98` sage · `#A5856C` clay · `#6F5A48` taupe · `#F0D9A0` straw |

Chosen on 2026-11-08 by exhaustive search over a hand-picked earth-tone pool. Every pair stays apart under normal
vision and simulated protanopia, deuteranopia and tritanopia (Machado 2009), with a minimum ΔE76 of **13.9 in light
and 14.8 in dark**. Every colour is at least **2.27:1** against the card surface. A first hand-picked draft failed
(rust/olive ΔE 6.6 for protanopes; taupe/pine 2.9 in dark), so re-run the check before changing any value. The donut
legend still lists every group with its percentage, so colour is never the only key. Series colours are for marks
only; text always uses ink tokens.

## 4. Typography

The editorial feel comes mostly from type: a serif for display, a precise sans for interface and numbers.

| Role | Style |
|---|---|
| Display face | **Fraunces Variable**, self-hosted via `@fontsource-variable/fraunces` (upright and `wght-italic`), never requested from Google Fonts. Tailwind class `font-serif`. Used for H1, `SectionHeading`, report section titles, finding numbers and the logotype. |
| Interface face | **Inter Variable** (kept). Body, labels, buttons, tables, all numbers. |
| Hero H1 | Serif, `text-4xl sm:text-5xl`, weight 500, `tracking-tight`, `text-balance`, ink |
| Section H2 | Serif, `text-2xl`, weight 500 |
| Card title | Inter `text-base font-semibold` (serif only on landing and report pages) |
| Eyebrow | Inter `text-xs font-medium uppercase tracking-[0.12em] text-ink-muted`, optionally preceded by a 16 px orange rule |
| KPI value | Inter `text-2xl sm:text-3xl font-semibold tabular`, ink. Never orange. |
| Body | Inter `text-sm` (14 px), `text-ink-2`, line-height 1.6 |
| Captions / hints | `text-xs text-ink-muted` |
| Numbers in tables | `.tabular`, right-aligned |

The v2 gradient text ("AI" in the brand name, the hero keyword) is removed. Emphasis in a headline is the serif
italic, or a single word underlined with a 3 px orange rule, at most once per screen.

## 5. Shape, depth and spacing

- **Radius** (tighter than v2, which reads more editorial):
  - controls `rounded-lg` (8 px)
  - cards `rounded-xl` (12 px)
  - hero and report surfaces `rounded-2xl` (16 px)
  - badges and chips `rounded-full`
- **Borders:** every card has a 1 px `--line` border. Borders, not shadows, separate things.
- **Shadows** (natural: warm, low, soft; never coloured):
  - `shadow-soft`: `0 1px 2px rgb(17 17 17 / 0.05)`, resting controls
  - `shadow-card`: `0 1px 2px rgb(17 17 17 / 0.04), 0 4px 12px rgb(17 17 17 / 0.04)`, cards (optional; border alone is fine)
  - `shadow-float`: `0 8px 24px rgb(17 17 17 / 0.10)`, popovers, tooltips, dialogs only
  - No glow on primary buttons.
- **Highlight (replaces `.gradient-border`):** the one most important card in a view gets a **3 px orange top rule**
  (or left rule in lists) on its normal border. Same rule as v2: one per view (upload zone, data health, lead KPI,
  top finding).
- **Spacing:** cards `p-5 sm:p-6`; section gaps `gap-6`; page padding `px-4 sm:px-6`; content max width `max-w-7xl`.
  Prefer more whitespace than v2. Editorial pages breathe.

## 6. Layout

### 6.1 App shell (changes from v2)

The v2 floating glass header pill is replaced by an **Ink Black sidebar** (the 30% structure colour).

| Width | Shell |
|---|---|
| `lg` and up | Fixed left sidebar, 248 px (`lg:w-62`), `--rail`, on every screen including the landing page. Top: logo mark and "TabulaView.ai" logotype, tagline. Then **Current file** (name, rows) and **New file**; **Sign in** / **Sign up** or **My reports** + account chip. Bottom, above a hairline: GitHub badge and theme toggle. Content is offset with `lg:pl-62`. |
| Below `lg` | Sticky flat ink top bar (56 px) holding the same controls in a row. Below 430 px, "New file" / "Sign in" are icon-only (text kept for screen readers), as in v2. |
| Content | Cream page, cards on `--surface`, `max-w-7xl`. |

**One header element serves both layouts** (CSS switches it from top bar to sidebar), so every accessible name
exists once. The workflow steps and AI report tabs stay in the content area as the stepper and `TabBar`; they are
not repeated in the sidebar, because duplicate names would break tests and screen-reader navigation. There is no
drawer and no collapsed icon rail (not needed: the bar fits every phone width from 320 px).

### 6.2 Screens

Screen structure and flow from v2 stay the same (landing → choose analyst → Manual stepper or AI timeline →
report). Only the styling changes:

| Screen | v3 styling |
|---|---|
| Landing | Serif headline left, upload zone below it (the view's highlight card: dashed `--line-strong` border, orange top rule, orange "Choose file" button). Example dashboard preview right, rendered in the v3 chart style (ink bars, one orange bar). No background glows. |
| Choose analyst | Two equal cards, cream surface, 1 px border. Hover: border `--ink`. The LLM badge uses `--good` when a model is configured, neutral otherwise. |
| Stepper (Manual) | Numbered steps on a single hairline. Active: ink number in an orange circle, ink label. Done: `--good` tick. Locked: 45% opacity. The progress bar is a 2 px ink line, orange for the current segment. |
| Live timeline | "Now: Phase N" in `--accent-text`. The current phase row gets the `--accent-soft` tint. The activity feed is plain rows divided by hairlines. |
| Report overview | Reads like a printed brief: serif section headings, eyebrow labels, numbered findings ("01", "02", "03" in serif), hairline rules between them. The top finding gets the orange rule. |
| Ask AI | User bubble `--accent-soft` with ink text; answer on `--surface-2`. "Numbers checked" badge in `--good`. |
| Tables | `--surface-2` header with ink semibold labels, hairline row rules, `--surface-2` hover, no zebra striping. |

**Stepper, phone layout and accessible names:** the v2 rules carry over unchanged:
- Steps are `role="tab"` buttons named "1. Preview" … "4. Report & export", with `aria-current="step"`.
- Every screen fits 320, 360 and 412 px phones: `grid-cols-[minmax(0,1fr)]`, `min-w-0` on cards, and tables
  scrolling inside their card.
- Verify that `window.innerWidth` equals the device width on every screen.

## 6a. Report files (PDF and PowerPoint)

| Element | PowerPoint (16:9) | PDF (A4) |
|---|---|---|
| Cover | **Flat Ink Black** background, "TABULAVIEW.AI" eyebrow in cream, bold title in cream, a 0.6" orange rule, meta line in `#A39C90`. No gradient. | Subtitle in `#A8400F`, 22 pt ink title, meta line, 2 pt orange rule |
| Section | Cream slide background, 0.6" × 0.08" orange rule top left (not full width), 26 pt ink title, muted footer | 14 pt heading kept with the next block |
| KPIs | `#FBF8F2` cards with a 1 px `#DDD5C5` border, 3 per row; value in ink | 3-column grid, same colours |
| Charts | Native editable charts: bars `#3A3631` with the largest group `#D9541E`, ink trend line, warm categorical palette for doughnuts | Vector charts, same colours |
| Insights | Confidence badge colours from `--good` / `--warn` / `--bad` | 3 pt left rule in the confidence colour |
| Fonts | Theme font (unchanged) | **DejaVu Sans** everywhere (₹, →, η, ρ). No serif is embedded yet: it would add a font file and Unicode coverage checks |
| Colours | Cream `#F3EEE3`, ink `#111111` / `#3A3631`, muted `#6B645A`, orange `#D9541E` (marks) / `#A8400F` (text) | Same |

## 7. Components (`ui.tsx`)

| Component | v3 spec |
|---|---|
| `Button` `primary` | Orange `#D9541E` fill, **ink** label and icon, no glow, no gradient. Hover `--accent-hover`. One per view where possible. |
| `Button` `secondary` | `--surface` fill, 1 px `--line-strong` border, ink label. Hover border `--ink`. |
| `Button` `ghost` | No fill, ink label; hover `--surface-2`. |
| `Button` `soft` | `--surface-2` fill, ink label (no longer accent-tinted). |
| `Button` (on sidebar) | Cream outline on ink for secondary actions in the rail. |
| `Card` | `--surface`, 1 px `--line`, `rounded-xl`; `highlight` = 3 px orange top rule (replaces gradient border). |
| `IconChip` | Square `--surface-2` tile with an ink icon. The `brand` tone becomes an ink tile with a cream icon (no gradient). `accent` = `--accent-soft` with `--accent-text` icon. |
| `Alert` | `--*-soft` fill, 1 px border in the tone, icon plus text. `info` is neutral ink, not blue. |
| `Badge` | `rounded-full`, `--surface-2` fill, ink text; tone variants use the soft/strong pairs. |
| `ProgressRing` / `Meter` | Track `--surface-3`; ≥ 95 `--good`, ≥ 80 **ink**, otherwise `--warn`. Orange is not used for gauge values. |
| `Toggle` | Native checkbox styled as a switch: off `--surface-3`, on **ink** track with a cream knob. |
| `SegmentedControl` / `TabBar` | Selected = ink text with a 2 px orange underline (tabs) or `--surface` pill with a hairline border (segments). |
| `KpiTile` | Ink value, muted label; `lead` = orange top rule. |
| `Eyebrow` | Uppercase muted label, optional 16 px orange rule before it. |
| Logo mark | Ink square (cream square in dark mode, or on the sidebar) holding the bar-chart glyph, with **the tallest bar in orange**. Logotype "TabulaView" in serif + ".ai" in Inter, both ink (cream on the sidebar). |

Icons stay **lucide-react**, 1.5 px stroke (`strokeWidth={1.75}` for 16 px), ink by default. Column-type icons
are unchanged.

## 8. Data visualisation rules

The v2 rules stay: one measure per chart, no dual axes, no smoothing, top-20 bars sorted, donut only when the server
allows it, tooltips with rank, `role="img"` with an `aria-label`, a table one click away, chart animations off.

What changes:
- Colours per section 3.4 (ink data, one orange highlight, warm neutrals).
- The trend area fill is flat, with no 22% → 0% gradient.
- Tooltips are solid `--surface` with a 1 px border and `shadow-float`, no frosted glass.
- Bars are square-ended or 2 px rounded (not 6 px), max 20 px thick, which reads more editorial.

## 9. Motion

Kept minimal: `.animate-rise` for section entrance (fade + 6 px, 300 ms), button press `scale(0.98)`, skeleton
shimmer in `--surface-3`, gauge stroke 800 ms. **No hover lift on cards**; hover changes the border colour instead.
`prefers-reduced-motion: reduce` still collapses all motion.

## 10. Content and voice

- Voice stays plain, specific and reassuring: "Nothing has been changed in your data", "Files are never stored".
- The editorial layer: eyebrows name the section ("DATA QUALITY"), serif headlines state the finding in a sentence,
  and body text explains it. Example: eyebrow "TOP FINDING", headline "Revenue in the South fell 18% in Q3".
- Every step keeps a **"Next: …" primary button** (bottom right).
- Empty states: an ink icon tile, one sentence and the next action. No gradient tile.

## 11. Accessibility checklist

- [x] Text contrast ≥ 4.5:1 in both themes (values in section 3 are measured; re-check any new pair)
- [x] No white or cream text on `#D9541E` (primary buttons, active step and avatar use ink)
- [x] Focus ring: 2 px `#D9541E` outline, 2 px offset (3.5:1 on cream, 4.7:1 on ink)
- [x] Status = icon + text, never colour alone (especially warning vs. brand orange)
- [x] Charts: legend with values plus a table view; categorical palette CVD-validated (section 3.4)
- [x] Sidebar: a single `<header>`, no duplicated controls or names between phone and desktop layouts
- [x] All v2 items stay: labelled inputs, native checkboxes, table captions and `scope`, reduced motion, 320–412 px phones (E2E, desktop + Pixel 7, light + dark)

## 12. Do / don't

| Do | Don't |
|---|---|
| Cream page, light-paper cards, hairline borders | Gradients, glows, glass, blur |
| One orange primary button per view | Orange cards, orange sections, orange page headers |
| Orange for the active state and the one highlighted data point | Orange body text on cream (`#D9541E` is 3.5:1) |
| Ink labels on orange buttons | White or cream labels on orange |
| Serif headlines, sans interface | Serif in tables, buttons or numbers |
| Warm neutrals and earth tones in charts | Blue, purple, teal-blue or neon anywhere |

## 13. Migration record (v2 → v3, done 2026-11-08)

Kept as the checklist for any future redesign.

1. **Tokens:** rewrite `frontend/src/index.css` with the values in section 3 (light, dark media query and
   `[data-theme='dark']`, kept in sync). Remove `--accent-2`, `--glass`, `--glow-*`, the body radial gradients, the
   `brand-gradient` / `text-gradient` utilities and `.gradient-border` (replaced by a `.highlight-rule` utility).
   Add `--accent-hover`, `--rail-*`, `--chart-base`, `--brand-tile`, `--switch-on`, `--knob`, the serif font
   variable. (`--accent-ink` already existed and now holds Ink Black, so it plays the role of `--on-accent`.)
   `brand-gradient` became `brand-solid`, `brand-text` became `.brand-em`, `.gradient-border` became `.highlight-rule`,
   and the skeleton shimmer became a flat pulse.
2. **Fonts:** add the serif package from `@fontsource-variable` (self-hosted, no Google Fonts request).
3. **Components:** update `ui.tsx` variants per section 7. Keep component names and props so screens need few edits.
4. **Shell:** replace the header pill with the ink sidebar (lg) and ink top bar (phones). Keep every
   existing accessible name ("New file", "Sign in", tab and step names) because tests depend on them.
5. **Charts:** `Charts.tsx` and `AgentCharts.tsx` use the section 3.4 colouring; the palette passed the CVD check.
6. **Report files:** backend PDF (ReportLab) and PowerPoint colours and cover per section 6a.
7. **Name:** the brand is **TabulaView.ai** in the visible UI, page `<title>`, favicon, report covers and footers.
   Still "TabulaVibe" (separate rename task): code identifiers, the repo and Vercel project names, `TABULAVIBE_*` env
   vars, the `tabulavibe-theme` storage key, the API title, the README and the AI analyst's system prompt.
8. **Verify:** `npm run typecheck && npm run lint && npm test && npm run test:e2e`. Review the E2E light/dark,
   desktop/mobile screenshots in `frontend/test-results/` against the 60/30/10 budget and the do/don't table. Then
   update `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md` and `MEMORY.md`.
