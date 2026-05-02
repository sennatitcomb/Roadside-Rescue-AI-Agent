# Roadside Rescue — Architecture & Execution Plan

## 1. Problem & Job to Be Done

**JTBD:** "As a stranded driver, I want to verbally report my vehicle breakdown and book a mobile mechanic so that I can safely arrange repairs without looking at a screen or typing on the side of a busy, dangerous highway."

**Why Voice:** A driver broken down on a highway is in a high-stress, physically unsafe environment. Hands may be dirty, cold, or occupied. Eyes must stay on traffic. Voice is the only interface that keeps hands free and eyes up while securing help.

---

## 2. System Architecture

### Deployment Model: Split (Frontend + Backend)

The system is split into two independently hosted services to minimize cost:

- **Frontend** → GitHub Pages (free) — static HTML/CSS/JS voice client
- **Backend** → Render free tier (free) — FastAPI + WebSocket server, LangGraph, all API integrations

```
  GitHub Pages (free)                          Render (free tier)
┌──────────────────┐    WebSocket (wss://)   ┌──────────────────────┐
│  Static Client   │◄──────────────────────►│  FastAPI Server       │
│  ┌────────────┐  │                        │  (Orchestrator)       │
│  │ index.html │  │                        └───────────┬───────────┘
│  │ style.css  │  │                                    │
│  │ app.js     │  │               ┌────────────────────┼────────────────────┐
│  └────────────┘  │               │                    │                    │
└──────────────────┘         ┌─────▼──────┐    ┌────────▼────────┐  ┌───────▼───────┐
                             │  Deepgram   │    │   LangGraph     │  │  ElevenLabs   │
                             │  STT        │    │   + GPT-4o      │  │  TTS          │
                             │  (Nova-2)   │    │   State Machine │  │  (Turbo v2.5) │
                             └────────────┘    └────────┬────────┘  └───────────────┘
                                                        │
                                             ┌──────────┼──────────┐
                                             │          │          │
                                       ┌─────▼───┐ ┌───▼────┐ ┌──▼──────────┐
                                       │verify_  │ │get_    │ │book_        │
                                       │vehicle  │ │slots   │ │mechanic     │
                                       └─────────┘ └───┬────┘ └──┬──────────┘
                                                       │         │
                                                  ┌────▼─────────▼────┐
                                                  │   SQLite DB       │
                                                  │   (slots/bookings)│
                                                  └───────────────────┘
```

### Why Split Deployment?

- **API key security** — Keys stay on the backend server, never exposed to the browser
- **$0 hosting cost** — GitHub Pages (static) + Render free tier (750 hrs/mo) = free for a POC
- **Full architecture preserved** — LangGraph state machine, SQLite, and all orchestration logic remain server-side
- **Interview-ready** — Demonstrates real backend engineering, not just client-side API calls

### Audio Flow (Round-Trip)

1. **Client** (GitHub Pages) captures mic audio via `MediaRecorder` API → streams chunks over WebSocket to `wss://<your-app>.onrender.com/ws`
2. **Server** (Render) forwards audio bytes to **Deepgram** streaming STT → receives transcript
3. Transcript is appended to **LangGraph** conversation state → GPT-4o processes and may invoke tools
4. LLM response text is sent to **ElevenLabs** TTS → receives synthesized audio bytes
5. Audio bytes are streamed back to **Client** over WebSocket → played via `AudioContext`

### CORS & WebSocket Configuration

The FastAPI backend must allow cross-origin requests from your GitHub Pages domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://<username>.github.io"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

The client `app.js` connects to the backend via:

```javascript
const WS_URL = "wss://<your-app>.onrender.com/ws";
const ws = new WebSocket(WS_URL);
```

---

## 3. Component Selection & Justification

| Component | Technology | Why |
|-----------|-----------|-----|
| **Transport** | FastAPI + WebSockets | Native async support; backend hosted on Render free tier |
| **STT** | Deepgram Nova-2 | Industry-leading low-latency streaming STT; excels with background noise (highway traffic) |
| **LLM** | OpenAI GPT-4o | Best-in-class tool-calling; extracts structured params from panicked conversational input |
| **TTS** | ElevenLabs Turbo v2.5 | Ultra-low latency, empathetic voice reduces panic for distressed callers |
| **Orchestration** | LangGraph (Python) | Models conversation as a state machine; handles cycles, retries, and error routing cleanly |
| **Storage** | SQLite | Zero-config, file-based; perfect for POC. Intentionally simple locking (interview bait) |
| **Eval** | LangSmith | Native LangGraph integration for trace logging and LLM-as-a-judge evaluation |

---

## 4. LangGraph State Machine

