"""Seed the SQLite database with mock mechanics and available slots."""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "roadside_rescue.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

MECHANICS = [
    ("Mike Torres", "206-555-0101", "98101"),
    ("Sarah Chen", "206-555-0102", "98101"),
    ("Lisa Park", "206-555-0103", "98122"),
    ("James Okafor", "310-555-0201", "90210"),
    ("Priya Patel", "310-555-0202", "90210"),
    ("Carlos Rivera", "512-555-0301", "73301"),
    ("David Kim", "206-555-0104", "98109"),
    ("Bob Jones", "204-829-4328", "98104"),
]

ZIP_CODES = ["98101", "98104", "98101", "98122", "90210", "90210", "73301", "98109"]


def seed(db_path: Path = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Apply schema (drops and recreates tables)
    cursor.executescript(SCHEMA_PATH.read_text())

    # Insert mechanics
    cursor.executemany(
        "INSERT INTO mechanics (name, phone, zip_code) VALUES (?, ?, ?)",
        MECHANICS,
    )

    # Generate slots: 4 slots per mechanic over the next 24 hours
    now = datetime.now()
    base_hour = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    slots = []
    for mechanic_id in range(1, len(MECHANICS) + 1):
        zip_code = ZIP_CODES[mechanic_id - 1]
        for offset in range(4):
            slot_time = base_hour + timedelta(hours=offset * 2)
            slots.append(
                (
                    mechanic_id,
                    slot_time.strftime("%Y-%m-%d"),
                    slot_time.strftime("%H:%M"),
                    zip_code,
                )
            )

    cursor.executemany(
        "INSERT INTO available_slots (mechanic_id, date, time, zip_code) VALUES (?, ?, ?, ?)",
        slots,
    )

    conn.commit()
    conn.close()
    print(f"Seeded {len(MECHANICS)} mechanics and {len(slots)} slots into {db_path}")


if __name__ == "__main__":
    seed()
