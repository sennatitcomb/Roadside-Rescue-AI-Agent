"""Build and compile the Roadside Rescue LangGraph state machine.

Graph flow:
    START → agent ←→ tools (loop until no more tool calls) → END

The agent node (Gemini + tools) drives the entire conversation. It decides
when to call tools and when to respond to the user. The system prompt
instructs it on the multi-step workflow (greet → collect → verify → slots → book).
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from server.graph.nodes import agent_node, ALL_TOOLS
from server.graph.state import ConversationState


def build_graph() -> StateGraph:
    """Construct the conversation graph with agent ↔ tools loop."""
    graph = StateGraph(ConversationState)

    # Nodes
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(ALL_TOOLS))

    # Edges
    graph.add_edge(START, "agent")

    # Agent → tools (if tool_calls present) or → END
    graph.add_conditional_edges("agent", tools_condition)

    # After tool execution, loop back to agent
    graph.add_edge("tools", "agent")

    return graph


# Compile with in-memory checkpointer for session persistence
memory = MemorySaver()
graph = build_graph().compile(checkpointer=memory)
