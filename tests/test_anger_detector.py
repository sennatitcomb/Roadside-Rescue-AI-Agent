"""Evaluation tests for the anger_detector pre-processing component.

Run with:
    pytest tests/test_anger_detector.py -v
"""

import pytest
from server.preprocessing.anger_detector import is_angry_user

# ---------------------------------------------------------------------------
# Should trigger → True
# ---------------------------------------------------------------------------

SHOULD_TRIGGER = [
    # Profanity + AI/bot
    ("fucking AI", True),
    ("f***ing bot", True),
    ("this shit agent", True),
    ("damn machine won't listen", True),
    ("ass system keep messing up", True),
    # Leet / spaced profanity alone
    ("f u c k this", True),
    ("fuuuuck this thing", True),
    ("f---ing useless", True),
    # Negative adjective + AI/bot
    ("stupid bot", True),
    ("I hate this AI", True),
    ("dumb machine", True),
    ("useless agent", True),
    ("worst AI I've ever used", True),
    ("this is garbage bot", True),
    ("terrible assistant", True),
    # Refusal to talk to AI
    ("I'm not talking to an AI", True),
    ("don't want to talk to a bot", True),
    ("won't talk to a machine", True),
    ("I refuse to speak to a robot", True),
    ("not going to talk to a computer", True),
    # Explicit transfer / human requests
    ("give me a human", True),
    ("connect me to a real person", True),
    ("transfer me to an operator", True),
    ("put me through to someone", True),
    ("get me a representative", True),
    ("send me to a real agent", True),
    # Speak / talk to a human
    ("I want to speak to a person", True),
    ("let me talk to a real human", True),
    ("can I chat with someone", True),
    ("I need to talk to an operator", True),
    # Want / need a human
    ("I want a human", True),
    ("I need a real person", True),
    ("I want to talk to an agent", True),
    ("need a representative", True),
    # Let me speak to
    ("let me speak to a real person", True),
    ("let me talk to a human", True),
    # No AI / stop AI
    ("no AI please", True),
    ("no more bots", True),
    ("no robots", True),
    ("stop the bot", True),
    ("enough of this AI", True),
    ("stop this machine", True),
    # Done with AI
    ("I'm done with this AI", True),
    ("I'm fed up with this bot", True),
    ("finished with this assistant", True),
    # AI is adjective
    ("this AI is ridiculous", True),
    ("the bot is useless", True),
    ("this agent is broken", True),
    ("the machine is garbage", True),
    # Mixed case / real STT output style
    ("FUCKING AI", True),
    ("Give Me A Human NOW", True),
    ("I HATE THIS BOT", True),
    ("please connect me to a real person i can't do this", True),
    ("seriously just transfer me to someone", True),
]

# ---------------------------------------------------------------------------
# Should NOT trigger → False
# ---------------------------------------------------------------------------

SHOULD_NOT_TRIGGER = [
    # Normal roadside assistance utterances
    ("Hi I just got a flat tire", False),
    ("My car won't start", False),
    ("I'm on Highway 101 near the 85", False),
    ("It's a 2020 Honda Civic", False),
    ("The 3 PM slot works for me", False),
    ("My phone number is 206 555 0101", False),
    ("Yes that location is correct", False),
    ("No actually I'm on the other side", False),
    ("I need help with my car", False),
    ("Can you send a mechanic", False),
    # Words that appear in patterns but in benign context
    ("I need to talk to my friend about this", False),
    ("My agent booked the slot already", False),
    # Partial word matches that should not trigger
    ("I'm not sure about the agent's timing", False),
    ("The machine is running fine now", False),
]


# ---------------------------------------------------------------------------
# Parametrized tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", SHOULD_TRIGGER)
def test_should_trigger(text: str, expected: bool):
    assert is_angry_user(text) == expected, (
        f"Expected is_angry_user({text!r}) == {expected}, got {not expected}"
    )


@pytest.mark.parametrize("text,expected", SHOULD_NOT_TRIGGER)
def test_should_not_trigger(text: str, expected: bool):
    assert is_angry_user(text) == expected, (
        f"Expected is_angry_user({text!r}) == {expected}, got {not expected}"
    )
