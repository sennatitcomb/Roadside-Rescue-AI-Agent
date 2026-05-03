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
    return _verify_vehicle(make, model, year)


@tool
def get_available_slots(zip_code: str) -> list[dict]:
    """Get available mechanic appointment slots near a zip code.
    Returns list of {slot_id, mechanic_name, specialty, date, time, zip_code}."""
    return _get_available_slots(zip_code)


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
    return _book_mechanic(
        customer_phone, zip_code, vehicle_make, vehicle_model, vehicle_year, slot_id
    )


# All tools available to the LLM
ALL_TOOLS = [verify_vehicle, get_available_slots, book_mechanic]

# ═══════════════════════════════════════════════════════════
# LLM with tools bound
# ═══════════════════════════════════════════════════════════

llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.environ.get("GOOGLE_API_KEY"),
    temperature=0,
)

llm_with_tools = llm.bind_tools(ALL_TOOLS)

# ═══════════════════════════════════════════════════════════
# Graph nodes
# ═══════════════════════════════════════════════════════════


async def agent_node(state: ConversationState) -> dict:
    """Core LLM node — invoke Gemini with conversation history + tools.

    Ensures the system prompt is always the first message.
    Returns the AIMessage (appended via add_messages reducer).
    """
    messages = list(state["messages"])

    # Inject system prompt if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + messages

    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}
