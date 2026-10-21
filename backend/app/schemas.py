"""Request models. Responses are plain dicts built by the service modules."""

from datetime import date
from typing import Literal

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


class CleanOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remove_duplicates: bool = False
