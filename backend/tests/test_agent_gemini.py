"""The Gemini analyst, against a scripted fake of the generateContent API (no network, no key)."""

import json

import httpx
import pytest

from app.agent.gemini import GeminiAnalyst
from app.agent.workflow import BusinessContext, RulesAnalyst, run_workflow

PLAN = {
    "business_context": "Small retail sales file (assumed from column names).",
    "stakeholders": "Store owner (assumed)",
    "objectives": ["Find where revenue comes from and how it changes"],
    "in_scope": ["This file"],
    "out_of_scope": ["Forecasting"],
    "success_criteria": ["Every KPI reconciles"],
    "assumptions": ["No business problem was provided, so discovery is the objective."],
    "primary_measure": "revenue",
    "questions": [
        {
            "id": "Q1",
            "question": "How did revenue change month to month?",
            "variables": ["date", "revenue"],
            "priority": "high",
            "method": "trend",
        },
        {
            "id": "Q2",
            "question": "Which regions contribute most revenue?",
            "variables": ["region", "revenue"],
            "priority": "high",
            "method": "segment share",
        },
    ],
    "hypotheses": [{"id": "H1", "question_id": "Q2", "statement": "One region holds most revenue."}],
}


def last_results(body):
    """functionResponse payloads in the latest user turn, by function name."""
    out = {}
    for part in body["contents"][-1].get("parts", []):
        if "functionResponse" in part:
            out[part["functionResponse"]["name"]] = part["functionResponse"]["response"]
    return out


def call(name, args, call_id=None, signature=None):
    part = {"functionCall": {"name": name, "args": args}}
    if call_id:
        part["functionCall"]["id"] = call_id
    if signature:
        part["thoughtSignature"] = signature
    return part


def reply(*parts):
    return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": list(parts)}, "finishReason": "STOP"}]})


