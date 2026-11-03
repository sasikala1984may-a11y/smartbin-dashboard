/**
 * ==============================================================================
 * Smart Waste Monitor - Main Application Logic
 * ==============================================================================
 * Vanilla JavaScript application connecting to an ESP32 dual-compartment smart bin
 * using the Web Bluetooth API (Nordic UART Service).
 *
 * Protocol Constants:
 * - Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
 * - TX (Notify ESP32 -> App): 6e400003-b5a3-f393-e0a9-e50e24dcca9e
 * - RX (Write App -> ESP32): 6e400002-b5a3-f393-e0a9-e50e24dcca9e
 * - Device prefix: "SmartBin"
 * - Data format: Line-delimited JSON ending with '\n'
 * ==============================================================================
 */

// --- Configuration Constants ---
const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // NOTIFY
const NORDIC_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // WRITE
const BLE_DEVICE_NAME_PREFIX = 'SmartBin';

const MAX_HISTORY_ITEMS = 10;
const STORAGE_KEY_HISTORY = 'smartbin_history';
const STORAGE_KEY_THEME = 'smartbin_theme';

// --- State Management ---
const state = {
  // Bluetooth connection state
  device: null,
  server: null,
  txCharacteristic: null,
  rxCharacteristic: null,
  isConnected: false,
  isConnecting: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 3,
  reconnectTimeoutId: null,

  // Stream chunk buffer (BLE splits JSON packets across multiple chunks)
  bleBuffer: '',

  // Demo simulation mode state
  isDemoMode: false,
  demoIntervalId: null,
  demoData: {
    wet: { cm: 8.5, pct: 45, full: false },
    dry: { cm: 12.0, pct: 30, full: false },
    buzzer: false,
    moist: { raw: 850, cls: 'DRY' },
    door: 'CLOSED'
  },
  demoDoorTimerId: null,

  // Last telemetry data cache
  lastData: null,
  lastUpdateTime: null,
  relativeTimeInterval: null,

  // Alerts & UI state
  alertDismissed: false
};

// --- DOM Element References ---
const DOM = {
  // Banners & Header
  alertBanner: document.getElementById('alert-banner'),
  alertTitle: document.getElementById('alert-title'),
  alertMessage: document.getElementById('alert-message'),
  alertDismissBtn: document.getElementById('alert-dismiss-btn'),
  browserWarning: document.getElementById('browser-warning'),
  enableDemoFromWarning: document.getElementById('enable-demo-from-warning'),

  // Header status & controls
  bleStatusDot: document.getElementById('ble-status-dot'),
  bleStatusText: document.getElementById('ble-status-text'),
  lastUpdateText: document.getElementById('last-update-text'),
  bleConnectBtn: document.getElementById('ble-connect-btn'),
  bleBtnText: document.getElementById('ble-btn-text'),
  demoModeBtn: document.getElementById('demo-mode-btn'),
  demoBadge: document.getElementById('demo-badge'),
  demoControlBar: document.getElementById('demo-control-bar'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeMoonIcon: document.getElementById('theme-moon-icon'),
  themeSunIcon: document.getElementById('theme-sun-icon'),

  // Wet Bin Card
  wetStatusBadge: document.getElementById('wet-status-badge'),
  wetBadgeText: document.getElementById('wet-badge-text'),
  wetLiquidFill: document.getElementById('wet-liquid-fill'),
  wetPctVal: document.getElementById('wet-pct-val'),
  wetCmVal: document.getElementById('wet-cm-val'),
  wetCmUnit: document.getElementById('wet-cm-unit'),
  wetDistBar: document.getElementById('wet-dist-bar'),
  wetCmDesc: document.getElementById('wet-cm-desc'),
  wetThresholdPill: document.getElementById('wet-threshold-pill'),
  wetThresholdLabel: document.getElementById('wet-threshold-label'),
  wetDoorStateIndicator: document.getElementById('wet-door-state-indicator'),

  // Dry Bin Card
  dryStatusBadge: document.getElementById('dry-status-badge'),
  dryBadgeText: document.getElementById('dry-badge-text'),
  dryLiquidFill: document.getElementById('dry-liquid-fill'),
  dryPctVal: document.getElementById('dry-pct-val'),
  dryCmVal: document.getElementById('dry-cm-val'),
  dryCmUnit: document.getElementById('dry-cm-unit'),
  dryDistBar: document.getElementById('dry-dist-bar'),
  dryCmDesc: document.getElementById('dry-cm-desc'),
  dryThresholdPill: document.getElementById('dry-threshold-pill'),
  dryThresholdLabel: document.getElementById('dry-threshold-label'),
  dryDoorStateIndicator: document.getElementById('dry-door-state-indicator'),

  // Buzzer Card
  buzzerStatusBadge: document.getElementById('buzzer-status-badge'),
  buzzerBadgeText: document.getElementById('buzzer-badge-text'),
  buzzerVisualCircle: document.getElementById('buzzer-visual-circle'),
  buzzerStateHeadline: document.getElementById('buzzer-state-headline'),
  buzzerExplanation: document.getElementById('buzzer-explanation'),

  // Last Item & Moisture Card
  itemClassificationBadge: document.getElementById('item-classification-badge'),
  itemClassText: document.getElementById('item-class-text'),
  moistResultBox: document.getElementById('moist-result-box'),
  moistHeroIcon: document.getElementById('moist-hero-icon'),
  moistClassDisplay: document.getElementById('moist-class-display'),
  moistNoteDisplay: document.getElementById('moist-note-display'),
  moistRawDisplay: document.getElementById('moist-raw-display'),
  adcNeedleIndicator: document.getElementById('adc-needle-indicator'),

  // Dual Chute Doors Visual
  doorCompWet: document.getElementById('door-comp-wet'),
  doorCompDry: document.getElementById('door-comp-dry'),
  doorStateWet: document.getElementById('door-state-wet'),
  doorStateDry: document.getElementById('door-state-dry'),
  doorSummaryText: document.getElementById('door-summary-text'),

  // Manual Buttons
  btnOpenWet: document.getElementById('btn-open-wet'),
  btnOpenDry: document.getElementById('btn-open-dry'),
  commandFeedbackText: document.getElementById('command-feedback-text'),

  // History Log
  historyList: document.getElementById('history-list'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  toastContainer: document.getElementById('toast-container'),

  // Demo bar simulation triggers
  demoToggleWetFull: document.getElementById('demo-toggle-wet-full'),
  demoToggleDryFull: document.getElementById('demo-toggle-dry-full'),
  demoSimWetItem: document.getElementById('demo-sim-wet-item'),
  demoSimDryItem: document.getElementById('demo-sim-dry-item'),
  demoSimUnknownItem: document.getElementById('demo-sim-unknown-item'),
  demoSimSensorError: document.getElementById('demo-sim-sensor-error')
};

// ==============================================================================
// 1. APPLICATION INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkBluetoothSupport();
  renderHistory();
  setupEventListeners();
  registerServiceWorker();

  // Periodically refresh relative timestamp ("Just now", "5s ago")
  state.relativeTimeInterval = setInterval(updateRelativeTimeDisplay, 1000);
});

