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
    : "wss://roadside-rescue.onrender.com/ws";

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
let audioContext = null;
let isRecording = false;
let audioQueue = [];
let isPlayingAudio = false;

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
    if (event.data instanceof ArrayBuffer) {
      // TTS audio chunk — queue for playback
      audioQueue.push(event.data);
      if (!isPlayingAudio) {
        playNextChunk();
      }
      return;
    }

    // JSON message
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
      break;

    case "audio_end":
      // TTS finished streaming — user can talk again
      micBtn.classList.remove("processing");
      setStatus(isRecording ? "Listening..." : "Ready");
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
      if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
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

// ── Audio playback (TTS) ──

async function playNextChunk() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    return;
  }

  isPlayingAudio = true;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Collect all queued chunks into a single buffer for smoother playback
  const chunks = audioQueue.splice(0, audioQueue.length);
  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  try {
    const audioBuffer = await audioContext.decodeAudioData(combined.buffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      // Check if more chunks arrived while we were playing
      if (audioQueue.length > 0) {
        playNextChunk();
      } else {
        isPlayingAudio = false;
      }
    };
    source.start();
  } catch (err) {
    console.warn("Audio decode error (partial chunk):", err);
    isPlayingAudio = false;
    // Try next chunk if available
    if (audioQueue.length > 0) {
      playNextChunk();
    }
  }
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
