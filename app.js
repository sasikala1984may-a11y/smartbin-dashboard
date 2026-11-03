
"use strict";

/* =========================================================
   SMART WASTE MONITOR
   ESP32 + Web Bluetooth + Demo Mode
   ========================================================= */

/* ---------------- CONFIGURATION ---------------- */

const BLE_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e";

const FULL_THRESHOLD = 90;
const MAX_HISTORY = 10;
const STORAGE_KEY = "smartWasteMonitorHistory";
const THEME_KEY = "smartWasteMonitorTheme";
const BIN_HEIGHT_CM = 18;

/* ---------------- APPLICATION STATE ---------------- */

const state = {
  device: null,
  server: null,
  service: null,
  txCharacteristic: null,
  rxCharacteristic: null,

  connected: false,
  demoMode: false,

  lastData: null,
  alertDismissed: false,

  history: [],
  demoTimer: null,

  // NEW: Buffer for fragmented BLE notifications.
  bleBuffer: "",

  demo: {
    wetDistance: 15,
    dryDistance: 15,
    moisture: 1000,
    wetFull: false,
    dryFull: false,
    wetDoorOpen: false,
    dryDoorOpen: false,
    sensorError: false
  }
};

/* ---------------- DOM ELEMENTS ---------------- */

const $ = (id) => document.getElementById(id);

const DOM = {
  splash: $("splash-screen"),

  alertBanner: $("alert-banner"),
  alertTitle: $("alert-title"),
  alertMessage: $("alert-message"),
  alertDismiss: $("alert-dismiss-btn"),

  browserWarning: $("browser-warning"),
  enableDemoFromWarning: $("enable-demo-from-warning"),

  bleStatusDot: $("ble-status-dot"),
  bleStatusText: $("ble-status-text"),
  lastUpdateText: $("last-update-text"),
  connectBtn: $("ble-connect-btn"),
  bleBtnText: $("ble-btn-text"),

  demoBtn: $("demo-mode-btn"),
  demoBadge: $("demo-badge"),
  demoControlBar: $("demo-control-bar"),

  themeBtn: $("theme-toggle-btn"),
  moonIcon: $("theme-moon-icon"),
  sunIcon: $("theme-sun-icon"),

  wet: {
    pct: $("wet-pct-val"),
    distance: $("wet-cm-val"),
    distanceBar: $("wet-dist-bar"),
    liquid: $("wet-liquid-fill"),
    statusBadge: $("wet-status-badge"),
    badgeText: $("wet-badge-text"),
    thresholdPill: $("wet-threshold-pill"),
    thresholdLabel: $("wet-threshold-label"),
    distanceDescription: $("wet-cm-desc"),
    doorIndicator: $("wet-door-state-indicator")
  },

  dry: {
    pct: $("dry-pct-val"),
    distance: $("dry-cm-val"),
    distanceBar: $("dry-dist-bar"),
    liquid: $("dry-liquid-fill"),
    statusBadge: $("dry-status-badge"),
    badgeText: $("dry-badge-text"),
    thresholdPill: $("dry-threshold-pill"),
    thresholdLabel: $("dry-threshold-label"),
    distanceDescription: $("dry-cm-desc"),
    doorIndicator: $("dry-door-state-indicator")
  },

  buzzer: {
    badge: $("buzzer-status-badge"),
    badgeText: $("buzzer-badge-text"),
    circle: $("buzzer-visual-circle"),
    headline: $("buzzer-state-headline"),
    explanation: $("buzzer-explanation")
  },

  classification: {
    badge: $("item-classification-badge"),
    badgeText: $("item-class-text"),
    resultBox: $("moist-result-box"),
    classDisplay: $("moist-class-display"),
    note: $("moist-note-display"),
    raw: $("moist-raw-display"),
    needle: $("adc-needle-indicator")
  },

  wetDoor: {
    indicator: $("wet-door-state-indicator"),
    lid: $("door-lid-wet"),
    state: $("door-state-wet"),
    compartment: $("door-comp-wet")
  },

  dryDoor: {
    indicator: $("dry-door-state-indicator"),
    lid: $("door-lid-dry"),
    state: $("door-state-dry"),
    compartment: $("door-comp-dry")
  },

  doorSummary: $("door-summary-text"),
  doorOverall: $("door-overall-summary"),

  openWetBtn: $("btn-open-wet"),
  openDryBtn: $("btn-open-dry"),

  commandFeedback: $("command-feedback-text"),
  historyList: $("history-list"),
  clearHistoryBtn: $("clear-history-btn"),

  toastContainer: $("toast-container")
};

