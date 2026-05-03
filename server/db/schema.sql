-- Roadside Rescue SQLite Schema

CREATE TABLE IF NOT EXISTS mechanics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    zip_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS available_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mechanic_id INTEGER NOT NULL,
    date TEXT NOT NULL,          -- ISO format: YYYY-MM-DD
    time TEXT NOT NULL,          -- 24h format: HH:MM
    zip_code TEXT NOT NULL,
    is_booked INTEGER DEFAULT 0, -- 0 = available, 1 = booked
    FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT UNIQUE NOT NULL,  -- UUID for customer reference
    customer_phone TEXT NOT NULL,
    vehicle_make TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    vehicle_year INTEGER NOT NULL,
    zip_code TEXT NOT NULL,
    slot_id INTEGER NOT NULL,
    mechanic_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (slot_id) REFERENCES available_slots(id),
    FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);
