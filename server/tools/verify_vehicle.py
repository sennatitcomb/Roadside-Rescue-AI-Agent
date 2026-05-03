"""Verify a vehicle make/model/year using the NHTSA Vehicle API.

API docs: https://vpic.nhtsa.dot.gov/api/
No API key required. Free and unlimited.
"""

import httpx

NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles"


async def verify_vehicle(make: str, model: str, year: int) -> dict:
    """Check if a make/model/year combination exists in the NHTSA database.

    Returns dict with {valid, corrected_make, corrected_model, error}.
    """
    make = make.strip()
    model = model.strip()

    # Validate year range
    if not (1950 <= year <= 2026):
        return {
            "valid": False,
            "corrected_make": make,
            "corrected_model": model,
            "error": f"Year {year} is out of range (1950–2026)",
        }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Query NHTSA for models matching this make and year
            url = f"{NHTSA_BASE}/getmodelsformakeyear/make/{make}/modelyear/{year}?format=json"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("Results", [])

        if not results:
            # No models found for this make — try just the make to see if it exists
            return {
                "valid": False,
                "corrected_make": make,
                "corrected_model": None,
                "error": f"No vehicles found for make '{make}' in year {year}",
            }

        # Search for a matching model (case-insensitive)
        model_lower = model.lower()
        for entry in results:
            nhtsa_model = entry.get("Model_Name", "")
            if nhtsa_model.lower() == model_lower:
                return {
                    "valid": True,
                    "corrected_make": entry.get("Make_Name", make),
                    "corrected_model": nhtsa_model,
                    "error": None,
                }

        # No exact match — find close matches to suggest
        available = [r.get("Model_Name", "") for r in results[:10]]
        return {
            "valid": False,
            "corrected_make": results[0].get("Make_Name", make),
            "corrected_model": None,
            "error": f"'{model}' is not a known {make} model for {year}. Similar models: {', '.join(available)}",
        }

    except httpx.HTTPError as e:
        # Fallback: if NHTSA API is down, accept the vehicle
        print(f"[NHTSA] API error: {e}, accepting vehicle as valid")
        return {
            "valid": True,
            "corrected_make": make,
            "corrected_model": model,
            "error": None,
        }
