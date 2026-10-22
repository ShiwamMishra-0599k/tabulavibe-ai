"""Request models. Responses are plain dicts built by the service modules."""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Aggregation = Literal["sum", "mean", "count", "min", "max"]
TimeGrain = Literal["day", "week", "month", "quarter", "year"]


class Measure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # column=None with aggregation="count" means "number of rows".
    column: str | None = Field(None, max_length=200)
    aggregation: Aggregation

    @model_validator(mode="after")
    def _column_required(self) -> "Measure":
        if self.column is None and self.aggregation != "count":
            raise ValueError(f"'{self.aggregation}' needs a column; only 'count' can be used without one")
        return self


class Filter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    column: str = Field(max_length=200)
    values: list[str] | None = Field(None, max_length=500)
    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def _one_kind(self) -> "Filter":
        has_values = self.values is not None
        has_range = self.start is not None or self.end is not None
        if has_values == has_range:
            raise ValueError("a filter needs either 'values' or a 'start'/'end' date range")
        if self.start and self.end and self.start > self.end:
            raise ValueError("filter 'start' must be on or before 'end'")
        return self


class AnalysisSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    measures: list[Measure] = Field(min_length=1, max_length=6)
    group_by: str | None = Field(None, max_length=200)
    time_grain: TimeGrain = "month"
    filters: list[Filter] = Field(default_factory=list, max_length=10)
    remove_duplicates: bool = False
    # Treat category labels that differ only by letter case or spacing as one value.
    merge_label_variants: bool = False


class CleanOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remove_duplicates: bool = False
    merge_label_variants: bool = False


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    text: str = Field(max_length=6_000)


class ChatRequest(BaseModel):
    """One "Ask AI" question about an analysed file. The report is sent without evidence results: the
    server recomputes any evidence it reads from the file."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1_000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    report: dict[str, Any]
    # Calculations made by earlier answers ({id, tool, args}), so follow-up questions can refer to them.
    chat_evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=60)

    @model_validator(mode="after")
    def _strip(self) -> "ChatRequest":
        self.question = self.question.strip()
        if not self.question:
            raise ValueError("question must not be empty")
        return self


class ReportExportRequest(BaseModel):
    """Download the final report as a PDF or PowerPoint file, built from already-computed results."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["pdf", "pptx"]
    kind: Literal["manual", "agent"]
    title: str | None = Field(None, max_length=200)
    # manual: {dataset, issues, result, narrative?, chart_kind?, measure_key?}; agent: the AI analyst report
    data: dict[str, Any]

    @model_validator(mode="after")
    def _clean_text(self) -> "ReportExportRequest":
        # JSON may carry lone surrogates ("\udc81"), which cannot be written to a file; replace them.
        self.data = _clean(self.data)
        return self


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, dict):
        return {_clean(k): _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


class SavedNarrative(BaseModel):
    """AI commentary the user chose to keep with a saved report (as returned by /api/narrative)."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(max_length=50)
    model: str = Field(max_length=100)
    text: str = Field(max_length=8_000)
    generated_at: str = Field(max_length=50)
    disclaimer: str = Field(max_length=1_000)
    shared_payload: dict[str, Any]