/* ---------------- GENERAL HELPERS ---------------- */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setHidden(element, hidden) {
  if (element) {
    element.classList.toggle("hidden", hidden);
  }
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function showToast(message, type = "info") {
  if (!DOM.toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  DOM.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("toast-visible");
  }, 10);

  window.setTimeout(() => {
    toast.classList.remove("toast-visible");

    window.setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ---------------- EVENT HISTORY ---------------- */

function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];

    state.history = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Could not load saved history:", error);
    state.history = [];
  }

  renderHistory();
}

function saveHistory() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.history.slice(0, MAX_HISTORY))
    );
  } catch (error) {
    console.warn("Could not save history:", error);
  }
}

function addHistory(message, type = "info") {
  state.history.unshift({
    message,
    type,
    time: new Date().toISOString()
  });

  state.history = state.history.slice(0, MAX_HISTORY);

  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (!DOM.historyList) return;

  DOM.historyList.replaceChildren();

  if (state.history.length === 0) {
    const item = document.createElement("li");
    item.className = "history-empty";
    item.textContent =
      "No recorded events yet. Connect your SmartBin or toggle Demo Mode!";

    DOM.historyList.appendChild(item);
    return;
  }

  state.history.forEach((event) => {
    const item = document.createElement("li");
    item.className = `history-item history-${event.type || "info"}`;

    const message = document.createElement("span");
    message.className = "history-message";
    message.textContent = event.message || "System event";

    const time = document.createElement("time");
    time.className = "history-time";

    const date = new Date(event.time);
    time.textContent = Number.isNaN(date.getTime())
      ? "--:--:--"
      : date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

    item.append(message, time);
    DOM.historyList.appendChild(item);
  });
}

function clearHistory() {
  state.history = [];
  saveHistory();
  renderHistory();

  showToast("Event history cleared.", "success");
}

/* ---------------- CONNECTION STATUS ---------------- */

function updateConnectionStatus(connected, message) {
  state.connected = connected;

  if (DOM.bleStatusDot) {
    DOM.bleStatusDot.classList.toggle("dot-disconnected", !connected);
    DOM.bleStatusDot.classList.toggle("dot-connected", connected);
  }

  setText(
    DOM.bleStatusText,
    message || (connected ? "Connected" : "Disconnected")
  );

  setText(
    DOM.bleBtnText,
    connected ? "Disconnect Bin" : "Connect Bin"
  );

  if (DOM.connectBtn) {
    DOM.connectBtn.classList.toggle("is-connected", connected);
  }

  if (DOM.lastUpdateText && !state.lastData) {
    setText(
      DOM.lastUpdateText,
      connected ? "Waiting for sensor data..." : "Last update: --"
    );
  }
}

function updateLastUpdate() {
  setText(DOM.lastUpdateText, `Last update: ${formatTime()}`);
}

/* ---------------- BIN CAPACITY CALCULATIONS ---------------- */

/*
  Supported bin fields:
  distance, cm, dist
  percent, pct, percentage, fill

  Percentage is calculated from the distance when the
  ESP32 does not provide a fill percentage.
*/

function normalizeBin(bin) {
  if (!bin || typeof bin !== "object") {
    return {
      distance: -1,
      percent: 0,
      full: false,
      valid: false
    };
  }

  const distance = safeNumber(
    bin.distance ?? bin.cm ?? bin.dist,
    -1
  );

  // FIX: Recognize "pct", which your ESP32 actually sends.
  const hasPercent = [
    "percent",
    "pct",
    "percentage",
    "fill"
  ].some((key) => bin[key] !== undefined && bin[key] !== null);

  let percent;

  if (hasPercent) {
    percent = safeNumber(
      bin.percent ?? bin.pct ?? bin.percentage ?? bin.fill,
      0
    );
  } else if (distance >= 0) {
    percent = ((BIN_HEIGHT_CM - distance) / BIN_HEIGHT_CM) * 100;
  } else {
    percent = 0;
  }

  percent = clamp(Math.round(percent), 0, 100);

  const valid = distance >= 0 || hasPercent;

  const full = bin.full !== undefined
    ? Boolean(bin.full)
    : percent >= FULL_THRESHOLD;

  return {
    distance,
    percent,
    full,
    valid
  };
}

/* ---------------- BIN DASHBOARD ---------------- */