/**
 * Check if the browser supports Web Bluetooth API.
 * Chrome and Edge (Windows, Mac, Linux, Android) support it; iOS Safari does not.
 */
function checkBluetoothSupport() {
  if (!navigator.bluetooth) {
    console.warn('[Bluetooth] Web Bluetooth API is not supported in this browser.');
    DOM.browserWarning.classList.remove('hidden');
    DOM.bleConnectBtn.disabled = true;
    DOM.bleConnectBtn.title = 'Web Bluetooth not supported in this browser';
  }
}

/**
 * Register Progressive Web App Service Worker for offline capability.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered successfully, scope:', reg.scope);
        })
        .catch((err) => {
          console.log('[PWA] Service Worker registration skipped or failed:', err.message);
        });
    });
  }
}

// ==============================================================================
// 2. THEME MANAGEMENT (LIGHT / DARK)
// ==============================================================================
function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY_THEME, theme);

  if (theme === 'light') {
    DOM.themeMoonIcon.classList.add('hidden');
    DOM.themeSunIcon.classList.remove('hidden');
  } else {
    DOM.themeMoonIcon.classList.remove('hidden');
    DOM.themeSunIcon.classList.add('hidden');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ==============================================================================
// 3. WEB BLUETOOTH LOW ENERGY (BLE) IMPLEMENTATION
// ==============================================================================

/**
 * Connect to ESP32 Smart Waste Monitor device.
 * Filters for device name prefix "SmartBin" and Nordic UART Service.
 */
async function connectBluetooth() {
  if (!navigator.bluetooth) {
    showToast('Web Bluetooth is not supported in this browser. Please use Chrome or Edge.', 'error');
    return;
  }

  // If already connected, clicking the button disconnects
  if (state.isConnected) {
    disconnectBluetooth(true);
    return;
  }

  try {
    setConnectionState('connecting', 'Requesting SmartBin...');
    showToast('Searching for BLE devices starting with "SmartBin"...', 'info');

    // 1. Request BLE Device with Nordic UART Service
    state.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: BLE_DEVICE_NAME_PREFIX }],
      optionalServices: [NORDIC_UART_SERVICE_UUID]
    });

    console.log('[Bluetooth] Selected device:', state.device.name, state.device.id);

    // Listen for unexpected GATT server disconnection
    state.device.addEventListener('gattserverdisconnected', onDeviceDisconnected);

    // 2. Connect to GATT Server
    setConnectionState('connecting', `Connecting to ${state.device.name}...`);
    state.server = await state.device.gatt.connect();

    // 3. Get Nordic UART Service
    setConnectionState('connecting', 'Accessing Nordic UART Service...');
    const service = await state.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

    // 4. Get TX Characteristic (ESP32 -> App notifications)
    state.txCharacteristic = await service.getCharacteristic(NORDIC_UART_TX_CHAR_UUID);
    await state.txCharacteristic.startNotifications();
    state.txCharacteristic.addEventListener('characteristicvaluechanged', handleBleNotification);

    // 5. Get RX Characteristic (App -> ESP32 write commands)
    state.rxCharacteristic = await service.getCharacteristic(NORDIC_UART_RX_CHAR_UUID);

    // Connection complete!
    state.isConnected = true;
    state.isConnecting = false;
    state.reconnectAttempts = 0;
    setConnectionState('connected', `Connected: ${state.device.name}`);
    showToast(`Successfully connected to ${state.device.name}!`, 'success');

    // Add connection event to history
    addHistoryItem('info', 'SmartBin Connected', `Paired with ${state.device.name} over BLE`);

    // Disable Demo Mode if it was running
    if (state.isDemoMode) {
      toggleDemoMode(false);
    }
  } catch (error) {
    console.error('[Bluetooth] Connection error:', error);
    setConnectionState('disconnected', 'Disconnected');

    // Friendly error messaging
    if (error.name === 'NotFoundError') {
      showToast('Bluetooth pairing cancelled or no device selected.', 'info');
    } else if (error.name === 'SecurityError') {
      showToast('Bluetooth permission blocked by security policy.', 'error');
    } else {
      showToast(`Connection failed: ${error.message}`, 'error');
    }
  }
}

/**
 * Handle incoming chunks from the ESP32.
 * BLE notifications split large packets into 20-byte MTU segments.
 * We accumulate incoming bytes in `state.bleBuffer` and parse each complete
 * newline-terminated line ("\n").
 */
