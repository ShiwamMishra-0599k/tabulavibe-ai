"""Synthetic sample datasets bundled with the app (see scripts/generate_samples.py)."""

from pathlib import Path

SAMPLES_DIR = Path(__file__).parent / "samples"

SAMPLES = {
    "retail-sales": {
        "file": "retail_sales.csv",
        "title": "Retail sales (CSV)",
        "description": "720 fictional orders across 4 regions and 5 product categories in 2025, with a few deliberate quality issues.",
        "media_type": "text/csv",
    },
    "service-bookings": {
        "file": "service_bookings.xlsx",
        "title": "Salon bookings (Excel)",
        "description": "300 fictional salon bookings over six months with services, staff, amounts and ratings.",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}


def list_samples() -> list[dict[str, str]]:
    return [{"id": key, "file_name": s["file"], "title": s["title"], "description": s["description"]} for key, s in SAMPLES.items()]
