# AI analyst: the analytics workflow (phases 0–8)

The **AI analyst** (step 5 in the app, `POST /api/agent/run`) runs the owner's analytics workflow on an
uploaded file and delivers a validated dashboard of what it found. The workflow text is the agent's
instructions, kept word for word in
[`backend/app/agent/workflow_prompt.md`](../backend/app/agent/workflow_prompt.md).

## Who does what

| | Python (always) | Analyst (LLM via Groq → NVIDIA, or the rules-based fallback) |
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

The AI analyst also faces gates inside the conversation: analysis tools are refused before a plan is
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

## AI providers: Groq first, then NVIDIA

`TABULAVIBE_AI_PROVIDER=groq,nvidia` sets the order. Both speak OpenAI-compatible chat completions with tool
calling (`https://api.groq.com/openai/v1/chat/completions`, `https://integrate.api.nvidia.com/v1/chat/completions`;
fixed in code). Keys: `TABULAVIBE_GROQ_API_KEY`, `TABULAVIBE_NVIDIA_API_KEY`; models: `TABULAVIBE_GROQ_MODEL`
(default `openai/gpt-oss-120b`), `TABULAVIBE_NVIDIA_MODEL` (default `nvidia/nemotron-3.5-lightning-30b-a3b`).

If Groq fails at any step (rate limit, request larger than the plan allows, error), **the same conversation
continues on NVIDIA**: nothing is repeated, and the report lists the switch. Requests estimated above
`TABULAVIBE_GROQ_TOKENS_PER_MINUTE` (8,000 on the free plan) skip Groq without a request; when Groq answers
"retry in N seconds" (up to 20 s) the app waits instead. Each reply may take up to
`TABULAVIBE_AGENT_REQUEST_TIMEOUT_SECONDS` (90 s).

Measured on the free plans (2026-10-23): an analyst request is about 7,600 tokens, so the analyst runs on NVIDIA
(`nvidia/nemotron-3.5-lightning-30b-a3b`, about 30 s per reply); Ask AI requests are about 2,900 tokens and run on
Groq in seconds. Open models sometimes send nested arguments as JSON text or call a tool with arguments the
engine rejects: arguments are decoded, and any per-call failure is returned to the model to correct. If time runs
out while the model corrects its findings, its last submission is kept with unmatched figures flagged. Groq's free plan allows fewer
tokens a minute than one analyst request (the workflow text alone is about 9,000 tokens), so on that plan runs
normally switch at the first request. Only if every provider fails does the rules-based analyst take over.

Each request offers only the functions the current stage allows. Open models sometimes write a call as JSON
text, or send arguments that are not valid JSON: the first is accepted, the second is sent back to the model.

## Evaluation: the best analysis builds the dashboard

After an AI run, the rules-based analyst also runs on the same file. Python scores both (0–100):

| Criterion | Weight |
|---|---|
| Findings whose numbers match their evidence | 30 |
| High-priority questions answered | 25 |
| Phase gates passed | 20 |
| Totals reconcile with an independent recalculation | 15 |
| Hypotheses resolved (supported or not supported) | 10 |

The higher score builds the dashboard (a tie goes to the AI). The scorecard is on the "Plan & method" page,
in the handover and in the PDF/PowerPoint report.

## Forecast: NVIDIA Kumo Relational

With `TABULAVIBE_FORECAST_PROVIDER=kumo` and an NVIDIA key, the winning analysis's primary measure is forecast
(`POST https://ai.api.nvidia.com/v1/structured-data/nvidia/kumo-relational/predictions`):

- Python builds the history with the trend tool: the coarsest grain (month, week, day) with at least 8 complete
  periods, most of them with data. Without a date column or enough history, the forecast is skipped with a reason.
- Each future period k is a Kumo **regression**: at every past period start, the target is the value k periods
  later, with up to 52 earlier period totals as context (the hosted API's documented multi-table shape).
- Horizon: up to 6 periods (a quarter of the history). A **backtest** predicts the last 3 known periods and
  compares the mean absolute error with "same as last period"; the page says which was more accurate.
- Only period totals of one measure are sent. NVIDIA's API trial terms allow it to record inputs.
- A forecast failure never affects the analysis; the report states why there is no forecast.

## Ask AI: questions about the report

The first tab of the report is a chat (`POST /api/agent/chat`, `app/agent/chat.py`). The browser sends the file,
the report **without evidence results**, the conversation (last 12 messages) and the calculations made by earlier
answers. The server is stateless and trusts no number from the browser:

- The model sees a summary of the report (findings, KPIs, plan, data dictionary, forecast, scorecard) and an
  evidence index (id, tool, arguments). `get_evidence` **recomputes** an item from the file with the same tool and
  arguments; new questions use the same analysis tools (new evidence ids C1, C2…, continuing across follow-ups).
- `answer` is checked like a finding: every number must appear in the cited evidence (FORECAST and EVALUATION are
  the report's own values). The model gets one chance to correct; anything still unmatched is shown as
  "Unverified". Answers without numbers need no evidence (e.g. "this file cannot answer that").
- Charts are built by Python from evidence results (trend → line, shares → bar or pie, group averages, category
  counts, histograms, FORECAST); the model only chooses the evidence and the kind. A pie with more than 8 parts or
  negative values becomes a bar chart; lines are only for time series.
- Groq answers first and NVIDIA continues if Groq cannot; without AI the tab explains that it is switched off.

## Data sent to the AI providers

Column names, the phase-1 profile, tool results (aggregates and statistics) and category labels.
**Never raw rows**, never values of free-text or identifier columns, and never invalid example values.
The page states what is shared.

## Without AI

With `TABULAVIBE_AI_PROVIDER=none` (the default), or if the AI provider fails mid-run (rate limit, timeout, step
budget), the **rules-based analyst** completes the same phases with documented, deterministic rules:
primary KPI from the context or column names, well-filled dimensions with 3–12 values first, additive
measures summed and prices, rates, percentages and scores averaged, and confidence from Holm-adjusted p-values plus
effect sizes. The report says which analyst ran and why.

## Limits

| Setting | Default | Why |
|---|---|---|
| `TABULAVIBE_AGENT_MAX_STEPS` | 24 | AI requests per run |
| `TABULAVIBE_AGENT_DEADLINE_SECONDS` | 200 | Stays inside Vercel's 300 s function limit |
| `TABULAVIBE_AGENT_RUNS_PER_MINUTE` | 4 | Per user (or IP) |
| `TABULAVIBE_CHAT_QUESTIONS_PER_MINUTE` | 8 | Ask AI questions per user (or IP) |

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
