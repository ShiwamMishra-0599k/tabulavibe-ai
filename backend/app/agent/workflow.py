"""The analytics workflow (phases 0-8) with phase gates, shared by the rules-based and the AI analyst.

Division of labour, in line with the project rule "Python computes every number":

* Python always does the computation: profiling (phase 1), the cleaning plan and metric definitions
  (phase 3), every statistic (phase 4 tools), and validation (phase 5: independent recomputation,
  Holm correction, grounding of every number in a finding against the evidence it cites).
* The analyst (rules or AI) decides what to investigate and how to describe it: the charter
  (phase 0), the question and hypothesis registers (phase 2), which tools to call (phase 4) and the
  wording of findings (phase 5).

The full workflow the analyst follows is in workflow_prompt.md (the owner's specification).
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from .. import __version__
from ..ai import PROVIDER_LABELS
from ..profiling import Dataset
from . import stats
from .tools import Toolbox

logger = logging.getLogger("tabulavibe")
EmitFn = Callable[[dict[str, Any]], None]

PHASES = [
    (0, "Business understanding", "Purpose, audience, scope and success criteria are documented (or assumptions are stated)."),
    (1, "Data understanding", "Structure, grain, coverage and major quality risks are understood."),
    (2, "Business problem discovery", "Prioritised questions and testable hypotheses are registered."),
    (3, "Data preparation", "A non-destructive cleaning plan and one definition per KPI are recorded."),
    (4, "Exploratory analysis", "Each registered question has been investigated with evidence."),
    (5, "Validation and insights", "Findings are recalculated, corrected for multiple tests and grounded in evidence."),
    (6, "Dashboard", "KPIs, charts and insight cards come only from validated results."),
    (7, "Quality checks", "Reconciliation and grounding checks for this analysis are reported."),
    (8, "Handover", "A handover document lets another analyst review and reproduce the work."),
]

# Measures whose total is meaningless (prices, rates, shares, scores): summarised with an average instead.
NON_ADDITIVE_HINTS = (
    "price",
    "rate",
    "pct",
    "percent",
    "ratio",
    "discount",
    "score",
    "rating",
    "margin",
    "avg",
    "average",
    "mean",
    "age",
    "temperature",
    "share",
)
PRIMARY_MEASURE_HINTS = ("revenue", "sales", "amount", "profit", "value", "total", "price", "cost", "spend", "income")
SIGNIFICANCE = 0.05


class BusinessContext(BaseModel):
    """Phase 0 input from the user. Every field is optional; gaps become documented assumptions."""

    model_config = ConfigDict(extra="forbid")

    domain: str = Field("", max_length=300, description="What business process the data represents")
    audience: str = Field("", max_length=200, description="Who will use the dashboard")
    objective: str = Field("", max_length=500, description="What the analysis should help decide")
    kpis: str = Field("", max_length=300, description="KPIs that matter most, comma-separated")
    notes: str = Field("", max_length=1000, description="Anything else the analyst should know")

    def is_empty(self) -> bool:
        return not any(v.strip() for v in self.model_dump().values())


class Analyst(Protocol):
    """Decides what to investigate and how to word it. Computation stays in the Toolbox."""

    name: str
    model: str | None

    def plan(self, toolbox: Toolbox, briefing: dict[str, Any], emit: EmitFn) -> dict[str, Any]: ...

    def investigate(self, toolbox: Toolbox, plan: dict[str, Any], emit: EmitFn) -> None: ...

    def write_findings(self, toolbox: Toolbox, plan: dict[str, Any], validation: dict[str, Any], emit: EmitFn) -> list[dict[str, Any]]: ...


# ====================================================================== formatting and grounding


def fmt(value: float | None, digits: int = 2) -> str:
    """Indian digit grouping (12,34,567.89), the app's display convention."""
    if value is None:
        return "n/a"
    negative = value < 0
    text = f"{abs(value):.{digits}f}".rstrip("0").rstrip(".") if digits else f"{abs(value):.0f}"
    whole, _, frac = text.partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join([*groups, tail])
    return ("-" if negative else "") + whole + (f".{frac}" if frac else "")


def fmt_p(p: float | None) -> str:
    if p is None:
        return "n/a"
    return "< 0.0001" if p < 0.0001 else fmt(p, 4)


def p_phrase(p: float | None, label: str = "adjusted p") -> str:
    """'adjusted p = 0.0451', or 'adjusted p < 0.0001' for tiny values."""
    if p is not None and p < 0.0001:
        return f"{label} < 0.0001"
    return f"{label} = {fmt_p(p)}"


def pct(share: float | None) -> str:
    return "n/a" if share is None else f"{fmt(share * 100, 1)}%"


_DATE_LIKE = re.compile(r"\b\d{4}-(?:Q[1-4]|\d{2}(?:-\d{2})?)\b")
_THRESHOLD = re.compile(r"[<>≤≥]=?\s*\d*\.?\d+")  # "p < 0.0001" is a threshold, not a reported value
_NUMBER = re.compile(r"(?<![A-Za-z0-9_.])-?\d[\d,]*(?:\.\d+)?")


def _numbers_in(text: str) -> list[tuple[str, float]]:
    found = []
    for match in _NUMBER.finditer(_THRESHOLD.sub(" ", _DATE_LIKE.sub(" ", text or ""))):
        raw = match.group(0)
        try:
            found.append((raw, float(raw.replace(",", ""))))
        except ValueError:
            continue
    return found


def _evidence_numbers(results: list[Any]) -> list[float]:
    values: list[float] = []

    def walk(node: Any) -> None:
        if isinstance(node, bool):
            return
        if isinstance(node, int | float):
            values.append(float(node))
        elif isinstance(node, str):
            values.extend(v for _, v in _numbers_in(node))  # numbers inside Python-written notes
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for r in results:
        walk(r)
    return values


def _matches(raw: str, value: float, candidates: list[float]) -> bool:
    decimals = len(raw.split(".")[1]) if "." in raw else 0
    tolerance = 0.5 * 10**-decimals + 1e-9
    for c in candidates:
        for variant in (c, c * 100, abs(c), abs(c) * 100):
            if abs(round(variant, decimals) - value) <= tolerance or abs(variant - value) <= tolerance:
                return True
    return False


def ground_finding(finding: dict[str, Any], evidence: Any, validation: dict[str, Any] | None = None) -> dict[str, Any]:
    """Check every number in the finding's text against the evidence it cites (phase 5 rule).

    Allowed numbers: values in the cited evidence (results and arguments) and the phase-5 validation
    results for that same evidence (Holm-adjusted p-values, reconciliations).
    """
    ids = set(finding.get("evidence_ids", []))
    cited = [evidence.get(eid) for eid in ids]
    cited = [c for c in cited if c is not None]
    extra: list[Any] = []
    if validation:
        extra += [t for t in validation["multiple_testing"]["tests"] if t["evidence_id"] in ids]
        extra += [r for r in validation["reconciliation"] if r.get("evidence_id") in ids]
    candidates = _evidence_numbers([c.result for c in cited] + [c.args for c in cited] + extra)
    fields = (
        "title",
        "what_happened",
        "where",
        "magnitude",
        "baseline",
        "comparison",
        "recommended_action",
        "success_metric",
        "limitations",
    )
    unverified = []
    for field_name in fields:
        for raw, value in _numbers_in(str(finding.get(field_name) or "")):
            if abs(value) <= 10 and float(value).is_integer():
                continue  # structural counts such as "top 3"
            if 1900 <= value <= 2100 and float(value).is_integer():
                continue  # years
            if not _matches(raw, value, candidates):
                unverified.append(raw)
    finding["grounded"] = bool(cited) and not unverified
    finding["unverified_numbers"] = sorted(set(unverified))
    if not cited:
        finding["unverified_numbers"].append("(no evidence cited)")
    return finding


# ====================================================================== phase 1 and 3 (always Python)


def _meaning(info) -> str:
    kind = {
        "number": "Numeric measure",
        "date": "Date",
        "boolean": "Yes/no flag",
        "category": "Category",
        "text": "Free text",
        "empty": "Empty column",
    }[info.inferred_type]
    if info.role == "identifier":
        kind = "Identifier (key)"
    return f"{kind}: meaning inferred from the name and values; confirm with the data owner."