function updateBinDisplay(elements, bin) {
  if (!elements) return;

  setText(elements.pct, bin.valid ? bin.percent : "--");

  setText(
    elements.distance,
    bin.distance >= 0 ? bin.distance.toFixed(1) : "--"
  );

  if (elements.liquid) {
    elements.liquid.style.height =
      `${bin.valid ? bin.percent : 0}%`;
  }

  if (elements.distanceBar) {
    const distanceWidth = bin.distance >= 0
      ? clamp((bin.distance / BIN_HEIGHT_CM) * 100, 0, 100)
      : 0;

    elements.distanceBar.style.width = `${distanceWidth}%`;
  }

  if (elements.statusBadge) {
    elements.statusBadge.classList.toggle(
      "badge-full",
      bin.full && bin.valid
    );

    elements.statusBadge.classList.toggle(
      "badge-not-full",
      !bin.full || !bin.valid
    );

    elements.statusBadge.classList.toggle(
      "badge-error",
      !bin.valid
    );
  }

  setText(
    elements.badgeText,
    !bin.valid ? "SENSOR ERROR" : bin.full ? "FULL" : "NOT FULL"
  );

  if (elements.thresholdPill) {
    elements.thresholdPill.classList.toggle(
      "threshold-danger",
      bin.full && bin.valid
    );

    elements.thresholdPill.classList.toggle(
      "threshold-normal",
      !bin.full || !bin.valid
    );

    elements.thresholdPill.classList.toggle(
      "threshold-error",
      !bin.valid
    );
  }

  setText(
    elements.thresholdLabel,
    !bin.valid
      ? "Sensor Reading Invalid"
      : bin.full
        ? "FULL — Empty Bin"
        : `Normal Level (< ${FULL_THRESHOLD}%)`
  );

  setText(
    elements.distanceDescription,
    !bin.valid
      ? "Check ultrasonic sensor"
      : bin.distance >= 0
        ? "Clearance to lid"
        : "Distance unavailable"
  );
}

/* ---------------- ALERT BANNER ---------------- */

function updateAlertBanner(wet, dry, previousData) {
  const wetFull = wet.valid && wet.full;
  const dryFull = dry.valid && dry.full;

  if (!wetFull && !dryFull) {
    setHidden(DOM.alertBanner, true);
    state.alertDismissed = false;
    return;
  }

  const previousWetFull = Boolean(
    previousData && previousData.wet && previousData.wet.full
  );

  const previousDryFull = Boolean(
    previousData && previousData.dry && previousData.dry.full
  );

  if (
    (wetFull && !previousWetFull) ||
    (dryFull && !previousDryFull)
  ) {
    state.alertDismissed = false;
  }

  if (state.alertDismissed) return;

  let title;
  let message;

  if (wetFull && dryFull) {
    title = "OVERFLOW WARNING: Both Bins Are FULL!";
    message = "Both compartments have reached capacity. Empty both bins.";
  } else if (wetFull) {
    title = "OVERFLOW WARNING: Wet Bin is FULL!";
    message = "Wet compartment capacity reached. Empty it immediately.";
  } else {
    title = "OVERFLOW WARNING: Dry Bin is FULL!";
    message = "Dry compartment capacity reached. Empty it immediately.";
  }

  setText(DOM.alertTitle, title);
  setText(DOM.alertMessage, message);
  setHidden(DOM.alertBanner, false);
}

/* ---------------- BUZZER STATUS ---------------- */

function updateBuzzer(data) {
  const wetFull = data.wet.valid && data.wet.full;
  const dryFull = data.dry.valid && data.dry.full;

  const obstruction = Boolean(
    data.obstruction || data.error
  );

  const buzzerOn = data.buzzer !== undefined
    ? Boolean(data.buzzer)
    : wetFull || dryFull || obstruction;

  if (DOM.buzzer.badge) {
    DOM.buzzer.badge.classList.toggle("badge-buzzer-on", buzzerOn);
    DOM.buzzer.badge.classList.toggle("badge-buzzer-off", !buzzerOn);
  }

  setText(DOM.buzzer.badgeText, buzzerOn ? "ON" : "OFF");
  setText(
    DOM.buzzer.headline,
    buzzerOn ? "Buzzer Active" : "Buzzer Standby"
  );

  setText(
    DOM.buzzer.explanation,
    buzzerOn
      ? "An overflow, obstruction, or active hardware alarm has been detected."
      : "Hardware alarm is currently silent. The buzzer activates when an alarm condition is detected."
  );

  if (DOM.buzzer.circle) {
    DOM.buzzer.circle.classList.toggle("buzzer-active", buzzerOn);
  }
}

/* ---------------- CLASSIFICATION ---------------- */

