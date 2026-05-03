"""Book a mechanic slot for a customer."""

import uuid

from server.tools.db import get_connection


def book_mechanic(
    customer_phone: str,
    zip_code: str,
    vehicle_make: str,
    vehicle_model: str,
    vehicle_year: int,
    slot_id: int,
) -> dict:
    """Book a specific slot for the customer.

    NOTE: Intentionally no row-level locking — concurrent calls can double-book.
    This is a deliberate limitation for interview discussion.

    Returns dict with {booking_id, mechanic_name, date, time, confirmation_msg}
    or {error} on failure.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Check slot exists and is available
    slot = cursor.execute(
        """
        SELECT s.id, s.mechanic_id, s.date, s.time, s.is_booked, m.name AS mechanic_name
        FROM available_slots s
        JOIN mechanics m ON s.mechanic_id = m.id
        WHERE s.id = ?
        """,
        (slot_id,),
    ).fetchone()

    if slot is None:
        conn.close()
        return {"error": f"Slot {slot_id} not found"}

    if slot["is_booked"]:
        conn.close()
        return {"error": f"Slot {slot_id} is already booked"}

    booking_id = str(uuid.uuid4())[:8].upper()

    # Mark slot as booked
    cursor.execute("UPDATE available_slots SET is_booked = 1 WHERE id = ?", (slot_id,))

    # Create booking record
    cursor.execute(
        """
        INSERT INTO bookings (booking_id, customer_phone, vehicle_make, vehicle_model,
                              vehicle_year, zip_code, slot_id, mechanic_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            booking_id,
            customer_phone,
            vehicle_make,
            vehicle_model,
            vehicle_year,
            zip_code,
            slot_id,
            slot["mechanic_id"],
        ),
    )

    conn.commit()
    conn.close()

    return {
        "booking_id": booking_id,
        "mechanic_name": slot["mechanic_name"],
        "date": slot["date"],
        "time": slot["time"],
        "confirmation_msg": (
            f"Booking confirmed! {slot['mechanic_name']} will arrive on "
            f"{slot['date']} at {slot['time']}. Your confirmation code is {booking_id}."
        ),
    }