function handleBleNotification(event) {
  const value = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const chunk = decoder.decode(value);

  // Append chunk to buffer
  state.bleBuffer += chunk;

  // Process all complete lines delimited by '\n'
  let newlineIndex;
  while ((newlineIndex = state.bleBuffer.indexOf('\n')) !== -1) {
    const rawLine = state.bleBuffer.slice(0, newlineIndex).trim();
    // Advance buffer past the newline
    state.bleBuffer = state.bleBuffer.slice(newlineIndex + 1);

    if (rawLine.length > 0) {
      parseAndProcessJsonLine(rawLine);
    }
  }

  // Safeguard: Prevent memory bloat if corrupted stream sends no newlines
  if (state.bleBuffer.length > 4096) {
    console.warn('[Bluetooth] Buffer overflow detected without newline, trimming.');
    state.bleBuffer = '';
  }
}

/**
 * Parse an incoming JSON line and update the dashboard.
 * Ignores invalid JSON lines gracefully without crashing.
 */
function parseAndProcessJsonLine(line) {
  try {
    const payload = JSON.parse(line);
    updateDashboard(payload);
  } catch (err) {
    console.warn('[Bluetooth] Invalid JSON line received, ignoring:', line, err);
  }
}

/**
 * Send a plain-text command over the RX characteristic to the ESP32.
 * Commands: "W" = Open Wet Door, "D" = Open Dry Door
 */
async function sendBleCommand(command) {
  // If in Demo Mode, simulate the hardware command
  if (state.isDemoMode) {
    simulateDemoCommand(command);
    return;
  }

  if (!state.isConnected || !state.rxCharacteristic) {
    showToast('SmartBin is not connected. Connect via BLE or use Demo Mode.', 'warning');
    updateCommandFeedback(`Command '${command}' not sent: SmartBin is disconnected.`);
    return;
  }

  try {
    updateCommandFeedback(`Transmitting command '${command}' to ESP32...`);
    const encoder = new TextEncoder();
    const data = encoder.encode(command);

    // Some BLE stacks prefer writeValueWithoutResponse if supported
    if (state.rxCharacteristic.writeValueWithoutResponse) {
      await state.rxCharacteristic.writeValueWithoutResponse(data);
    } else {
      await state.rxCharacteristic.writeValue(data);
    }

    const doorLabel = command === 'W' ? 'Wet Compartment' : 'Dry Compartment';
    updateCommandFeedback(`Sent command '${command}' successfully: Opening ${doorLabel}.`);
    showToast(`Command "${command}" delivered to ESP32 (${doorLabel})`, 'info');
    addHistoryItem('door', `Manual Command Sent: ${command}`, `Dispatched ${doorLabel} open signal`);
  } catch (err) {
    console.error('[Bluetooth] Failed to send command:', err);
    updateCommandFeedback(`Failed to transmit command: ${err.message}`);
    showToast(`Failed to send command: ${err.message}`, 'error');
  }
}

/**
 * Called when the GATT server disconnects.
 * Attempts auto-reconnect up to maxReconnectAttempts.
 */
function onDeviceDisconnected(event) {
  console.warn('[Bluetooth] Device disconnected:', event);
  state.isConnected = false;
  state.txCharacteristic = null;
  state.rxCharacteristic = null;

  addHistoryItem('info', 'SmartBin Disconnected', 'BLE connection lost');

  // Attempt auto-reconnection if not manually disconnected
  if (state.device && state.reconnectAttempts < state.maxReconnectAttempts) {
    state.reconnectAttempts++;
    const delaySec = state.reconnectAttempts * 2;
    setConnectionState('connecting', `Lost connection. Reconnecting in ${delaySec}s (${state.reconnectAttempts}/${state.maxReconnectAttempts})...`);
    showToast(`Connection lost. Reconnect attempt ${state.reconnectAttempts} of ${state.maxReconnectAttempts}...`, 'warning');

    state.reconnectTimeoutId = setTimeout(() => {
      attemptReconnect();
    }, delaySec * 1000);
  } else {
    setConnectionState('disconnected', 'Disconnected');
    showToast('SmartBin disconnected. Click "Connect Bin" to reconnect.', 'error');
  }
}

/**
 * Re-establish connection with the previously paired device.
 */
async function attemptReconnect() {
  if (!state.device || !state.device.gatt) {
    setConnectionState('disconnected', 'Disconnected');
    return;
  }

  try {
    setConnectionState('connecting', `Reconnecting to ${state.device.name}...`);
    state.server = await state.device.gatt.connect();
    const service = await state.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
    state.txCharacteristic = await service.getCharacteristic(NORDIC_UART_TX_CHAR_UUID);
    await state.txCharacteristic.startNotifications();
    state.txCharacteristic.addEventListener('characteristicvaluechanged', handleBleNotification);
    state.rxCharacteristic = await service.getCharacteristic(NORDIC_UART_RX_CHAR_UUID);

    state.isConnected = true;
    state.reconnectAttempts = 0;
    setConnectionState('connected', `Connected: ${state.device.name}`);
    showToast(`Reconnected to ${state.device.name}!`, 'success');
    addHistoryItem('info', 'SmartBin Reconnected', 'BLE link restored automatically');
  } catch (err) {
    console.warn('[Bluetooth] Reconnect attempt failed:', err);
    onDeviceDisconnected({ target: state.device });
  }
}

/**
 * Manually disconnect from BLE device.
 */
