"""Deepgram streaming STT client for Roadside Rescue."""

import os
from typing import Awaitable, Callable

from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents


class DeepgramSTT:
    """Manages a single Deepgram live transcription session."""

    def __init__(
        self,
        on_transcript: Callable[[str, bool], Awaitable[None]],
        on_utterance_end: Callable[[], Awaitable[None]] | None = None,
    ):
        self._on_transcript = on_transcript
        self._on_utterance_end = on_utterance_end
        self._client = DeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
        self._connection = None
        self._audio_bytes_sent = 0

    async def start(self) -> bool:
        """Open the Deepgram WebSocket connection. Returns True on success."""
        self._connection = self._client.listen.asyncwebsocket.v("1")

        transcript_cb = self._on_transcript
        utterance_cb = self._on_utterance_end

        async def _on_message(*args, **kwargs):
            try:
                # SDK v3: result is passed as keyword argument
                result = kwargs.get("result")
                if result is None:
                    print("[Deepgram] No result in kwargs")
                    return
                text = result.channel.alternatives[0].transcript
                is_final = result.is_final
                if text:
                    print(f"[Deepgram] Transcript: '{text}' (is_final={is_final})")
                    await transcript_cb(text, is_final)
            except Exception as e:
                print(f"[Deepgram] Transcript parse error: {e}")

        async def _on_utterance_end(*args, **kwargs):
            print("[Deepgram] Utterance end detected")
            if utterance_cb:
                await utterance_cb()

        async def _on_open(*args, **kwargs):
            print("[Deepgram] Connection opened")

        async def _on_close(*args, **kwargs):
            print(f"[Deepgram] Connection closed: {args} {kwargs}")

        async def _on_error(*args, **kwargs):
            print(f"[Deepgram] Error: {args} {kwargs}")

        self._connection.on(LiveTranscriptionEvents.Open, _on_open)
        self._connection.on(LiveTranscriptionEvents.Transcript, _on_message)
        self._connection.on(LiveTranscriptionEvents.UtteranceEnd, _on_utterance_end)
        self._connection.on(LiveTranscriptionEvents.Close, _on_close)
        self._connection.on(LiveTranscriptionEvents.Error, _on_error)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=True,
            utterance_end_ms="1000",
            vad_events=True,
            endpointing=300,
        )

        print("[Deepgram] Starting connection...")
        result = await self._connection.start(options)
        print(f"[Deepgram] start() returned: {result}")
        return result

    async def send(self, audio_bytes: bytes) -> None:
        """Forward raw audio bytes to Deepgram."""
        if self._connection:
            self._audio_bytes_sent += len(audio_bytes)
            if self._audio_bytes_sent % 10000 < len(audio_bytes):
                print(f"[Deepgram] Total audio sent: {self._audio_bytes_sent} bytes")
            await self._connection.send(audio_bytes)

    async def keep_alive(self) -> None:
        """Send keepalive to prevent Deepgram timeout during TTS playback."""
        if self._connection:
            try:
                await self._connection.keep_alive()
            except Exception as e:
                print(f"[Deepgram] Keepalive error: {e}")

    async def finish(self) -> None:
        """Gracefully close the Deepgram connection."""
        if self._connection:
            print(
                f"[Deepgram] Finishing. Total audio sent: {self._audio_bytes_sent} bytes"
            )
            await self._connection.finish()
            self._connection = None