```
State: ConversationState
├── make: str | None
├── model: str | None
├── year: int | None
├── location: str | None
├── zip_code: str | None
├── phone: str | None
├── selected_slot: dict | None
├── booking_id: str | None
├── retry_count: int (default 0)
├── messages: list[BaseMessage]
└── step: str (current node)
```

### Graph Flow

```
START
  │
  ▼
GREETING ──► COLLECT_INFO ◄─── (ambiguous input → re-ask)
                  │
                  ▼
            VERIFY_VEHICLE ◄─── (fail + retry < 3 → retry)
                  │
                  ▼
            FIND_SLOTS
                  │
                  ▼
            CONFIRM_AND_BOOK
                  │
                  ▼
            SUMMARY_AND_END
```

**Error Routing:**
- Tool failure + retry < 3 → loop back with "I'm having trouble, give me a moment"
- Tool failure + retry >= 3 → graceful fallback: "Let me connect you to a human dispatcher"
- Ambiguous input → politely ask for clarification, stay on current node
- Connection drop → save state to DB for resumption

---

## 5. Tool Definitions (API Integration)

### `verify_vehicle(make: str, model: str, year: int) → dict`
- Checks against NHTSA Vehicle API (or mocked dictionary)
- Returns `{valid: bool, corrected_make: str, corrected_model: str}`
- Handles edge cases: "2025 Ford Civic" → invalid combo

### `get_available_slots(zip_code: str) → list[dict]`
- Queries SQLite `available_slots` table
- Returns list of `{slot_id, mechanic_name, date, time, zip_code}`
- Filters to next 24 hours, sorts by soonest

### `book_mechanic(customer_phone: str, zip_code: str, vehicle: dict, slot_id: str) → dict`
- Writes booking to SQLite `bookings` table
- Returns `{booking_id, mechanic_name, eta, confirmation_msg}`
- **Intentional limitation:** No row-level locking — concurrent bookings can double-book (interview live-coding bait)

---

## 6. Client Interface

**Approach:** Single-page web app, mobile-first, hosted on **GitHub Pages** (free). No framework, no bundler.

```
┌─────────────────────────────┐
│      ROADSIDE RESCUE        │
│                             │
│     ┌───────────────┐       │
│     │               │       │
│     │   🎙️  TAP     │       │
│     │   TO TALK     │       │
│     │               │       │
│     └───────────────┘       │
│                             │
│  "Tell me what happened     │
│   and I'll get help on      │
│   the way."                 │
│                             │
│  ┌─────────────────────┐    │
│  │ 📍 Location: shared │    │
│  │ 🚗 Vehicle: —       │    │
│  │ 🔧 Status: Listening│    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

**Design Principles:**
- **One giant button** — tap to start, tap to stop. No forms, no typing.
- **Live transcript** — subtle scrolling text confirming the user is being heard
- **Status card** — auto-fills as agent extracts info (vehicle, location, booking)
- **Auto-geolocation** — `navigator.geolocation.getCurrentPosition()` on page load
- **PWA-ready** — optional `manifest.json` for home-screen install

**Tech:** Vanilla HTML/CSS/JS, WebSocket API, MediaRecorder API, AudioContext API.

---

## 7. Evaluation Methodology

### LangSmith Tracing
- Instrument LangGraph with LangSmith callbacks
- Every conversation generates a full trace with tool calls, latencies, and token usage

### LLM-as-a-Judge Script (`eval/judge.py`)
Pull transcripts from LangSmith, grade on three criteria:

| Criterion | What It Measures | Pass Condition |
|-----------|-----------------|----------------|
| **Parameter Extraction** | Did it capture make, model, year, location? | All 4 fields populated correctly |
| **Tool Execution** | Did it trigger booking API successfully? | `booking_id` returned |
| **Conversational Resilience** | Handled ambiguous input gracefully? | No crashes; polite clarification given |

### Test Scenarios (5-10 conversations)
1. Happy path — clear info, books successfully
2. Ambiguous input — "my car is the blue one"
3. Invalid vehicle — "2025 Ford Civic"
4. No available slots in area
5. Tool API failure (mocked)
6. User changes mind mid-conversation
7. Noisy/fragmented speech

---

## 8. Execution Plan

### Phase 1: Foundation (Day 1)
- [ ] Initialize project: `pyproject.toml`, dependencies, directory structure
- [ ] Create SQLite schema: `mechanics`, `available_slots`, `bookings` tables
- [ ] Seed database with mock data (5 mechanics, ~20 slots across 3 zip codes)
- [ ] Implement 3 tool functions with unit tests

### Phase 2: Voice Pipeline (Day 2)
- [ ] FastAPI WebSocket endpoint — accept/manage audio connections
- [ ] Add CORS middleware for GitHub Pages origin
- [ ] Deepgram STT integration — stream audio in, receive transcripts
- [ ] ElevenLabs TTS integration — send text, stream audio back
- [ ] Verify end-to-end audio round-trip

### Phase 3: LangGraph Brain (Day 2-3)
- [ ] Define `ConversationState` TypedDict
- [ ] Implement graph nodes: greeting, collect_info, verify_vehicle, find_slots, confirm_book, summarize
- [ ] Write system prompt (calm, empathetic tone; structured extraction instructions)
- [ ] Bind 3 tools to GPT-4o, wire tool-call handling in graph
- [ ] Add error routing: retry logic, ambiguity handling, graceful fallbacks

### Phase 4: Integration (Day 3)
- [ ] Wire full loop: client audio → STT → LangGraph → TTS → client audio
- [ ] Build static web client (`client/index.html`, `client/style.css`, `client/app.js`)
- [ ] Configure `app.js` to connect to Render backend via `wss://`
- [ ] Add geolocation auto-capture
- [ ] Test latency end-to-end (target: < 2s round-trip)

