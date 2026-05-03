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
let map = null;
let mapMarker = null;
let pendingAddress = null; // Stored from GPS, shown only after agent confirms
let pendingLocationMsg = null; // Queued location message if WS not open yet

// ── WebSocket ──

function connect() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "connection-status connected";
    setStatus("Ready");
    // Flush queued location if GPS resolved before WS connected
    if (pendingLocationMsg) {
      ws.send(JSON.stringify(pendingLocationMsg));
      pendingLocationMsg = null;
    }
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

  // Location confirmation — agent asks "you're near X, is that right?"
  // This means the agent is confirming the GPS location; keep status as "Confirming..."
  const confirmingMatch = lower.match(/(?:you're near|i see you're|you're at|you're on|located at|location.*?is)\b/);
  if (confirmingMatch && lower.match(/(?:is that right|right\??|correct|sound right)/)) {
    // Agent is asking for confirmation — stay pending
    return;
  }

  // Location confirmed by user — agent proceeds with acknowledgment
  // Match phrases like "Got it, you're at..." or "Great, so you're near..."
  if (statusLocation.textContent === "Confirming..." && pendingAddress) {
    const confirmedWithLocation = lower.match(
      /(?:got it|perfect|great|alright|noted|confirmed|okay).*(?:you're|you are|near|at|on|location)/
    );
    // Also match when agent simply moves on after the user confirmed (e.g. "Great. Now, what's your vehicle...")
    const confirmedAndMovedOn = lower.match(
      /(?:got it|perfect|great|alright|noted|confirmed).*(?:vehicle|car|what'?s your|tell me)/
    );
    if (confirmedWithLocation || confirmedAndMovedOn) {
      const { road, city, zip } = pendingAddress;
      const display = [road, city, zip].filter(Boolean).join(", ");
      statusLocation.textContent = display || pendingAddress.formatted;
      return;
    }
  }

  // Location correction — agent acknowledges a new location from the user
  const locationMatch = text.match(/(?:you're (?:near|at|on)|located at|location.*?(?:is|updated to|changed to))\s+(.+?)(?:\.|,\s*(?:is that|right|correct)|$)/i);
  if (locationMatch) {
    const corrected = locationMatch[1].trim();
    forwardGeocode(corrected);
  }
}

function confirmLocation(address) {
  // Called when agent confirms or user corrects — show formatted address
  statusLocation.textContent = address;
}

function forwardGeocode(query) {
  fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { "Accept-Language": "en" } }
  )
    .then((r) => r.json())
    .then((results) => {
      if (results.length > 0) {
        const { lat, lon, display_name } = results[0];
        updateMapLocation(parseFloat(lat), parseFloat(lon), display_name);
        // Parse display_name into parts for formatted display
        const parts = display_name.split(", ");
        const formatted = parts.slice(0, 3).join(", ");
        statusLocation.textContent = formatted || query;
        // Update pending address so future confirmations use the corrected one
        pendingAddress = null;
      }
    })
    .catch(() => {});
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
      initMap(latitude, longitude);
      reverseGeocode(latitude, longitude);
    },
    () => {
      statusLocation.textContent = "denied";
    }
  );
}

function initMap(lat, lon) {
  map = L.map("map").setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  mapMarker = L.marker([lat, lon]).addTo(map).bindPopup("Your location").openPopup();
}

function reverseGeocode(lat, lon) {
  fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
    { headers: { "Accept-Language": "en" } }
  )
    .then((r) => r.json())
    .then((data) => {
      const addr = data.address || {};
      const zip = addr.postcode || "";
      const road = addr.road || "";
      const city = addr.city || addr.town || addr.village || "";
      const state = addr.state || "";
      const parts = [road, city, state].filter(Boolean);
      const formatted = parts.join(", ");

      // Store address but show "Confirming..." until agent verifies
      pendingAddress = { road, city, state, zip, formatted };
      statusLocation.textContent = "Confirming...";

      // Send location to server — queue if WS not open yet
      const locationMsg = { type: "location", lat, lon, zip, address: formatted };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(locationMsg));
      } else {
        pendingLocationMsg = locationMsg;
      }
    })
    .catch(() => {
      statusLocation.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    });
}

function updateMapLocation(lat, lon, label) {
  if (!map) return;
  map.setView([lat, lon], 15);
  if (mapMarker) {
    mapMarker.setLatLng([lat, lon]).setPopupContent(label).openPopup();
  }
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