function updateClassification(data) {
  // FIX: ESP32 sends moisture as { raw: 4095, cls: "UNKNOWN" }.
  const moistureData =
    data.moisture && typeof data.moisture === "object"
      ? data.moisture
      : {};

  const raw = safeNumber(
    moistureData.raw ??
    data.moistureRaw ??
    data.adc ??
    (typeof data.moisture === "number" ? data.moisture : undefined),
    -1
  );

  setText(
    DOM.classification.raw,
    raw >= 0 ? `ADC: ${raw}` : "ADC: --"
  );

  if (DOM.classification.needle) {
    DOM.classification.needle.style.left =
      `${clamp((raw / 4095) * 100, 0, 100)}%`;
  }

  let classification = "WAITING";
  let note = "Insert waste item into intake funnel";

  if (raw >= 0) {
    if (raw > 2500) {
      classification = "WET";
      note = "High moisture detected. Wet waste classification.";
    } else if (raw < 1500) {
      classification = "DRY";
      note = "Low moisture detected. Dry waste classification.";
    } else {
      classification = "UNKNOWN";
      note = "Ambiguous moisture level. Check the item or sensor.";
    }
  }

  // Use the ESP32 classification when available.
  const espClassification =
    moistureData.cls ?? data.classification;

  if (espClassification) {
    const value = String(espClassification).toUpperCase();

    if (["WET", "DRY", "UNKNOWN"].includes(value)) {
      classification = value;
    }
  }

  setText(DOM.classification.classDisplay, classification);

  // Keep the note consistent with the displayed classification.
  if (classification === "WET") {
    note = "High moisture detected. Wet waste classification.";
  } else if (classification === "DRY") {
    note = "Low moisture detected. Dry waste classification.";
  } else if (classification === "UNKNOWN") {
    note = "Ambiguous moisture level. Check the item or sensor.";
  }

  setText(DOM.classification.note, note);

  setText(
    DOM.classification.badgeText,
    classification === "WAITING"
      ? "WAITING FOR ITEM"
      : `${classification} ITEM DETECTED`
  );

  if (DOM.classification.badge) {
    DOM.classification.badge.classList.toggle(
      "badge-neutral",
      classification === "WAITING"
    );

    DOM.classification.badge.classList.toggle(
      "badge-wet",
      classification === "WET"
    );

    DOM.classification.badge.classList.toggle(
      "badge-dry",
      classification === "DRY"
    );

    DOM.classification.badge.classList.toggle(
      "badge-unknown",
      classification === "UNKNOWN"
    );
  }
}

/* ---------------- CHUTE DOORS ---------------- */

function updateDoor(isWet, isOpen) {
  const door = isWet ? DOM.wetDoor : DOM.dryDoor;
  const elements = isWet ? DOM.wet : DOM.dry;

  if (door.lid) {
    door.lid.classList.toggle("door-open", isOpen);
  }

  if (door.compartment) {
    door.compartment.classList.toggle("door-open", isOpen);
  }

  setText(door.state, isOpen ? "OPEN" : "CLOSED");
  setText(elements.doorIndicator, isOpen ? "OPEN" : "CLOSED");

  if (elements.doorIndicator) {
    elements.doorIndicator.classList.toggle("door-pill-open", isOpen);
    elements.doorIndicator.classList.toggle("door-pill-closed", !isOpen);
  }
}

function updateDoors(data) {
  updateDoor(true, Boolean(data.wetDoorOpen));
  updateDoor(false, Boolean(data.dryDoorOpen));

  const wetOpen = Boolean(data.wetDoorOpen);
  const dryOpen = Boolean(data.dryDoorOpen);

  if (wetOpen && dryOpen) {
    setText(DOM.doorSummary, "Both intake doors are open");
  } else if (wetOpen) {
    setText(DOM.doorSummary, "Wet intake door is open");
  } else if (dryOpen) {
    setText(DOM.doorSummary, "Dry intake door is open");
  } else {
    setText(DOM.doorSummary, "Both intake doors are securely closed");
  }
}

/* ---------------- MAIN DASHBOARD UPDATE ---------------- */

function updateDashboard(rawData) {
  if (!rawData || typeof rawData !== "object") return;

  const previousData = state.lastData;

  const wet = normalizeBin(rawData.wet);
  const dry = normalizeBin(rawData.dry);

  const data = {
    ...rawData,
    wet,
    dry
  };

  updateBinDisplay(DOM.wet, wet);
  updateBinDisplay(DOM.dry, dry);

  updateAlertBanner(wet, dry, previousData);
  updateBuzzer(data);
  updateClassification(data);
  updateDoors(data);

  state.lastData = data;

  updateLastUpdate();
}

