# AI analyst: the analytics workflow (phases 0–8)

The **AI analyst** (step 5 in the app, `POST /api/agent/run`) runs the owner's analytics workflow on an
uploaded file and delivers a validated dashboard of what it found. The workflow text is the agent's
instructions, kept word for word in
[`backend/app/agent/workflow_prompt.md`](../backend/app/agent/workflow_prompt.md).

## Who does what

| | Python (always) | Analyst (Gemini, or the rules-based fallback) |
|---|---|---|
| Phase 0 | Collects the optional business-context form | Writes the charter; states assumptions where context is missing |
| Phase 1 | Profiles the file: types, grain, keys, missingness, duplicates, gaps | — |
| Phase 2 | Checks every question uses real columns | Writes the question and hypothesis registers |
| Phase 3 | Non-destructive cleaning log and one definition per KPI | — |
| Phase 4 | Runs every statistic (13 tools) and records it as evidence E1, E2… | Chooses which tools to run for which question |
| Phase 5 | Independent recalculation, Holm correction, grounding check | Words the findings (insight register) |
| Phases 6–8 | Dashboard, quality checks, handover document | — |

**The analyst never computes a number.** Every figure in a finding must appear in the evidence it cites
(or in the phase-5 validation of that evidence). Findings that fail this check are sent back to the AI once
for correction; any that still fail are flagged "unverified" and kept out of the overview.

## Phase gates (enforced in code)

| Phase | Exit check |
|---|---|
| 0 Business understanding | Context documented; scope and success criteria stated (assumptions flagged) |
| 1 Data understanding | Rows profiled, grain stated, quality risks listed, something analysable |
| 2 Problem discovery | Questions registered; answerable with this file; hypotheses explicit |
| 3 Preparation | Raw data preserved; cleaning decisions logged; one definition per KPI |
| 4 EDA | Every high-priority question has evidence; within the time budget |
| 5 Validation | Totals reconcile; Holm correction applied; every finding cites evidence; every number grounded |
| 6 Dashboard | Built only from validated results |
| 7 Quality checks | Reconciliation and grounding reported |
| 8 Handover | Markdown handover generated; the report downloads as PDF or PowerPoint |

The Gemini analyst also faces gates inside the conversation: analysis tools are refused before a plan is
registered, the investigation cannot finish while a high-priority question lacks evidence, and only
`submit_findings` is accepted in phase 5.

## Tools (phase 4), all in `backend/app/agent/tools.py`

| Tool | Method |
|---|---|
| `describe_column` | Count, mean, median, SD, variance, quartiles, IQR, P5/P95, skewness, excess kurtosis, 1.5×IQR outliers, histogram; or frequencies, mode, imbalance |
| `kpi` | The app's authoritative metric engine (`analysis.run_analysis`) |
| `compare_groups` | Welch's t-test (2 groups, 95% CI, Hedges' g, Mann–Whitney check) or one-way ANOVA + Alexander–Govern + Kruskal–Wallis (η², ω²) |
| `correlate` | Pearson and Spearman with p-values |
| `crosstab` | Chi-square test of independence, Cramér's V, expected-count warning |
| `trend` | Periods, partial and missing periods, linear trend, period-over-period, year-over-year, month-of-year |
| `segment_contribution` | Shares, top-3 share, HHI |
| `two_way_breakdown` | Aggregation by two dimensions |
| `correlation_matrix`, `pca`, `regression` | Multivariate (only when justified) |
| `verify_total` | Independent numpy recalculation, with and without duplicates (phase 5) |

Statistics are in `backend/app/agent/stats.py`, tested against hand-computed values
(`tests/test_agent_stats.py`).

## Data sent to Gemini

Column names, the phase-1 profile, tool results (aggregates and statistics) and category labels.
**Never raw rows**, never values of free-text or identifier columns, and never invalid example values.
On Gemini's free tier Google may use prompts to improve its products. The page states what is shared.

## Without AI

With `TABULAVIBE_AI_PROVIDER=none` (the default), or if Gemini fails mid-run (quota, timeout, step
budget), the **rules-based analyst** completes the same phases with documented, deterministic rules:
primary KPI from the context or column names, well-filled dimensions with 3–12 values first, additive
measures summed and prices, rates, percentages and scores averaged, and confidence from Holm-adjusted p-values plus
effect sizes. The report says which analyst ran and why.

## Limits

| Setting | Default | Why |
|---|---|---|
| `TABULAVIBE_AGENT_MAX_STEPS` | 24 | Gemini requests per run |
| `TABULAVIBE_AGENT_DEADLINE_SECONDS` | 200 | Stays inside Vercel's 300 s function limit |
| `TABULAVIBE_AGENT_RUNS_PER_MINUTE` | 4 | Per user (or IP) |

## Relation to the owner's workflow text

- **Stack:** the workflow suggests Streamlit and Plotly. The product keeps its React dashboard, so the
  analyst's output lives in the same app, with the same metric engine behind "Explore in Analyse".
- **Interactivity (6.4):** the analyst's dashboard is a validated snapshot with functional selectors
  (variable, analysis, correlation method, finding kind). Filters, date ranges, sorting and exports run
  in the Analyse step through "Explore in Analyse", on the same validated metric engine.
- **Phase 7:** for a single analysis this becomes the per-run quality checks. The product's own tests and
  deployment are documented in `PROJECT_STATUS.md` and `DEPLOYMENT_VERCEL.md`.
- **Machine learning / causal inference:** not used (rule 17). PCA and regression are descriptive and run
  only when justified.
