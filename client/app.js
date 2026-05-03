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
const statusPhone = document.getElementById("status-phone");
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
        parseUserTranscript(msg.text);
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

function parseUserTranscript(text) {
  // Detect when user corrects their location by mentioning a zip code
  const zipMatch = text.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip = zipMatch[1];
    const beforeZip = text.substring(0, text.indexOf(zip)).trim();
    const addrMatch = beforeZip.match(/(?:on|at|near)\s+(.+?)(?:,\s*)?$/i);
    const addressPart = addrMatch ? addrMatch[1].trim() : "";
    const geocodeQuery = addressPart ? `${addressPart}, ${zip}` : zip;
    pendingAddress = null;
    forwardGeocode(geocodeQuery);
  }

  // Detect phone number (10 digits, with or without formatting)
  const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, "");
    statusPhone.textContent = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
}

function parseAssistantResponse(text) {
  const lower = text.toLowerCase();

  // Vehicle detection — match both "2023 Tesla Model 3" and "Tesla Model 3 (2023)"
  const yearFirstMatch = text.match(/\b(\d{4})\s+([\w-]+)\s+((?:Model\s+)?[\w-]+)/i);
  const yearLastMatch = text.match(/([\w-]+)\s+((?:Model\s+)?[\w-]+)\s+\(?(\d{4})\)?/i);

  if (yearFirstMatch && parseInt(yearFirstMatch[1]) >= 1990 && parseInt(yearFirstMatch[1]) <= 2030) {
    statusVehicle.textContent = `${yearFirstMatch[1]} ${yearFirstMatch[2]} ${yearFirstMatch[3]}`;
  } else if (yearLastMatch && parseInt(yearLastMatch[3]) >= 1990 && parseInt(yearLastMatch[3]) <= 2030) {
    statusVehicle.textContent = `${yearLastMatch[3]} ${yearLastMatch[1]} ${yearLastMatch[2]}`;
  }

  // Booking confirmation — match "confirmation code", "booking ID", "booking code", etc.
  const bookingMatch = text.match(/(?:confirmation\s+code|booking\s+(?:id|code))\s+(?:is\s+)?(\w+)/i);
  if (bookingMatch) {
    statusBooking.textContent = bookingMatch[1];
    setStatus("Booked!");
  }

  // ── Location handling ──
  // Step 1: If agent is ASKING for confirmation ("is that right?"), stay pending
  if (lower.match(/is that (?:right|correct)|(?:sound|that) right\??|correct\?/)) {
    return;
  }

  // Step 2: If status is "Confirming..." and agent acknowledges without repeating zip
  // (user said "yes" and agent moved on), confirm with the pending GPS address
  if (statusLocation.textContent === "Confirming..." && pendingAddress) {
    const acknowledged = lower.match(/(?:great|got it|perfect|alright|okay|noted|thanks|excellent|wonderful|good)/);
    if (acknowledged) {
      const { road, city, zip } = pendingAddress;
      const display = [road, city, zip].filter(Boolean).join(", ");
      statusLocation.textContent = display || pendingAddress.formatted;
      pendingAddress = null;
      // Don't return — still check for zip in case agent also mentioned a new one
    }
  }

  // Step 3: Look for a zip code in the response — this signals a location update
  const zipMatch = text.match(/\b(\d{5})\b/);
  if (!zipMatch) return;

  const zip = zipMatch[1];

  // Extract address text near the zip code (everything before the zip in the same sentence)
  const sentenceWithZip = text.split(/[.!]/).find((s) => s.includes(zip)) || "";
  const beforeZip = sentenceWithZip.substring(0, sentenceWithZip.indexOf(zip)).trim();
  const addrMatch = beforeZip.match(/(?:to|at|near|on)\s+(.+?)(?:,\s*)?$/i);
  const addressPart = addrMatch ? addrMatch[1].trim() : "";

  // Build query for geocoding: address + zip
  const geocodeQuery = addressPart ? `${addressPart}, ${zip}` : zip;

  // Forward geocode to validate and update map + status
  forwardGeocode(geocodeQuery);
}

function forwardGeocode(query) {
  statusLocation.textContent = "Updating...";
  fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`,
    { headers: { "Accept-Language": "en" } }
  )
    .then((r) => r.json())
    .then((results) => {
      if (results.length > 0) {
        const { lat, lon, display_name } = results[0];
        updateMapLocation(parseFloat(lat), parseFloat(lon), display_name);
        // Format as "Street, City, Zip"
        const parts = display_name.split(", ");
        // Nominatim returns: street, city, county, state, zip, country
        // We want: street, city, zip
        const street = parts[0] || "";
        const city = parts[1] || "";
        // Find the zip in the display name
        const displayZip = parts.find((p) => /^\d{5}$/.test(p.trim())) || "";
        const formatted = [street, city, displayZip].filter(Boolean).join(", ");
        statusLocation.textContent = formatted || query;
        pendingAddress = null;
      } else {
        // Geocoding failed — show what we have
        statusLocation.textContent = query;
      }
    })
    .catch(() => {
      statusLocation.textContent = query;
    });
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
