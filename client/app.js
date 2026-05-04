/**
 * Roadside Assistance AI — WebSocket voice client
 *
 * Captures mic audio via MediaRecorder, sends to backend over WebSocket,
 * receives transcripts + TTS audio, plays audio via AudioContext.
 */

// ── Configuration ──
const WS_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "ws://localhost:8000/ws"
    : "wss://roadside-rescue-ai-agent.onrender.com/ws";

// ── SVG icon templates for chat avatars ──
const USER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

const BOT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';

// ── DOM elements ──
const micBtn = document.getElementById("mic-btn");
const micLabel = document.getElementById("mic-label");
const micIconOn = document.getElementById("mic-icon-on");
const micIconOff = document.getElementById("mic-icon-off");
const conversationEl = document.getElementById("conversation");
const detailLocation = document.getElementById("detail-location");
const detailVehicle = document.getElementById("detail-vehicle");
const detailPhone = document.getElementById("detail-phone");
const detailBooking = document.getElementById("detail-booking");
const connectionStatus = document.getElementById("connection-status");
const agentDot = document.getElementById("dot");
const agentDotPing = document.getElementById("dot-ping");
const agentLabel = document.getElementById("agent-label");

// ── State ──
let ws = null;
let mediaRecorder = null;
let isRecording = false;
let isSpeaking = false;
let map = null;
let mapMarker = null;
let pendingAddress = null;
let pendingLocationMsg = null;
let locationRejected = false;

// ── Helpers ──

function escapeHtml(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}

function setAgentStatus(status) {
  agentDot.className = "dot " + status;
  agentDotPing.className = status === "online" ? "dot-ping active" : "dot-ping";
  const labels = { online: "Agent online", offline: "Agent offline", error: "Connection error" };
  agentLabel.textContent = labels[status] || status;
}

function setStatus(text) {
  const labels = {
    Ready: "Tap to speak",
    "Listening...": "Listening...",
    "Thinking...": "Processing...",
    "Speaking...": "Agent speaking...",
    Disconnected: "Reconnecting...",
    "Not connected": "Not connected",
    "Mic access denied": "Microphone access denied",
    "Booked!": "Booking confirmed!",
    Error: "Error — tap to retry",
  };
  micLabel.textContent = labels[text] || text;

  if (text === "Listening...") {
    micLabel.classList.add("listening");
  } else {
    micLabel.classList.remove("listening");
  }
}

// ── WebSocket ──

function connect() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "conn-status connected";
    setAgentStatus("online");
    setStatus("Ready");
    if (pendingLocationMsg) {
      ws.send(JSON.stringify(pendingLocationMsg));
      pendingLocationMsg = null;
    }
  };

  ws.onclose = () => {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.className = "conn-status disconnected";
    setAgentStatus("offline");
    setStatus("Disconnected");
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    connectionStatus.textContent = "Connection error";
    connectionStatus.className = "conn-status disconnected";
    setAgentStatus("error");
  };

  ws.onmessage = (event) => {
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
      showThinkingIndicator();
      break;

    case "assistant_text":
      hideThinkingIndicator();
      addTranscript("assistant", msg.text);
      setStatus("Speaking...");
      parseAssistantResponse(msg.text);
      pauseMicForTTS();
      speakText(msg.text);
      break;

    case "audio_end":
      break;

    case "error":
      hideThinkingIndicator();
      addTranscript("assistant", "Sorry, something went wrong. Please try again.");
      micBtn.classList.remove("processing");
      setStatus("Error");
      console.error("Server error:", msg.message);
      break;

    case "pong":
      break;
  }
}

// ── Conversation display ──

