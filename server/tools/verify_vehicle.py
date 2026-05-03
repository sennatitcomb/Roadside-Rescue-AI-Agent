"""Verify that a vehicle make/model/year combination is valid."""

# Simplified vehicle database — in production this would call the NHTSA API.
KNOWN_VEHICLES: dict[str, list[str]] = {
    "Toyota": ["Camry", "Corolla", "RAV4", "Highlander", "Tacoma", "Prius"],
    "Honda": ["Civic", "Accord", "CR-V", "Pilot", "Odyssey", "Fit"],
    "Ford": ["F-150", "Mustang", "Explorer", "Escape", "Focus", "Fusion"],
    "Chevrolet": ["Silverado", "Malibu", "Equinox", "Tahoe", "Camaro", "Traverse"],
    "Nissan": ["Altima", "Sentra", "Rogue", "Pathfinder", "Maxima", "Frontier"],
    "Hyundai": ["Elantra", "Sonata", "Tucson", "Santa Fe", "Kona", "Palisade"],
    "Kia": ["Forte", "Optima", "Sorento", "Sportage", "Telluride", "Soul"],
    "BMW": ["3 Series", "5 Series", "X3", "X5"],
    "Tesla": ["Model 3", "Model Y", "Model S", "Model X"],
    "Subaru": ["Outback", "Forester", "Impreza", "Crosstrek", "WRX"],
}

MIN_YEAR = 1990
MAX_YEAR = 2026


def verify_vehicle(make: str, model: str, year: int) -> dict:
    """Check if a make/model/year combination is valid.

    Returns dict with {valid, corrected_make, corrected_model, error}.
    """
    # Normalize and find closest make (case-insensitive)
    corrected_make = None
    for known_make in KNOWN_VEHICLES:
        if known_make.lower() == make.strip().lower():
            corrected_make = known_make
            break

    if corrected_make is None:
        return {
            "valid": False,
            "corrected_make": None,
            "corrected_model": None,
            "error": f"Unknown vehicle make: '{make}'",
        }

    # Find closest model
    corrected_model = None
    for known_model in KNOWN_VEHICLES[corrected_make]:
        if known_model.lower() == model.strip().lower():
            corrected_model = known_model
            break

    if corrected_model is None:
        available = ", ".join(KNOWN_VEHICLES[corrected_make])
        return {
            "valid": False,
            "corrected_make": corrected_make,
            "corrected_model": None,
            "error": f"'{model}' is not a known {corrected_make} model. Known models: {available}",
        }

    # Validate year
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return {
            "valid": False,
            "corrected_make": corrected_make,
            "corrected_model": corrected_model,
            "error": f"Year {year} is out of range ({MIN_YEAR}–{MAX_YEAR})",
        }

    return {
        "valid": True,
        "corrected_make": corrected_make,
        "corrected_model": corrected_model,
        "error": None,
    }