def data_understanding(toolbox: Toolbox, emit: EmitFn) -> dict[str, Any]:
    ds = toolbox.ds
    overview = toolbox.call("dataset_overview", {}, 1)
    ov = overview["result"]
    emit({"type": "tool", "phase": 1, "name": "dataset_overview", "evidence_id": overview["evidence_id"]})
    described = {}
    for info in ds.columns.values():
        if info.role in {"measure", "dimension", "time", "identifier"}:
            res = toolbox.call("describe_column", {"column": info.name}, 1)
            if "evidence_id" in res:
                described[info.name] = res["evidence_id"]
    emit({"type": "tool", "phase": 1, "name": "describe_column", "count": len(described)})

    keys = ov["candidate_keys"]
    unique_keys = [k["column"] for k in keys if k["is_unique"]]
    if unique_keys:
        grain, basis = f"One row per {unique_keys[0]}", f"'{unique_keys[0]}' is unique across all rows."
    elif keys:
        grain, basis = (
            f"Rows repeat '{keys[0]['column']}' values: probably one row per line item or event",
            f"'{keys[0]['column']}' has {keys[0]['unique_values']} distinct values in {ov['rows']} rows. Confirm with the data owner.",
        )
    else:
        grain, basis = (
            "One row per record or event (assumed)",
            "No identifier column was found, so the grain cannot be confirmed from the data.",
        )

    issues = []
    if ov["exact_duplicate_rows"]:
        issues.append(
            {
                "severity": "warning",
                "issue": "Exact duplicate rows",
                "detail": f"{ov['exact_duplicate_rows']} row(s) repeat an earlier row exactly. They may be errors or legitimate repeated transactions.",
                "kind": "needs_investigation",
            }
        )
    for k in keys:
        if not k["is_unique"] and k["rows_with_value"]:
            issues.append(
                {
                    "severity": "info",
                    "issue": f"Repeated key values in '{k['column']}'",
                    "detail": "The identifier repeats, so it is not a row key on its own.",
                    "kind": "needs_investigation",
                }
            )
    for c in ov["column_details"]:
        if c["missing_pct"] >= 20:
            issues.append(
                {
                    "severity": "warning",
                    "issue": f"High missingness in '{c['name']}'",
                    "detail": f"{c['missing_pct']}% of rows have no value. Check whether this is systematic before relying on it.",
                    "kind": "needs_investigation",
                }
            )
        elif c["missing"]:
            issues.append(
                {
                    "severity": "info",
                    "issue": f"Missing values in '{c['name']}'",
                    "detail": f"{c['missing']} row(s) ({c['missing_pct']}%) have no value.",
                    "kind": "data_quality",
                }
            )
        if c["invalid"]:
            issues.append(
                {
                    "severity": "warning",
                    "issue": f"Invalid values in '{c['name']}'",
                    "detail": f"{c['invalid']} value(s) do not match the column's type ({c['type']}).",
                    "kind": "data_quality",
                }
            )
    for info in ds.columns.values():
        for note in info.notes:
            if "letter case or spacing" in note:
                issues.append(
                    {"severity": "warning", "issue": f"Inconsistent labels in '{info.name}'", "detail": note, "kind": "data_quality"}
                )
    for name, rng in ov["date_ranges"].items():
        trend = toolbox.call("trend", {"date_column": name, "aggregation": "count", "grain": "month"}, 1)
        if "result" in trend and trend["result"]["missing_periods"]:
            issues.append(
                {
                    "severity": "warning",
                    "issue": f"Gaps in '{name}'",
                    "detail": f"Months with no rows: {', '.join(trend['result']['missing_periods'][:12])}. Could be an incomplete extract or a real pause.",
                    "kind": "needs_investigation",
                }
            )
        _ = rng

    limitations = ["Only the uploaded file was analysed: no other sources, joins or business documents were available."]
    if ds.source.file_type == "xlsx":
        limitations.append("Only the first worksheet was read; formulas use their last saved values.")
    dictionary = []
    for info in ds.columns.values():
        detail = next((c for c in ov["column_details"] if c["name"] == info.name), {})
        dictionary.append(
            {
                "column": info.name,
                "type": info.inferred_type,
                "role": info.role,
                "meaning": _meaning(info),
                "missing_pct": detail.get("missing_pct"),
                "unique": info.unique_count,
                "evidence_id": described.get(info.name),
                "notes": info.notes,
            }
        )
    return {
        "overview_evidence": overview["evidence_id"],
        "overview": ov,
        "grain": grain,
        "grain_basis": basis,
        "data_dictionary": dictionary,
        "quality_issues": issues,
        "limitations": limitations,
        "source_inventory": [
            {
                "source": "Uploaded file",
                "type": ds.source.file_type,
                "sheet": ds.source.sheet_name,
                "rows": ov["rows"],
                "columns": ov["columns"],
                "lineage": "Read in memory for this analysis; not stored.",
            }
        ],
    }