/* ---------------- BLE DATA PARSING ---------------- */

/*
  FIX: BLE notifications may split one JSON message across
  several notifications.

  This buffer collects fragments and extracts complete JSON
  objects before parsing them.

  Supports nested JSON objects and braces inside quoted strings.
*/

function extractCompleteJSON(buffer) {
  const messages = [];

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < buffer.length; i++) {
    const character = buffer[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        start = i;
      }

      depth++;
    } else if (character === "}") {
      if (depth > 0) {
        depth--;

        if (depth === 0 && start !== -1) {
          messages.push(buffer.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  // Keep the incomplete JSON object for the next notification.
  const remainder = depth > 0 && start !== -1
    ? buffer.slice(start)
    : "";

  return { messages, remainder };
}

function parseTelemetry(message) {
  const textMessage = message.trim();

  if (!textMessage) return null;

  try {
    const json = JSON.parse(textMessage);

    if (json && typeof json === "object") {
      return json;
    }
  } catch (_) {
    // Try key/value parsing below.
  }

  const result = {};
  const values = {};

  textMessage.split(/[,\n;]+/).forEach((part) => {
    const separator = part.indexOf("=");

    if (separator === -1) return;

    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();

    if (key) values[key] = value;
  });

  function getNumber(...keys) {
    for (const key of keys) {
      if (values[key] !== undefined) {
        const number = Number(values[key]);

        if (Number.isFinite(number)) return number;
      }
    }

    return undefined;
  }

  function getBoolean(...keys) {
    for (const key of keys) {
      if (values[key] !== undefined) {
        return ["1", "true", "on", "yes", "open", "full"].includes(
          values[key].toLowerCase()
        );
      }
    }

    return undefined;
  }

  const wetDistance = getNumber(
    "wetdistance", "wet_distance", "wetcm", "wet_cm", "wet"
  );

  const dryDistance = getNumber(
    "drydistance", "dry_distance", "drycm", "dry_cm", "dry"
  );

  if (wetDistance !== undefined) {
    result.wet = { distance: wetDistance };
  }

  if (dryDistance !== undefined) {
    result.dry = { distance: dryDistance };
  }

  const wetPercent = getNumber("wetpercent", "wet_percent", "wetpct");
  const dryPercent = getNumber("drypercent", "dry_percent", "drypct");

  if (wetPercent !== undefined) {
    result.wet = { ...(result.wet || {}), percent: wetPercent };
  }

  if (dryPercent !== undefined) {
    result.dry = { ...(result.dry || {}), percent: dryPercent };
  }

  const wetFull = getBoolean("wetfull", "wet_full");
  const dryFull = getBoolean("dryfull", "dry_full");

  if (wetFull !== undefined) {
    result.wet = { ...(result.wet || {}), full: wetFull };
  }

  if (dryFull !== undefined) {
    result.dry = { ...(result.dry || {}), full: dryFull };
  }

  const moisture = getNumber("moisture", "adc", "moistureraw");

  if (moisture !== undefined) {
    result.moisture = moisture;
  }

  const buzzer = getBoolean("buzzer", "alarm");

  if (buzzer !== undefined) {
    result.buzzer = buzzer;
  }

  const wetDoorOpen = getBoolean("wetdooropen", "wet_door_open");
  const dryDoorOpen = getBoolean("drydooropen", "dry_door_open");

  if (wetDoorOpen !== undefined) {
    result.wetDoorOpen = wetDoorOpen;
  }

  if (dryDoorOpen !== undefined) {
    result.dryDoorOpen = dryDoorOpen;
  }

  return Object.keys(result).length ? result : null;
}

function handleBLENotification(event) {
  const value = event.target.value;
  const fragment = new TextDecoder().decode(value);

  if (!fragment) return;

  // Append this notification to any unfinished previous message.
  state.bleBuffer += fragment;

  // Avoid an unbounded buffer if the ESP32 sends malformed data.
  if (state.bleBuffer.length > 16384) {
    console.warn("BLE receive buffer reset: message too large.");
    state.bleBuffer = fragment;
  }

  const extracted = extractCompleteJSON(state.bleBuffer);

  // Preserve incomplete JSON for the next BLE notification.
  state.bleBuffer = extracted.remainder;

  for (const message of extracted.messages) {
    const data = parseTelemetry(message);

    if (data) {
      updateDashboard(data);
    } else {
      console.warn("Could not parse complete ESP32 telemetry:", message);
    }
  }

  // Also support newline-delimited non-JSON telemetry.
  // Only process it when there is no unfinished JSON object.
  if (
    state.bleBuffer &&
    !state.bleBuffer.includes("{") &&
    /[\r\n]/.test(state.bleBuffer)
  ) {
    const lines = state.bleBuffer.split(/[\r\n]+/);
    state.bleBuffer = lines.pop() || "";

    for (const line of lines) {
      const data = parseTelemetry(line);

      if (data) {
        updateDashboard(data);
      }
    }
  }
}

/* ---------------- BLUETOOTH CONNECTION ---------------- */

function isBluetoothSupported() {
  return Boolean(
    navigator.bluetooth &&
    typeof navigator.bluetooth.requestDevice === "function"
  );
}

async function connectBLE() {
  if (!isBluetoothSupported()) {
    setHidden(DOM.browserWarning, false);
    showToast(
      "Web Bluetooth is unavailable. Use Chrome or Edge on a supported device.",
      "error"
    );
    return;
  }

  try {
    state.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    state.device.addEventListener(
      "gattserverdisconnected",
      handleBLEDisconnect
    );

    updateConnectionStatus(false, "Connecting...");

    state.bleBuffer = "";

    state.server = await state.device.gatt.connect();

    state.service = await state.server.getPrimaryService(
      BLE_SERVICE_UUID
    );

    state.rxCharacteristic = await state.service.getCharacteristic(
      BLE_RX_UUID
    );

    state.txCharacteristic = await state.service.getCharacteristic(
      BLE_TX_UUID
    );

    await state.txCharacteristic.startNotifications();

    state.txCharacteristic.addEventListener(
      "characteristicvaluechanged",
      handleBLENotification
    );

    updateConnectionStatus(true, "Connected");
    addHistory(
      `Connected to ${state.device.name || "ESP32 SmartBin"}`,
      "success"
    );
    showToast("Connected to SmartBin successfully.", "success");

  } catch (error) {
    console.error("BLE connection failed:", error);

    updateConnectionStatus(false);

    if (error.name !== "NotFoundError") {
      showToast(`BLE connection failed: ${error.message}`, "error");
      addHistory(`BLE connection failed: ${error.message}`, "error");
    }
  }
}

function handleBLEDisconnect() {
  state.connected = false;
  state.bleBuffer = "";

  if (state.txCharacteristic) {
    state.txCharacteristic.removeEventListener(
      "characteristicvaluechanged",
      handleBLENotification
    );
  }

  state.server = null;
  state.service = null;
  state.txCharacteristic = null;
  state.rxCharacteristic = null;

  updateConnectionStatus(false);

  addHistory("SmartBin disconnected.", "warning");
  showToast("SmartBin disconnected.", "warning");
}

async function disconnectBLE() {
  try {
    if (state.device && state.device.gatt.connected) {
      state.device.gatt.disconnect();
    } else {
      handleBLEDisconnect();
    }
  } catch (error) {
    console.error("Disconnect error:", error);
    showToast("Could not disconnect cleanly.", "error");
  }
}

async function sendBLECommand(command) {
  if (state.demoMode) {
    handleDemoCommand(command);
    return;
  }

  if (!state.connected || !state.rxCharacteristic) {
    showToast(
      "Connect to the ESP32 first, or activate Demo Mode.",
      "warning"
    );
    setText(DOM.commandFeedback, "Not connected. Command was not sent.");
    return;
  }

  try {
    const bytes = new TextEncoder().encode(command);

    if (
      typeof state.rxCharacteristic.writeValueWithResponse === "function"
    ) {
      await state.rxCharacteristic.writeValueWithResponse(bytes);
    } else {
      await state.rxCharacteristic.writeValue(bytes);
    }

    const description = command === "W"
      ? "Wet door command sent to ESP32."
      : "Dry door command sent to ESP32.";

    setText(DOM.commandFeedback, description);
    addHistory(description, "success");
    showToast(description, "success");

  } catch (error) {
    console.error("BLE command failed:", error);

    setText(DOM.commandFeedback, `Command failed: ${error.message}`);
    showToast("Failed to send command to ESP32.", "error");
  }
}

/* ---------------- DEMO MODE ---------------- */

function createDemoData() {
  const wetDistance = state.demo.sensorError
    ? -1
    : state.demo.wetFull
      ? 1
      : state.demo.wetDistance;

  const dryDistance = state.demo.sensorError
    ? -1
    : state.demo.dryFull
      ? 1
      : state.demo.dryDistance;

  return {
    wet: {
      distance: wetDistance,
      percent: state.demo.wetFull
        ? 100
        : state.demo.sensorError
          ? 0
          : clamp(
              Math.round(
                ((BIN_HEIGHT_CM - wetDistance) / BIN_HEIGHT_CM) * 100
              ),
              0,
              100
            ),
      full: state.demo.wetFull
    },

    dry: {
      distance: dryDistance,
      percent: state.demo.dryFull
        ? 100
        : state.demo.sensorError
          ? 0
          : clamp(
              Math.round(
                ((BIN_HEIGHT_CM - dryDistance) / BIN_HEIGHT_CM) * 100
              ),
              0,
              100
            ),
      full: state.demo.dryFull
    },

    moisture: state.demo.moisture,

    buzzer:
      state.demo.wetFull ||
      state.demo.dryFull ||
      state.demo.sensorError,

    wetDoorOpen: state.demo.wetDoorOpen,
    dryDoorOpen: state.demo.dryDoorOpen
  };
}

function startDemoMode() {
  state.demoMode = true;

  if (state.device && state.device.gatt.connected) {
    state.device.gatt.disconnect();
  }

  updateConnectionStatus(false, "Demo Mode");
  setText(DOM.demoBadge, "ON");

  if (DOM.demoBtn) {
    DOM.demoBtn.setAttribute("aria-pressed", "true");
    DOM.demoBtn.classList.add("demo-active");
  }

  setHidden(DOM.demoControlBar, false);
  setHidden(DOM.browserWarning, true);

  updateDashboard(createDemoData());

  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
  }

  state.demoTimer = window.setInterval(() => {
    if (!state.demo.sensorError) {
      if (!state.demo.wetFull) {
        state.demo.wetDistance = clamp(
          state.demo.wetDistance + (Math.random() - 0.5) * 0.6,
          1,
          BIN_HEIGHT_CM
        );
      }

      if (!state.demo.dryFull) {
        state.demo.dryDistance = clamp(
          state.demo.dryDistance + (Math.random() - 0.5) * 0.6,
          1,
          BIN_HEIGHT_CM
        );
      }
    }

    updateDashboard(createDemoData());
  }, 2000);

  addHistory("Demo Mode activated.", "success");
  showToast("Demo Mode activated. Sensor data is simulated.", "success");
}

function stopDemoMode() {
  state.demoMode = false;

  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
    state.demoTimer = null;
  }

  setText(DOM.demoBadge, "OFF");

  if (DOM.demoBtn) {
    DOM.demoBtn.setAttribute("aria-pressed", "false");
    DOM.demoBtn.classList.remove("demo-active");
  }

  setHidden(DOM.demoControlBar, true);

  updateConnectionStatus(state.connected);

  addHistory("Demo Mode deactivated.", "info");
  showToast("Demo Mode deactivated.", "info");
}

function toggleDemoMode() {
  if (state.demoMode) {
    stopDemoMode();
  } else {
    startDemoMode();
  }
}

function handleDemoCommand(command) {
  if (command === "W") {
    state.demo.wetDoorOpen = !state.demo.wetDoorOpen;

    if (state.demo.wetDoorOpen) {
      state.demo.dryDoorOpen = false;
    }
  }

  if (command === "D") {
    state.demo.dryDoorOpen = !state.demo.dryDoorOpen;

    if (state.demo.dryDoorOpen) {
      state.demo.wetDoorOpen = false;
    }
  }

  updateDashboard(createDemoData());

  const message = command === "W"
    ? `Demo: Wet door ${state.demo.wetDoorOpen ? "opened" : "closed"}.`
    : `Demo: Dry door ${state.demo.dryDoorOpen ? "opened" : "closed"}.`;

  setText(DOM.commandFeedback, message);
  addHistory(message, "info");
  showToast(message, "success");
}

/* ---------------- DEMO SIMULATION BUTTONS ---------------- */

function toggleWetFull() {
  state.demo.wetFull = !state.demo.wetFull;

  state.demo.wetDistance = state.demo.wetFull ? 1 : 15;
  state.demo.sensorError = false;

  updateDashboard(createDemoData());

  addHistory(
    `Demo: Wet bin ${state.demo.wetFull ? "is FULL" : "is no longer full"}.`,
    state.demo.wetFull ? "warning" : "success"
  );
}

function toggleDryFull() {
  state.demo.dryFull = !state.demo.dryFull;

  state.demo.dryDistance = state.demo.dryFull ? 1 : 15;
  state.demo.sensorError = false;

  updateDashboard(createDemoData());

  addHistory(
    `Demo: Dry bin ${state.demo.dryFull ? "is FULL" : "is no longer full"}.`,
    state.demo.dryFull ? "warning" : "success"
  );
}

function simulateWetItem() {
  state.demo.moisture = 3200;
  updateDashboard(createDemoData());

  addHistory("Demo: Wet item detected.", "info");
}

function simulateDryItem() {
  state.demo.moisture = 900;
  updateDashboard(createDemoData());

  addHistory("Demo: Dry item detected.", "info");
}

function simulateUnknownItem() {
  state.demo.moisture = 2000;
  updateDashboard(createDemoData());

  addHistory("Demo: Ambiguous item detected.", "warning");
}

function simulateSensorError() {
  state.demo.sensorError = !state.demo.sensorError;
  updateDashboard(createDemoData());

  addHistory(
    `Demo: Sensor error ${state.demo.sensorError ? "enabled" : "disabled"}.`,
    state.demo.sensorError ? "error" : "success"
  );
}

/* ---------------- THEME ---------------- */

function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", selectedTheme);

  setHidden(DOM.moonIcon, selectedTheme === "light");
  setHidden(DOM.sunIcon, selectedTheme === "dark");

  try {
    localStorage.setItem(THEME_KEY, selectedTheme);
  } catch (error) {
    console.warn("Could not save theme:", error);
  }
}

function initializeTheme() {
  let theme = "dark";

  try {
    theme = localStorage.getItem(THEME_KEY) || "dark";
  } catch (error) {
    console.warn("Could not read saved theme:", error);
  }

  applyTheme(theme);
}

function toggleTheme() {
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "dark";

  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

/* ---------------- ALERT DISMISS ---------------- */

function dismissAlert() {
  state.alertDismissed = true;
  setHidden(DOM.alertBanner, true);
}

/* ---------------- EVENT LISTENERS ---------------- */

function bindEvents() {
  DOM.connectBtn?.addEventListener("click", () => {
    if (state.connected) {
      disconnectBLE();
    } else {
      connectBLE();
    }
  });

  DOM.demoBtn?.addEventListener("click", toggleDemoMode);

  DOM.enableDemoFromWarning?.addEventListener("click", () => {
    if (!state.demoMode) startDemoMode();
  });

  DOM.themeBtn?.addEventListener("click", toggleTheme);

  DOM.alertDismiss?.addEventListener("click", dismissAlert);

  DOM.openWetBtn?.addEventListener("click", () => {
    sendBLECommand("W");
  });

  DOM.openDryBtn?.addEventListener("click", () => {
    sendBLECommand("D");
  });

  DOM.clearHistoryBtn?.addEventListener("click", clearHistory);

  $("demo-toggle-wet-full")?.addEventListener("click", () => {
    if (state.demoMode) toggleWetFull();
  });

  $("demo-toggle-dry-full")?.addEventListener("click", () => {
    if (state.demoMode) toggleDryFull();
  });

  $("demo-sim-wet-item")?.addEventListener("click", () => {
    if (state.demoMode) simulateWetItem();
  });

  $("demo-sim-dry-item")?.addEventListener("click", () => {
    if (state.demoMode) simulateDryItem();
  });

  $("demo-sim-unknown-item")?.addEventListener("click", () => {
    if (state.demoMode) simulateUnknownItem();
  });

  $("demo-sim-sensor-error")?.addEventListener("click", () => {
    if (state.demoMode) simulateSensorError();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;

    if (
      target &&
      (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
    ) {
      return;
    }

    if (event.key.toLowerCase() === "w") {
      sendBLECommand("W");
    }

    if (event.key.toLowerCase() === "d") {
      sendBLECommand("D");
    }
  });
}

/* ---------------- BROWSER COMPATIBILITY ---------------- */

function checkBrowserCompatibility() {
  if (!isBluetoothSupported()) {
    setHidden(DOM.browserWarning, false);
  } else {
    setHidden(DOM.browserWarning, true);
  }
}

/* ---------------- INITIALIZATION ---------------- */

function initializeApp() {
  initializeTheme();
  loadHistory();
  bindEvents();
  checkBrowserCompatibility();

  updateConnectionStatus(false);

  updateDashboard({
    wet: { distance: -1 },
    dry: { distance: -1 },
    moisture: -1,
    buzzer: false,
    wetDoorOpen: false,
    dryDoorOpen: false
  });

  addHistory("Smart Waste Monitor initialized.", "info");

  console.log("Smart Waste Monitor initialized.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}