function disconnectBluetooth(userInitiated = true) {
  if (state.reconnectTimeoutId) {
    clearTimeout(state.reconnectTimeoutId);
    state.reconnectTimeoutId = null;
  }

  if (userInitiated) {
    state.reconnectAttempts = state.maxReconnectAttempts; // Prevent auto-reconnect
  }

  if (state.device && state.device.gatt && state.device.gatt.connected) {
    state.device.gatt.disconnect();
  }

  state.isConnected = false;
  state.device = null;
  state.server = null;
  state.txCharacteristic = null;
  state.rxCharacteristic = null;
  state.bleBuffer = '';

  setConnectionState('disconnected', 'Disconnected');
  showToast('Disconnected from SmartBin', 'info');
}

/**
 * Update UI connection indicators (dot, button label, status text).
 */
function setConnectionState(status, text) {
  DOM.bleStatusText.textContent = text;
  DOM.bleStatusDot.className = 'status-dot';

  if (status === 'connected') {
    DOM.bleStatusDot.classList.add('dot-connected');
    DOM.bleConnectBtn.classList.add('connected-state');
    DOM.bleBtnText.textContent = 'Disconnect';
    DOM.btnOpenWet.disabled = false;
    DOM.btnOpenDry.disabled = false;
  } else if (status === 'connecting') {
    DOM.bleStatusDot.classList.add('dot-connecting');
    DOM.bleConnectBtn.classList.remove('connected-state');
    DOM.bleBtnText.textContent = 'Connecting...';
  } else {
    DOM.bleStatusDot.classList.add('dot-disconnected');
    DOM.bleConnectBtn.classList.remove('connected-state');
    DOM.bleBtnText.textContent = 'Connect Bin';
    if (!state.isDemoMode) {
      DOM.btnOpenWet.disabled = true;
      DOM.btnOpenDry.disabled = true;
    }
  }
}

// ==============================================================================
// 4. DASHBOARD TELEMETRY UPDATES & RENDERING
// ==============================================================================

/**
 * Primary UI update function: consumes the validated JSON payload from ESP32:
 * {
 *   "wet": { "cm": 7.2, "pct": 60, "full": false },
 *   "dry": { "cm": 4.5, "pct": 75, "full": true },
 *   "buzzer": true,
 *   "moist": { "raw": 2100, "cls": "WET" },
 *   "door": "WET"
 * }
 */
function updateDashboard(data) {
  if (!data) return;

  const prevData = state.lastData;
  state.lastData = data;
  state.lastUpdateTime = new Date();
  updateRelativeTimeDisplay();

  // 1. Update WET Compartment Card
  updateWetCard(data.wet);

  // 2. Update DRY Compartment Card
  updateDryCard(data.dry);

  // 3. Update Audio Alert Buzzer Card
  updateBuzzerCard(data.buzzer);

  // 4. Update Last Item Moisture Classification & Door Status
  updateItemAndDoorCard(data.moist, data.door);

  // 5. Update Full Alert Banner
  updateAlertBanner(data.wet, data.dry);

  // 6. Detect and record state change transitions into Event History
  detectAndLogTransitions(prevData, data);
}

/**
 * Update the Wet compartment metrics, gauge, and status badge.
 */
function updateWetCard(wet) {
  if (!wet) return;

  // Clamp pct to 0-100 range
  const pct = Math.min(100, Math.max(0, Math.round(wet.pct || 0)));
  DOM.wetPctVal.textContent = pct;
  DOM.wetLiquidFill.style.height = `${pct}%`;

  // Ultrasonic distance handling (-1 indicates sensor error)
  if (wet.cm === -1 || wet.cm === undefined || wet.cm === null) {
    DOM.wetCmVal.textContent = 'ERR';
    DOM.wetCmUnit.textContent = '';
    DOM.wetCmDesc.textContent = 'Ultrasonic sensor unreadable';
    DOM.wetDistBar.style.width = '0%';

    // Status Badge: Sensor Error
    DOM.wetStatusBadge.className = 'status-badge badge-sensor-error';
    DOM.wetBadgeText.textContent = 'SENSOR ERROR';
    DOM.wetThresholdLabel.textContent = 'Sensor Fault (-1)';
    DOM.wetThresholdPill.classList.remove('warning-active');
  } else {
    const cmValue = Number(wet.cm).toFixed(1);
    DOM.wetCmVal.textContent = cmValue;
    DOM.wetCmUnit.textContent = 'cm';
    DOM.wetCmDesc.textContent = 'Clearance to sensor lid';

    // Distance bar (assuming 30cm full empty depth)
    const distBarPct = Math.min(100, Math.max(0, (30 - wet.cm) / 30 * 100));
    DOM.wetDistBar.style.width = `${distBarPct}%`;

    // Status Badge: FULL vs NOT FULL
    if (wet.full) {
      DOM.wetStatusBadge.className = 'status-badge badge-full';
      DOM.wetBadgeText.textContent = 'FULL';
      DOM.wetThresholdLabel.textContent = 'CAPACITY REACHED (≥ 90%)';
      DOM.wetThresholdPill.classList.add('warning-active');
    } else {
      DOM.wetStatusBadge.className = 'status-badge badge-not-full';
      DOM.wetBadgeText.textContent = 'NOT FULL';
      DOM.wetThresholdLabel.textContent = `Normal Level (${pct}%)`;
      DOM.wetThresholdPill.classList.remove('warning-active');
    }
  }
}

/**
 * Update the Dry compartment metrics, gauge, and status badge.
 */
