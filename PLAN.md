# Roadside Rescue — Architecture & Execution Plan

## 1. Problem & Job to Be Done

**JTBD:** "As a stranded driver, I want to verbally report my vehicle breakdown and book a mobile mechanic so that I can safely arrange repairs without looking at a screen or typing on the side of a busy, dangerous highway."

**Why Voice:** A driver broken down on a highway is in a high-stress, physically unsafe environment. Hands may be dirty, cold, or occupied. Eyes must stay on traffic. Voice is the only interface that keeps hands free and eyes up while securing help.

---

## 2. System Architecture

### Deployment Model: Split (Frontend + Backend)

The system is split into two independently hosted services to minimize cost:

- **Frontend** → GitHub Pages (free) — static HTML/CSS/JS voice client with interactive map
- **Backend** → Render free tier (free) — FastAPI + WebSocket server, LangGraph, all API integrations

```
  GitHub Pages (free)                          Render (free tier)
┌──────────────────┐    WebSocket (wss://)   ┌──────────────────────┐
│  Static Client   │◄──────────────────────►│  FastAPI Server       │
│  ┌────────────┐  │                        │  (Orchestrator)       │
│  │ index.html │  │                        └───────────┬───────────┘
│  │ style.css  │  │                                    │
│  │ app.js     │  │               ┌────────────────────┼──────────┐
│  │ Leaflet.js │  │               │                    │          │
│  └────────────┘  │         ┌─────▼──────┐    ┌────────▼────────┐ │
└──────────────────┘         │  Deepgram   │    │   LangGraph     │ │
                             │  STT        │    │   + Gemini 2.5  │ │
   Browser TTS ◄─── text ── │  (Nova-2)   │    │   State Machine │ │
   (speechSynthesis)         └────────────┘    └────────┬────────┘ │
                                                        │          │
   Leaflet Map ◄─── tiles ── OpenStreetMap    ┌──────────┼──────────┤
                                              │          │          │
   Status Card ◄── geocode ── Nominatim ┌─────▼───┐ ┌───▼────┐ ┌──▼──────────┐
                                        │verify_  │ │get_    │ │book_        │
                                        │vehicle  │ │slots   │ │mechanic     │
                                        │(NHTSA)  │ │(top 3) │ │             │
                                        └─────────┘ └───┬────┘ └──┬──────────┘
                                                        │         │
                                                   ┌────▼─────────▼────┐
                                                   │   SQLite DB       │
                                                   │   (slots/bookings)│
                                                   └───────────────────┘
```

### Why Split Deployment?

- **API key security** — Keys stay on the backend server, never exposed to the browser
- **$0 total cost** — GitHub Pages (static) + Render free tier (750 hrs/mo) + Gemini free tier + Browser TTS + Deepgram ($200 free credit) + Nominatim/OpenStreetMap (free) = free for a POC
- **Full architecture preserved** — LangGraph state machine, SQLite, and all orchestration logic remain server-side
- **Interview-ready** — Demonstrates real backend engineering, not just client-side API calls

### Audio Flow (Round-Trip)

1. **Client** (GitHub Pages) captures mic audio via `MediaRecorder` API → streams chunks over WebSocket to `wss://roadside-rescue-ai-agent.onrender.com/ws`
2. **Server** (Render) forwards audio bytes to **Deepgram** streaming STT → receives transcript
3. Transcript is appended to **LangGraph** conversation state → Gemini 2.5 Flash processes and may invoke tools
4. LLM response text is sent back to **Client** over WebSocket as JSON
5. **Client** speaks the response aloud using the browser's built-in `speechSynthesis` API (Web Speech API)

### GPS & Location Flow

1. **Page load** → `navigator.geolocation.getCurrentPosition()` captures coordinates
2. **Leaflet map** initialized with pin at GPS location
3. **Nominatim reverse geocode** resolves coordinates to street address + zip code
4. Status card shows **"Confirming..."** (not raw address)
5. Location sent to server via WebSocket `{"type": "location", ...}` — queued if WS not yet open
6. Server stores location in `session_state` dict (mutable container for closure access)
7. **First utterance** → server injects GPS as a `SystemMessage` (not embedded in HumanMessage, so LLM treats it as authoritative)
8. Agent confirms: *"I see you're near [street], [zip]. Is that right?"*
9. **User confirms** → agent responds with "Great..." → client detects acknowledgment → status card shows formatted address
10. **User corrects** → client parses zip from transcript → forward geocodes new address → map pin moves + status updates

### Client-Side Parsing

