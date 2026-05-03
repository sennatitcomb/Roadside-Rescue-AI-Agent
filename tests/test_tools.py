"""Unit tests for Roadside Rescue tool functions."""

import sqlite3
import tempfile
from pathlib import Path

import pytest
from server.db.seed import seed
from server.tools.verify_vehicle import verify_vehicle


@pytest.fixture()
def seeded_db(tmp_path):
    """Create a temporary seeded database and patch tool imports to use it."""
    db_path = tmp_path / "test.db"
    seed(db_path)
    return db_path


def _get_connection(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


# ── verify_vehicle tests (now async, calls NHTSA API) ──


@pytest.mark.asyncio
async def test_verify_valid_vehicle():
    result = await verify_vehicle("Honda", "Accord", 2020)
    assert result["valid"] is True
    assert result["corrected_make"].lower() == "honda"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_verify_case_insensitive():
    result = await verify_vehicle("honda", "civic", 2019)
    assert result["valid"] is True
    assert result["error"] is None


@pytest.mark.asyncio
async def test_verify_invalid_make():
    result = await verify_vehicle("Foobar", "Sedan", 2020)
    assert result["valid"] is False
    assert result["error"] is not None


@pytest.mark.asyncio
async def test_verify_invalid_model():
    result = await verify_vehicle("Ford", "Civic", 2020)
    assert result["valid"] is False
    assert result["error"] is not None


@pytest.mark.asyncio
async def test_verify_year_out_of_range():
    result = await verify_vehicle("Toyota", "Camry", 1940)
    assert result["valid"] is False
    assert "out of range" in result["error"]


# ── get_available_slots tests ──


def test_get_slots_returns_results(seeded_db, monkeypatch):
    monkeypatch.setattr(
        "server.tools.get_slots.get_connection", lambda: _get_connection(seeded_db)
    )
    from server.tools.get_slots import get_available_slots

    slots = get_available_slots("98101")
    assert len(slots) > 0
    assert all(s["zip_code"] == "98101" for s in slots)


def test_get_slots_empty_zip(seeded_db, monkeypatch):
    monkeypatch.setattr(
        "server.tools.get_slots.get_connection", lambda: _get_connection(seeded_db)
    )
    from server.tools.get_slots import get_available_slots

    slots = get_available_slots("00000")
    assert slots == []


# ── book_mechanic tests ──


def test_book_mechanic_success(seeded_db, monkeypatch):
    monkeypatch.setattr(
        "server.tools.book_mechanic.get_connection", lambda: _get_connection(seeded_db)
    )
    from server.tools.book_mechanic import book_mechanic

    # Get a valid slot_id first
    conn = _get_connection(seeded_db)
    slot = conn.execute(
        "SELECT id FROM available_slots WHERE is_booked = 0 LIMIT 1"
    ).fetchone()
    conn.close()

    result = book_mechanic(
        customer_phone="555-1234",
        zip_code="98101",
        vehicle_make="Honda",
        vehicle_model="Accord",
        vehicle_year=2020,
        slot_id=slot["id"],
    )
    assert "booking_id" in result
    assert "mechanic_name" in result
    assert result["confirmation_msg"]


def test_book_mechanic_already_booked(seeded_db, monkeypatch):
    monkeypatch.setattr(
        "server.tools.book_mechanic.get_connection", lambda: _get_connection(seeded_db)
    )
    from server.tools.book_mechanic import book_mechanic

    # Get a slot and book it
    conn = _get_connection(seeded_db)
    slot = conn.execute(
        "SELECT id FROM available_slots WHERE is_booked = 0 LIMIT 1"
    ).fetchone()
    conn.execute("UPDATE available_slots SET is_booked = 1 WHERE id = ?", (slot["id"],))
    conn.commit()
    conn.close()

    result = book_mechanic(
        customer_phone="555-1234",
        zip_code="98101",
        vehicle_make="Honda",
        vehicle_model="Accord",
        vehicle_year=2020,
        slot_id=slot["id"],
    )
    assert "error" in result
    assert "already booked" in result["error"]


def test_book_mechanic_invalid_slot(seeded_db, monkeypatch):
    monkeypatch.setattr(
        "server.tools.book_mechanic.get_connection", lambda: _get_connection(seeded_db)
    )
    from server.tools.book_mechanic import book_mechanic

    result = book_mechanic(
        customer_phone="555-1234",
        zip_code="98101",
        vehicle_make="Honda",
        vehicle_model="Accord",
        vehicle_year=2020,
        slot_id=99999,
    )
    assert "error" in result
    assert "not found" in result["error"]
