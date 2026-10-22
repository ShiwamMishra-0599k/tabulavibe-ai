"""The LLM analyst (Groq, then NVIDIA), against scripted fakes of the chat completions APIs (no network, no key)."""

import json

import httpx
import pytest

from app.agent.llm import LLMAnalyst
from app.agent.workflow import BusinessContext, RulesAnalyst, evaluate_report, run_best, run_workflow
from app.ai import CHAT_URLS, ChatBackend

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
    """Tool results that answer the latest assistant turn, by function name."""
    messages = body["messages"]
    names = {}
    for m in messages:
        for c in m.get("tool_calls") or []:
            names[c["id"]] = c["function"]["name"]
    out = {}
    for m in reversed(messages):
        if m["role"] != "tool":
            break
        out[names[m["tool_call_id"]]] = json.loads(m["content"])
    return out


def call(name, args, call_id=None):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def reply(*calls, content=None, finish_reason="tool_calls"):
    message = {"role": "assistant", "content": content, "tool_calls": list(calls) or None}
    return httpx.Response(200, json={"choices": [{"index": 0, "message": message, "finish_reason": finish_reason}]})


class ScriptedChat:
    """Plays a sequence of turns for one provider; each step is a function(body) -> httpx.Response."""

    def __init__(self, steps, provider="nvidia"):
        self.steps = list(steps)
        self.bodies = []
        self.provider = provider

    def backend(self) -> ChatBackend:
        return ChatBackend(self.provider, f"{self.provider}-test", f"{self.provider}-key", 5, httpx.MockTransport(self.handler))

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == CHAT_URLS[self.provider]
        assert request.headers["authorization"] == f"Bearer {self.provider}-key"
        body = json.loads(request.content)
        assert body["model"] == f"{self.provider}-test"
        self.bodies.append(body)
        if not self.steps:
            return reply(call("finish_investigation", {"summary": "loop"}, "loop"))  # never ends a findings stage
        return self.steps.pop(0)(body)


def analyst(fake, context=None, **kwargs):
    fakes = fake if isinstance(fake, list) else [fake]
    return LLMAnalyst([f.backend() for f in fakes], context or BusinessContext(), **kwargs)