The client extracts structured data from both user transcripts and agent responses:

| Source | What's Parsed | How |
|--------|--------------|-----|
| User transcript | Zip codes (location correction) | `\b(\d{5})\b` + address extraction from both sides of zip |
| User transcript | Phone numbers | `\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}` → formatted |
| Agent response | Vehicle (year-first) | `\b(\d{4})\s+(make)\s+(model)` with stop-word filter |
| Agent response | Vehicle (year-last) | `(make)\s+(model)\s+\(?(\d{4})\)?` with stop-word filter |
| Agent response | Booking code | `(?:confirmation code\|booking ID)\s+(\w+)` |
| Agent response | Location confirmation | Acknowledgment words when status is "Confirming..." |
| Agent response | Location update | Zip code detection (skipped for slot/availability messages) |

### CORS & WebSocket Configuration

The FastAPI backend allows cross-origin requests from the GitHub Pages domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://sennatitcomb.github.io"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

The client `app.js` connects to the backend via:

```javascript
const WS_URL = "wss://roadside-rescue-ai-agent.onrender.com/ws";
const ws = new WebSocket(WS_URL);
```

---

## 3. Component Selection & Justification

| Component | Technology | Why |
|-----------|-----------|-----|
| **Transport** | FastAPI + WebSockets | Native async support; backend hosted on Render free tier |
| **STT** | Deepgram Nova-2 | Industry-leading low-latency streaming STT; excels with background noise (highway traffic) |
| **LLM** | Google Gemini 2.5 Flash | Free API tier; strong tool-calling support; zero cost for POC |
| **TTS** | Browser Web Speech API (`speechSynthesis`) | Zero-cost, no API key, works on all modern browsers |
| **Map** | Leaflet.js + OpenStreetMap | Open-source, free, no API key required |
| **Geocoding** | Nominatim (OpenStreetMap) | Free reverse + forward geocoding, no API key, 1 req/sec policy |
| **Vehicle API** | NHTSA Vehicle API | Free government API for vehicle make/model validation |
| **Orchestration** | LangGraph (Python) | Models conversation as a state machine; handles cycles, retries, and error routing cleanly |
| **Storage** | SQLite | Zero-config, file-based; perfect for POC. Intentionally simple locking (interview bait) |
| **Eval** | LangSmith | Native LangGraph integration for trace logging and LLM-as-a-judge evaluation |
| **CI/CD** | GitHub Actions | Auto-deploys `client/` to GitHub Pages on push to `main` |

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
AGENT ◄──────────── tools_condition ────► TOOLS
  │                     (loop)               │
  │                                          │
  ▼                                          │
 END ◄──────────────────────────────────────┘
```

The agent node drives the entire conversation. It decides when to call tools and when to respond. The system prompt instructs a multi-step workflow:

1. **Greet** → confirm GPS location with driver
2. **Collect vehicle** → make, model, year
3. **Verify vehicle** → `verify_vehicle` tool (NHTSA API)
4. **Find slots** → `get_available_slots` tool (top 3 results)
5. **Book** → `book_mechanic` tool
6. **Confirm** → read back confirmation code and ETA

**Error Routing:**
- Tool failure + retry < 3 → loop back with "I'm having trouble, give me a moment"
- Tool failure + retry >= 3 → graceful fallback: "Let me connect you to a human dispatcher"
- Ambiguous input → politely ask for clarification, stay on current node

---

## 5. Tool Definitions (API Integration)

### `verify_vehicle(make: str, model: str, year: int) → dict`
- Validates against NHTSA Vehicle API
- Returns `{valid: bool, corrected_make: str, corrected_model: str}`
- Handles edge cases: "2025 Ford Civic" → invalid combo

### `get_available_slots(zip_code: str) → list[dict]`
- Queries SQLite `available_slots` table
- Returns list of `{slot_id, mechanic_name, specialty, date, time, zip_code}`
- **Limited to 3 results** (soonest first) to keep voice responses concise
- Slot IDs are available to the LLM for booking but hidden from the user

### `book_mechanic(customer_phone: str, zip_code: str, vehicle: dict, slot_id: str) → dict`
- Writes booking to SQLite `bookings` table
- Returns `{booking_id, mechanic_name, date, time, confirmation_msg}`
- **Intentional limitation:** No row-level locking — concurrent bookings can double-book (interview live-coding bait)

---

## 6. Client Interface

**Approach:** Single-page web app, mobile-first, hosted on **GitHub Pages** (free). No framework, no bundler. Deployed via GitHub Actions workflow.

```
┌─────────────────────────────┐
│      ROADSIDE RESCUE        │
│                             │
│     ┌───────────────┐       │
│     │   🎙️  TAP     │       │
│     │   TO TALK     │       │
│     └───────────────┘       │
│                             │
│  ┌─────────────────────┐    │
│  │   🗺️ Leaflet Map    │    │
│  │   (GPS pin + tiles) │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ Your conversation   │    │
│  │ will appear here... │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ 📍 Location: ...    │    │
│  │ 🚗 Vehicle: ...     │    │
│  │ 🔧 Status: ...      │    │
│  │ 📞 Phone: ...       │    │
│  │ 🎫 Booking: ...     │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

