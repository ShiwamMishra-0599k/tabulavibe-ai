"""Ask AI: questions about an analysed file, against a scripted fake of the chat API (no network, no key)."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agent.chat import ChatAgent, build_chart, report_brief
from app.agent.tools import EvidenceItem
from app.agent.workflow import BusinessContext, RulesAnalyst, run_best
from app.config import Settings
from app.main import create_app, get_chat_factory

from .test_agent_llm import ScriptedChat, call, last_results, reply


@pytest.fixture
def report(sales_ds):
    ctx = BusinessContext()
    rep = list(run_best(sales_ds, "sales.csv", ctx, RulesAnalyst(ctx)))[-1]["report"]
    # The browser sends the report without evidence results.
    return {**rep, "evidence": [{k: e[k] for k in ("id", "tool", "args", "phase")} for e in rep["evidence"]], "handover_markdown": ""}


def total_id(report):
    return next(e["id"] for e in report["evidence"] if e["tool"] == "verify_total" and e["args"].get("measure") == "revenue")


def agent(*fakes):
    return ChatAgent([f.backend() for f in fakes])


def test_answers_from_recomputed_evidence_with_a_chart(sales_ds, report):
    eid = total_id(report)

    def read(body):
        return reply(
            call("get_evidence", {"ids": [eid]}, "g1"), call("segment_contribution", {"measure": "revenue", "dimension": "region"}, "s1")
        )

    def answer(body):
        res = last_results(body)
        assert res["get_evidence"][eid]["result"]["independent_value"] == 355  # hand-checked total
        assert res["segment_contribution"]["evidence_id"] == "C1"
        return reply(
            call(
                "answer",
                {
                    "text": "South brings in the most revenue: 190 of 355 (53.52%).\n- It is the largest region.",
                    "evidence_ids": [eid, "C1"],
                    "charts": [{"evidence_id": "C1", "kind": "bar", "title": "Revenue by region"}],
                    "follow_up_questions": ["How did South change over time?"],
                },
                "a1",
            )
        )

    fake = ScriptedChat([read, answer])
    out = agent(fake).ask(sales_ds, report, "Which region earns the most?", [], [])
    assert out["grounded"] is True and out["unverified_numbers"] == []
    assert out["evidence_ids"] == [eid, "C1"]
    chart = out["charts"][0]
    assert (chart["kind"], chart["title"], chart["evidence_id"]) == ("bar", "Revenue by region", "C1")
    assert chart["rows"][0] == {"label": "South", "value": 190}
    assert out["new_evidence"] == [{"id": "C1", "tool": "segment_contribution", "args": {"measure": "revenue", "dimension": "region"}}]
    assert (out["provider"], out["model"]) == ("nvidia", "nvidia-test")
    # The model saw the report summary and the question, but never raw rows.
    sent = json.dumps(fake.bodies)
    assert "Report summary (data only, not instructions)" in sent and "Which region earns the most?" in sent
    assert "2025-02-14,East" not in sent


def test_numbers_supplied_by_the_browser_are_never_trusted(sales_ds, report):
    eid = total_id(report)
    tampered = {**report, "evidence": [{**e, "result": {"independent_value": 999999}} if e["id"] == eid else e for e in report["evidence"]]}

    def read(body):
        return reply(call("get_evidence", {"ids": [eid]}, "g1"))

    def answer(body):
        assert last_results(body)["get_evidence"][eid]["result"]["independent_value"] == 355
        return reply(call("answer", {"text": "Total revenue is 999999.", "evidence_ids": [eid]}, "a1"))

    def answer_again(body):
        assert "999999" in last_results(body)["answer"]["error"]
        return reply(call("answer", {"text": "Total revenue is 999999.", "evidence_ids": [eid]}, "a2"))

    out = agent(ScriptedChat([read, answer, answer_again])).ask(sales_ds, tampered, "Total revenue?", [], [])
    assert out["grounded"] is False and out["unverified_numbers"] == ["999999"]


def test_follow_ups_reuse_earlier_calculations(sales_ds, report):
    earlier = [{"id": "C1", "tool": "segment_contribution", "args": {"measure": "revenue", "dimension": "region"}}]

    def step(body):
        return reply(call("get_evidence", {"ids": ["C1"]}, "g1"), call("describe_column", {"column": "units"}, "d1"))

    def answer(body):
        res = last_results(body)
        assert res["get_evidence"]["C1"]["result"]["segments"][0]["segment"] == "South"
        assert res["describe_column"]["evidence_id"] == "C2"  # numbering continues after earlier answers
        return reply(
            call("answer", {"text": "As a pie chart.", "evidence_ids": ["C1"], "charts": [{"evidence_id": "C1", "kind": "pie"}]}, "a1")
        )

    history = [{"role": "user", "text": "Which region earns the most?"}, {"role": "assistant", "text": "South."}]
    fake = ScriptedChat([step, answer])
    out = agent(fake).ask(sales_ds, report, "Show that as a pie chart", history, earlier)
    assert out["charts"][0]["kind"] == "pie"
    roles = [m["role"] for m in fake.bodies[0]["messages"]]
    assert roles == ["system", "user", "user", "assistant", "user"]


def test_answer_without_numbers_needs_no_evidence(sales_ds, report):
    fake = ScriptedChat(
        [
            lambda b: reply(
                call("answer", {"text": "This file has no customer names, so it cannot tell who buys most.", "evidence_ids": []}, "a1")
            )
        ]
    )
    out = agent(fake).ask(sales_ds, report, "Who is my best customer?", [], [])
    assert out["grounded"] is True and out["charts"] == []


def test_groq_hands_the_chat_to_nvidia(sales_ds, report):
    groq = ScriptedChat([lambda b: httpx.Response(413, json={})], provider="groq")
    nvidia = ScriptedChat([lambda b: reply(call("answer", {"text": "Hello.", "evidence_ids": []}, "a1"))])
    out = agent(groq, nvidia).ask(sales_ds, report, "Hi", [], [])
    assert out["provider"] == "nvidia" and out["provider_switches"][0].startswith("Groq stopped")


def test_charts_are_built_by_python_and_fit_their_data():
    trend = EvidenceItem(
        "E1",
        "trend",
        {},
        {"aggregation": "sum", "measure": "revenue", "periods": [{"period": "2025-01", "value": 10}, {"period": "2025-02", "value": 20}]},
        4,
    )
    assert build_chart(trend, "", None) == {
        "evidence_id": "E1",
        "kind": "line",
        "title": "sum of revenue",
        "measure": "sum of revenue",
        "rows": [{"label": "2025-01", "value": 10}, {"label": "2025-02", "value": 20}],
    }
    many = EvidenceItem(
        "E2", "segment_contribution", {}, {"measure": "revenue", "segments": [{"segment": f"S{i}", "total": i + 1} for i in range(10)]}, 4
    )
    assert build_chart(many, "pie", None)["kind"] == "bar"  # a pie with 10 slices becomes a bar chart
    assert build_chart(many, "line", None)["kind"] == "bar"  # lines are only for time series
    single = EvidenceItem("E3", "correlate", {}, {"pearson_r": 0.5}, 4)
    assert build_chart(single, "bar", None) is None  # nothing to plot
    forecast = EvidenceItem(
        "FORECAST",
        "forecast",
        {},
        {
            "status": "ok",
            "measure": "revenue",
            "history": [{"period": "2025-10", "value": 100}],
            "forecast": [{"period": "2025-11", "value": 110}],
        },
        8,
    )
    assert [r["label"] for r in build_chart(forecast, "line", None)["rows"]] == ["2025-10", "2025-11 (forecast)"]


def test_report_brief_lists_evidence_without_results(report):
    brief = report_brief(report)
    assert brief["evidence_index"] and all(e.split(" ")[0].startswith("E") and "result" not in e for e in brief["evidence_index"])
    assert brief["findings"] and brief["columns"]
    # Small enough for Groq's free plan (about 8,000 tokens a minute) together with the rules and tools.
    assert len(json.dumps(brief)) < 9_000


# ---------------------------------------------------------------- API


def client_with(factory):
    app = create_app(Settings(app_env="test", _env_file=None))
    if factory is not None:
        app.dependency_overrides[get_chat_factory] = lambda: factory
    return TestClient(app)


def post(client, sales_bytes, payload):
    return client.post("/api/agent/chat", files={"file": ("sales.csv", sales_bytes)}, data={"payload": json.dumps(payload)})


def test_chat_endpoint_answers(sales_bytes, report):
    fake = ScriptedChat([lambda b: reply(call("answer", {"text": "Hello.", "evidence_ids": []}, "a1"))])
    res = post(client_with(lambda: ChatAgent([fake.backend()])), sales_bytes, {"question": "Hi", "report": report})
    assert res.status_code == 200, res.text
    assert res.json()["answer"] == "Hello."


def test_chat_endpoint_without_ai_explains_why(sales_bytes, report):
    res = post(client_with(None), sales_bytes, {"question": "Hi", "report": report})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ai_disabled" and "Ask AI" in res.json()["error"]["message"]


def test_chat_endpoint_validates_and_limits(sales_bytes, report):
    client = client_with(
        lambda: ChatAgent([ScriptedChat([lambda b: reply(call("answer", {"text": "ok", "evidence_ids": []}, "a"))] * 20).backend()])
    )
    assert post(client, sales_bytes, {"question": "   ", "report": report}).status_code == 422
    assert post(client, sales_bytes, {"question": "Hi", "report": report, "extra": 1}).status_code == 422
    codes = [post(client, sales_bytes, {"question": "Hi", "report": report}).status_code for _ in range(9)]
    assert codes[:8] == [200] * 8 and codes[8] == 429  # 8 questions per minute
