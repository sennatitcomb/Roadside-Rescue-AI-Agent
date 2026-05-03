# Roadside Rescue — Voice-Agent for Stranded Drivers

A real-time voice AI agent that helps stranded drivers report vehicle breakdowns and book mobile mechanics — entirely through conversation, no typing required.

## Why Voice?

A driver broken down on a highway can't safely navigate a mobile app. Voice is the only interface that keeps hands free and eyes on traffic while securing help.

## Architecture

**Split deployment: GitHub Pages (frontend) + Render (backend) — both free.**

```
  GitHub Pages (free)                      Render free tier
┌────────────────┐   WebSocket (wss://)  ┌─────────────────────┐
│  index.html    │◄─────────────────────►│  FastAPI Server     │
│  style.css     │                       │  LangGraph + Gemini │
│  app.js        │                       │  Deepgram STT       │
│  speechSynth.  │◄── text response ──────│  SQLite DB          │
└────────────────┘  (browser TTS)        └─────────────────────┘
```

| Component | Technology |
|-----------|----------|
| Frontend | GitHub Pages (static HTML/CSS/JS) |
| Backend | FastAPI + WebSockets on Render (free tier) |
| Speech-to-Text | Deepgram Nova-2 |
| LLM | Google Gemini 2.5 Flash (free tier) |
| Text-to-Speech | Browser Web Speech API (free; ElevenLabs optional upgrade) |
| Orchestration | LangGraph (Python) |
| Storage | SQLite |
| Evaluation | LangSmith |

## Quick Start (Local Development)

```bash
# 1. Clone and install
git clone https://github.com/sennatitcomb/Roadside-Rescue-AI-Agent.git
cd Roadside-Rescue-AI-Agent
pip install -r requirements.txt

# 2. Set up environment variables
cp .env.example .env
# Fill in: GOOGLE_API_KEY, DEEPGRAM_API_KEY (ELEVENLABS_API_KEY optional)

# 3. Initialize database
python server/db/seed.py

# 4. Run backend server
uvicorn server.main:app --reload

# 5. Open client
# Open client/index.html in your browser (or serve via Live Server)
# For local dev, app.js defaults to ws://localhost:8000/ws
```

## Deployment

- **Frontend** → GitHub Pages: Settings → Pages → source: `main` / `/ (root)` → access at `/client/`
- **Backend** → Connect repo to [Render](https://render.com) free tier, set env vars (`GOOGLE_API_KEY`, `DEEPGRAM_API_KEY`; `ELEVENLABS_API_KEY` optional)
- **Live demo**: [sennatitcomb.github.io/Roadside-Rescue-AI-Agent/client/](https://sennatitcomb.github.io/Roadside-Rescue-AI-Agent/client/)

## Project Structure

```
├── PLAN.md                     # Full architecture & execution plan
├── .env.example                # API keys template
├── render.yaml                 # Render deployment config
│
├── server/                     # BACKEND (Render free tier)
│   ├── main.py                 # FastAPI + WebSocket server
│   ├── stt.py                  # Deepgram streaming client
│   ├── tts.py                  # ElevenLabs TTS (optional; browser TTS is default)
│   ├── graph/                  # LangGraph state machine
│   ├── tools/                  # LLM tool functions
│   ├── prompts/                # System prompt
│   └── db/                     # SQLite schema & seed data
│
├── client/                     # FRONTEND (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── eval/                       # LLM-as-a-judge evaluation
└── tests/                      # Unit tests
```

## Tools (LLM Function Calling)

- **`verify_vehicle(make, model, year)`** — Validates vehicle exists via NHTSA API / mock data
- **`get_available_slots(zip_code)`** — Returns available mechanic time slots from SQLite
- **`book_mechanic(phone, zip_code, vehicle, slot_id)`** — Creates a booking record

## Evaluation

Conversations are traced with LangSmith and graded by an LLM-as-a-judge on:
1. **Parameter Extraction** — Did it capture make, model, year, location?
2. **Tool Execution** — Did it successfully book a mechanic?
3. **Conversational Resilience** — Did it handle ambiguous input gracefully?

## Known Limitations

The SQLite booking system intentionally lacks concurrency control — simultaneous bookings can conflict. This is a deliberate design choice for the POC.

## AI Assistant Collaboration Log

> *To be filled in during development.*

---

See [PLAN.md](./PLAN.md) for the full architecture document and execution plan.
