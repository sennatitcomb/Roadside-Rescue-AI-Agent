"""Query available mechanic slots by zip code."""

from server.tools.db import get_connection


def get_available_slots(zip_code: str) -> list[dict]:
    """Return available (unbooked) mechanic slots for the given zip code.

    Results are sorted by date/time (soonest first).
    """
    conn = get_connection()
    cursor = conn.execute(
        """
        SELECT
            s.id AS slot_id,
            m.name AS mechanic_name,
            m.specialty,
            s.date,
            s.time,
            s.zip_code
        FROM available_slots s
        JOIN mechanics m ON s.mechanic_id = m.id
        WHERE s.zip_code = ? AND s.is_booked = 0
        ORDER BY s.date, s.time
        """,
        (zip_code,),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows
