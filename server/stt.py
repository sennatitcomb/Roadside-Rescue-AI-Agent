"""Deepgram streaming STT client for Roadside Rescue."""

import os
from typing import Awaitable, Callable

from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents


class DeepgramSTT:
    """Manages a single Deepgram live transcription session.

    One instance per WebSocket client connection. Audio bytes flow in,
    transcript callbacks fire out.
    """

    def __init__(
        self,
        on_transcript: Callable[[str, bool], Awaitable[None]],
        on_utterance_end: Callable[[], Awaitable[None]] | None = None,
    ):
        """
        Args:
            on_transcript: async callback(text, is_final) for each transcript segment.
            on_utterance_end: async callback() when silence indicates the user stopped speaking.
        """
        self._on_transcript = on_transcript
        self._on_utterance_end = on_utterance_end
        self._client = DeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
        self._connection = None

    async def start(self) -> bool:
        """Open the Deepgram WebSocket connection. Returns True on success."""
        self._connection = self._client.listen.asyncwebsocket.v("1")

        # Capture callbacks for closures
        transcript_cb = self._on_transcript
        utterance_cb = self._on_utterance_end

        async def _on_message(_self, result, **kwargs):
            text = result.channel.alternatives[0].transcript
            if text:
                await transcript_cb(text, result.is_final)

        async def _on_utterance_end_handler(_self, _event, **kwargs):
            if utterance_cb:
                await utterance_cb()

        async def _on_error(_self, error, **kwargs):
            print(f"[Deepgram STT] Error: {error}")

        self._connection.on(LiveTranscriptionEvents.Transcript, _on_message)
        self._connection.on(
            LiveTranscriptionEvents.UtteranceEnd, _on_utterance_end_handler
        )
        self._connection.on(LiveTranscriptionEvents.Error, _on_error)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            # Don't specify encoding — let Deepgram auto-detect from WebM container
            interim_results=True,
            utterance_end_ms="1000",
            vad_events=True,
            endpointing=300,
        )

        return await self._connection.start(options)

    async def send(self, audio_bytes: bytes) -> None:
        """Forward raw audio bytes to Deepgram."""
        if self._connection:
            await self._connection.send(audio_bytes)

    async def finish(self) -> None:
        """Gracefully close the Deepgram connection."""
        if self._connection:
            await self._connection.finish()
            self._connection = None
