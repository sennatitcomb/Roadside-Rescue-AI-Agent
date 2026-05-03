"""FastAPI server with WebSocket endpoint for Roadside Rescue."""

import json
import os
import traceback
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage, SystemMessage
from server.graph.builder import graph
from server.stt import DeepgramSTT

load_dotenv()

app = FastAPI(title="Roadside Rescue API")

# CORS — allow GitHub Pages origin
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://sennatitcomb.github.io").split(
    ","
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Unique session ID for LangGraph checkpointer
    session_id = str(uuid.uuid4())

    # Accumulate final transcript segments until utterance ends
    transcript_buffer: list[str] = []
    stt: DeepgramSTT | None = None
    # GPS location data from client (mutable container for closure access)
    session_state = {"location": None, "location_injected": False}

    async def on_transcript(text: str, is_final: bool):
        """Forward transcript to client; buffer finals for LLM processing."""
        await ws.send_json(
            {
                "type": "transcript",
                "text": text,
                "is_final": is_final,
            }
        )
        if is_final:
            transcript_buffer.append(text)

    async def on_utterance_end():
        """User stopped speaking — feed transcript into LangGraph."""
        if not transcript_buffer:
            return

        full_text = " ".join(transcript_buffer)
        transcript_buffer.clear()

        print(f"[Main] Utterance complete: '{full_text}'")
        await ws.send_json({"type": "utterance_end", "text": full_text})

        # Build messages for this turn
        messages = []

        # Inject GPS location as a SystemMessage on the first utterance
        if session_state["location"] and not session_state["location_injected"]:
            session_state["location_injected"] = True
            addr = session_state["location"].get("address", "unknown")
            zip_code = session_state["location"].get("zip", "unknown")
            messages.append(
                SystemMessage(
                    content=(
                        f"GPS DATA: The driver's GPS shows they are at {addr}, "
                        f"zip code {zip_code}. You MUST confirm this location "
                        f"with the driver BEFORE asking about their vehicle. "
                        f"For example: 'I see you're near {addr}, {zip_code}. "
                        f"Is that right?'"
                    )
                )
            )

        messages.append(HumanMessage(content=full_text))

        try:
            print("[Main] Invoking LangGraph...")
            result = await graph.ainvoke(
                {"messages": messages},
                config={"configurable": {"thread_id": session_id}},
            )

            reply = result["messages"][-1].content
            # Gemini 2.5 may return content as a list of parts
            if isinstance(reply, list):
                texts = []
                for part in reply:
                    if isinstance(part, dict) and "text" in part:
                        texts.append(part["text"])
                    elif isinstance(part, str):
                        texts.append(part)
                reply = " ".join(texts) if texts else str(reply)
            reply = str(reply)
            print(f"[Main] LLM reply: '{reply[:100]}...'")
            await ws.send_json({"type": "assistant_text", "text": reply})

            # Browser TTS handles speech on the client side
            await ws.send_json({"type": "audio_end"})
            print("[Main] Audio sent to client")

        except Exception as e:
            print(f"[LangGraph/TTS Error] {e}")
            traceback.print_exc()
            await ws.send_json(
                {
                    "type": "error",
                    "message": f"Processing error: {str(e)}",
                }
            )

    async def ensure_stt_started() -> DeepgramSTT | None:
        """Lazily start Deepgram STT on first audio chunk."""
        nonlocal stt
        if stt is not None:
            return stt
        try:
            stt = DeepgramSTT(
                on_transcript=on_transcript, on_utterance_end=on_utterance_end
            )
            started = await stt.start()
            if not started:
                print("[STT] Deepgram start() returned False")
                await ws.send_json(
                    {
                        "type": "error",
                        "message": "Failed to connect to speech recognition",
                    }
                )
                stt = None
            return stt
        except Exception as e:
            print(f"[STT Error] {e}")
            traceback.print_exc()
            await ws.send_json(
                {
                    "type": "error",
                    "message": f"Speech recognition error: {str(e)}",
                }
            )
            stt = None
            return None

    keepalive_task = None

    async def send_keepalives():
        """Send periodic keepalive to Deepgram while TTS is playing."""
        import asyncio

        while True:
            await asyncio.sleep(5)
            if stt:
                await stt.keep_alive()

    try:
        while True:
            data = await ws.receive()

            if "bytes" in data:
                # Start STT lazily on first audio chunk
                active_stt = await ensure_stt_started()
                if active_stt:
                    await active_stt.send(data["bytes"])

            elif "text" in data:
                message = json.loads(data["text"])
                msg_type = message.get("type", "")

                if msg_type == "ping":
                    await ws.send_json({"type": "pong"})
                elif msg_type == "tts_playing":
                    # Start sending keepalives to Deepgram
                    import asyncio

                    if keepalive_task is None or keepalive_task.done():
                        keepalive_task = asyncio.create_task(send_keepalives())
                elif msg_type == "tts_done":
                    # Stop keepalives
                    if keepalive_task and not keepalive_task.done():
                        keepalive_task.cancel()
                        keepalive_task = None
                elif msg_type == "location":
                    # Store GPS location data from client
                    session_state["location"] = {
                        "lat": message.get("lat"),
                        "lon": message.get("lon"),
                        "zip": message.get("zip", ""),
                        "address": message.get("address", ""),
                    }
                    print(
                        f"[Main] Location received: "
                        f"{session_state['location'].get('address')}, "
                        f"zip {session_state['location'].get('zip')}"
                    )

    except (WebSocketDisconnect, RuntimeError):
        if keepalive_task and not keepalive_task.done():
            keepalive_task.cancel()
        if stt:
            await stt.finish()