def preparation(toolbox: Toolbox, understanding: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    ds, ov = toolbox.ds, understanding["overview"]
    log = [
        {
            "step": "Preserve raw data",
            "decision": "The uploaded file is read in memory and never modified or stored.",
            "reason": "Rule 4: never modify the raw dataset destructively.",
            "applied": True,
        }
    ]
    if ov["exact_duplicate_rows"]:
        log.append(
            {
                "step": "Exact duplicates",
                "decision": f"Kept {ov['exact_duplicate_rows']} duplicate row(s) in the analysis; their effect on totals is measured in phase 5.",
                "reason": "Without a business rule they could be legitimate repeated transactions.",
                "applied": False,
            }
        )
    for c in ov["column_details"]:
        if c["missing"]:
            log.append(
                {
                    "step": f"Missing values in '{c['name']}'",
                    "decision": "Retained; excluded only from calculations that need the value, and counted in every KPI definition.",
                    "reason": "No evidence that the gaps can be safely imputed.",
                    "applied": True,
                }
            )
        if c["invalid"]:
            log.append(
                {
                    "step": f"Invalid values in '{c['name']}'",
                    "decision": "Kept unchanged in the data; excluded from calculations and listed in the quality report.",
                    "reason": "Rule 5: investigate before treating values as errors.",
                    "applied": True,
                }
            )
    for info in ds.columns.values():
        if any("letter case or spacing" in n for n in info.notes):
            log.append(
                {
                    "step": f"Label variants in '{info.name}'",
                    "decision": "Not merged automatically. Merging is offered as an opt-in option on the Analyse step.",
                    "reason": "Map categories only when their equivalence is confirmed.",
                    "applied": False,
                }
            )
        if info.inferred_type == "number" and any("Percent" in n or "%" in n for n in info.notes):
            log.append(
                {
                    "step": f"Units in '{info.name}'",
                    "decision": "Percent signs removed; values kept on their original scale.",
                    "reason": "Preserve meaningful precision and units.",
                    "applied": True,
                }
            )
    for item in toolbox.evidence.items:
        if item.tool == "describe_column" and item.result.get("outlier_count"):
            log.append(
                {
                    "step": f"Outliers in '{item.args['column']}'",
                    "decision": f"{item.result['outlier_count']} value(s) outside the 1.5×IQR fences are flagged and retained.",
                    "reason": "Extreme values may be legitimate; there is no evidence they are errors.",
                    "applied": False,
                }
            )
    derived = []
    for d in ov["dates"]:
        derived.append({"field": f"{d} (month)", "formula": f"Calendar month of '{d}'", "use": "Time-series analysis"})
    definitions = [{"name": "Row count", "formula": "Number of rows (after any filters)", "column": None, "aggregation": "count"}]
    for m in ov["measures"]:
        if default_aggregation(m) == "sum":
            definitions.append(
                {
                    "name": f"Total {m}",
                    "formula": f"Sum of valid '{m}' values; missing and invalid values excluded and counted",
                    "column": m,
                    "aggregation": "sum",
                }
            )
        definitions.append(
            {
                "name": f"Average {m} per row",
                "formula": f"Sum of valid '{m}' values ÷ number of valid values"
                + ("" if default_aggregation(m) == "sum" else f" (a total of '{m}' is not meaningful, so it is never reported)"),
                "column": m,
                "aggregation": "mean",
            }
        )
    if ov["dimensions"] and ov["measures"]:
        definitions.append(
            {"name": "Share of total", "formula": "Segment total ÷ total across all segments", "column": None, "aggregation": "ratio"}
        )
    if ov["dates"]:
        definitions.append(
            {
                "name": "Period-over-period change",
                "formula": "(Latest complete period − previous complete period) ÷ previous complete period; partial periods excluded",
                "column": None,
                "aggregation": "ratio",
            }
        )
    return {
        "raw_data_preserved": True,
        "cleaning_log": log,
        "derived_fields": derived,
        "metric_definitions": definitions,
        "primary_measure": plan.get("primary_measure"),
    }


# ====================================================================== phase 5 (always Python)


def _test_p_values(toolbox: Toolbox) -> list[tuple[str, float]]:
    out = []
    for item in toolbox.evidence.items:
        r = item.result
        if item.tool in {"compare_groups", "crosstab"} and r.get("test") and r["test"].get("p_value") is not None:
            out.append((item.id, r["test"]["p_value"]))
        elif item.tool == "correlate" and r.get("spearman_p") is not None:
            out.append((item.id, r["spearman_p"]))
        elif item.tool == "trend" and item.phase >= 4 and r.get("trend", {}).get("p_value") is not None:
            out.append((item.id, r["trend"]["p_value"]))
    return out


def validation_summary(toolbox: Toolbox, primary_measure: str | None) -> dict[str, Any]:
    tests = _test_p_values(toolbox)
    adjusted = stats.holm_adjust([p for _, p in tests]) if tests else []
    verified = []
    measures = [m for m in toolbox.ds.columns if toolbox.ds.columns[m].role == "measure"]
    for m in ([primary_measure] if primary_measure else []) + [m for m in measures if m != primary_measure][:3]:
        res = toolbox.call("verify_total", {"measure": m, "aggregation": default_aggregation(m)}, 5)
        if "result" in res:
            verified.append({"evidence_id": res["evidence_id"], **res["result"]})
    return {
        "multiple_testing": {
            "method": "holm",
            "alpha": SIGNIFICANCE,
            "tests": [
                {"evidence_id": e, "p_value": p, "adjusted_p_value": a, "significant": a < SIGNIFICANCE}
                for (e, p), a in zip(tests, adjusted, strict=True)
            ],
        },
        "reconciliation": verified,
        "all_reconciled": all(v["reconciled"] for v in verified) if verified else None,
    }


def spec_from_evidence(item: Any) -> dict[str, Any] | None:
    """The Analyse-step spec that reproduces a piece of evidence, so a finding can be explored further."""
    a = item.args
    if item.tool == "trend":
        measure = (
            {"column": a["measure"], "aggregation": a.get("aggregation", "sum")}
            if a.get("measure")
            else {"column": None, "aggregation": "count"}
        )
        return {"measures": [measure], "group_by": a["date_column"], "time_grain": a.get("grain", "month"), "filters": []}
    if item.tool == "segment_contribution":
        return {"measures": [{"column": a["measure"], "aggregation": "sum"}], "group_by": a["dimension"], "filters": []}
    if item.tool == "compare_groups":
        return {"measures": [{"column": a["measure"], "aggregation": "mean"}], "group_by": a["group_by"], "filters": []}
    if item.tool == "two_way_breakdown":
        return {"measures": [{"column": a["measure"], "aggregation": a.get("aggregation", "sum")}], "group_by": a["dim_a"], "filters": []}
    if item.tool == "kpi":
        return item.result.get("spec")
    return None


def adjusted_p(validation: dict[str, Any], evidence_id: str) -> float | None:
    return next((t["adjusted_p_value"] for t in validation["multiple_testing"]["tests"] if t["evidence_id"] == evidence_id), None)


# ====================================================================== rules-based analyst


def _words(name: str) -> list[str]:
    """'unitPrice', 'unit_price', 'Unit Price (INR)' -> ['unit', 'price', 'inr']."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    return [w for w in re.split(r"[^a-z0-9]+", spaced.lower()) if w]


def _has_hint(name: str, hints: tuple[str, ...]) -> bool:
    # Whole words (or a word starting with the hint, e.g. 'percentage'), so 'duration' does not match 'ratio'.
    return any(w == h or w.startswith(h) for w in _words(name) for h in hints)


def default_aggregation(measure: str) -> str:
    """'sum' for additive measures (amounts, quantities), 'mean' for prices, rates, percentages and scores."""
    return "mean" if _has_hint(measure, NON_ADDITIVE_HINTS) else "sum"


def agg_label(aggregation: str) -> str:
    return {"sum": "Total", "mean": "Average", "count": "Count of"}.get(aggregation, aggregation.title())


def pick_primary_measure(measures: list[str], context: BusinessContext) -> str | None:
    if not measures:
        return None
    wanted = [k.strip().lower() for k in context.kpis.split(",") if k.strip()]
    for w in wanted:
        for m in measures:
            if w == m.lower() or w in m.lower() or m.lower() in w:
                return m
    for hint in PRIMARY_MEASURE_HINTS:
        for m in measures:
            if _has_hint(m, (hint,)) and default_aggregation(m) == "sum":
                return m
    additive = [m for m in measures if default_aggregation(m) == "sum"]
    return (additive or measures)[0]


class RulesAnalyst:
    """Deterministic analyst: follows the workflow with fixed, documented rules. Needs no AI."""

    name = "rules"
    model = None

    def __init__(self, context: BusinessContext):
        self.context = context

    # phase 0 + 2
    def plan(self, toolbox: Toolbox, briefing: dict[str, Any], emit: EmitFn) -> dict[str, Any]:
        ov = briefing["overview"]
        ctx = self.context
        measures, dims, dates = ov["measures"], [d for d in ov["dimensions"]], ov["dates"]
        primary = pick_primary_measure(measures, ctx)
        primary_agg = default_aggregation(primary) if primary else "sum"
        assumptions = []
        if not ctx.domain.strip():
            assumptions.append(
                f"Business domain not provided: the data is treated as a general {('time-stamped ' if dates else '')}business dataset described by its columns."
            )
        if not ctx.audience.strip():
            assumptions.append("Audience not provided: the dashboard is written for a business owner or manager.")
        if not ctx.objective.strip():
            assumptions.append(
                "No specific business problem was given, so discovering problems and opportunities is itself the objective (exploratory analysis)."
            )
        if primary and not ctx.kpis.strip():
            assumptions.append(f"No KPI was named: '{primary}' is treated as the primary measure because of its name.")
        charter = {
            "business_context": ctx.domain.strip() or "Not provided (see assumptions).",
            "stakeholders": ctx.audience.strip() or "Business owner or manager (assumed).",
            "objectives": [ctx.objective.strip()]
            if ctx.objective.strip()
            else ["Understand performance and data quality, and surface evidence-backed problems and opportunities."],
            "decisions_supported": [ctx.objective.strip()]
            if ctx.objective.strip()
            else ["Where to focus attention next (segments, periods, data fixes)."],
            "in_scope": [
                "The uploaded file only",
                "Descriptive statistics and standard statistical tests",
                "A dashboard of validated KPIs and findings",
            ],
            "out_of_scope": [
                "Other data sources and joins",
                "Forecasting, machine learning and causal claims",
                "Changing the uploaded data",
            ],
            "success_criteria": [
                "Every KPI has one written definition and reconciles to an independent recalculation",
                "Every finding cites evidence and states its confidence and limitations",
            ],
            "preliminary_kpis": [f"{agg_label(primary_agg)} {primary}", "Row count"] if primary else ["Row count"],
            "assumptions": assumptions,
            "provided_by_user": not ctx.is_empty(),
            "notes": ctx.notes.strip(),
        }
        questions, hypotheses = [], []

        def q(
            question: str,
            rationale: str,
            variables: list[str],
            metrics: list[str],
            method: str,
            priority: str,
            tools: list[tuple[str, dict]],
            hypothesis: str | None,
            test: str | None,
        ):
            qid = f"Q{len(questions) + 1}"
            questions.append(
                {
                    "id": qid,
                    "question": question,
                    "rationale": rationale,
                    "variables": variables,
                    "metrics": metrics,
                    "method": method,
                    "priority": priority,
                    "limitations": "Observational data from one file: associations only.",
                    "tools": tools,
                    "evidence_ids": [],
                    "status": "not_investigated",
                }
            )
            if hypothesis:
                hypotheses.append(
                    {
                        "id": f"H{len(hypotheses) + 1}",
                        "question_id": qid,
                        "statement": hypothesis,
                        "test": test,
                        "result": "inconclusive",
                        "evidence_ids": [],
                    }
                )

        # Prefer well-filled dimensions with 3-12 values (regions, categories) over sparse columns, flags or long lists.
        def dim_rank(d: str) -> tuple[bool, bool, int]:
            info = toolbox.ds.columns[d]
            mostly_missing = info.missing_count > 0.2 * max(toolbox.ds.row_count, 1)
            return (mostly_missing, not 3 <= info.unique_count <= 12, info.unique_count)

        dim_order = sorted(dims, key=dim_rank)
        if primary and dates:
            q(
                f"How has {primary} changed over time, and is the latest complete month up or down?",
                "Trend direction is the first thing a business owner needs to know.",
                [dates[0], primary],
                [f"Total {primary} per month", "Period-over-period change"],
                "Monthly time series, linear trend test, period-over-period change (partial months excluded)",
                "high",
                [("trend", {"date_column": dates[0], "measure": primary, "aggregation": primary_agg, "grain": "month"})],
                f"Monthly {agg_label(primary_agg).lower()} {primary} has a sustained upward or downward trend.",
                "Linear trend slope (least squares), Holm-adjusted",
            )
        for d in dim_order[:2]:
            if primary and primary_agg == "sum":
                q(
                    f"Which {d} values contribute most and least to {primary}?",
                    "Concentration shows where performance and risk sit.",
                    [d, primary],
                    [f"Total {primary} by {d}", "Share of total"],
                    "Segment contribution and concentration (HHI)",
                    "high" if d == dim_order[0] else "medium",
                    [("segment_contribution", {"measure": primary, "dimension": d})],
                    f"A small number of {d} values account for most of {primary}.",
                    "Descriptive: top-3 share ≥ 60% or HHI ≥ 0.25",
                )
        for d in dim_order[:2]:
            if primary:
                q(
                    f"Does the average {primary} per row differ across {d}?",
                    "Differences in typical values point to segments worth investigating.",
                    [d, primary],
                    [f"Average {primary} per row by {d}"],
                    "Welch's t-test or one-way ANOVA with a distribution-free check and effect size",
                    "medium",
                    [("compare_groups", {"measure": primary, "group_by": d})],
                    f"Average {primary} differs between {d} groups.",
                    "Welch t-test / ANOVA, Holm-adjusted, with effect size",
                )
        others = [m for m in measures if m != primary][:3]
        for m in others:
            q(
                f"Is {primary} associated with {m}?",
                "Relationships between measures (for example discounts and revenue) suggest drivers worth testing.",
                [primary, m],
                [f"Spearman correlation of {primary} and {m}"],
                "Pearson and Spearman correlation",
                "medium",
                [("correlate", {"x": primary, "y": m})],
                f"{primary} and {m} are associated.",
                "Spearman correlation, Holm-adjusted",
            )
        if len(dim_order) >= 2:
            a, b = dim_order[0], dim_order[1]
            q(
                f"Is {a} associated with {b}?",
                "Shows whether segments overlap, which matters when comparing them.",
                [a, b],
                ["Row share by category pair"],
                "Cross-tabulation and chi-square test of independence with Cramér's V",
                "low",
                [("crosstab", {"row": a, "column": b})],
                f"{a} and {b} are not independent.",
                "Chi-square test, Holm-adjusted",
            )
        if len(measures) >= 2:
            tools = [("correlation_matrix", {})]
            if len(measures) >= 3:
                tools.append(("pca", {}))
            q(
                "Which numeric measures move together?",
                "A multivariate view avoids reading pairs in isolation.",
                measures[:12],
                ["Correlation matrix", "Explained variance"],
                "Correlation heatmap" + (" and PCA" if len(measures) >= 3 else ""),
                "low",
                tools,
                None,
                None,
            )
        if primary and len(dim_order) >= 2:
            q(
                f"How does {primary} break down by {dim_order[0]} and {dim_order[1]} together?",
                "Two-way views reveal combinations hidden by single-dimension totals.",
                [dim_order[0], dim_order[1], primary],
                [f"Total {primary} by {dim_order[0]} × {dim_order[1]}"],
                "Grouped aggregation by two dimensions",
                "low",
                [("two_way_breakdown", {"measure": primary, "dim_a": dim_order[0], "dim_b": dim_order[1]})],
                None,
                None,
            )
        emit({"type": "log", "phase": 2, "message": f"Registered {len(questions)} questions and {len(hypotheses)} hypotheses."})
        return {"charter": charter, "questions": questions[:10], "hypotheses": hypotheses, "primary_measure": primary}

    # phase 4
    def investigate(self, toolbox: Toolbox, plan: dict[str, Any], emit: EmitFn) -> None:
        for question in plan["questions"]:
            for tool, args in question.get("tools", []):
                res = toolbox.call(tool, args, 4)
                if "evidence_id" in res:
                    question["evidence_ids"].append(res["evidence_id"])
                    emit({"type": "tool", "phase": 4, "name": tool, "evidence_id": res["evidence_id"], "question_id": question["id"]})
                else:
                    emit({"type": "tool", "phase": 4, "name": tool, "error": res["error"], "question_id": question["id"]})
            question["status"] = "answered" if question["evidence_ids"] else "inconclusive"

    # phase 5 wording
    def write_findings(self, toolbox: Toolbox, plan: dict[str, Any], validation: dict[str, Any], emit: EmitFn) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        primary = plan.get("primary_measure")
        hyp_by_q = {h["question_id"]: h for h in plan["hypotheses"]}

        def add(**f):
            f["title"] = f["title"][:1].upper() + f["title"][1:]  # titles often start with a column name
            f.setdefault("possible_explanations", [])
            f.setdefault("spec", None)
            findings.append({"id": f"F{len(findings) + 1}", **f})

        for question in plan["questions"]:
            for eid in question["evidence_ids"]:
                item = toolbox.evidence.get(eid)
                r, hyp = item.result, hyp_by_q.get(question["id"])
                if hyp:
                    hyp["evidence_ids"].append(eid)
                if item.tool == "trend" and r.get("period_over_period"):
                    pop, tr = r["period_over_period"], r["trend"]
                    adj = adjusted_p(validation, eid)
                    direction = "up" if (pop["absolute_change"] or 0) >= 0 else "down"
                    significant = adj is not None and adj < SIGNIFICANCE
                    if hyp:
                        hyp["result"] = "supported" if significant else "not_supported" if adj is not None else "inconclusive"
                        hyp.update({"p_value": tr.get("p_value"), "adjusted_p_value": adj})
                    trend_text = (
                        f"Across {tr['n_periods']} complete months the trend slope is {fmt(tr['slope_per_period'])} per month ({p_phrase(adj)})."
                        if tr.get("slope_per_period") is not None
                        else "Too few complete months to test a trend."
                    )
                    add(
                        title=f"{primary} {direction} {fmt(abs(pop['percent_change'] or 0), 2)}% in {pop['current_period']} vs {pop['previous_period']}",
                        what_happened=f"{agg_label(r['aggregation'])} {primary} was {fmt(pop['current_value'])} in {pop['current_period']}, against {fmt(pop['previous_value'])} in {pop['previous_period']}. {trend_text}",
                        where="All rows",
                        magnitude=f"{fmt(pop['absolute_change'])} ({fmt(pop['percent_change'], 2)}%)",
                        baseline=f"{pop['previous_period']}: {fmt(pop['previous_value'])}",
                        comparison=f"{pop['current_period']}: {fmt(pop['current_value'])}",
                        evidence_ids=[eid],
                        possible_explanations=[
                            "Seasonality or one-off events",
                            "Changes in volume, price or mix (test separately)",
                            "An incomplete data extract (check row counts per month)",
                        ],
                        recommended_action=f"Review what changed in {pop['current_period']} before acting; confirm the month is complete.",
                        success_metric=f"Monthly {agg_label(r['aggregation']).lower()} {primary} compared with {fmt(pop['current_value'])}",
                        confidence="medium" if significant else "low",
                        limitations="One month-on-month change can be noise; partial months are excluded."
                        + (f" Partial: {', '.join(r['partial_periods'])}." if r["partial_periods"] else ""),
                        kind="observed_fact",
                        priority_score=3 if significant else 2,
                        spec={
                            "measures": [{"column": primary, "aggregation": r["aggregation"]}],
                            "group_by": r["date_column"],
                            "time_grain": "month",
                            "filters": [],
                        },
                    )
                elif item.tool == "segment_contribution" and r.get("segments"):
                    top, bottom = r["segments"][0], r["segments"][-1]
                    concentrated = (r.get("top_3_share") or 0) >= 0.6 or (r.get("hhi") or 0) >= 0.25
                    if hyp:
                        hyp["result"] = "supported" if concentrated else "not_supported"
                    add(
                        title=f"'{top['segment']}' ({r['dimension']}) contributes {pct(top['share'])} of {primary}",
                        what_happened=f"'{top['segment']}' is the largest {r['dimension']} with {fmt(top['total'])} of {fmt(r['grand_total'])} total {primary}. The smallest is '{bottom['segment']}' with {fmt(bottom['total'])}.",
                        where=f"{r['dimension']} ({r['segment_count']} values)",
                        magnitude=f"Top 3 share {pct(r.get('top_3_share'))}; HHI {fmt(r.get('hhi'), 4)}",
                        baseline=f"Total {primary}: {fmt(r['grand_total'])}",
                        comparison=f"'{top['segment']}': {fmt(top['total'])}",
                        evidence_ids=[eid],
                        possible_explanations=[
                            "Differences in volume (number of rows) or in value per row",
                            "Uneven coverage of segments in the extract",
                        ],
                        recommended_action=f"Prioritise '{top['segment']}' for monitoring; check whether '{bottom['segment']}' is a real segment or a data issue.",
                        success_metric=f"Share of {primary} by {r['dimension']}, month by month",
                        confidence="high",
                        limitations="Descriptive share of the total; does not explain why segments differ.",
                        kind="observed_fact",
                        priority_score=3,
                        spec={"measures": [{"column": primary, "aggregation": "sum"}], "group_by": r["dimension"], "filters": []},
                    )
                elif item.tool == "compare_groups" and r.get("test"):
                    t, adj = r["test"], adjusted_p(validation, eid)
                    effect = t["effect_size"]["value"]
                    significant = adj is not None and adj < SIGNIFICANCE
                    meaningful = effect is not None and (
                        (t["name"] == "one_way_anova" and effect >= 0.01) or (t["name"] == "welch_t_test" and abs(effect) >= 0.2)
                    )
                    if hyp:
                        hyp["result"] = "supported" if significant and meaningful else "not_supported"
                        hyp.update({"p_value": t["p_value"], "adjusted_p_value": adj, "effect_size": t["effect_size"]})
                    groups = sorted((g for g in r["groups"] if g["mean"] is not None), key=lambda g: -g["mean"])
                    if not groups:
                        continue
                    hi, lo = groups[0], groups[-1]
                    effect_name = "η²" if t["name"] == "one_way_anova" else "Hedges' g"
                    add(
                        title=(
                            f"Average {r['measure']} differs across {r['group_by']}"
                            if significant and meaningful
                            else f"No reliable difference in average {r['measure']} across {r['group_by']}"
                        ),
                        what_happened=f"Highest average: '{hi['group']}' at {fmt(hi['mean'])}; lowest: '{lo['group']}' at {fmt(lo['mean'])}. Test: {t['name'].replace('_', ' ')}, {p_phrase(adj)}, {effect_name} = {fmt(effect, 4)}.",
                        where=r["group_by"],
                        magnitude=f"{effect_name} = {fmt(effect, 4)}",
                        baseline=f"'{lo['group']}': {fmt(lo['mean'])}",
                        comparison=f"'{hi['group']}': {fmt(hi['mean'])}",
                        evidence_ids=[eid],
                        possible_explanations=["Different product or customer mix within groups", "Different pricing or discounting"]
                        if significant
                        else [],
                        recommended_action=(
                            f"Investigate why '{hi['group']}' and '{lo['group']}' differ."
                            if significant and meaningful
                            else f"Treat {r['group_by']} groups as similar on average {r['measure']} unless new evidence appears."
                        ),
                        success_metric=f"Average {r['measure']} per row by {r['group_by']}",
                        confidence=("high" if significant and meaningful and (adj or 1) < 0.01 else "medium" if significant else "low"),
                        limitations="Association, not cause. " + " ".join(r["notes"][:2]),
                        kind="statistical_association",
                        priority_score=2 if significant and meaningful else 0,
                        spec={"measures": [{"column": r["measure"], "aggregation": "mean"}], "group_by": r["group_by"], "filters": []},
                    )
                elif item.tool == "correlate" and r.get("spearman_rho") is not None:
                    adj = adjusted_p(validation, eid)
                    rho = r["spearman_rho"]
                    significant = adj is not None and adj < SIGNIFICANCE
                    strength = "strong" if abs(rho) >= 0.5 else "moderate" if abs(rho) >= 0.3 else "weak"
                    if hyp:
                        hyp["result"] = "supported" if significant and abs(rho) >= 0.1 else "not_supported"
                        hyp.update(
                            {"p_value": r["spearman_p"], "adjusted_p_value": adj, "effect_size": {"name": "spearman_rho", "value": rho}}
                        )
                    if not significant and abs(rho) < 0.3:
                        continue
                    add(
                        title=f"{strength.capitalize()} {'positive' if rho > 0 else 'negative'} association between {r['x']} and {r['y']}",
                        what_happened=f"Spearman ρ = {fmt(rho, 4)} (Pearson r = {fmt(r['pearson_r'], 4)}) over {fmt(r['n'], 0)} rows; {p_phrase(adj)}.",
                        where="All rows with both values",
                        magnitude=f"ρ = {fmt(rho, 4)}",
                        baseline="No association (ρ = 0)",
                        comparison=f"ρ = {fmt(rho, 4)}",
                        evidence_ids=[eid],
                        possible_explanations=["A shared driver affects both measures", "One measure is partly calculated from the other"],
                        recommended_action=f"Test whether changing {r['y']} changes {r['x']} (for example with a controlled trial) before acting on this.",
                        success_metric=f"Correlation of {r['x']} and {r['y']} on new data",
                        confidence="medium" if significant and abs(rho) >= 0.3 else "low",
                        limitations="Correlation is not causation. " + " ".join(n for n in r["notes"] if "cause" not in n)[:200],
                        kind="statistical_association",
                        priority_score=2 if significant and abs(rho) >= 0.3 else 1,
                    )
                elif item.tool == "crosstab" and r.get("test"):
                    t, adj = r["test"], adjusted_p(validation, eid)
                    significant = adj is not None and adj < SIGNIFICANCE
                    if hyp:
                        hyp["result"] = "supported" if significant else "not_supported"
                        hyp.update({"p_value": t["p_value"], "adjusted_p_value": adj, "effect_size": t["effect_size"]})
                    if not significant:
                        continue
                    add(
                        title=f"{r['row']} and {r['column']} are associated",
                        what_happened=f"Chi-square = {fmt(t['statistic'], 4)} with {t['df']} degrees of freedom, {p_phrase(adj)}, Cramér's V = {fmt(t['effect_size']['value'], 4)}.",
                        where=f"{r['row']} × {r['column']}",
                        magnitude=f"Cramér's V = {fmt(t['effect_size']['value'], 4)}",
                        baseline="Independence",
                        comparison=f"V = {fmt(t['effect_size']['value'], 4)}",
                        evidence_ids=[eid],
                        recommended_action=f"Compare {r['column']} within each {r['row']} rather than across all rows.",
                        success_metric=f"Mix of {r['column']} within {r['row']}",
                        confidence="medium",
                        limitations=" ".join(r["notes"][:2]),
                        kind="statistical_association",
                        priority_score=1,
                    )
        for rec in validation["reconciliation"][:1]:  # the primary measure; the rest stay in the validation table
            if rec.get("duplicate_effect_pct"):
                add(
                    title=f"Duplicate rows change {agg_label(rec['aggregation']).lower()} {rec['measure']} by {fmt(rec['duplicate_effect_pct'], 2)}%",
                    what_happened=f"{agg_label(rec['aggregation'])} {rec['measure']} is {fmt(rec['independent_value'])} with duplicates and {fmt(rec['value_without_duplicates'])} without them.",
                    where="Exact duplicate rows",
                    magnitude=f"{fmt(rec['duplicate_effect_pct'], 2)}%",
                    baseline=f"Without duplicates: {fmt(rec['value_without_duplicates'])}",
                    comparison=f"With duplicates: {fmt(rec['independent_value'])}",
                    evidence_ids=[rec["evidence_id"]],
                    possible_explanations=["Repeated export of the same transaction", "Legitimate identical transactions"],
                    recommended_action="Confirm with the data owner whether identical rows are real transactions.",
                    success_metric="Number of exact duplicate rows in each new extract",
                    confidence="high",
                    limitations="Only exact duplicates are detected; near-duplicates are not.",
                    kind="data_quality",
                    priority_score=1 if abs(rec["duplicate_effect_pct"]) < 1 else 3,
                )
        findings.sort(key=lambda f: -f.pop("priority_score", 0))
        for i, f in enumerate(findings, 1):
            f["id"] = f"F{i}"
        return findings


# ====================================================================== dashboard and handover


def dashboard(
    toolbox: Toolbox, plan: dict[str, Any], understanding: dict[str, Any], validation: dict[str, Any], findings: list[dict[str, Any]]
) -> dict[str, Any]:
    primary = plan.get("primary_measure")
    kpis = [
        {
            "label": "Rows analysed",
            "value": understanding["overview"]["rows"],
            "unit": "rows",
            "definition": "Number of rows in the uploaded file.",
            "evidence_id": understanding["overview_evidence"],
        }
    ]
    for rec in validation["reconciliation"][:3]:
        if rec["reconciled"]:
            label = f"{agg_label(rec['aggregation'])} {rec['measure']}"
            how = "Sum" if rec["aggregation"] == "sum" else "Average"
            kpis.append(
                {
                    "label": label,
                    "value": rec["independent_value"],
                    "unit": None,
                    "definition": f"{how} of valid '{rec['measure']}' values; reconciled with an independent recalculation.",
                    "evidence_id": rec["evidence_id"],
                }
            )
    charts = []
    for item in toolbox.evidence.items:
        if item.phase < 4:
            continue
        kind = {
            "trend": "trend",
            "segment_contribution": "bar",
            "correlation_matrix": "heatmap",
            "two_way_breakdown": "table",
            "compare_groups": "groups",
            "crosstab": "crosstab",
            "pca": "pca",
        }.get(item.tool)
        if kind:
            charts.append({"type": kind, "evidence_id": item.id, "tool": item.tool, "args": item.args})
    for item in toolbox.evidence.items:
        if item.tool == "trend" and item.phase >= 4 and item.result.get("period_over_period"):
            pop = item.result["period_over_period"]
            kpis.append(
                {
                    "label": f"{primary} change, {pop['current_period']} vs {pop['previous_period']}",
                    "value": pop["percent_change"],
                    "unit": "%",
                    "definition": "Latest complete month versus the month before; partial months excluded.",
                    "evidence_id": item.id,
                }
            )
            break
    validated = [f for f in findings if f["grounded"]]
    return {
        "kpis": kpis,
        "charts": charts,
        "key_findings": [f["id"] for f in validated[:5]],
        "unverified_findings": [f["id"] for f in findings if not f["grounded"]],
    }


def handover_markdown(report: dict[str, Any]) -> str:
    c, du, prep = report["charter"], report["data_understanding"], report["preparation"]
    lines = [
        f"# Analysis handover: {report['dataset']['file_name']}",
        "",
        f"Generated {report['generated_at']} by TabulaVibe AI {report['app_version']} ({'AI analyst: ' + report['model'] if report['mode'] == 'ai' else 'rules-based analyst'}).",
        "",
        "## 1. Executive summary",
        "",
    ]
    for f in [f for f in report["findings"] if f["grounded"]][:5]:
        lines.append(f"- **{f['title']}** ({f['confidence']} confidence). {f['what_happened']}")
    if not report["findings"]:
        lines.append("- No findings met the evidence threshold.")
    lines += ["", "## 2. Business objectives and scope", "", f"- Context: {c['business_context']}", f"- Audience: {c['stakeholders']}"]
    lines += [f"- Objective: {o}" for o in c["objectives"]]
    lines += [f"- In scope: {', '.join(c['in_scope'])}", f"- Out of scope: {', '.join(c['out_of_scope'])}"]
    lines += ["", "**Assumptions**", ""] + [f"- {a}" for a in c["assumptions"] or ["None"]]
    lines += [
        "",
        "## 3. Data sources and dictionary",
        "",
        f"Grain: {du['grain']}. {du['grain_basis']}",
        "",
        "| Column | Type | Role | Missing % | Unique |",
        "|---|---|---|---|---|",
    ]
    lines += [f"| {d['column']} | {d['type']} | {d['role']} | {d['missing_pct']} | {d['unique']} |" for d in du["data_dictionary"]]
    lines += ["", "## 4. Data-quality findings", ""] + [
        f"- [{i['severity']}] {i['issue']}: {i['detail']}"
        for i in du["quality_issues"] or [{"severity": "info", "issue": "None", "detail": "No issues detected."}]
    ]
    lines += ["", "## 5. Cleaning and transformation", ""] + [
        f"- {s['step']}: {s['decision']} ({s['reason']})" for s in prep["cleaning_log"]
    ]
    lines += ["", "## 6. KPI definitions", ""] + [f"- **{m['name']}**: {m['formula']}" for m in prep["metric_definitions"]]
    lines += ["", "## 7. Questions and hypotheses", ""]
    for q in report["questions"]:
        lines.append(f"- {q['id']} ({q['priority']}): {q['question']} [{q['status']}; evidence {', '.join(q['evidence_ids']) or 'none'}]")
    for h in report["hypotheses"]:
        adj = f", adjusted p = {h['adjusted_p_value']}" if h.get("adjusted_p_value") is not None else ""
        lines.append(f"- {h['id']}: {h['statement']} → **{h['result'].replace('_', ' ')}**{adj}")
    lines += ["", "## 8. Validated findings", ""]
    for f in report["findings"]:
        lines += [
            f"### {f['id']}. {f['title']}",
            "",
            f"- What happened: {f['what_happened']}",
            f"- Where: {f['where']}",
            f"- Magnitude: {f['magnitude']}",
            f"- Evidence: {', '.join(f['evidence_ids'])}{'' if f['grounded'] else ' (contains figures that could not be matched to evidence: ' + ', '.join(f['unverified_numbers']) + ')'}",
            f"- Possible explanations (not verified): {'; '.join(f['possible_explanations']) or 'n/a'}",
            f"- Recommended action: {f['recommended_action']}",
            f"- Success metric: {f['success_metric']}",
            f"- Confidence: {f['confidence']}. Limitations: {f['limitations']}",
            "",
        ]
    v = report["validation"]
    lines += [
        "## 9. Statistical methods and validation",
        "",
        f"- Multiple testing: Holm-Bonferroni across {len(v['multiple_testing']['tests'])} test(s), alpha = {v['multiple_testing']['alpha']}.",
    ]
    lines += [
        f"- {r['measure']}: engine {r['engine_value']} vs independent {r['independent_value']} → {'reconciled' if r['reconciled'] else 'NOT reconciled'}"
        for r in v["reconciliation"]
    ]
    ev = report.get("evaluation")
    if ev:
        lines += ["", "### Evaluation: which analysis built the dashboard", "", ev["rule"]]
        lines += [
            f"- {'AI analyst' if c['mode'] == 'ai' else 'Rules-based analyst'}{' (' + str(c['provider']) + ' · ' + str(c['model']) + ')' if c['mode'] == 'ai' else ''}: "
            f"score {c['score']} ({'; '.join(f'{x["label"]} {x["detail"]}' for x in c['criteria'])}){' ← used' if c['mode'] == ev['winner'] else ''}"
            for c in ev["candidates"]
        ]
    fc = report.get("forecast")
    if fc:
        lines += ["", "### Forecast (NVIDIA Kumo Relational)", ""]
        if fc["status"] != "ok":
            lines.append(f"- {fc['note']}")
        else:
            lines.append(
                f"- {fc['measure']} ({fc['aggregation']}) by {fc['grain']}, from '{fc['date_column']}'. Sent to NVIDIA: {fc['shared']}."
            )
            lines += [f"- {p['period']}: {p['value']}" for p in fc["forecast"]]
            bt = fc.get("backtest")
            if bt:
                lines.append(
                    f"- Backtest on the last {len(bt['periods'])} period(s): Kumo mean absolute error {bt['kumo_mae']} vs naive {bt['naive_mae']}."
                )
            lines += [f"- {x}" for x in fc["notes"]]
    lines += ["", "## 10. Limitations and outstanding questions", ""] + [
        f"- {x}" for x in report["limitations"] + report["outstanding_questions"]
    ]
    lines += [
        "",
        "## 11. Reproduce",
        "",
        "Upload the same file to TabulaVibe AI and run the analyst; every figure above cites the evidence ID of the calculation that produced it.",
        "",
    ]
    return "\n".join(lines)


# ====================================================================== orchestrator


def run_workflow(
    ds: Dataset,
    file_name: str | None,
    context: BusinessContext,
    analyst: Analyst,
    fallback: Analyst | None = None,
    deadline_seconds: float = 240,
) -> Iterator[dict[str, Any]]:
    """Run phases 0-8 and yield progress events, ending with {"type": "report"}."""
    started = time.monotonic()
    toolbox = Toolbox(ds)
    events: list[dict[str, Any]] = []
    phases: dict[int, dict[str, Any]] = {
        pid: {"id": pid, "name": name, "exit_criteria": crit, "status": "pending", "checks": []} for pid, name, crit in PHASES
    }
    ai_note = None

    def emit(event: dict[str, Any]) -> None:
        events.append(event)

    def gate(pid: int, checks: list[tuple[str, bool, str]], assumed: bool = False) -> dict[str, Any]:
        phase = phases[pid]
        phase["checks"] = [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks]
        phase["status"] = "passed" if all(ok for _, ok, _ in checks) else "blocked"
        if phase["status"] == "passed" and assumed:
            phase["status"] = "passed_with_assumptions"
        return {"type": "phase", "phase": pid, "name": phase["name"], "status": phase["status"], "checks": phase["checks"]}

    def drain() -> Iterator[dict[str, Any]]:
        while events:
            yield events.pop(0)

    yield {
        "type": "start",
        "mode": analyst.name,
        "provider": getattr(analyst, "provider", None),
        "model": analyst.model,
        "phases": [{"id": p, "name": n} for p, n, _ in PHASES],
    }

    # Phase 1 runs before planning so the analyst works from evidence (rule 3: profile before deciding).
    understanding = data_understanding(toolbox, emit)
    yield from drain()
    analysable = understanding["overview"]["rows"] > 0 and bool(
        understanding["overview"]["measures"] or understanding["overview"]["dimensions"]
    )
    phase1 = gate(
        1,
        [
            (
                "Rows and columns profiled",
                understanding["overview"]["rows"] > 0,
                f"{understanding['overview']['rows']} rows, {understanding['overview']['columns']} columns",
            ),
            ("Grain stated", True, understanding["grain"]),
            ("Quality risks listed", True, f"{len(understanding['quality_issues'])} issue(s)"),
            ("Something to analyse", analysable, "At least one numeric measure or category column is needed."),
        ],
    )

    # Phase 0 + 2: analyst plans (AI falls back to rules on failure).
    briefing = {
        "overview": understanding["overview"],
        "grain": understanding["grain"],
        "quality_issues": understanding["quality_issues"],
        "data_dictionary": understanding["data_dictionary"],
    }
    try:
        plan = analyst.plan(toolbox, briefing, emit)
    except Exception as exc:  # noqa: BLE001 - any AI failure falls back to the rules analyst
        if fallback is None:
            raise
        ai_note = _ai_failure_note(exc, "planning (phases 0 and 2)", "completed the whole workflow")
        analyst = fallback
        plan = analyst.plan(toolbox, briefing, emit)
    yield from drain()
    charter = plan["charter"]
    yield gate(
        0,
        [
            ("Business context documented", bool(charter["business_context"]), charter["business_context"][:120]),
            ("Scope and success criteria stated", bool(charter["in_scope"] and charter["success_criteria"]), ""),
        ],
        assumed=bool(charter["assumptions"]),
    )
    yield phase1
    yield gate(
        2,
        [
            ("Questions registered", bool(plan["questions"]), f"{len(plan['questions'])} question(s)"),
            ("Questions are answerable with this data", analysable, "Each question names variables present in the file."),
            ("Hypotheses are explicit", True, f"{len(plan['hypotheses'])} hypothesis/hypotheses"),
        ],
    )

    prep = preparation(toolbox, understanding, plan)
    yield gate(
        3,
        [
            ("Raw data preserved", True, "Nothing is modified or stored."),
            ("Cleaning decisions logged", bool(prep["cleaning_log"]), f"{len(prep['cleaning_log'])} decision(s)"),
            (
                "One definition per KPI",
                len({m["name"] for m in prep["metric_definitions"]}) == len(prep["metric_definitions"]),
                f"{len(prep['metric_definitions'])} definition(s)",
            ),
        ],
    )

    if not analysable:
        for pid in (4, 5, 6, 7, 8):
            phases[pid]["status"] = "skipped"
        yield {"type": "phase", "phase": 4, "name": phases[4]["name"], "status": "skipped", "checks": []}
    else:
        try:
            analyst.investigate(toolbox, plan, emit)
        except Exception as exc:  # noqa: BLE001
            if fallback is None or analyst is fallback:
                raise
            ai_note = _ai_failure_note(exc, "the investigation (phase 4)", "re-planned and completed the workflow")
            analyst = fallback
            plan = analyst.plan(toolbox, briefing, emit)
            analyst.investigate(toolbox, plan, emit)
        yield from drain()
        high = [q for q in plan["questions"] if q["priority"] == "high"]
        yield gate(
            4,
            [
                (
                    "High-priority questions investigated",
                    all(q["evidence_ids"] for q in high),
                    f"{sum(1 for q in high if q['evidence_ids'])} of {len(high)}",
                ),
                ("Within the time budget", time.monotonic() - started < deadline_seconds, f"{time.monotonic() - started:.0f} s"),
            ],
        )

        validation = validation_summary(toolbox, plan.get("primary_measure"))
        try:
            findings = analyst.write_findings(toolbox, plan, validation, emit)
        except Exception as exc:  # noqa: BLE001
            if fallback is None or analyst is fallback:
                raise
            ai_note = _ai_failure_note(exc, "writing findings (phase 5)", "wrote the findings from the AI's plan and evidence")
            analyst = fallback
            findings = analyst.write_findings(toolbox, plan, validation, emit)
        yield from drain()
        for f in findings:
            ground_finding(f, toolbox.evidence, validation)
        grounded = sum(1 for f in findings if f["grounded"])
        yield gate(
            5,
            [
                (
                    "Totals reconcile with an independent recalculation",
                    validation["all_reconciled"] is not False,
                    "; ".join(f"{r['measure']}: {'ok' if r['reconciled'] else 'mismatch'}" for r in validation["reconciliation"])
                    or "no numeric measures",
                ),
                ("Multiple-testing correction applied", True, f"Holm across {len(validation['multiple_testing']['tests'])} test(s)"),
                ("Every finding cites evidence", all(f["evidence_ids"] for f in findings), f"{len(findings)} finding(s)"),
                ("Every number in a finding is grounded", grounded == len(findings), f"{grounded} of {len(findings)} grounded"),
            ],
        )
    if not analysable:
        validation, findings = (
            {"multiple_testing": {"method": "holm", "alpha": SIGNIFICANCE, "tests": []}, "reconciliation": [], "all_reconciled": None},
            [],
        )

    dash = (
        dashboard(toolbox, plan, understanding, validation, findings)
        if analysable
        else {"kpis": [], "charts": [], "key_findings": [], "unverified_findings": []}
    )
    if analysable:
        yield gate(
            6,
            [
                (
                    "Built only from validated results",
                    not dash["unverified_findings"] or all(fid not in dash["key_findings"] for fid in dash["unverified_findings"]),
                    f"{len(dash['kpis'])} KPI(s), {len(dash['charts'])} chart(s)",
                )
            ],
        )
        yield gate(
            7,
            [
                ("KPIs reconcile", validation["all_reconciled"] is not False, ""),
                ("Findings grounded", not dash["unverified_findings"], f"{len(dash['unverified_findings'])} unverified finding(s) flagged"),
            ],
        )

    outstanding = list(plan.get("outstanding_questions") or [])
    if charter["assumptions"]:
        outstanding.append("Confirm the assumptions in the charter (domain, audience, primary KPI).")
    if any(i["kind"] == "needs_investigation" for i in understanding["quality_issues"]):
        outstanding.append("Investigate the data-quality items marked 'needs investigation' with the data owner.")
    outstanding.append("Confirm column meanings and units in the data dictionary.")
    limitations = understanding["limitations"] + [
        "Findings are associations in observational data; no causal claims are made.",
        "Statistical tests assume rows are independent observations.",
    ]
    report = {
        "version": 1,
        "app_version": __version__,
        "mode": analyst.name,
        "provider": getattr(analyst, "provider", None),
        "model": analyst.model,
        "provider_switches": list(getattr(analyst, "switches", [])),
        "ai_note": ai_note,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "duration_seconds": round(time.monotonic() - started, 1),
        "dataset": {
            "file_name": file_name or "uploaded file",
            "file_type": ds.source.file_type,
            "rows": ds.row_count,
            "columns": len(ds.columns),
        },
        "phases": [phases[p] for p in sorted(phases)],
        "charter": charter,
        "primary_measure": plan.get("primary_measure"),
        "data_understanding": {k: v for k, v in understanding.items() if k != "overview"},
        "questions": [{k: v for k, v in q.items() if k != "tools"} for q in plan["questions"]],
        "hypotheses": plan["hypotheses"],
        "preparation": prep,
        "validation": validation,
        "findings": findings,
        "dashboard": dash,
        "outstanding_questions": outstanding,
        "limitations": limitations,
        "evidence": toolbox.evidence.as_list(),
    }
    phases[8]["status"] = "passed" if analysable else "skipped"
    phases[8]["checks"] = [{"check": "Handover document generated", "passed": True, "detail": "Download it from the report."}]
    report["handover_markdown"] = handover_markdown(report)
    yield {"type": "phase", "phase": 8, "name": phases[8]["name"], "status": phases[8]["status"], "checks": phases[8]["checks"]}
    yield {"type": "report", "report": report}


# ---------------------------------------------------------------- evaluation: the best analysis builds the dashboard

# (key, label, weight). Weights sum to 100, so a score is a percentage.
EVALUATION_CRITERIA = (
    ("grounded", "Findings whose numbers match their evidence", 30),
    ("coverage", "High-priority questions answered", 25),
    ("gates", "Phase gates passed", 20),
    ("reconciled", "Totals reconcile with an independent recalculation", 15),
    ("hypotheses", "Hypotheses resolved (supported or not supported)", 10),
)


def evaluate_report(report: dict[str, Any]) -> dict[str, Any]:
    """Score one finished analysis on measurable quality criteria (0-100). Python only; no AI judgement."""
    findings = report["findings"]
    high = [q for q in report["questions"] if q["priority"] == "high"]
    phases = [p for p in report["phases"] if p["status"] != "skipped"]
    hypotheses = report["hypotheses"]
    grounded = sum(1 for f in findings if f.get("grounded"))
    answered = sum(1 for q in high if q["evidence_ids"])
    passed = sum(1 for p in phases if p["status"] in ("passed", "passed_with_assumptions"))
    resolved = sum(1 for h in hypotheses if h["result"] in ("supported", "not_supported"))
    values = {
        "grounded": (grounded / len(findings) if findings else 0.0, f"{grounded} of {len(findings)}"),
        "coverage": (answered / len(high) if high else (1.0 if report["questions"] else 0.0), f"{answered} of {len(high)}"),
        "gates": (passed / len(phases) if phases else 0.0, f"{passed} of {len(phases)}"),
        "reconciled": (
            0.0 if report["validation"]["all_reconciled"] is False else 1.0,
            "yes" if report["validation"]["all_reconciled"] is not False else "no",
        ),
        "hypotheses": (resolved / len(hypotheses) if hypotheses else 0.0, f"{resolved} of {len(hypotheses)}"),
    }
    criteria = [
        {"key": key, "label": label, "weight": weight, "value": round(values[key][0], 4), "detail": values[key][1]}
        for key, label, weight in EVALUATION_CRITERIA
    ]
    return {
        "mode": report["mode"],
        "provider": report.get("provider"),
        "model": report.get("model"),
        "score": round(sum(c["weight"] * c["value"] for c in criteria), 1),
        "criteria": criteria,
    }


def run_best(
    ds: Dataset,
    file_name: str | None,
    context: BusinessContext,
    analyst: Analyst,
    fallback: Analyst | None = None,
    deadline_seconds: float = 240,
    forecaster: Any = None,
) -> Iterator[dict[str, Any]]:
    """Run the workflow; when the AI finished it, also run the rules-based baseline on the same file, score
    both with `evaluate_report`, and deliver the higher-scoring analysis (ties go to the AI). With a
    forecaster (NVIDIA Kumo Relational), the winning analysis's primary measure is then forecast."""
    final = None
    for event in run_workflow(ds, file_name, context, analyst, fallback, deadline_seconds):
        if event["type"] == "report":
            final = event["report"]
        else:
            yield event
    assert final is not None
    candidates = [final]
    if final["mode"] == "ai" and fallback is not None:
        yield {"type": "log", "phase": 8, "message": "Scoring the AI analysis against the rules-based baseline."}
        baseline = next(
            e["report"] for e in run_workflow(ds, file_name, context, fallback, None, deadline_seconds) if e["type"] == "report"
        )
        candidates.append(baseline)
    scored = [(evaluate_report(r), r) for r in candidates]
    best_eval, best = max(scored, key=lambda pair: (pair[0]["score"], pair[1]["mode"] == "ai"))
    best["evaluation"] = {
        "winner": best_eval["mode"],
        "rule": "The analysis with the higher score builds the dashboard; a tie goes to the AI analyst.",
        "candidates": [e for e, _ in scored],
    }
    if len(scored) > 1 and best["mode"] != "ai":
        ai_eval = scored[0][0]
        best["ai_note"] = (
            f"The AI analysis ({PROVIDER_LABELS.get(ai_eval['provider'] or '', 'AI')} · {ai_eval['model']}) scored {ai_eval['score']} and the "
            f"rules-based analysis scored {best_eval['score']}, so the rules-based analysis builds this dashboard."
        )
    if forecaster is not None:
        yield {"type": "log", "phase": 8, "message": "Forecasting the primary measure with NVIDIA Kumo Relational."}
        try:
            best["forecast"] = forecaster.forecast(ds, best.get("primary_measure"))
        except Exception as exc:  # noqa: BLE001 - a forecast failure never breaks the analysis
            message = getattr(exc, "message", None)
            if message is None:
                logger.exception("Forecast failed: %s", type(exc).__name__)
                message = "it stopped unexpectedly"
            best["forecast"] = {"status": "failed", "provider": "nvidia", "model": "kumo-relational", "note": f"No forecast: {message}."}
    best["handover_markdown"] = handover_markdown(best)
    yield {"type": "report", "report": best}


def _ai_failure_note(exc: Exception, stage: str, outcome: str) -> str:
    message = getattr(exc, "message", None)
    if message is None:  # not an expected provider error: keep a trace (type only, never data)
        logger.exception("AI analyst failed during %s: %s", stage, type(exc).__name__)
        message = "it stopped unexpectedly"
    return f"The AI analyst stopped during {stage}: {message}. The rules-based analyst {outcome}."
