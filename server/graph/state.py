"""Conversation state definition for the Roadside Rescue LangGraph."""

from typing import Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class ConversationState(TypedDict):
    """State flowing through the conversation graph.

    `messages` uses the add_messages reducer — node returns are APPENDED,
    not overwritten. All other fields use last-write-wins semantics.
    """

    # Conversation history (append-only)
    messages: Annotated[list[BaseMessage], add_messages]

    # Extracted vehicle info
    make: str | None
    model: str | None
    year: int | None

    # Location & contact
    location: str | None
    zip_code: str | None
    phone: str | None

    # Booking state
    selected_slot: dict | None
    booking_id: str | None

    # Control flow
    retry_count: int
    step: str  # current graph phase
