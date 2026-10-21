import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.config import Settings
from app.ingest import load_table
from app.main import create_app
from app.profiling import build_dataset

# Hand-checked fixture. Expected values (see tests) were calculated by hand:
# units:   10,5,3,_,7,7,2,4,1,6        -> n=9, sum=45, mean=5, min=1, max=10
# revenue: 50,50,15,_,70,70,40,20,10,30 -> n=9, sum=355
# revenue by region: South 190 (3 rows), North 135 (4), East 20 (2), West 10 (1)
# row 6 duplicates row 5; row 7 has an invalid date.
SALES_CSV = """date,region,product,units,price,revenue,notes
2025-01-05,North,A,10,5.00,50.00,ok
2025-01-20,South,B,5,10.00,50.00,
2025-02-03,North,A,3,5.00,15.00,"=HYPERLINK(""x"")"
2025-02-14,East,C,,20.00,,n/a
2025-03-01,South,B,7,10.00,70.00,-cmd
2025-03-01,South,B,7,10.00,70.00,-cmd
not-a-date,North,C,2,20.00,40.00,
2025-04-10,East,A,4,5.00,20.00,
2025-04-11,West,B,1,10.00,10.00,
2025-05-30,North,A,6,5.00,30.00,
"""


@pytest.fixture
def settings() -> Settings:
    return Settings(app_env="test", ai_provider="none", _env_file=None)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))


@pytest.fixture
def sales_bytes() -> bytes:
    return SALES_CSV.encode("utf-8")


@pytest.fixture
def sales_ds(settings, sales_bytes):
    return build_dataset(load_table("sales.csv", sales_bytes, settings))


def make_xlsx(rows: list[list], sheet: str = "Data") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    for row in rows:
        ws.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
