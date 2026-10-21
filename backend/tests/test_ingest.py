import io
import zipfile
from datetime import date, datetime

import pytest

from app.config import Settings
from app.errors import DataError
from app.ingest import load_table

from .conftest import make_xlsx


def test_csv_parsing_reads_header_and_rows(settings, sales_bytes):
    table = load_table("sales.csv", sales_bytes, settings)
    assert list(table.frame.columns) == ["date", "region", "product", "units", "price", "revenue", "notes"]
    assert len(table.frame) == 10
    assert table.frame.iloc[2]["notes"] == '=HYPERLINK("x")'
    assert table.file_type == "csv"


def test_csv_semicolon_and_bom_and_whitespace(settings):
    content = b"\xef\xbb\xbf" + b"name ; amount\n alpha ; 1\nbeta;2\n"  # UTF-8 byte-order mark
    table = load_table("x.csv", content, settings)
    assert list(table.frame.columns) == ["name", "amount"]
    assert table.frame["name"].tolist() == ["alpha", "beta"]
    assert any("semicolon" in n for n in table.notes)


def test_csv_windows_1252_fallback(settings):
    content = "city,amount\nS\xe3o Paulo,5\n".encode("cp1252")
    table = load_table("x.csv", content, settings)
    assert table.frame.iloc[0]["city"] == "São Paulo"
    assert any("Windows-1252" in n for n in table.notes)


def test_blank_and_duplicate_headers_are_renamed(settings):
    table = load_table("x.csv", b"a,,a,A\n1,2,3,4\n", settings)
    assert list(table.frame.columns) == ["a", "column_2", "a_2", "A_3"]


def test_empty_rows_are_skipped_and_reported(settings):
    table = load_table("x.csv", b"a,b\n1,2\n,\n3,4\n\n", settings)
    assert len(table.frame) == 2
    assert table.empty_rows_dropped == 1


def test_short_rows_are_padded(settings):
    table = load_table("x.csv", b"a,b,c\n1,2\n", settings)
    assert table.frame.iloc[0].tolist() == ["1", "2", ""]


def test_xlsx_parsing_converts_native_types(settings):
    content = make_xlsx(
        [
            ["Day", "Amount", "Paid", "When"],
            [date(2025, 3, 1), 12.5, True, datetime(2025, 3, 1, 14, 30)],
            [date(2025, 3, 2), 7, False, None],
        ]
    )
    table = load_table("book.xlsx", content, settings)
    assert table.sheet_name == "Data"
    assert table.frame.values.tolist() == [
        ["2025-03-01", "12.5", "true", "2025-03-01 14:30:00"],
        ["2025-03-02", "7", "false", ""],
    ]
    assert any("Formulas are not evaluated" in n for n in table.notes)


def test_xlsx_formula_is_not_evaluated(settings):
    # A workbook written by openpyxl has formulas but no cached values, so the cell reads as empty.
    content = make_xlsx([["a", "b"], [1, "=1+1"]])
    table = load_table("f.xlsx", content, settings)
    assert table.frame.iloc[0]["b"] == ""


def test_xlsx_only_first_sheet_is_read(settings):
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.append(["x"])
    wb.active.append([1])
    wb.create_sheet("Second").append(["y"])
    buffer = io.BytesIO()
    wb.save(buffer)
    table = load_table("two.xlsx", buffer.getvalue(), settings)
    assert any("Only the first worksheet" in n for n in table.notes)


@pytest.mark.parametrize("name", ["data.xls", "data.xlsm", "data.txt", "data.json", "data", "data.csv.exe"])
def test_unsupported_extensions_are_rejected(settings, name):
    with pytest.raises(DataError) as err:
        load_table(name, b"a,b\n1,2\n", settings)
    assert err.value.code == "unsupported_file_type"
    assert err.value.status_code == 415


def test_xlsx_extension_with_csv_content_is_rejected(settings):
    with pytest.raises(DataError) as err:
        load_table("fake.xlsx", b"a,b\n1,2\n", settings)
    assert err.value.code == "content_mismatch"


def test_csv_extension_with_zip_content_is_rejected(settings):
    with pytest.raises(DataError) as err:
        load_table("fake.csv", make_xlsx([["a"], [1]]), settings)
    assert err.value.code == "content_mismatch"


def test_binary_content_as_csv_is_rejected(settings):
    with pytest.raises(DataError) as err:
        load_table("fake.csv", b"\x89PNG\r\n\x1a\n\x00\x00\x00", settings)
    assert err.value.code == "content_mismatch"


def test_macro_workbook_is_rejected(settings):
    buffer = io.BytesIO(make_xlsx([["a"], [1]]))
    with zipfile.ZipFile(buffer, "a") as archive:
        archive.writestr("xl/vbaProject.bin", b"fake macro")
    with pytest.raises(DataError) as err:
        load_table("macro.xlsx", buffer.getvalue(), settings)
    assert err.value.code == "macros_not_allowed"


def test_random_zip_is_not_accepted_as_xlsx(settings):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("hello.txt", "hi")
    with pytest.raises(DataError) as err:
        load_table("x.xlsx", buffer.getvalue(), settings)
    assert err.value.code == "content_mismatch"


@pytest.mark.parametrize("content", [b"", b"   \n\n"])
def test_empty_files_are_rejected(settings, content):
    with pytest.raises(DataError) as err:
        load_table("x.csv", content, settings)
    assert err.value.code == "empty_file"


def test_header_only_file_is_rejected(settings):
    with pytest.raises(DataError) as err:
        load_table("x.csv", b"a,b,c\n", settings)
    assert err.value.code == "no_data_rows"


def test_oversized_file_is_rejected():
    small = Settings(max_upload_mb=0.001, _env_file=None)  # ~1 KB
    with pytest.raises(DataError) as err:
        load_table("x.csv", b"a\n" + b"1\n" * 1000, small)
    assert err.value.code == "file_too_large"
    assert err.value.status_code == 413


def test_row_limit_is_enforced():
    small = Settings(max_rows=5, _env_file=None)
    with pytest.raises(DataError) as err:
        load_table("x.csv", b"a\n" + b"1\n" * 6, small)
    assert err.value.code == "too_many_rows"
    assert load_table("x.csv", b"a\n" + b"1\n" * 5, small).frame.shape == (5, 1)


def test_column_limit_is_enforced_for_csv_and_xlsx():
    small = Settings(max_columns=3, _env_file=None)
    with pytest.raises(DataError) as err:
        load_table("x.csv", b"a,b,c,d\n1,2,3,4\n", small)
    assert err.value.code == "too_many_columns"
    with pytest.raises(DataError) as err:
        load_table("x.xlsx", make_xlsx([["a", "b", "c", "d"], [1, 2, 3, 4]]), small)
    assert err.value.code == "too_many_columns"


def test_cell_limit_is_enforced():
    small = Settings(max_cells=10, _env_file=None)
    with pytest.raises(DataError) as err:
        load_table("x.csv", b"a,b\n" + b"1,2\n" * 6, small)
    assert err.value.code == "too_many_cells"