function updateDryCard(dry) {
  if (!dry) return;

  const pct = Math.min(100, Math.max(0, Math.round(dry.pct || 0)));
  DOM.dryPctVal.textContent = pct;
  DOM.dryLiquidFill.style.height = `${pct}%`;

  if (dry.cm === -1 || dry.cm === undefined || dry.cm === null) {
    DOM.dryCmVal.textContent = 'ERR';
    DOM.dryCmUnit.textContent = '';
    DOM.dryCmDesc.textContent = 'Ultrasonic sensor unreadable';
    DOM.dryDistBar.style.width = '0%';

    DOM.dryStatusBadge.className = 'status-badge badge-sensor-error';
    DOM.dryBadgeText.textContent = 'SENSOR ERROR';
    DOM.dryThresholdLabel.textContent = 'Sensor Fault (-1)';
    DOM.dryThresholdPill.classList.remove('warning-active');
  } else {
    const cmValue = Number(dry.cm).toFixed(1);
    DOM.dryCmVal.textContent = cmValue;
    DOM.dryCmUnit.textContent = 'cm';
    DOM.dryCmDesc.textContent = 'Clearance to sensor lid';

    const distBarPct = Math.min(100, Math.max(0, (30 - dry.cm) / 30 * 100));
    DOM.dryDistBar.style.width = `${distBarPct}%`;

    if (dry.full) {
      DOM.dryStatusBadge.className = 'status-badge badge-full';
      DOM.dryBadgeText.textContent = 'FULL';
      DOM.dryThresholdLabel.textContent = 'CAPACITY REACHED (≥ 90%)';
      DOM.dryThresholdPill.classList.add('warning-active');
    } else {
      DOM.dryStatusBadge.className = 'status-badge badge-not-full';
      DOM.dryBadgeText.textContent = 'NOT FULL';
      DOM.dryThresholdLabel.textContent = `Normal Level (${pct}%)`;
      DOM.dryThresholdPill.classList.remove('warning-active');
    }
  }
}

/**
 * Update the Audio Alert Buzzer card.
 */
function updateBuzzerCard(buzzerOn) {
  const isBuzzerActive = Boolean(buzzerOn);

  if (isBuzzerActive) {
    DOM.buzzerStatusBadge.className = 'status-badge badge-buzzer-on';
    DOM.buzzerBadgeText.textContent = 'ACTIVE';
    DOM.buzzerVisualCircle.classList.add('buzzer-on');
    DOM.buzzerStateHeadline.textContent = 'Alarm Buzzer Sounding!';
    DOM.buzzerExplanation.textContent = 'Hardware beeper on the ESP32 is actively sounding. Overflow warning or obstacle detected.';
  } else {
    DOM.buzzerStatusBadge.className = 'status-badge badge-buzzer-off';
    DOM.buzzerBadgeText.textContent = 'OFF';
    DOM.buzzerVisualCircle.classList.remove('buzzer-on');
    DOM.buzzerStateHeadline.textContent = 'Buzzer Standby';
    DOM.buzzerExplanation.textContent = 'Alarm is silent. Buzzer activates automatically if any compartment overflows or an obstruction occurs.';
  }
}

/**
 * Update the Last Item Moisture classification & physical door chutes.
 * - moist.cls: "WET", "DRY", or "UNKNOWN" (ambiguous)
 * - moist.raw: integer ADC reading (0 - 4095)
 * - door: "WET", "DRY", or "CLOSED"
 */
function updateItemAndDoorCard(moist, doorState) {
  // --- Moisture Classification ---
  if (moist) {
    const cls = String(moist.cls || 'UNKNOWN').toUpperCase();
    const rawVal = Number.isFinite(moist.raw) ? Math.round(moist.raw) : 0;

    DOM.moistRawDisplay.textContent = `ADC: ${rawVal}`;

    // Position the ADC needle (0 to 4095 range)
    const needlePct = Math.min(100, Math.max(0, (rawVal / 4095) * 100));
    DOM.adcNeedleIndicator.style.left = `${needlePct}%`;

    DOM.moistResultBox.className = 'moist-result-hero';

    if (cls === 'WET') {
      DOM.itemClassificationBadge.className = 'status-badge badge-moist-wet';
      DOM.itemClassText.textContent = 'WET WASTE DETECTED';
      DOM.moistResultBox.classList.add('hero-wet');
      DOM.moistClassDisplay.textContent = 'WET WASTE';
      DOM.moistNoteDisplay.textContent = 'Organic / High Moisture Content';
      setMoistHeroIcon('wet');
    } else if (cls === 'DRY') {
      DOM.itemClassificationBadge.className = 'status-badge badge-moist-dry';
      DOM.itemClassText.textContent = 'DRY WASTE DETECTED';
      DOM.moistResultBox.classList.add('hero-dry');
      DOM.moistClassDisplay.textContent = 'DRY WASTE';
      DOM.moistNoteDisplay.textContent = 'Inorganic / Low Moisture Content';
      setMoistHeroIcon('dry');
    } else {
      // UNKNOWN / Ambiguous
      DOM.itemClassificationBadge.className = 'status-badge badge-moist-unknown';
      DOM.itemClassText.textContent = 'AMBIGUOUS ITEM';
      DOM.moistResultBox.classList.add('hero-unknown');
      DOM.moistClassDisplay.textContent = 'UNKNOWN';
      DOM.moistNoteDisplay.textContent = 'Ambiguous - handled safely';
      setMoistHeroIcon('unknown');
    }
  }

  // --- Door Chute Graphic & Labels ---
  const door = String(doorState || 'CLOSED').toUpperCase();

  // Reset doors
  DOM.doorCompWet.classList.remove('door-open');
  DOM.doorCompDry.classList.remove('door-open');
  DOM.doorStateWet.textContent = 'CLOSED';
  DOM.doorStateDry.textContent = 'CLOSED';
  DOM.wetDoorStateIndicator.className = 'door-status-pill door-pill-closed';
  DOM.wetDoorStateIndicator.textContent = 'CLOSED';
  DOM.dryDoorStateIndicator.className = 'door-status-pill door-pill-closed';
  DOM.dryDoorStateIndicator.textContent = 'CLOSED';

  if (door === 'WET') {
    DOM.doorCompWet.classList.add('door-open');
    DOM.doorStateWet.textContent = 'OPEN';
    DOM.wetDoorStateIndicator.className = 'door-status-pill door-pill-open';
    DOM.wetDoorStateIndicator.textContent = 'OPEN';
    DOM.doorSummaryText.textContent = 'Wet Chute Door is currently OPEN for waste deposition';
  } else if (door === 'DRY') {
    DOM.doorCompDry.classList.add('door-open');
    DOM.doorStateDry.textContent = 'OPEN';
    DOM.dryDoorStateIndicator.className = 'door-status-pill door-pill-open';
    DOM.dryDoorStateIndicator.textContent = 'OPEN';
    DOM.doorSummaryText.textContent = 'Dry Chute Door is currently OPEN for waste deposition';
  } else {
    DOM.doorSummaryText.textContent = 'Both intake doors are securely closed';
  }
}

