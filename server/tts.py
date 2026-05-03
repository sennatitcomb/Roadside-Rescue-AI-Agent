"""ElevenLabs streaming TTS client for Roadside Rescue."""

import os
from typing import AsyncIterator

from elevenlabs import AsyncElevenLabs

DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel — calm, professional
DEFAULT_MODEL_ID = "eleven_turbo_v2_5"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

_client: AsyncElevenLabs | None = None

_api_key = os.environ.get("ELEVENLABS_API_KEY")
print(
    f"[TTS] ELEVENLABS_API_KEY set: {bool(_api_key)}, length: {len(_api_key) if _api_key else 0}"
)


def _get_client() -> AsyncElevenLabs:
    """Lazy-init singleton async ElevenLabs client."""
    global _client
    if _client is None:
        _client = AsyncElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    return _client


async def synthesize_speech(
    text: str,
    voice_id: str = DEFAULT_VOICE_ID,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> bytes:
    """Generate full audio bytes from text (non-streaming)."""
    print(f"[TTS] synthesize_speech: '{text[:60]}...'")
    client = _get_client()
    response = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id=model_id,
        output_format=output_format,
    )
    audio = b"".join([chunk async for chunk in response])
    print(f"[TTS] Generated {len(audio)} bytes of audio")
    return audio


async def stream_speech(
    text: str,
    voice_id: str = DEFAULT_VOICE_ID,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> AsyncIterator[bytes]:
    """Yield audio chunks as they arrive from ElevenLabs."""
    print(f"[TTS] stream_speech: '{text[:80]}...'")
    client = _get_client()
    try:
        # SDK v2.x: convert() returns an async generator (no await)
        response = client.text_to_speech.convert(
            voice_id=voice_id,
            text=text,
            model_id=model_id,
            output_format=output_format,
        )
        total_bytes = 0
        async for chunk in response:
            if chunk:
                total_bytes += len(chunk)
                yield chunk
        print(f"[TTS] Streamed {total_bytes} bytes total")
    except Exception as e:
        print(f"[TTS] Error: {e}")
        raise
