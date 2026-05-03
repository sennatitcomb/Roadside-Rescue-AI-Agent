"""ElevenLabs streaming TTS client for Roadside Rescue."""

import os
from typing import AsyncIterator

from elevenlabs import AsyncElevenLabs

DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel — calm, professional
DEFAULT_MODEL_ID = "eleven_turbo_v2_5"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

_client: AsyncElevenLabs | None = None


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
    client = _get_client()
    response = await client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id=model_id,
        output_format=output_format,
    )
    return b"".join([chunk async for chunk in response])


async def stream_speech(
    text: str,
    voice_id: str = DEFAULT_VOICE_ID,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> AsyncIterator[bytes]:
    """Yield audio chunks as they arrive from ElevenLabs (streaming)."""
    client = _get_client()
    audio_stream = await client.text_to_speech.convert_as_stream(
        voice_id=voice_id,
        text=text,
        model_id=model_id,
        output_format=output_format,
    )
    async for chunk in audio_stream:
        if chunk:
            yield chunk