/**
 * Set SVG icon for the moisture classification hero box.
 */
function setMoistHeroIcon(type) {
  if (type === 'wet') {
    DOM.moistHeroIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
      </svg>`;
  } else if (type === 'dry') {
    DOM.moistHeroIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>`;
  } else {
    DOM.moistHeroIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>`;
  }
}

/**
 * Top Alert Banner management: shows whenever any bin is confirmed FULL.
 */
function updateAlertBanner(wet, dry) {
  const wetFull = Boolean(wet && wet.full);
  const dryFull = Boolean(dry && dry.full);

  if (wetFull || dryFull) {
    // If a new full condition arises, un-dismiss the banner
    if (wetFull && (!state.lastData || !state.lastData.wet || !state.lastData.wet.full)) {
      state.alertDismissed = false;
    }
    if (dryFull && (!state.lastData || !state.lastData.dry || !state.lastData.dry.full)) {
      state.alertDismissed = false;
    }

    if (!state.alertDismissed) {
      DOM.alertBanner.classList.remove('hidden');

      if (wetFull && dryFull) {
        DOM.alertTitle.textContent = 'CRITICAL ALERT: BOTH BINS ARE FULL!';
        DOM.alertMessage.textContent = 'Both Wet and Dry compartments have reached 100% capacity. Please empty immediately.';
      } else if (wetFull) {
        DOM.alertTitle.textContent = 'WARNING: Wet Waste Compartment is FULL!';
        DOM.alertMessage.textContent = 'Wet bin capacity reached. Please empty the organic waste compartment.';
      } else {
        DOM.alertTitle.textContent = 'WARNING: Dry Waste Compartment is FULL!';
        DOM.alertMessage.textContent = 'Dry bin capacity reached. Please empty recyclables and dry waste.';
      }
    }
  } else {
    DOM.alertBanner.classList.add('hidden');
    state.alertDismissed = false;
  }
}

/**
 * Update the "Last update: X" timestamp readout in the header.
 */
function updateRelativeTimeDisplay() {
  if (!state.lastUpdateTime) {
    DOM.lastUpdateText.textContent = 'Last update: --';
    return;
  }

  const secondsAgo = Math.floor((new Date() - state.lastUpdateTime) / 1000);
  if (secondsAgo < 2) {
    DOM.lastUpdateText.textContent = 'Last update: Just now';
  } else if (secondsAgo < 60) {
    DOM.lastUpdateText.textContent = `Last update: ${secondsAgo}s ago`;
  } else {
    DOM.lastUpdateText.textContent = `Last update: ${state.lastUpdateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

/**
 * Updates the manual command bar message text.
 */
function updateCommandFeedback(text) {
  DOM.commandFeedbackText.textContent = text;
}

// ==============================================================================
// 5. EVENT LOGGING & LOCALSTORAGE HISTORY
// ==============================================================================

/**
 * Detect significant state transitions (bin full, doors opening, classifications)
 * and append them to the 10-item history log.
 */
function detectAndLogTransitions(prev, curr) {
  if (!curr) return;

  // Wet full transition
  if (curr.wet && curr.wet.full && (!prev || !prev.wet || !prev.wet.full)) {
    addHistoryItem('full', 'Wet Compartment Full', `Capacity reached (${curr.wet.pct}% fill, ${curr.wet.cm}cm)`);
  }
  // Dry full transition
  if (curr.dry && curr.dry.full && (!prev || !prev.dry || !prev.dry.full)) {
    addHistoryItem('full', 'Dry Compartment Full', `Capacity reached (${curr.dry.pct}% fill, ${curr.dry.cm}cm)`);
  }

  // Door opened transition
  if (curr.door && curr.door !== 'CLOSED' && (!prev || prev.door === 'CLOSED')) {
    addHistoryItem('door', `${curr.door} Door Opened`, `Chute unlocked for waste intake`);
  }

  // New item classification transition
  if (curr.moist && (!prev || !prev.moist || prev.moist.cls !== curr.moist.cls || Math.abs(prev.moist.raw - curr.moist.raw) > 200)) {
    const iconType = curr.moist.cls === 'WET' ? 'wet' : curr.moist.cls === 'DRY' ? 'dry' : 'info';
    const desc = curr.moist.cls === 'UNKNOWN' ? 'Ambiguous - handled safely' : `${curr.moist.cls} detected (ADC: ${curr.moist.raw})`;
    addHistoryItem(iconType, `Item Classified: ${curr.moist.cls}`, desc);
  }

  // Buzzer turned ON transition
  if (curr.buzzer && (!prev || !prev.buzzer)) {
    addHistoryItem('buzzer', 'Alert Buzzer Triggered', 'Audio alarm activated on bin');
  }
}

/**
 * Add a new event entry to localStorage history (max 10 items).
 */
function addHistoryItem(type, title, meta) {
  const history = getHistoryFromStorage();
  const now = new Date();

  const newItem = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    type,
    title,
    meta,
    timestamp: now.toISOString(),
    timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  // Prepend new item and keep only last 10
  history.unshift(newItem);
  if (history.length > MAX_HISTORY_ITEMS) {
    history.length = MAX_HISTORY_ITEMS;
  }

  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
  } catch (e) {
    console.warn('[History] LocalStorage write failed:', e);
  }

  renderHistory();
}

/**
 * Read history array from localStorage.
 */
function getHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Render history items in the UI list.
 */
function renderHistory() {
  const history = getHistoryFromStorage();

  if (history.length === 0) {
    DOM.historyList.innerHTML = `
      <li class="history-empty">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>No recorded events yet. Connect your SmartBin or toggle Demo Mode!</span>
      </li>`;
    return;
  }

  DOM.historyList.innerHTML = history.map((item) => {
    let iconClass = 'hist-icon-info';
    let iconSvg = '';

    if (item.type === 'full') {
      iconClass = 'hist-icon-full';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
    } else if (item.type === 'wet') {
      iconClass = 'hist-icon-wet';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M10 2a1 1 0 01.832.445l4.5 6.75A5.5 5.5 0 115 13.5a5.5 5.5 0 015-11.5z" clip-rule="evenodd" /></svg>`;
    } else if (item.type === 'dry') {
      iconClass = 'hist-icon-dry';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.732V5a2 2 0 012-2h4a2 2 0 012 2v6.268A2 2 0 0118 13v3a2 2 0 01-2 2h-4a2 2 0 01-2-2v-3a2 2 0 011-1.732z" clip-rule="evenodd" /></svg>`;
    } else if (item.type === 'door') {
      iconClass = 'hist-icon-door';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" /></svg>`;
    } else if (item.type === 'buzzer') {
      iconClass = 'hist-icon-buzzer';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
    } else {
      iconClass = 'hist-icon-info';
      iconSvg = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>`;
    }

    return `
      <li class="history-item">
        <div class="history-icon-box ${iconClass}" aria-hidden="true">
          ${iconSvg}
        </div>
        <div class="history-content">
          <span class="history-title">${escapeHtml(item.title)}</span>
          <span class="history-meta">${escapeHtml(item.meta || '')}</span>
        </div>
        <span class="history-time" title="${item.timestamp}">${item.timeStr}</span>
      </li>`;
  }).join('');
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEY_HISTORY);
  renderHistory();
  showToast('Event history cleared', 'info');
}

// ==============================================================================
// 6. DEMO SIMULATION MODE (TEST WITHOUT HARDWARE)
// ==============================================================================

/**
 * Toggle simulation mode on/off.
 * Generates realistic fake data matching the exact JSON format every 600ms.
 */
function toggleDemoMode(forceState) {
  state.isDemoMode = typeof forceState === 'boolean' ? forceState : !state.isDemoMode;

  if (state.isDemoMode) {
    // If connected to real BLE, disconnect first to avoid collisions
    if (state.isConnected) {
      disconnectBluetooth(true);
    }

    DOM.demoModeBtn.classList.add('active');
    DOM.demoModeBtn.setAttribute('aria-pressed', 'true');
    DOM.demoBadge.textContent = 'ON';
    DOM.demoControlBar.classList.remove('hidden');

    DOM.btnOpenWet.disabled = false;
    DOM.btnOpenDry.disabled = false;

    setConnectionState('connected', 'Demo Mode (Simulated)');
    showToast('Demo Mode activated! Simulating real-time ESP32 data.', 'info');
    addHistoryItem('info', 'Demo Mode Activated', 'Started simulated telemetry stream');

    // Start simulation loop (runs every 600 ms)
    startDemoSimulationLoop();
  } else {
    DOM.demoModeBtn.classList.remove('active');
    DOM.demoModeBtn.setAttribute('aria-pressed', 'false');
    DOM.demoBadge.textContent = 'OFF';
    DOM.demoControlBar.classList.add('hidden');

    if (state.demoIntervalId) {
      clearInterval(state.demoIntervalId);
      state.demoIntervalId = null;
    }

    setConnectionState('disconnected', 'Disconnected');
    showToast('Demo Mode deactivated.', 'info');
    addHistoryItem('info', 'Demo Mode Stopped', 'Simulation stopped');
  }
}

/**
 * Main simulation ticker: generates realistic gradual fill changes and events.
 */
function startDemoSimulationLoop() {
  if (state.demoIntervalId) clearInterval(state.demoIntervalId);

  // Send an immediate frame
  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));

  let cycleCounter = 0;

  state.demoIntervalId = setInterval(() => {
    cycleCounter++;

    // Slowly increase fill percentage with slight fluctuations
    if (cycleCounter % 3 === 0) {
      state.demoData.wet.pct = Math.min(100, state.demoData.wet.pct + (Math.random() > 0.3 ? 1 : -1));
      state.demoData.dry.pct = Math.min(100, state.demoData.dry.pct + (Math.random() > 0.4 ? 1 : 0));

      // Calculate inverse distance in cm: higher pct = smaller distance
      if (state.demoData.wet.cm !== -1) {
        state.demoData.wet.cm = Number(Math.max(2.0, (100 - state.demoData.wet.pct) * 0.28).toFixed(1));
      }
      if (state.demoData.dry.cm !== -1) {
        state.demoData.dry.cm = Number(Math.max(2.0, (100 - state.demoData.dry.pct) * 0.32).toFixed(1));
      }

      state.demoData.wet.full = state.demoData.wet.pct >= 90;
      state.demoData.dry.full = state.demoData.dry.pct >= 90;
      state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;
    }

    // Occasional simulated waste drop every 12-16 cycles
    if (cycleCounter % 16 === 0 && state.demoData.door === 'CLOSED') {
      const rand = Math.random();
      if (rand < 0.45) {
        simulateDropItem('WET');
      } else if (rand < 0.85) {
        simulateDropItem('DRY');
      } else {
        simulateDropItem('UNKNOWN');
      }
    }

    // Broadcast copy of simulated data
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 600);
}

/**
 * Simulate dropping an item of specified moisture class in Demo Mode.
 */
function simulateDropItem(cls) {
  let rawAdc = 2100;
  if (cls === 'WET') {
    rawAdc = Math.floor(2700 + Math.random() * 1200); // 2700 - 3900
  } else if (cls === 'DRY') {
    rawAdc = Math.floor(500 + Math.random() * 900); // 500 - 1400
  } else {
    // UNKNOWN / Ambiguous zone
    rawAdc = Math.floor(1800 + Math.random() * 500); // 1800 - 2300
  }

  state.demoData.moist = { raw: rawAdc, cls };

  // Door opens corresponding to moisture class
  const targetDoor = cls === 'WET' ? 'WET' : cls === 'DRY' ? 'DRY' : 'WET';
  state.demoData.door = targetDoor;

  // Auto-close door after 2.5 seconds
  if (state.demoDoorTimerId) clearTimeout(state.demoDoorTimerId);
  state.demoDoorTimerId = setTimeout(() => {
    state.demoData.door = 'CLOSED';
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 2500);

  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
}

/**
 * Simulate manual 'W' or 'D' button commands in Demo Mode.
 */
function simulateDemoCommand(cmd) {
  const isWet = cmd === 'W';
  const doorName = isWet ? 'WET' : 'DRY';

  state.demoData.door = doorName;
  updateCommandFeedback(`Demo: Servo triggered -> Opened ${doorName} compartment door.`);
  showToast(`Demo: Executed command "${cmd}" -> Opened ${doorName} Door`, 'info');
  addHistoryItem('door', `Manual Command: ${cmd} (Demo)`, `Opened ${doorName} door chute`);

  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));

  if (state.demoDoorTimerId) clearTimeout(state.demoDoorTimerId);
  state.demoDoorTimerId = setTimeout(() => {
    state.demoData.door = 'CLOSED';
    updateCommandFeedback('Demo: Chute door closed automatically.');
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 2500);
}

// ==============================================================================
// 7. EVENT LISTENERS & SHORTCUTS
// ==============================================================================
function setupEventListeners() {
  // BLE Connect / Disconnect button
  DOM.bleConnectBtn.addEventListener('click', connectBluetooth);

  // Demo Mode toggle button
  DOM.demoModeBtn.addEventListener('click', () => toggleDemoMode());

  // Warning banner Demo button
  DOM.enableDemoFromWarning.addEventListener('click', () => {
    DOM.browserWarning.classList.add('hidden');
    toggleDemoMode(true);
  });

  // Light / Dark Theme toggle
  DOM.themeToggleBtn.addEventListener('click', toggleTheme);

  // Alert Banner dismiss
  DOM.alertDismissBtn.addEventListener('click', () => {
    DOM.alertBanner.classList.add('hidden');
    state.alertDismissed = true;
  });

  // Manual Door Controls
  DOM.btnOpenWet.addEventListener('click', () => sendBleCommand('W'));
  DOM.btnOpenDry.addEventListener('click', () => sendBleCommand('D'));

  // Keyboard Shortcuts: 'W' / 'w' and 'D' / 'd'
  window.addEventListener('keydown', (e) => {
    // Ignore hotkeys when typing in any input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      animateButtonPress(DOM.btnOpenWet);
      sendBleCommand('W');
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      animateButtonPress(DOM.btnOpenDry);
      sendBleCommand('D');
    }
  });

  // Clear Event History
  DOM.clearHistoryBtn.addEventListener('click', clearHistory);

  // Demo Quick Bar Buttons
  DOM.demoToggleWetFull.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    state.demoData.wet.full = !state.demoData.wet.full;
    state.demoData.wet.pct = state.demoData.wet.full ? 98 : 45;
    state.demoData.wet.cm = state.demoData.wet.full ? 2.5 : 9.5;
    state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  });

  DOM.demoToggleDryFull.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    state.demoData.dry.full = !state.demoData.dry.full;
    state.demoData.dry.pct = state.demoData.dry.full ? 95 : 30;
    state.demoData.dry.cm = state.demoData.dry.full ? 3.0 : 12.0;
    state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  });

  DOM.demoSimWetItem.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('WET');
  });

  DOM.demoSimDryItem.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('DRY');
  });

  DOM.demoSimUnknownItem.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('UNKNOWN');
  });

  DOM.demoSimSensorError.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    state.demoData.wet.cm = -1;
    state.demoData.dry.cm = -1;
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
    showToast('Simulated Ultrasonic Sensor Error (cm = -1)', 'warning');
  });
}

function animateButtonPress(btn) {
  if (!btn) return;
  btn.style.transform = 'scale(0.96)';
  setTimeout(() => {
    btn.style.transform = '';
  }, 120);
}

// ==============================================================================
// 8. UTILITY FUNCTIONS (TOAST NOTIFICATIONS, ESCAPING)
// ==============================================================================

/**
 * Display a non-blocking toast alert in the bottom corner.
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg viewBox="0 0 20 20" width="18" height="18" fill="#10b981"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg viewBox="0 0 20 20" width="18" height="18" fill="#ef4444"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg viewBox="0 0 20 20" width="18" height="18" fill="#f59e0b"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`;
  } else {
    iconSvg = `<svg viewBox="0 0 20 20" width="18" height="18" fill="#0ea5e9"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`;
  }

  toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  DOM.toastContainer.appendChild(toast);

  // Fade out and remove after 3.8s
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
