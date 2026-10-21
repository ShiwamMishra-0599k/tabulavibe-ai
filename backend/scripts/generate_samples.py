"""Generate the synthetic sample datasets shipped with the app.

All data is fictional and produced from a fixed random seed. Some quality issues are
introduced on purpose (missing values, duplicates, invalid numbers, inconsistent labels)
so the data-quality report has something to show.

Run from the backend folder:  .venv\\Scripts\\python.exe scripts\\generate_samples.py
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook

OUT = Path(__file__).resolve().parents[1] / "app" / "samples"


def retail_sales(rng: random.Random) -> None:
    regions = ["North", "South", "East", "West"]
    categories = {"Beverages": 80, "Snacks": 45, "Household": 220, "Personal Care": 160, "Stationery": 30}
    channels = ["Store", "Online"]
    rows = []
    start = date(2025, 1, 1)
    for i in range(1, 721):
        day = start + timedelta(days=rng.randrange(0, 365))
        region = rng.choice(regions)
        category = rng.choice(list(categories))
        units = rng.randint(1, 40)
        price = round(categories[category] * rng.uniform(0.85, 1.15), 2)
        seasonal = 1.25 if day.month in (10, 11, 12) else 1.0
        units = max(1, round(units * seasonal))
        revenue = round(units * price, 2)
        discount = rng.choice([0, 0, 0, 5, 10, 15])
        rows.append([f"ORD-{i:05d}", day.isoformat(), region, category, rng.choice(channels), units, price, revenue, discount])
    rows.sort(key=lambda r: r[1])

    # Deliberate quality issues.
    for idx in rng.sample(range(len(rows)), 18):
        rows[idx][7] = ""  # missing revenue
    for idx in rng.sample(range(len(rows)), 6):
        rows[idx][5] = "n/a"  # missing units
    for idx in rng.sample(range(len(rows)), 3):
        rows[idx][6] = "TBD"  # invalid price
    for idx in rng.sample(range(len(rows)), 4):
        rows[idx][2] = rows[idx][2].lower()  # inconsistent label casing
    for idx in rng.sample(range(len(rows)), 5):
        rows.insert(idx + 1, list(rows[idx]))  # exact duplicate rows

    with open(OUT / "retail_sales.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["order_id", "order_date", "region", "category", "channel", "units", "unit_price", "revenue", "discount_pct"])
        writer.writerows(rows)


def service_bookings(rng: random.Random) -> None:
    services = {"Haircut": 350, "Spa": 1800, "Facial": 1200, "Manicure": 600, "Hair Colour": 2500}
    staff = ["Asha", "Ravi", "Meera", "Karan"]
    wb = Workbook()
    ws = wb.active
    ws.title = "Bookings"
    ws.append(["Booking ID", "Booking Date", "Service", "Staff", "Amount (INR)", "Duration (min)", "Repeat Customer", "Rating"])
    start = date(2025, 4, 1)
    for i in range(1, 301):
        service = rng.choice(list(services))
        amount = services[service] + rng.choice([0, 0, 100, 200, -50])
        rating = rng.choice([3, 4, 4, 5, 5, None])
        ws.append(
            [
                f"BK{i:04d}",
                start + timedelta(days=rng.randrange(0, 180)),
                service,
                rng.choice(staff),
                amount,
                rng.choice([30, 45, 60, 90, 120]),
                rng.choice(["Yes", "No"]),
                rating,
            ]
        )
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
        row[0].number_format = "dd-mm-yyyy"
    wb.save(OUT / "service_bookings.xlsx")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    retail_sales(random.Random(42))
    service_bookings(random.Random(7))
    print(f"Samples written to {OUT}")