### Phase 5: Deployment (Day 3-4)
- [ ] Deploy backend to Render (free tier) — connect GitHub repo, set env vars
- [ ] Deploy `client/` folder to GitHub Pages — configure as publishing source
- [ ] Verify cross-origin WebSocket connectivity
- [ ] Test full flow from GitHub Pages → Render backend

### Phase 6: Evaluation (Day 4)
- [ ] Instrument LangGraph with LangSmith callbacks
- [ ] Build `eval/judge.py` LLM-as-a-judge script
- [ ] Run 5-10 test conversations, capture traces
- [ ] Generate evaluation report

### Phase 7: Polish & Presentation (Day 4)
- [ ] Write README with setup instructions and architecture diagram
- [ ] Write AI collaboration log section
- [ ] Build 5-slide presentation deck
- [ ] Record demo video (optional)

---

## 9. Directory Structure

```
roadside-rescue/
├── pyproject.toml              # Python backend dependencies
├── render.yaml                 # Render deployment config
├── README.md
├── PLAN.md
├── .env.example                # API keys template (backend only)
│
├── server/                     # ── BACKEND (deployed to Render) ──
│   ├── main.py                 # FastAPI + WebSocket entry point
│   ├── stt.py                  # Deepgram streaming client
│   ├── tts.py                  # ElevenLabs streaming client
│   ├── graph/
│   │   ├── state.py            # ConversationState TypedDict
│   │   ├── nodes.py            # Graph node functions
│   │   └── builder.py          # LangGraph compilation
│   ├── tools/
│   │   ├── verify_vehicle.py
│   │   ├── get_slots.py
│   │   └── book_mechanic.py
│   ├── prompts/
│   │   └── system.py           # System prompt text
│   └── db/
│       ├── schema.sql
│       └── seed.py
│
├── client/                     # ── FRONTEND (deployed to GitHub Pages) ──
│   ├── index.html
│   ├── style.css
│   └── app.js                  # WebSocket client → wss://<app>.onrender.com/ws
│
├── eval/
│   └── judge.py                # LLM-as-a-judge evaluation script
└── tests/
    ├── test_tools.py
    └── test_graph.py
```

---

## 10. Known Limitations & Next Steps

### Intentional Limitation (Interview Bait)
The SQLite `book_mechanic` tool has **no transactional locking or optimistic concurrency control**. Two simultaneous callers can book the same slot. This is deliberately left as the live-coding challenge topic.

### Future Enhancements
- Row-level locking / optimistic concurrency for bookings
- Session resumption on connection drop
- Multi-language support via Deepgram language detection
- SMS confirmation via Twilio after booking
- Real mechanic dispatch integration
- Voice activity detection (VAD) for hands-free start/stop
- Migrate from Render free tier to paid/dedicated if traffic grows
- Custom domain for both frontend and backend

---

## 11. Presentation Outline (5 Slides)

1. **The Problem & JTBD** — Visual of stranded driver. JTBD statement. Why voice is the only solution.
2. **System Architecture** — Block diagram: User Audio → WebSocket → Deepgram → LangGraph/GPT-4o → ElevenLabs → User Audio. SQLite via tool calling.
3. **Tool Calling & Error Handling** — Ambiguity management. Successful tool call payload snippet.
4. **Evaluation** — LangSmith trace screenshot. Evaluation criteria and results.
5. **Next Steps** — "Current limitation: SQLite lacks transactional locking for concurrent bookings. Next step: conflict resolution."

---

## 12. AI Assistant Collaboration Log

> *To be filled in during development. Be specific and honest about where AI tools helped and where manual work was needed.*

**Template:**
- "I used [tool] for [specific task], saving roughly [time estimate]."
- "I used [tool] as a sounding board for [design decision]. It suggested [X], which I [adopted/modified/rejected] because [reason]."
- "I struggled with [problem] and [tool] helped me [resolution]."
