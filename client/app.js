/**
 * Roadside Rescue — WebSocket voice client
 *
 * Captures mic audio via MediaRecorder, sends to backend over WebSocket,
 * receives transcripts + TTS audio, plays audio via AudioContext.
 */

// ── Configuration ──
// In production, point this to your Render URL
const WS_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "ws://localhost:8000/ws"
    : "wss://roadside-rescue-ai-agent.onrender.com/ws";

// ── DOM elements ──
const micBtn = document.getElementById("mic-btn");
const micLabel = micBtn.querySelector(".mic-label");
const transcriptEl = document.getElementById("transcript");
const statusLocation = document.getElementById("status-location");
const statusVehicle = document.getElementById("status-vehicle");
const statusState = document.getElementById("status-state");
const statusBooking = document.getElementById("status-booking");
const connectionStatus = document.getElementById("connection-status");

// ── State ──
let ws = null;
let mediaRecorder = null;
let isRecording = false;
let isSpeaking = false;  // Prevents sending audio during TTS

// ── WebSocket ──

function connect() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "connection-status connected";
    setStatus("Ready");
  };

  ws.onclose = () => {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.className = "connection-status disconnected";
    setStatus("Disconnected");
    // Reconnect after 3s
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    connectionStatus.textContent = "Connection error";
    connectionStatus.className = "connection-status disconnected";
  };

  ws.onmessage = (event) => {
    // All messages are JSON text (no binary audio)
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case "transcript":
      if (msg.is_final) {
        addTranscript("user", msg.text);
      } else {
        showInterim(msg.text);
      }
      break;

    case "utterance_end":
      clearInterim();
      setStatus("Thinking...");
      micBtn.classList.add("processing");
      break;

    case "assistant_text":
      addTranscript("assistant", msg.text);
      setStatus("Speaking...");
      parseAssistantResponse(msg.text);
      // Pause mic to prevent feedback loop, then speak
      pauseMicForTTS();
      speakText(msg.text);
      break;

    case "audio_end":
      // Server signals processing complete
      break;

    case "error":
      addTranscript("assistant", "Sorry, something went wrong. Please try again.");
      micBtn.classList.remove("processing");
      setStatus("Error");
      console.error("Server error:", msg.message);
      break;

    case "pong":
      break;
  }
}

// ── Transcript display ──

function addTranscript(role, text) {
  // Remove placeholder if present
  const placeholder = transcriptEl.querySelector(".placeholder");
  if (placeholder) placeholder.remove();

  const p = document.createElement("p");
  p.className = role === "user" ? "user-msg" : "assistant-msg";
  p.textContent = text;
  transcriptEl.appendChild(p);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function showInterim(text) {
  let interim = transcriptEl.querySelector(".interim");
  if (!interim) {
    interim = document.createElement("p");
    interim.className = "interim";
    transcriptEl.appendChild(interim);
  }
  interim.textContent = text;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function clearInterim() {
  const interim = transcriptEl.querySelector(".interim");
  if (interim) interim.remove();
}

// ── Status card updates ──

function setStatus(text) {
  statusState.textContent = text;
}

function parseAssistantResponse(text) {
  // Simple keyword extraction to update status card
  const lower = text.toLowerCase();

  // Vehicle detection
  const vehicleMatch = text.match(
    /(\d{4})\s+([\w-]+)\s+([\w-]+(?:\s+\w+)?)/i
  );
  if (vehicleMatch) {
    statusVehicle.textContent = `${vehicleMatch[1]} ${vehicleMatch[2]} ${vehicleMatch[3]}`;
  }

  // Booking confirmation
  const bookingMatch = text.match(/confirmation\s+code\s+(?:is\s+)?(\w+)/i);
  if (bookingMatch) {
    statusBooking.textContent = bookingMatch[1];
    setStatus("Booked!");
  }
}

// ── Audio capture ──

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
      },
    });

    // Use webm/opus — Deepgram supports it natively
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 16000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN && !isSpeaking) {
        ws.send(event.data);
      }
    };

    // Send chunks every 250ms for low latency
    mediaRecorder.start(250);

    isRecording = true;
    micBtn.classList.add("recording");
    micLabel.textContent = "LISTENING...";
    setStatus("Listening...");
  } catch (err) {
    console.error("Microphone access denied:", err);
    setStatus("Mic access denied");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
  }

  isRecording = false;
  micBtn.classList.remove("recording");
  micLabel.textContent = "TAP TO TALK";
  setStatus("Ready");
}

// ── Geolocation ──

// ── Browser TTS ──

function pauseMicForTTS() {
  isSpeaking = true;
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getAudioTracks().forEach((t) => (t.enabled = false));
  }
  // Tell server to keep Deepgram alive while we're speaking
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "tts_playing" }));
  }
}

function resumeMicAfterTTS() {
  isSpeaking = false;
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getAudioTracks().forEach((t) => (t.enabled = true));
  }
  // Tell server TTS is done, resume normal audio
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "tts_done" }));
  }
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("Browser TTS not supported");
    resumeMicAfterTTS();
    micBtn.classList.remove("processing");
    setStatus(isRecording ? "Listening..." : "Ready");
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Pick a natural-sounding voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.name.includes("Samantha") || v.name.includes("Google") || v.lang === "en-US"
  );
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => {
    resumeMicAfterTTS();
    micBtn.classList.remove("processing");
    setStatus(isRecording ? "Listening..." : "Ready");
  };

  utterance.onerror = () => {
    resumeMicAfterTTS();
    micBtn.classList.remove("processing");
    setStatus(isRecording ? "Listening..." : "Ready");
  };

  window.speechSynthesis.speak(utterance);
}

// Load voices (some browsers load them async)
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// ── Geolocation ──

function detectLocation() {
  if (!navigator.geolocation) {
    statusLocation.textContent = "unavailable";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      statusLocation.textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    },
    () => {
      statusLocation.textContent = "denied";
    }
  );
}

// ── Event listeners ──

micBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("Not connected");
    return;
  }

  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ── Init ──
detectLocation();
connect();
