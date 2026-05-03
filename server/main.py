"""FastAPI server with WebSocket endpoint for Roadside Rescue."""

import json
import os
import traceback
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage
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

        try:
            print("[Main] Invoking LangGraph...")
            result = await graph.ainvoke(
                {"messages": [HumanMessage(content=full_text)]},
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

    except (WebSocketDisconnect, RuntimeError):
        if stt:
            await stt.finish()
