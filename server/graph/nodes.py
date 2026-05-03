"""Graph node functions and LangChain tool wrappers for Roadside Rescue."""

import os

from langchain_core.messages import SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from server.graph.state import ConversationState
from server.prompts.system import SYSTEM_PROMPT
from server.tools.book_mechanic import book_mechanic as _book_mechanic
from server.tools.get_slots import get_available_slots as _get_available_slots
from server.tools.verify_vehicle import verify_vehicle as _verify_vehicle

# ═══════════════════════════════════════════════════════════
# LangChain tool wrappers (these get bound to the LLM)
# ═══════════════════════════════════════════════════════════


@tool
def verify_vehicle(make: str, model: str, year: int) -> dict:
    """Check if a vehicle make/model/year combination is valid.
    Returns dict with valid, corrected_make, corrected_model, error."""
    print(f"[Tool] verify_vehicle({make}, {model}, {year})")
    result = _verify_vehicle(make, model, year)
    print(f"[Tool] verify_vehicle result: {result}")
    return result


@tool
def get_available_slots(zip_code: str) -> list[dict]:
    """Get available mechanic appointment slots near a zip code.
    Returns list of {slot_id, mechanic_name, specialty, date, time, zip_code}."""
    print(f"[Tool] get_available_slots({zip_code})")
    result = _get_available_slots(zip_code)
    print(f"[Tool] get_available_slots returned {len(result)} slots")
    return result


@tool
def book_mechanic(
    customer_phone: str,
    zip_code: str,
    vehicle_make: str,
    vehicle_model: str,
    vehicle_year: int,
    slot_id: int,
) -> dict:
    """Book a specific mechanic slot for the customer.
    Returns {booking_id, mechanic_name, date, time, confirmation_msg} or {error}."""
    print(
        f"[Tool] book_mechanic(phone={customer_phone}, zip={zip_code}, slot={slot_id})"
    )
    result = _book_mechanic(
        customer_phone, zip_code, vehicle_make, vehicle_model, vehicle_year, slot_id
    )
    print(f"[Tool] book_mechanic result: {result}")
    return result


# All tools available to the LLM
ALL_TOOLS = [verify_vehicle, get_available_slots, book_mechanic]

# ═══════════════════════════════════════════════════════════
# LLM with tools bound
# ═══════════════════════════════════════════════════════════

_api_key = os.environ.get("GOOGLE_API_KEY")
print(
    f"[LLM] GOOGLE_API_KEY set: {bool(_api_key)}, length: {len(_api_key) if _api_key else 0}"
)

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=_api_key,
    temperature=0,
)

llm_with_tools = llm.bind_tools(ALL_TOOLS)

# ═══════════════════════════════════════════════════════════
# Graph nodes
# ═══════════════════════════════════════════════════════════


async def agent_node(state: ConversationState) -> dict:
    """Core LLM node — invoke Gemini with conversation history + tools."""
    messages = list(state["messages"])

    # Inject system prompt if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + messages

    print(f"[Agent] Invoking Gemini with {len(messages)} messages")
    response = await llm_with_tools.ainvoke(messages)
    print(
        f"[Agent] Gemini response: content='{str(response.content)[:100]}', tool_calls={len(response.tool_calls) if response.tool_calls else 0}"
    )
    return {"messages": [response]}