function addTranscript(role, text) {
  const placeholder = conversationEl.querySelector(".placeholder");
  if (placeholder) placeholder.remove();

  hideThinkingIndicator();

  const group = document.createElement("div");
  group.className = "message-group " + (role === "user" ? "user" : "agent");

  const avatarClass = role === "user" ? "user-avatar" : "agent-avatar";
  const avatarIcon = role === "user" ? USER_ICON : BOT_ICON;
  const bubbleClass = role === "user" ? "user-bubble" : "agent-bubble";
  const sideClass = role === "user" ? "user-side" : "agent-side";
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  group.innerHTML =
    '<div class="avatar ' + avatarClass + '">' + avatarIcon + "</div>" +
    '<div class="message-content ' + sideClass + '">' +
      '<div class="bubble ' + bubbleClass + '"><p>' + escapeHtml(text) + "</p></div>" +
      '<span class="timestamp">' + time + "</span>" +
    "</div>";

  conversationEl.appendChild(group);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function showInterim(text) {
  let interim = conversationEl.querySelector(".interim-group");
  if (!interim) {
    const placeholder = conversationEl.querySelector(".placeholder");
    if (placeholder) placeholder.remove();

    interim = document.createElement("div");
    interim.className = "message-group user interim-group";
    interim.innerHTML =
      '<div class="avatar user-avatar">' + USER_ICON + "</div>" +
      '<div class="message-content user-side">' +
        '<div class="bubble user-bubble interim-bubble"><p class="interim-text"></p></div>' +
      "</div>";
    conversationEl.appendChild(interim);
  }
  interim.querySelector(".interim-text").textContent = text;
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function clearInterim() {
  const interim = conversationEl.querySelector(".interim-group");
  if (interim) interim.remove();
}

function showThinkingIndicator() {
  hideThinkingIndicator();
  const group = document.createElement("div");
  group.className = "message-group agent";
  group.id = "thinking-indicator";
  group.innerHTML =
    '<div class="avatar agent-avatar">' + BOT_ICON + "</div>" +
    '<div class="message-content agent-side">' +
      '<div class="bubble agent-bubble thinking-bubble">' +
        '<span class="thinking-dot" style="animation-delay:0ms"></span>' +
        '<span class="thinking-dot" style="animation-delay:150ms"></span>' +
        '<span class="thinking-dot" style="animation-delay:300ms"></span>' +
      "</div>" +
    "</div>";
  conversationEl.appendChild(group);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function hideThinkingIndicator() {
  const el = document.getElementById("thinking-indicator");
  if (el) el.remove();
}

// ── Status card updates ──

function detectVehicle(text) {
  const STOP_WORDS = /^(at|on|in|the|to|is|a|an|and|or|for|may|june|july|august)$/i;
  const normalized = text.replace(/[/,]/g, " ").replace(/\s+/g, " ");

  const yearFirst = normalized.match(/\b(\d{4})\s+([\w-]+)\s+((?:Model\s+)?[\w-]+)/i);
  if (
    yearFirst &&
    parseInt(yearFirst[1]) >= 1990 &&
    parseInt(yearFirst[1]) <= 2030 &&
    !STOP_WORDS.test(yearFirst[2])
  ) {
    return yearFirst[1] + " " + yearFirst[2] + " " + yearFirst[3];
  }

  const yearLast = normalized.match(/([\w-]+)\s+((?:Model\s+)?[\w-]+)\s+\(?(\d{4})\)?/i);
  if (
    yearLast &&
    parseInt(yearLast[3]) >= 1990 &&
    parseInt(yearLast[3]) <= 2030 &&
    !STOP_WORDS.test(yearLast[1])
  ) {
    return yearLast[3] + " " + yearLast[1] + " " + yearLast[2];
  }

  return null;
}

function parseUserTranscript(text) {
  const lower = text.toLowerCase().trim();

  if (
    detailLocation.textContent === "Confirming..." &&
    lower.match(/^no\b|^not\b|^actually\b|^nope\b/)
  ) {
    locationRejected = true;
    pendingAddress = null;
  }

  const zipMatch = text.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip = zipMatch[1];
    const zipIndex = text.indexOf(zip);

    const beforeZip = text.substring(0, zipIndex).trim();
    const beforeMatch = beforeZip.match(/(?:on|at|near)\s+(.+?)(?:,\s*)?$/i);
    let beforePart = beforeMatch ? beforeMatch[1].trim() : "";
    beforePart = beforePart.replace(/\s+(?:at|on|near|in)$/i, "");

    const afterZip = text.substring(zipIndex + 5).trim();
    const afterMatch = afterZip.match(/^,?\s*(?:on|at|near)?\s*([\w\s]+?)(?:\.|,|$)/i);
    const afterPart = afterMatch ? afterMatch[1].trim() : "";

    const addressPart = beforePart || afterPart;
    const geocodeQuery = addressPart ? addressPart + ", " + zip : zip;
    pendingAddress = null;
    locationRejected = false;
    forwardGeocode(geocodeQuery);
  }

  const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, "");
    detailPhone.textContent =
      "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }

  const vehicle = detectVehicle(text);
  if (vehicle) {
    detailVehicle.textContent = vehicle;
  }
}

function parseAssistantResponse(text) {
  const lower = text.toLowerCase();

  const vehicle = detectVehicle(text);
  if (vehicle) {
    detailVehicle.textContent = vehicle;
  }

  const bookingMatch = text.match(
    /(?:confirmation\s+code|booking\s+(?:id|code))\s+(?:is\s+)?(\w+)/i
  );
  if (bookingMatch) {
    detailBooking.textContent = bookingMatch[1];
    setStatus("Booked!");
  }

  if (
    detailLocation.textContent === "Confirming..." &&
    pendingAddress &&
    !locationRejected
  ) {
    if (lower.match(/is that (?:right|correct)|(?:sound|that) right\??|correct\?/)) {
      return;
    }
    const acknowledged = lower.match(
      /(?:great|got it|perfect|alright|okay|noted|thanks|excellent|wonderful|good)/
    );
    if (acknowledged) {
      const { road, city, zip } = pendingAddress;
      const display = [road, city, zip].filter(Boolean).join(", ");
      detailLocation.textContent = display || pendingAddress.formatted;
      pendingAddress = null;
    }
  }
}

function forwardGeocode(query) {
  detailLocation.textContent = "Updating...";
  fetch(
    "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(query) +
      "&format=json&limit=1&countrycodes=us&addressdetails=1",
    { headers: { "Accept-Language": "en" } }
  )
    .then((r) => r.json())
    .then((results) => {
      if (results.length > 0) {
        const { lat, lon, display_name, address } = results[0];
        updateMapLocation(parseFloat(lat), parseFloat(lon), display_name);
        const road = address?.road || "";
        const city = address?.city || address?.town || address?.village || "";
        const zip = address?.postcode || "";
        const formatted = [road, city, zip].filter(Boolean).join(", ");
        detailLocation.textContent = formatted || query;
        pendingAddress = null;
      } else {
        detailLocation.textContent = query;
      }
    })
    .catch(() => {
      detailLocation.textContent = query;
    });
}

// ── Audio capture ──

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000 },
    });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 16000 });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN && !isSpeaking) {
        ws.send(event.data);
      }
    };

    mediaRecorder.start(250);

    isRecording = true;
    micBtn.classList.add("recording");
    micIconOn.classList.add("hidden");
    micIconOff.classList.remove("hidden");
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
  micIconOn.classList.remove("hidden");
  micIconOff.classList.add("hidden");
  setStatus("Ready");
}

// ── Browser TTS ──

function pauseMicForTTS() {
  isSpeaking = true;
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getAudioTracks().forEach((t) => (t.enabled = false));
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "tts_playing" }));
  }
}

function resumeMicAfterTTS() {
  isSpeaking = false;
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getAudioTracks().forEach((t) => (t.enabled = true));
  }
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

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

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

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// ── Geolocation ──

function detectLocation() {
  if (!navigator.geolocation) {
    detailLocation.textContent = "Unavailable";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      initMap(latitude, longitude);
      reverseGeocode(latitude, longitude);
    },
    () => {
      detailLocation.textContent = "Denied";
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
    "https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lon + "&format=json",
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

      pendingAddress = { road, city, state, zip, formatted };
      detailLocation.textContent = "Confirming...";

      const locationMsg = { type: "location", lat, lon, zip, address: formatted };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(locationMsg));
      } else {
        pendingLocationMsg = locationMsg;
      }
    })
    .catch(() => {
      detailLocation.textContent = lat.toFixed(4) + ", " + lon.toFixed(4);
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