class ScriptedGemini:
    """Plays a sequence of turns; each step is a function(body) -> httpx.Response."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.bodies = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        assert "gemini-test" in str(request.url)
        body = json.loads(request.content)
        self.bodies.append(body)
        if not self.steps:
            return reply(call("finish_investigation", {"summary": "loop"}))  # never ends a findings stage
        return self.steps.pop(0)(body)


def analyst(fake, context=None, **kwargs):
    return GeminiAnalyst("test-key", "gemini-test", context or BusinessContext(), transport=httpx.MockTransport(fake.handler), **kwargs)


def happy_steps():
    state = {}

    def investigate(body):
        return reply(
            call(
                "trend",
                {"date_column": "date", "measure": "revenue", "aggregation": "sum", "grain": "month", "question_id": "Q1"},
                "c1",
                "sig-1",
            ),
            call("segment_contribution", {"measure": "revenue", "dimension": "region", "question_id": "Q2"}, "c2"),
        )

    def finish(body):
        res = last_results(body)
        state["trend"] = res["trend"]["evidence_id"]
        state["segment"] = res["segment_contribution"]["evidence_id"]
        assert res["trend"]["result"]["period_over_period"]["percent_change"] == -78.57  # hand-checked (30 vs 140)
        return reply(call("finish_investigation", {"summary": "done"}))

    def submit_with_invented_number(body):
        return reply(
            call(
                "submit_findings",
                {
                    "findings": [
                        {
                            "title": "Revenue fell 78.57% in 2025-04",
                            "what_happened": "Revenue was 30 in 2025-04 against 140 in 2025-03.",
                            "evidence_ids": [state["trend"]],
                            "confidence": "low",
                            "kind": "observed_fact",
                            "recommended_action": "Check April is complete.",
                        },
                        {
                            "title": "South could reach 999.9",
                            "what_happened": "South has 190 of 355.",
                            "evidence_ids": [state["segment"]],
                            "confidence": "high",
                            "kind": "observed_fact",
                            "recommended_action": "Monitor South.",
                        },
                    ]
                },
            )
        )

    def submit_corrected(body):
        rejection = last_results(body)["submit_findings"]
        assert "999.9" in rejection["error"]
        return reply(
            call(
                "submit_findings",
                {
                    "findings": [
                        {
                            "title": "Revenue fell 78.57% in 2025-04",
                            "what_happened": "Revenue was 30 in 2025-04 against 140 in 2025-03.",
                            "evidence_ids": [state["trend"]],
                            "confidence": "low",
                            "kind": "observed_fact",
                            "recommended_action": "Check April is complete.",
                        },
                        {
                            "title": "South holds 53.52% of revenue",
                            "what_happened": "South has 190 of 355.",
                            "evidence_ids": [state["segment"]],
                            "confidence": "high",
                            "kind": "observed_fact",
                            "recommended_action": "Monitor South.",
                        },
                    ],
                    "hypothesis_results": [{"hypothesis_id": "H1", "result": "supported", "evidence_ids": [state["segment"]]}],
                    "outstanding_questions": ["Is April's extract complete?"],
                },
            )
        )

    return [lambda b: reply(call("register_plan", PLAN, "p1", "sig-0")), investigate, finish, submit_with_invented_number, submit_corrected]


def run_ai(ds, fake, **kwargs):
    ctx = BusinessContext()
    events = list(run_workflow(ds, "sales.csv", ctx, analyst(fake, ctx, **kwargs), fallback=RulesAnalyst(ctx)))
    return events, events[-1]["report"]


def test_ai_analyst_completes_the_workflow_with_grounded_findings(sales_ds):
    fake = ScriptedGemini(happy_steps())
    _, report = run_ai(sales_ds, fake)
    assert (report["mode"], report["model"], report["ai_note"]) == ("ai", "gemini-test", None)
    assert {p["id"]: p["status"] for p in report["phases"]}[5] == "passed"
    titles = [f["title"] for f in report["findings"]]
    assert titles == ["Revenue fell 78.57% in 2025-04", "South holds 53.52% of revenue"]  # the invented number never reaches the report
    assert all(f["grounded"] for f in report["findings"])
    assert report["findings"][0]["spec"]["group_by"] == "date"
    assert report["hypotheses"][0]["result"] == "supported"
    assert "Is April's extract complete?" in report["outstanding_questions"]
    assert [q["status"] for q in report["questions"]] == ["answered", "answered"]


def test_model_turns_are_returned_unchanged_with_thought_signatures(sales_ds):
    fake = ScriptedGemini(happy_steps())
    run_ai(sales_ds, fake)
    second = fake.bodies[1]["contents"]
    model_turns = [c for c in second if c["role"] == "model"]
    assert model_turns[0]["parts"][0]["thoughtSignature"] == "sig-0"
    response = second[-1]["parts"][0]["functionResponse"]
    assert response["name"] == "register_plan" and response["id"] == "p1"


def test_each_stage_only_allows_its_own_functions(sales_ds):
    fake = ScriptedGemini(happy_steps())
    run_ai(sales_ds, fake)
    allowed = [b["toolConfig"]["functionCallingConfig"]["allowedFunctionNames"] for b in fake.bodies]
    assert allowed[0] == ["describe_column", "register_plan"]
    assert "finish_investigation" in allowed[1] and "register_plan" not in allowed[1]
    assert allowed[-1] == ["submit_findings"]
    assert all(b["toolConfig"]["functionCallingConfig"]["mode"] == "ANY" for b in fake.bodies)


def test_the_model_never_receives_raw_rows(sales_ds):
    fake = ScriptedGemini(happy_steps())
    run_ai(sales_ds, fake)
    sent = json.dumps(fake.bodies)
    assert "2025-02-14,East" not in sent and "not-a-date" not in sent
    assert "Phase 1 is complete" in sent  # the profile is shared as aggregates


def test_gate_refuses_analysis_before_a_plan(sales_ds):
    def early_tool(body):
        return reply(call("trend", {"date_column": "date", "measure": "revenue"}))

    def check_then_plan(body):
        assert "register the plan first" in last_results(body)["trend"]["error"]
        return reply(call("register_plan", PLAN))

    steps = [early_tool, check_then_plan] + happy_steps()[1:]
    _, report = run_ai(sales_ds, ScriptedGemini(steps))
    assert report["mode"] == "ai"


def test_plan_with_unknown_columns_is_rejected(sales_ds):
    bad = {**PLAN, "questions": [{"id": "Q1", "question": "Profit?", "variables": ["profit"], "priority": "high"}]}

    def check_then_plan(body):
        assert "unknown columns ['profit']" in last_results(body)["register_plan"]["error"]
        return reply(call("register_plan", PLAN))

    steps = [lambda b: reply(call("register_plan", bad)), check_then_plan] + happy_steps()[1:]
    _, report = run_ai(sales_ds, ScriptedGemini(steps))
    assert [q["id"] for q in report["questions"]] == ["Q1", "Q2"]


def test_investigation_cannot_finish_while_high_priority_questions_lack_evidence(sales_ds):
    steps = happy_steps()

    def finish_too_early(body):
        return reply(call("finish_investigation", {"summary": "skip"}))

    def check(body):
        assert "exit criteria not met" in last_results(body)["finish_investigation"]["error"]
        return steps[1](body)

    _, report = run_ai(sales_ds, ScriptedGemini([steps[0], finish_too_early, check, *steps[2:]]))
    assert report["mode"] == "ai"


def test_quota_error_falls_back_to_the_rules_analyst(sales_ds):
    fake = ScriptedGemini([lambda b: httpx.Response(429, json={"error": {"message": "quota"}})])
    _, report = run_ai(sales_ds, fake)
    assert report["mode"] == "rules"
    assert "free Gemini quota" in report["ai_note"]
    assert report["findings"] and all(f["grounded"] for f in report["findings"])


def test_step_budget_falls_back_without_hanging(sales_ds):
    steps = happy_steps()[:3]  # never submits findings
    fake = ScriptedGemini(steps + [lambda b: reply({"text": "I think revenue is fine."})] * 10)
    _, report = run_ai(sales_ds, fake, max_steps=6)
    assert report["mode"] == "rules"
    assert "step budget" in report["ai_note"]
    assert len(fake.bodies) <= 6


@pytest.mark.parametrize("status", [401, 500])
def test_provider_errors_fall_back(sales_ds, status):
    _, report = run_ai(sales_ds, ScriptedGemini([lambda b: httpx.Response(status, json={})]))
    assert report["mode"] == "rules" and report["ai_note"]
