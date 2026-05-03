"""FastAPI server with WebSocket endpoint for Roadside Rescue."""

import json
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage
from server.graph.builder import graph
from server.stt import DeepgramSTT
from server.tts import stream_speech

load_dotenv()

app = FastAPI(title="Roadside Rescue API")

# CORS — allow GitHub Pages origin (update with your actual domain)
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

    # Unique session ID for LangGraph checkpointer (persists state across turns)
    session_id = str(uuid.uuid4())

    # Accumulate final transcript segments until utterance ends
    transcript_buffer: list[str] = []

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

        await ws.send_json({"type": "utterance_end", "text": full_text})

        # Invoke LangGraph with the user's utterance
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content=full_text)]},
            config={"configurable": {"thread_id": session_id}},
        )

        # Extract the last AI response
        reply = result["messages"][-1].content
        await ws.send_json({"type": "assistant_text", "text": reply})

        # Stream TTS audio back to client
        async for audio_chunk in stream_speech(reply):
            await ws.send_bytes(audio_chunk)

        # Signal audio stream complete
        await ws.send_json({"type": "audio_end"})

    stt = DeepgramSTT(on_transcript=on_transcript, on_utterance_end=on_utterance_end)
    await stt.start()

    try:
        while True:
            data = await ws.receive()

            if "bytes" in data:
                # Forward raw audio to Deepgram STT
                await stt.send(data["bytes"])

            elif "text" in data:
                message = json.loads(data["text"])
                msg_type = message.get("type", "")

                if msg_type == "ping":
                    await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        await stt.finish()