**Design Principles:**
- **One giant button** — tap to start, tap to stop. No forms, no typing.
- **Interactive map** — Leaflet.js with OpenStreetMap tiles, GPS pin, dark theme
- **Live transcript** — scrolling text confirming the user is being heard
- **Smart status card** — auto-fills as agent extracts info (location, vehicle, phone, booking)
- **Location confirmation flow** — "Confirming..." → agent verifies → formatted address
- **Auto-geolocation** — `navigator.geolocation.getCurrentPosition()` on page load
- **Reverse geocoding** — Nominatim converts GPS coordinates to street address + zip

**Tech:** Vanilla HTML/CSS/JS, Leaflet.js (CDN), WebSocket API, MediaRecorder API, Web Speech API, Nominatim API.

---

## 7. Database Coverage

| Zip Code | City | Mechanic | Specialty |
|----------|------|----------|-----------|
| 98101 | Seattle, WA (Downtown) | Mike Torres | General Repair |
| 98101 | Seattle, WA (Downtown) | Sarah Chen | Electrical |
| 98109 | Seattle, WA (South Lake Union) | David Kim | Battery & Electrical |
| 98122 | Seattle, WA (Capitol Hill) | Lisa Park | Tires & Brakes |
| 90210 | Beverly Hills, CA | James Okafor | Engine & Transmission |
| 90210 | Beverly Hills, CA | Priya Patel | Tires & Brakes |
| 73301 | Austin, TX | Carlos Rivera | General Repair |

Each mechanic has 4 time slots generated over the next 24 hours from seed time.

---

## 8. Evaluation Methodology

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

### Test Scenarios
1. Happy path — clear info, books successfully
2. Ambiguous input — "my car is the blue one"
3. Invalid vehicle — "2025 Ford Civic"
4. No available slots in area
5. Tool API failure (mocked)
6. User changes mind mid-conversation
7. User corrects GPS location
8. Noisy/fragmented speech

---

## 9. Execution Plan

### Phase 1: Foundation ✅
- [x] Initialize project: `pyproject.toml`, dependencies, directory structure
- [x] Create SQLite schema: `mechanics`, `available_slots`, `bookings` tables
- [x] Seed database with mock data (7 mechanics, ~28 slots across 4 zip codes)
- [x] Implement 3 tool functions with unit tests

### Phase 2: Voice Pipeline ✅
- [x] FastAPI WebSocket endpoint — accept/manage audio connections
- [x] Add CORS middleware for GitHub Pages origin
- [x] Deepgram STT integration — stream audio in, receive transcripts
- [x] Browser TTS via `speechSynthesis` API
- [x] Verify end-to-end voice round-trip

### Phase 3: LangGraph Brain ✅
- [x] Define `ConversationState` TypedDict
- [x] Implement agent node with tool-calling loop
- [x] Write system prompt (calm, empathetic tone; location-first workflow)
- [x] Bind 3 tools to Gemini 2.5 Flash via `ChatGoogleGenerativeAI`
- [x] Add error routing: retry logic, ambiguity handling, graceful fallbacks

### Phase 4: Integration ✅
- [x] Wire full loop: client audio → STT → LangGraph → text response → browser TTS
- [x] Build static web client (`client/index.html`, `client/style.css`, `client/app.js`)
- [x] Configure `app.js` to connect to Render backend via `wss://`
- [x] Add geolocation auto-capture

### Phase 5: GPS & Interactive Map ✅
- [x] Add Leaflet.js map with OpenStreetMap tiles (dark theme)
- [x] Reverse geocode GPS coordinates via Nominatim
- [x] Location confirmation flow: "Confirming..." → agent verifies → formatted address
- [x] GPS data sent to server as WebSocket message (with queuing for race conditions)
- [x] Server injects GPS as SystemMessage on first utterance
- [x] Forward geocoding for location corrections (map pin + status update)
- [x] Parse user transcripts for zip code corrections
- [x] Strip trailing prepositions from address extraction
- [x] Skip geocoding during slot/availability discussions
- [x] Use structured Nominatim address fields (not display_name) to avoid business names