def happy_steps():
    state = {}

    def investigate(body):
        return reply(
            call(
                "trend",
                {"date_column": "date", "measure": "revenue", "aggregation": "sum", "grain": "month", "question_id": "Q1"},
                "c1",
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

    return [lambda b: reply(call("register_plan", PLAN, "p1")), investigate, finish, submit_with_invented_number, submit_corrected]


def run_ai(ds, fake, **kwargs):
    ctx = BusinessContext()
    events = list(run_workflow(ds, "sales.csv", ctx, analyst(fake, ctx, **kwargs), fallback=RulesAnalyst(ctx)))
    return events, events[-1]["report"]


def test_ai_analyst_completes_the_workflow_with_grounded_findings(sales_ds):
    fake = ScriptedChat(happy_steps())
    _, report = run_ai(sales_ds, fake)
    assert (report["mode"], report["model"], report["ai_note"]) == ("ai", "nvidia-test", None)
    assert {p["id"]: p["status"] for p in report["phases"]}[5] == "passed"
    titles = [f["title"] for f in report["findings"]]
    assert titles == ["Revenue fell 78.57% in 2025-04", "South holds 53.52% of revenue"]  # the invented number never reaches the report
    assert all(f["grounded"] for f in report["findings"])
    assert report["findings"][0]["spec"]["group_by"] == "date"
    assert report["hypotheses"][0]["result"] == "supported"
    assert "Is April's extract complete?" in report["outstanding_questions"]
    assert [q["status"] for q in report["questions"]] == ["answered", "answered"]


def test_tool_results_answer_the_matching_tool_call(sales_ds):
    fake = ScriptedChat(happy_steps())
    run_ai(sales_ds, fake)
    second = fake.bodies[1]["messages"]
    assert second[0]["role"] == "system" and "HOW YOU WORK INSIDE TABULAVIBE AI" in second[0]["content"]
    assistant = [m for m in second if m["role"] == "assistant"][0]
    assert assistant["tool_calls"][0]["id"] == "p1" and assistant["tool_calls"][0]["function"]["name"] == "register_plan"
    assert second[-1]["role"] == "tool" and second[-1]["tool_call_id"] == "p1"
    assert json.loads(second[-1]["content"])["status"] == "accepted"


def test_each_stage_only_offers_its_own_functions(sales_ds):
    fake = ScriptedChat(happy_steps())
    run_ai(sales_ds, fake)
    offered = [[t["function"]["name"] for t in b["tools"]] for b in fake.bodies]
    assert offered[0] == ["describe_column", "register_plan"]
    assert "finish_investigation" in offered[1] and "register_plan" not in offered[1]
    assert offered[-1] == ["submit_findings"]
    assert all(t["type"] == "function" and t["function"]["parameters"]["type"] == "object" for b in fake.bodies for t in b["tools"])
    assert all(b["tool_choice"] == "auto" and b["stream"] is False for b in fake.bodies)


def test_missing_tool_call_ids_are_filled_in(sales_ds):
    steps = happy_steps()
    steps[0] = lambda b: reply(call("register_plan", PLAN))  # no id

    def investigate(body):
        assert body["messages"][-1]["tool_call_id"] == body["messages"][-2]["tool_calls"][0]["id"] == "call_1_0"
        return happy_steps()[1](body)

    steps[1] = investigate
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai"


def test_a_tool_call_written_as_text_is_accepted(sales_ds):
    steps = happy_steps()
    steps[0] = lambda b: reply(
        content="```json\n" + json.dumps({"name": "register_plan", "parameters": PLAN}) + "\n```", finish_reason="stop"
    )
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai" and [q["id"] for q in report["questions"]] == ["Q1", "Q2"]


def test_invalid_arguments_and_plain_text_are_sent_back(sales_ds):
    broken = {"id": "x1", "type": "function", "function": {"name": "register_plan", "arguments": "{not json"}}

    def check_then_text(body):
        assert "not a valid JSON object" in last_results(body)["register_plan"]["error"]
        return reply(content="Let me think about the plan first.", finish_reason="stop")

    def check_then_plan(body):
        assert body["messages"][-1] == {
            "role": "user",
            "content": "Your last turn (stop) did not call a function. Call one of: describe_column, register_plan.",
        }
        return reply(call("register_plan", PLAN, "p1"))

    steps = [lambda b: reply(broken), check_then_text, check_then_plan] + happy_steps()[1:]
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai"


def test_the_model_never_receives_raw_rows(sales_ds):
    fake = ScriptedChat(happy_steps())
    run_ai(sales_ds, fake)
    sent = json.dumps(fake.bodies)
    assert "nvidia-key" not in sent
    assert "2025-02-14,East" not in sent and "not-a-date" not in sent
    assert "Phase 1 is complete" in sent  # the profile is shared as aggregates


def test_gate_refuses_analysis_before_a_plan(sales_ds):
    def early_tool(body):
        return reply(call("trend", {"date_column": "date", "measure": "revenue"}, "t0"))

    def check_then_plan(body):
        assert "register the plan first" in last_results(body)["trend"]["error"]
        return reply(call("register_plan", PLAN, "p1"))

    steps = [early_tool, check_then_plan] + happy_steps()[1:]
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai"


def test_plan_with_unknown_columns_is_rejected(sales_ds):
    bad = {**PLAN, "questions": [{"id": "Q1", "question": "Profit?", "variables": ["profit"], "priority": "high"}]}

    def check_then_plan(body):
        assert "unknown columns ['profit']" in last_results(body)["register_plan"]["error"]
        return reply(call("register_plan", PLAN, "p1"))

    steps = [lambda b: reply(call("register_plan", bad, "p0")), check_then_plan] + happy_steps()[1:]
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert [q["id"] for q in report["questions"]] == ["Q1", "Q2"]


def test_investigation_cannot_finish_while_high_priority_questions_lack_evidence(sales_ds):
    steps = happy_steps()

    def finish_too_early(body):
        return reply(call("finish_investigation", {"summary": "skip"}, "f0"))

    def check(body):
        assert "exit criteria not met" in last_results(body)["finish_investigation"]["error"]
        return steps[1](body)

    _, report = run_ai(sales_ds, ScriptedChat([steps[0], finish_too_early, check, *steps[2:]]))
    assert report["mode"] == "ai"


def test_quota_error_falls_back_to_the_rules_analyst(sales_ds):
    fake = ScriptedChat([lambda b: httpx.Response(429, json={"error": {"message": "quota"}})])
    _, report = run_ai(sales_ds, fake)
    assert report["mode"] == "rules"
    assert "the NVIDIA rate limit was reached" in report["ai_note"]
    assert report["findings"] and all(f["grounded"] for f in report["findings"])


def test_step_budget_falls_back_without_hanging(sales_ds):
    steps = happy_steps()[:3]  # never submits findings
    fake = ScriptedChat(steps + [lambda b: reply(content="I think revenue is fine.", finish_reason="stop")] * 10)
    _, report = run_ai(sales_ds, fake, max_steps=6)
    assert report["mode"] == "rules"
    assert "step budget" in report["ai_note"]
    assert len(fake.bodies) <= 6


@pytest.mark.parametrize("status", [401, 500])
def test_provider_errors_fall_back(sales_ds, status):
    _, report = run_ai(sales_ds, ScriptedChat([lambda b: httpx.Response(status, json={})]))
    assert report["mode"] == "rules" and report["ai_note"]


# ---------------------------------------------------------------- Groq first, NVIDIA when Groq cannot finish


@pytest.mark.parametrize("status", [413, 429, 500, 401])
def test_groq_failure_hands_the_same_conversation_to_nvidia(sales_ds, status):
    steps = happy_steps()
    groq = ScriptedChat([steps[0], lambda b: httpx.Response(status, json={"error": {"message": "limit"}})], provider="groq")
    nvidia = ScriptedChat(steps[1:])
    events, report = run_ai(sales_ds, [groq, nvidia])
    assert (report["mode"], report["provider"], report["model"]) == ("ai", "nvidia", "nvidia-test")
    assert len(report["provider_switches"]) == 1 and report["provider_switches"][0].startswith("Groq stopped")
    assert any(e["type"] == "log" and "Switching to NVIDIA" in e["message"] for e in events)
    # NVIDIA received the plan Groq registered, so no work was repeated.
    first = nvidia.bodies[0]["messages"]
    assert any(m.get("tool_calls") and m["tool_calls"][0]["function"]["name"] == "register_plan" for m in first)
    assert report["findings"] and all(f["grounded"] for f in report["findings"])


def test_groq_alone_finishes_without_nvidia(sales_ds):
    groq = ScriptedChat(happy_steps(), provider="groq")
    nvidia = ScriptedChat([])
    _, report = run_ai(sales_ds, [groq, nvidia])
    assert (report["provider"], report["model"], report["provider_switches"]) == ("groq", "groq-test", [])
    assert nvidia.bodies == []


def test_when_every_provider_fails_the_rules_analyst_takes_over(sales_ds):
    groq = ScriptedChat([lambda b: httpx.Response(413, json={})], provider="groq")
    nvidia = ScriptedChat([lambda b: httpx.Response(429, json={})])
    _, report = run_ai(sales_ds, [groq, nvidia])
    assert report["mode"] == "rules"
    assert "the NVIDIA rate limit was reached" in report["ai_note"]


# ---------------------------------------------------------------- evaluation: the best analysis builds the dashboard


def test_evaluation_scores_the_ai_run_against_the_rules_baseline(sales_ds):
    ctx = BusinessContext()
    events = list(run_best(sales_ds, "sales.csv", ctx, analyst(ScriptedChat(happy_steps()), ctx), fallback=RulesAnalyst(ctx)))
    report = events[-1]["report"]
    evaluation = report["evaluation"]
    assert [c["mode"] for c in evaluation["candidates"]] == ["ai", "rules"]
    assert evaluation["winner"] == report["mode"]
    ai = evaluation["candidates"][0]
    assert sum(c["weight"] for c in ai["criteria"]) == 100
    # Hand-checked AI score: 2/2 grounded (30) + 2/2 high-priority answered (25) + all gates (20) + reconciled (15) + 1/1 hypothesis (10)
    assert ai["score"] == 100.0 and report["mode"] == "ai"
    assert any(e["type"] == "log" and "rules-based baseline" in e["message"] for e in events)


def test_the_rules_baseline_wins_when_it_scores_higher(sales_ds):
    steps = happy_steps()

    def submit_ungrounded_twice(body):
        finding = {
            "title": "Revenue could reach 999.9",
            "what_happened": "A guess.",
            "evidence_ids": ["E1"],
            "confidence": "low",
            "kind": "observed_fact",
            "recommended_action": "None.",
        }
        return reply(call("submit_findings", {"findings": [finding]}, "s1"))

    ctx = BusinessContext()
    fake = ScriptedChat([*steps[:3], submit_ungrounded_twice, submit_ungrounded_twice, submit_ungrounded_twice])  # two corrections allowed
    report = list(run_best(sales_ds, "sales.csv", ctx, analyst(fake, ctx), fallback=RulesAnalyst(ctx)))[-1]["report"]
    ai, rules = report["evaluation"]["candidates"]
    assert ai["score"] < rules["score"]
    assert report["mode"] == "rules" and report["evaluation"]["winner"] == "rules"
    assert f"scored {ai['score']}" in report["ai_note"] and "rules-based analysis builds this dashboard" in report["ai_note"]


def test_a_rules_only_run_is_evaluated_alone(sales_ds):
    ctx = BusinessContext()
    report = list(run_best(sales_ds, "sales.csv", ctx, RulesAnalyst(ctx)))[-1]["report"]
    assert [c["mode"] for c in report["evaluation"]["candidates"]] == ["rules"]
    assert report["evaluation"]["candidates"][0] == evaluate_report(report)


def test_a_full_per_minute_limit_is_waited_out_instead_of_switching(sales_ds, monkeypatch):
    slept = []
    monkeypatch.setattr("app.agent.llm.time.sleep", slept.append)
    steps = happy_steps()
    groq = ScriptedChat([steps[0], lambda b: httpx.Response(429, json={}, headers={"retry-after": "7"}), *steps[1:]], provider="groq")
    nvidia = ScriptedChat([])
    events, report = run_ai(sales_ds, [groq, nvidia])
    assert (report["provider"], report["provider_switches"]) == ("groq", [])
    assert slept == [7.5] and nvidia.bodies == []
    assert any(e["type"] == "log" and "per-minute limit is full; waiting 7 s" in e["message"] for e in events)


def test_a_long_wait_switches_provider_instead(sales_ds, monkeypatch):
    monkeypatch.setattr("app.agent.llm.time.sleep", lambda s: pytest.fail("should not wait"))
    steps = happy_steps()
    groq = ScriptedChat([steps[0], lambda b: httpx.Response(429, json={}, headers={"retry-after": "45"})], provider="groq")
    _, report = run_ai(sales_ds, [groq, ScriptedChat(steps[1:])])
    assert report["provider"] == "nvidia"


def test_a_request_too_large_for_groq_skips_it_without_calling(sales_ds):
    groq = ScriptedChat([], provider="groq")
    nvidia = ScriptedChat(happy_steps())
    small_groq = ChatBackend("groq", "groq-test", "groq-key", 5, httpx.MockTransport(groq.handler), max_request_tokens=1_000)
    ctx = BusinessContext()
    analyst_ = LLMAnalyst([small_groq, nvidia.backend()], ctx)
    report = list(run_workflow(sales_ds, "sales.csv", ctx, analyst_, fallback=RulesAnalyst(ctx)))[-1]["report"]
    assert groq.bodies == []  # never sent: the workflow prompt alone is far above 1,000 tokens
    assert report["provider"] == "nvidia" and "larger than Groq's per-minute limit" in report["provider_switches"][0]


# ---------------------------------------------------------------- arguments sent as JSON text (seen live from NVIDIA Nemotron)


def test_findings_sent_as_json_text_are_decoded(sales_ds):
    steps = happy_steps()
    original = steps[4]

    def as_text(body):
        args = json.loads(original(body).json()["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"])
        args["findings"] = json.dumps(args["findings"])  # the whole list as one JSON string
        args["findings"] = args["findings"]
        args["hypothesis_results"] = json.dumps(args["hypothesis_results"])
        return reply(call("submit_findings", args, "s2"))

    steps[4] = as_text
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai" and [f["title"] for f in report["findings"]] == [
        "Revenue fell 78.57% in 2025-04",
        "South holds 53.52% of revenue",
    ]
    assert report["hypotheses"][0]["result"] == "supported"


def test_a_plan_sent_as_json_text_is_decoded(sales_ds):
    steps = happy_steps()
    plan = {
        **PLAN,
        "questions": json.dumps(PLAN["questions"]),
        "hypotheses": json.dumps(PLAN["hypotheses"]),
        "assumptions": "One assumption.",
    }
    steps[0] = lambda b: reply(call("register_plan", plan, "p1"))
    _, report = run_ai(sales_ds, ScriptedChat(steps))
    assert report["mode"] == "ai" and [q["id"] for q in report["questions"]] == ["Q1", "Q2"]


def evidence_by_tool(body):
    """Evidence ids returned so far in the conversation, by tool name."""
    names = {c["id"]: c["function"]["name"] for m in body["messages"] for c in (m.get("tool_calls") or [])}
    out = {}
    for m in body["messages"]:
        if m["role"] == "tool":
            data = json.loads(m["content"])
            if "evidence_id" in data:
                out[names[m["tool_call_id"]]] = data["evidence_id"]
    return out


def test_malformed_findings_are_sent_back_instead_of_crashing(sales_ds):
    steps = happy_steps()

    def broken(body):
        return reply(call("submit_findings", {"findings": ["Revenue fell", 42]}, "s1"))

    def fixed_with_single_ids(body):
        assert "every finding must be an object" in last_results(body)["submit_findings"]["error"]
        ids = evidence_by_tool(body)
        finding = {
            "title": "South holds 53.52% of revenue",
            "what_happened": "South has 190 of 355.",
            "evidence_ids": ids["segment_contribution"],  # one string instead of a list
            "confidence": "high",
            "kind": "observed_fact",
            "recommended_action": "Monitor South.",
        }
        return reply(call("submit_findings", {"findings": [finding]}, "s2"))

    _, report = run_ai(sales_ds, ScriptedChat([*steps[:3], broken, fixed_with_single_ids]))
    assert report["mode"] == "ai" and report["findings"][0]["evidence_ids"] and report["findings"][0]["grounded"]


def test_confidence_levels_are_not_data_and_feedback_lists_available_numbers(sales_ds):
    from app.agent.workflow import _numbers_in

    text = "Difference 45.66 (95% confidence interval 12.1 to 79.2), 99% CI, 90 % confidence"
    assert [raw for raw, _ in _numbers_in(text)] == ["45.66", "12.1", "79.2"]

    steps = happy_steps()
    submitted = {}

    def with_wrong_total(body):
        args = json.loads(steps[4](body).json()["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"])
        submitted["args"] = args
        wrong = json.loads(json.dumps(args))
        wrong["findings"][1]["what_happened"] = "South has 191 of 355."
        return reply(call("submit_findings", wrong, "s1"))

    def check_feedback_then_fix(body):
        error = last_results(body)["submit_findings"]["error"]
        assert "['191'] are not in its cited evidence" in error
        assert "numbers there include" in error and "190" in error  # the right value is offered
        assert "Do not calculate percentages" in error
        return reply(call("submit_findings", submitted["args"], "s2"))

    _, report = run_ai(sales_ds, ScriptedChat([*steps[:4], with_wrong_total, check_feedback_then_fix]))
    assert report["mode"] == "ai" and all(f["grounded"] for f in report["findings"])


def test_tool_arguments_the_engine_rejects_are_sent_back_not_crashing(sales_ds):
    from app.agent.tools import Toolbox

    res = Toolbox(sales_ds).call("kpi", {"measures": [{"column": "revenue", "aggregation": "median"}]}, 4)
    assert "Invalid arguments for 'kpi'" in res["error"] and "aggregation" in res["error"]
    res = Toolbox(sales_ds).call("kpi", {"measures": "revenue"}, 4)
    assert "Invalid arguments for 'kpi'" in res["error"]


def test_any_tool_failure_on_odd_arguments_is_reported_to_the_model(sales_ds):
    from app.agent.tools import Toolbox

    res = Toolbox(sales_ds).call("describe_column", {"column": ["revenue", "units"]}, 4)
    assert "error" in res and "evidence_id" not in res


def test_an_unexpected_error_in_one_call_is_reported_to_the_model(sales_ds):
    steps = happy_steps()
    odd = {**PLAN, "primary_measure": ["revenue"]}  # a list where a column name belongs

    def check_then_plan(body):
        assert "could not be processed" in last_results(body)["register_plan"]["error"]
        return reply(call("register_plan", PLAN, "p1"))

    _, report = run_ai(sales_ds, ScriptedChat([lambda b: reply(call("register_plan", odd, "p0")), check_then_plan, *steps[1:]]))
    assert report["mode"] == "ai"


def test_out_of_time_while_correcting_keeps_the_ais_last_findings_flagged(sales_ds):
    steps = happy_steps()[:4]  # plan, investigate, finish, then findings with one invented number
    events, report = run_ai(sales_ds, ScriptedChat(steps), max_steps=4)  # no step left for the correction
    assert report["mode"] == "ai" and report["ai_note"] is None
    assert [f["grounded"] for f in report["findings"]] == [True, False]
    assert report["findings"][1]["unverified_numbers"] == ["999.9"]
    assert report["dashboard"]["unverified_findings"] == ["F2"]  # kept out of the overview
    assert any(e["type"] == "log" and "using the AI's last findings" in e["message"] for e in events)
