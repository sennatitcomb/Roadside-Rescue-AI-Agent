"""Pre-processing gate: detect angry or frustrated users and route to human dispatcher.

All patterns are compiled once at import so there is no per-call overhead.
is_angry_user() runs in microseconds — well below any network latency —
making it safe to run synchronously before every LangGraph invocation.
"""

import re

# ---------------------------------------------------------------------------
# Regex pattern bank
# ---------------------------------------------------------------------------
# Each pattern targets a distinct signal of frustration or an explicit
# human-transfer request.  Patterns use non-capturing groups where possible
# to keep backtracking low.
# ---------------------------------------------------------------------------

_PATTERNS: list[str] = [
    # ── Profanity directly aimed at AI / bot / system ──────────────────────
    # Matches: "fucking AI", "f*** bot", "shit agent", "damn machine", "ass system"
    r"\b(?:f+u+c*k+i*n*g?|f+[*@#$%!]+|sh[i!1]t+|b[i!1]tc*h|d[a@]mn|a[s$]{2})"
    r"\s*(?:ai|bot|agent|robot|machine|computer|system|assistant)\b",

    # ── Censored / leet profanity anywhere in the utterance ────────────────
    # Matches: "f**k", "f---", "fuuuck", "f u c k", "f***ing", "f---ing"
    r"\bf+[\W_]*u+[\W_]*c+[\W_]*k+",
    # Matches "f" + non-letter symbols + "ing" — e.g. "f***ing", "f---ing"
    r"\bf[^a-zA-Z\s]{1,6}ing\b",

    # ── Negative adjective + AI / bot ──────────────────────────────────────
    # Matches: "stupid bot", "useless AI", "I hate this agent", "dumb machine"
    r"\b(?:hate|stupid|dumb|useless|idiot|moron|trash|garbage|terrible|awful|worst|ridiculous|pathetic)"
    r"\s+(?:this\s+)?(?:ai|bot|agent|robot|machine|computer|assistant)\b",

    # ── Refusal to speak with AI / machine ─────────────────────────────────
    # Matches: "not talking to an AI", "don't want to talk to a bot",
    #          "won't talk to a machine", "I'm not speaking to a robot"
    r"(?:not|don'?t|won'?t|can'?t|refuse\s+to)\s+"
    r"(?:want\s+to\s+|going\s+to\s+)?(?:talk|speak|chat)(?:ing)?\s+"
    r"to\s+an?\s+(?:ai|bot|agent|robot|machine|computer|assistant)",

    # ── Explicit transfer / human requests (verb form) ─────────────────────
    # Matches: "give me a human", "connect me to an agent", "transfer me to someone",
    #          "put me through to a real person", "get me a representative"
    r"\b(?:give|get|connect|transfer|send|put|forward)\s+me\s+"
    r"(?:through\s+)?(?:to\s+)?(?:an?\s+)?(?:real\s+)?(?:human|person|agent|operator|representative|rep|someone|somebody)\b",

    # ── speak / talk / chat to a human ─────────────────────────────────────
    # Matches: "speak to a real person", "talk with someone", "chat with an operator"
    r"\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:an?\s+)?(?:real\s+)?(?:human|person|agent|operator|representative|rep|someone|somebody)\b",

    # ── "I want / need a human" ─────────────────────────────────────────────
    # Matches: "I want a human", "I need a real person", "want to talk to an agent"
    r"\b(?:want|need)\s+(?:to\s+)?(?:talk\s+to\s+)?(?:an?\s+)?(?:real\s+)?(?:human|person|operator|agent|representative)\b",

    # ── "let me speak / talk to a real person" ──────────────────────────────
    r"\blet\s+me\s+(?:speak|talk)\s+to\s+(?:a\s+)?real\s+(?:person|human|agent)\b",

    # ── Rejection of AI/bots in general ────────────────────────────────────
    # Matches: "no AI", "no more bots", "no robots", "no automated system"
    r"\bno\s+(?:more\s+)?(?:ai|bot|bots|robot|robots|machine|machines|automated|automation|computer)\b",

    # ── "stop the bot / AI" ─────────────────────────────────────────────────
    # Matches: "stop the bot", "enough of this AI", "stop this machine"
    r"\b(?:stop|enough)\s+(?:of\s+)?(?:the\s+|this\s+)?(?:ai|bot|robot|automated|machine|computer|assistant)\b",

    # ── "I'm done with this AI / bot" ──────────────────────────────────────
    r"\b(?:done|finished|fed\s+up)\s+(?:with\s+)?(?:this\s+)?(?:ai|bot|robot|machine|computer|assistant)\b",

    # ── "This is ridiculous / unacceptable" paired with AI/bot mention ─────
    # Broader frustration phrase: "this AI is ridiculous", "the bot is useless"
    r"\b(?:this|the)\s+(?:ai|bot|agent|robot|machine|computer|assistant)\s+"
    r"(?:is\s+)?(?:ridiculous|unacceptable|useless|stupid|terrible|awful|broken|garbage|trash|dumb|worthless)\b",
]

_COMPILED: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE) for p in _PATTERNS
]

# ---------------------------------------------------------------------------
# Transfer message spoken / displayed to the user
# ---------------------------------------------------------------------------

TRANSFER_MESSAGE = (
    "I completely understand. Let me transfer you to one of our human "
    "dispatchers right away. Please stay on the line."
)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def is_angry_user(text: str) -> bool:
    """Return True if the transcript matches any anger / transfer-request pattern.

    Runs in O(n) where n is len(text) — safe to call synchronously before
    every LangGraph invocation without meaningful latency impact.
    """
    return any(pattern.search(text) for pattern in _COMPILED)