### Phase 6: Status Card Intelligence ✅
- [x] Vehicle detection: year-first and year-last formats with stop-word filtering
- [x] Phone number parsing from user transcripts
- [x] Booking ID detection (confirmation code + booking ID patterns)
- [x] Slot results limited to 3 (voice-friendly)
- [x] Slot IDs hidden from user-facing output

### Phase 7: Deployment ✅
- [x] Deploy backend to Render (free tier)
- [x] GitHub Actions workflow deploys `client/` to GitHub Pages on push
- [x] Verify cross-origin WebSocket connectivity

### Phase 8: Evaluation
- [ ] Instrument LangGraph with LangSmith callbacks
- [ ] Build `eval/judge.py` LLM-as-a-judge script
- [ ] Run test conversations, capture traces
- [ ] Generate evaluation report

---

## 10. Directory Structure

```
roadside-rescue/
├── pyproject.toml              # Python backend dependencies
├── requirements.txt            # pip dependencies
├── render.yaml                 # Render deployment config
├── README.md
├── PLAN.md
├── .env.example                # API keys template (GOOGLE_API_KEY, DEEPGRAM_API_KEY)
│
├── .github/workflows/
│   └── deploy-pages.yml        # GitHub Actions → deploys client/ to Pages
│
├── server/                     # ── BACKEND (deployed to Render) ──
│   ├── main.py                 # FastAPI + WebSocket + GPS SystemMessage injection
│   ├── stt.py                  # Deepgram streaming client
│   ├── graph/
│   │   ├── state.py            # ConversationState TypedDict
│   │   ├── nodes.py            # Agent node + LangChain tool wrappers
│   │   └── builder.py          # LangGraph compilation with MemorySaver
│   ├── tools/
│   │   ├── verify_vehicle.py   # NHTSA Vehicle API validation
│   │   ├── get_slots.py        # SQLite query (LIMIT 3, soonest first)
│   │   ├── book_mechanic.py    # Booking creation
│   │   └── db.py               # SQLite connection helper
│   ├── prompts/
│   │   └── system.py           # System prompt (location-first, no slot IDs)
│   └── db/
│       ├── schema.sql          # Table definitions
│       └── seed.py             # 7 mechanics across 4 zip codes
│
├── client/                     # ── FRONTEND (deployed to GitHub Pages) ──
│   ├── index.html              # Leaflet map + mic button + status card
│   ├── style.css               # Dark theme + map container styling
│   └── app.js                  # WebSocket, GPS, Nominatim, transcript parsing
│
├── eval/
│   └── judge.py                # LLM-as-a-judge evaluation script
└── tests/
    └── test_tools.py           # Tool unit tests
```

---

## 11. Known Limitations & Next Steps

### Intentional Limitation (Interview Bait)
The SQLite `book_mechanic` tool has **no transactional locking or optimistic concurrency control**. Two simultaneous callers can book the same slot. This is deliberately left as the live-coding challenge topic.

### Current Limitations
- Nominatim has a 1 request/second usage policy — fine for single-user POC
- Browser TTS quality varies by OS/browser (Safari Samantha and Chrome Google voices sound best)
- Vehicle detection regex can't handle all speech-to-text variations
- Location parsing relies on zip code detection — addresses without zip codes aren't geocoded

### Future Enhancements
- Row-level locking / optimistic concurrency for bookings
- Session resumption on connection drop
- Multi-language support via Deepgram language detection
- SMS confirmation via Twilio after booking
- Real mechanic dispatch integration
- Voice activity detection (VAD) for hands-free start/stop
- Upgrade to ElevenLabs paid TTS for higher-quality voice synthesis
- Custom domain for both frontend and backend

---

## 12. Presentation Outline (5 Slides)

1. **The Problem & JTBD** — Visual of stranded driver. JTBD statement. Why voice is the only solution.
2. **System Architecture** — Block diagram: User Audio → WebSocket → Deepgram → LangGraph/Gemini → Browser TTS. GPS → Nominatim → Leaflet Map.
3. **Tool Calling & Location Flow** — GPS auto-detection, location confirmation, tool calls for vehicle verification and booking.
4. **Evaluation** — LangSmith trace screenshot. Evaluation criteria and results.
5. **Next Steps** — "Current limitation: SQLite lacks transactional locking for concurrent bookings. Next step: conflict resolution."
