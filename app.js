/**
 * Smart Waste Monitor - Main Application Logic
 * ESP32 BLE + Dual Bin Dashboard + Demo Mode + Event History
 */

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_DEVICE_NAME_PREFIX = 'SmartBin';

const MAX_HISTORY_ITEMS = 10;
const STORAGE_KEY_HISTORY = 'smartbin_history';
const STORAGE_KEY_THEME = 'smartbin_theme';

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================

const state = {
  device: null,
  server: null,
  txCharacteristic: null,
  rxCharacteristic: null,

  isConnected: false,
  isConnecting: false,
  manualDisconnect: false,

  reconnectAttempts: 0,
  maxReconnectAttempts: 3,
  reconnectTimeoutId: null,

  bleBuffer: '',

  isDemoMode: false,
  demoIntervalId: null,
  demoDoorTimerId: null,

  demoData: {
    wet: { cm: 8.5, pct: 45, full: false },
    dry: { cm: 12.0, pct: 30, full: false },
    buzzer: false,
    moist: { raw: 850, cls: 'DRY' },
    door: 'CLOSED'
  },

  lastData: null,
  lastUpdateTime: null,
  relativeTimeInterval: null,

  alertDismissed: false
};

// ============================================================================
// 3. DOM ELEMENT REFERENCES
// ============================================================================

const DOM = {
  alertBanner: document.getElementById('alert-banner'),
  alertTitle: document.getElementById('alert-title'),
  alertMessage: document.getElementById('alert-message'),
  alertDismissBtn: document.getElementById('alert-dismiss-btn'),
  browserWarning: document.getElementById('browser-warning'),
  enableDemoFromWarning: document.getElementById('enable-demo-from-warning'),

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

  buzzerStatusBadge: document.getElementById('buzzer-status-badge'),
  buzzerBadgeText: document.getElementById('buzzer-badge-text'),
  buzzerVisualCircle: document.getElementById('buzzer-visual-circle'),
  buzzerStateHeadline: document.getElementById('buzzer-state-headline'),
  buzzerExplanation: document.getElementById('buzzer-explanation'),

  itemClassificationBadge: document.getElementById('item-classification-badge'),
  itemClassText: document.getElementById('item-class-text'),
  moistResultBox: document.getElementById('moist-result-box'),
  moistHeroIcon: document.getElementById('moist-hero-icon'),
  moistClassDisplay: document.getElementById('moist-class-display'),
  moistNoteDisplay: document.getElementById('moist-note-display'),
  moistRawDisplay: document.getElementById('moist-raw-display'),
  adcNeedleIndicator: document.getElementById('adc-needle-indicator'),

  doorCompWet: document.getElementById('door-comp-wet'),
  doorCompDry: document.getElementById('door-comp-dry'),
  doorStateWet: document.getElementById('door-state-wet'),
  doorStateDry: document.getElementById('door-state-dry'),
  doorSummaryText: document.getElementById('door-summary-text'),

  btnOpenWet: document.getElementById('btn-open-wet'),
  btnOpenDry: document.getElementById('btn-open-dry'),
  commandFeedbackText: document.getElementById('command-feedback-text'),

  historyList: document.getElementById('history-list'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  toastContainer: document.getElementById('toast-container'),

  demoToggleWetFull: document.getElementById('demo-toggle-wet-full'),
  demoToggleDryFull: document.getElementById('demo-toggle-dry-full'),
  demoSimWetItem: document.getElementById('demo-sim-wet-item'),
  demoSimDryItem: document.getElementById('demo-sim-dry-item'),
  demoSimUnknownItem: document.getElementById('demo-sim-unknown-item'),
  demoSimSensorError: document.getElementById('demo-sim-sensor-error')
};

// ============================================================================
// 4. SAFE INITIALIZATION
// ============================================================================

function initializeApp() {
  initTheme();
  checkBluetoothSupport();
  renderHistory();
  setupEventListeners();
  registerServiceWorker();

  if (state.relativeTimeInterval) {
    clearInterval(state.relativeTimeInterval);
  }

  state.relativeTimeInterval = setInterval(updateRelativeTimeDisplay, 1000);

  // Start buttons disabled until a connection or demo mode is active.
  setConnectionState('disconnected', 'Disconnected');

  console.log('[SmartBin] Application initialized.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}

function checkBluetoothSupport() {
  if (!navigator.bluetooth) {
    console.warn('[Bluetooth] Web Bluetooth is unavailable.');

    DOM.browserWarning?.classList.remove('hidden');

    if (DOM.bleConnectBtn) {
      DOM.bleConnectBtn.disabled = true;
      DOM.bleConnectBtn.title = 'Web Bluetooth is not supported in this browser.';
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service worker registered:', reg.scope))
      .catch(err => console.warn('[PWA] Service worker registration failed:', err));
  }, { once: true });
}

// ============================================================================
// 5. SPLASH SCREEN
// ============================================================================

function hideSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  setTimeout(() => splash.classList.add('splash-hidden'), 2500);
  setTimeout(() => splash.remove(), 3200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hideSplashScreen, { once: true });
} else {
  hideSplashScreen();
}

// ============================================================================
// 6. THEME MANAGEMENT
// ============================================================================

function initTheme() {
  let savedTheme = 'dark';

  try {
    savedTheme = localStorage.getItem(STORAGE_KEY_THEME) ||
      (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch (error) {
    console.warn('[Theme] Could not read saved theme:', error);
  }

  applyTheme(savedTheme);
}

function applyTheme(theme) {
  theme = theme === 'light' ? 'light' : 'dark';

  document.documentElement.setAttribute('data-theme', theme);

  try {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  } catch (error) {
    console.warn('[Theme] Could not save theme:', error);
  }

  DOM.themeMoonIcon?.classList.toggle('hidden', theme === 'light');
  DOM.themeSunIcon?.classList.toggle('hidden', theme !== 'light');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ============================================================================
// 7. BLUETOOTH CONNECTION
// ============================================================================

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    showToast('Web Bluetooth is unavailable. Try Chrome or Edge over HTTPS or localhost.', 'error');
    return;
  }

  if (state.isConnected && !state.isDemoMode) {
    disconnectBluetooth(true);
    return;
  }

  if (state.isConnecting) return;

  state.manualDisconnect = false;
  state.isConnecting = true;

  try {
    setConnectionState('connecting', 'Select your SmartBin...');
    showToast('Choose your SmartBin device from the Bluetooth list.', 'info');

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: BLE_DEVICE_NAME_PREFIX }],
      optionalServices: [NORDIC_UART_SERVICE_UUID]
    });

    state.device = device;

    device.removeEventListener('gattserverdisconnected', onDeviceDisconnected);
    device.addEventListener('gattserverdisconnected', onDeviceDisconnected);

    await establishBleConnection();

    state.reconnectAttempts = 0;
    state.isConnected = true;
    state.isConnecting = false;

    setConnectionState('connected', `Connected: ${state.device.name || 'SmartBin'}`);
    showToast(`Connected to ${state.device.name || 'SmartBin'}.`, 'success');

    addHistoryItem('info', 'SmartBin Connected', `Connected to ${state.device.name || 'SmartBin'} over BLE`);

    if (state.isDemoMode) toggleDemoMode(false);

  } catch (error) {
    state.isConnecting = false;
    console.error('[Bluetooth] Connection failed:', error);

    if (state.isDemoMode) {
      setConnectionState('connected', 'Demo Mode (Simulated)');
    } else {
      setConnectionState('disconnected', 'Disconnected');
    }

    if (error.name === 'NotFoundError') {
      showToast('Pairing cancelled or no device selected.', 'info');
    } else if (error.name === 'SecurityError') {
      showToast('Bluetooth permission was blocked. Check browser permissions.', 'error');
    } else {
      showToast(`Connection failed: ${error.message || 'Unknown error'}`, 'error');
    }
  }
}

async function establishBleConnection() {
  if (!state.device?.gatt) throw new Error('No Bluetooth device is selected.');

  setConnectionState('connecting', 'Connecting to SmartBin...');

  state.server = await state.device.gatt.connect();

  const service = await state.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

  state.txCharacteristic = await service.getCharacteristic(NORDIC_UART_TX_CHAR_UUID);
  state.txCharacteristic.removeEventListener('characteristicvaluechanged', handleBleNotification);
  await state.txCharacteristic.startNotifications();
  state.txCharacteristic.addEventListener('characteristicvaluechanged', handleBleNotification);

  state.rxCharacteristic = await service.getCharacteristic(NORDIC_UART_RX_CHAR_UUID);

  state.bleBuffer = '';
}

function handleBleNotification(event) {
  try {
    const bytes = event.target.value;
    const chunk = new TextDecoder('utf-8').decode(bytes);

    state.bleBuffer += chunk;

    // Process newline-delimited JSON messages.
    let newlineIndex;

    while ((newlineIndex = state.bleBuffer.indexOf('\n')) !== -1) {
      const line = state.bleBuffer.slice(0, newlineIndex).trim();
      state.bleBuffer = state.bleBuffer.slice(newlineIndex + 1);

      if (line) parseAndProcessJsonLine(line);
    }

    // Avoid retaining a corrupted or unbounded packet.
    if (state.bleBuffer.length > 4096) {
      console.warn('[Bluetooth] Oversized incomplete packet discarded.');
      state.bleBuffer = '';
    }
  } catch (error) {
    console.error('[Bluetooth] Notification handling failed:', error);
  }
}

function parseAndProcessJsonLine(line) {
  try {
    const payload = JSON.parse(line);

    if (!payload || typeof payload !== 'object') {
      throw new Error('Telemetry must be a JSON object.');
    }

    updateDashboard(payload);
  } catch (error) {
    console.warn('[Bluetooth] Invalid telemetry ignored:', line, error);
  }
}

async function sendBleCommand(command) {
  command = String(command).toUpperCase();

  if (!['W', 'D'].includes(command)) {
    showToast('Unknown command.', 'error');
    return;
  }

  if (state.isDemoMode) {
    simulateDemoCommand(command);
    return;
  }

  if (!state.isConnected || !state.rxCharacteristic) {
    showToast('SmartBin is disconnected. Connect or activate Demo Mode.', 'warning');
    updateCommandFeedback(`Command '${command}' not sent: SmartBin is disconnected.`);
    return;
  }

  try {
    updateCommandFeedback(`Sending '${command}' to ESP32...`);

    const bytes = new TextEncoder().encode(command);

    if (typeof state.rxCharacteristic.writeValueWithoutResponse === 'function') {
      await state.rxCharacteristic.writeValueWithoutResponse(bytes);
    } else {
      await state.rxCharacteristic.writeValue(bytes);
    }

    const label = command === 'W' ? 'Wet compartment' : 'Dry compartment';

    updateCommandFeedback(`Command '${command}' sent successfully: ${label} requested to open.`);
    showToast(`Command '${command}' sent to ${label}.`, 'success');
    addHistoryItem('door', `Manual Command Sent: ${command}`, `Sent ${label} open command`);

  } catch (error) {
    console.error('[Bluetooth] Command failed:', error);
    updateCommandFeedback(`Command failed: ${error.message}`);
    showToast(`Failed to send command: ${error.message}`, 'error');
  }
}

// ============================================================================
// 8. DISCONNECTION AND AUTOMATIC RECONNECTION
// ============================================================================

function onDeviceDisconnected() {
  console.warn('[Bluetooth] Device disconnected.');

  state.isConnected = false;
  state.isConnecting = false;
  state.txCharacteristic = null;
  state.rxCharacteristic = null;
  state.server = null;
  state.bleBuffer = '';

  addHistoryItem('info', 'SmartBin Disconnected', 'BLE connection lost');

  if (state.manualDisconnect || state.isDemoMode || !state.device) {
    setConnectionState(state.isDemoMode ? 'connected' : 'disconnected',
      state.isDemoMode ? 'Demo Mode (Simulated)' : 'Disconnected');
    return;
  }

  scheduleReconnect();
}

function scheduleReconnect() {
  if (state.reconnectTimeoutId) {
    clearTimeout(state.reconnectTimeoutId);
    state.reconnectTimeoutId = null;
  }

  if (state.reconnectAttempts >= state.maxReconnectAttempts) {
    setConnectionState('disconnected', 'Disconnected');
    showToast('Automatic reconnection failed. Press Connect Bin to try again.', 'error');
    return;
  }

  state.reconnectAttempts++;

  const delay = state.reconnectAttempts * 2000;

  setConnectionState(
    'connecting',
    `Reconnecting in ${delay / 1000}s (${state.reconnectAttempts}/${state.maxReconnectAttempts})...`
  );

  showToast(`Reconnecting to SmartBin (attempt ${state.reconnectAttempts})...`, 'warning');

  state.reconnectTimeoutId = setTimeout(attemptReconnect, delay);
}

async function attemptReconnect() {
  state.reconnectTimeoutId = null;

  if (state.manualDisconnect || state.isDemoMode || !state.device) return;

  try {
    state.isConnecting = true;
    await establishBleConnection();

    state.isConnected = true;
    state.isConnecting = false;
    state.reconnectAttempts = 0;

    setConnectionState('connected', `Connected: ${state.device.name || 'SmartBin'}`);
    showToast('SmartBin connection restored.', 'success');
    addHistoryItem('info', 'SmartBin Reconnected', 'BLE connection restored automatically');

  } catch (error) {
    state.isConnecting = false;
    console.warn('[Bluetooth] Reconnection attempt failed:', error);

    if (state.device?.gatt?.connected) {
      try {
        state.device.gatt.disconnect();
      } catch (_) {}
    }

    scheduleReconnect();
  }
}

function disconnectBluetooth(userInitiated = true) {
  state.manualDisconnect = userInitiated;

  if (state.reconnectTimeoutId) {
    clearTimeout(state.reconnectTimeoutId);
    state.reconnectTimeoutId = null;
  }

  state.reconnectAttempts = 0;
  state.isConnecting = false;

  const oldDevice = state.device;

  if (oldDevice) {
    oldDevice.removeEventListener('gattserverdisconnected', onDeviceDisconnected);
  }

  if (oldDevice?.gatt?.connected) {
    oldDevice.gatt.disconnect();
  }

  state.isConnected = false;
  state.device = null;
  state.server = null;
  state.txCharacteristic = null;
  state.rxCharacteristic = null;
  state.bleBuffer = '';

  setConnectionState(state.isDemoMode ? 'connected' : 'disconnected',
    state.isDemoMode ? 'Demo Mode (Simulated)' : 'Disconnected');

  if (userInitiated) showToast('Disconnected from SmartBin.', 'info');
}

function setConnectionState(status, text) {
  if (DOM.bleStatusText) DOM.bleStatusText.textContent = text;

  if (DOM.bleStatusDot) {
    DOM.bleStatusDot.className = 'status-dot';

    if (status === 'connected') DOM.bleStatusDot.classList.add('dot-connected');
    else if (status === 'connecting') DOM.bleStatusDot.classList.add('dot-connecting');
    else DOM.bleStatusDot.classList.add('dot-disconnected');
  }

  DOM.bleConnectBtn?.classList.toggle('connected-state', status === 'connected');

  if (DOM.bleBtnText) {
    DOM.bleBtnText.textContent =
      status === 'connected' && !state.isDemoMode ? 'Disconnect' :
      status === 'connecting' ? 'Connecting...' :
      status === 'connected' ? 'Demo Active' : 'Connect Bin';
  }

  if (DOM.bleConnectBtn) {
    DOM.bleConnectBtn.disabled = status === 'connecting' && !state.isDemoMode;
  }

  const controlsEnabled = state.isConnected || state.isDemoMode;

  if (DOM.btnOpenWet) DOM.btnOpenWet.disabled = !controlsEnabled;
  if (DOM.btnOpenDry) DOM.btnOpenDry.disabled = !controlsEnabled;
}

// ============================================================================
// 9. DASHBOARD UPDATE
// ============================================================================

function updateDashboard(data) {
  if (!data || typeof data !== 'object') return;

  const previousData = state.lastData;
  state.lastData = data;
  state.lastUpdateTime = new Date();

  updateRelativeTimeDisplay();

  updateWetCard(data.wet);
  updateDryCard(data.dry);
  updateBuzzerCard(data.buzzer);
  updateItemAndDoorCard(data.moist, data.door);

  // Pass previous telemetry explicitly to fix alert dismissal logic.
  updateAlertBanner(data.wet, data.dry, previousData);

  detectAndLogTransitions(previousData, data);
}

function updateWetCard(wet) {
  if (!wet) return;

  const pct = clampNumber(wet.pct, 0, 100, 0);
  DOM.wetPctVal.textContent = Math.round(pct);
  DOM.wetLiquidFill.style.height = `${pct}%`;

  if (!isValidDistance(wet.cm)) {
    DOM.wetCmVal.textContent = 'ERR';
    DOM.wetCmUnit.textContent = '';
    DOM.wetCmDesc.textContent = 'Ultrasonic sensor unreadable';
    DOM.wetDistBar.style.width = '0%';
    DOM.wetStatusBadge.className = 'status-badge badge-sensor-error';
    DOM.wetBadgeText.textContent = 'SENSOR ERROR';
    DOM.wetThresholdLabel.textContent = 'Sensor Fault';
    DOM.wetThresholdPill.classList.remove('warning-active');
    return;
  }

  DOM.wetCmVal.textContent = Number(wet.cm).toFixed(1);
  DOM.wetCmUnit.textContent = 'cm';
  DOM.wetCmDesc.textContent = 'Clearance to sensor lid';

  DOM.wetDistBar.style.width =
    `${clampNumber((30 - Number(wet.cm)) / 30 * 100, 0, 100, 0)}%`;

  if (wet.full) {
    DOM.wetStatusBadge.className = 'status-badge badge-full';
    DOM.wetBadgeText.textContent = 'FULL';
    DOM.wetThresholdLabel.textContent = `CAPACITY REACHED (${Math.round(pct)}%)`;
    DOM.wetThresholdPill.classList.add('warning-active');
  } else {
    DOM.wetStatusBadge.className = 'status-badge badge-not-full';
    DOM.wetBadgeText.textContent = 'NOT FULL';
    DOM.wetThresholdLabel.textContent = `Normal Level (${Math.round(pct)}%)`;
    DOM.wetThresholdPill.classList.remove('warning-active');
  }
}

function updateDryCard(dry) {
  if (!dry) return;

  const pct = clampNumber(dry.pct, 0, 100, 0);
  DOM.dryPctVal.textContent = Math.round(pct);
  DOM.dryLiquidFill.style.height = `${pct}%`;

  if (!isValidDistance(dry.cm)) {
    DOM.dryCmVal.textContent = 'ERR';
    DOM.dryCmUnit.textContent = '';
    DOM.dryCmDesc.textContent = 'Ultrasonic sensor unreadable';
    DOM.dryDistBar.style.width = '0%';
    DOM.dryStatusBadge.className = 'status-badge badge-sensor-error';
    DOM.dryBadgeText.textContent = 'SENSOR ERROR';
    DOM.dryThresholdLabel.textContent = 'Sensor Fault';
    DOM.dryThresholdPill.classList.remove('warning-active');
    return;
  }

  DOM.dryCmVal.textContent = Number(dry.cm).toFixed(1);
  DOM.dryCmUnit.textContent = 'cm';
  DOM.dryCmDesc.textContent = 'Clearance to sensor lid';

  DOM.dryDistBar.style.width =
    `${clampNumber((30 - Number(dry.cm)) / 30 * 100, 0, 100, 0)}%`;

  if (dry.full) {
    DOM.dryStatusBadge.className = 'status-badge badge-full';
    DOM.dryBadgeText.textContent = 'FULL';
    DOM.dryThresholdLabel.textContent = `CAPACITY REACHED (${Math.round(pct)}%)`;
    DOM.dryThresholdPill.classList.add('warning-active');
  } else {
    DOM.dryStatusBadge.className = 'status-badge badge-not-full';
    DOM.dryBadgeText.textContent = 'NOT FULL';
    DOM.dryThresholdLabel.textContent = `Normal Level (${Math.round(pct)}%)`;
    DOM.dryThresholdPill.classList.remove('warning-active');
  }
}

function isValidDistance(cm) {
  return cm !== null && cm !== undefined &&
    Number.isFinite(Number(cm)) && Number(cm) >= 0;
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function updateBuzzerCard(buzzerOn) {
  const active = Boolean(buzzerOn);

  DOM.buzzerStatusBadge.className =
    `status-badge ${active ? 'badge-buzzer-on' : 'badge-buzzer-off'}`;

  DOM.buzzerBadgeText.textContent = active ? 'ACTIVE' : 'OFF';
  DOM.buzzerVisualCircle.classList.toggle('buzzer-on', active);
  DOM.buzzerStateHeadline.textContent = active ? 'Alarm Buzzer Sounding!' : 'Buzzer Standby';

  DOM.buzzerExplanation.textContent = active
    ? 'The ESP32 reports that the hardware buzzer is active. Check the bin status.'
    : 'The buzzer is currently reported as OFF.';
}

function updateItemAndDoorCard(moist, doorState) {
  if (moist) {
    const cls = String(moist.cls || 'UNKNOWN').toUpperCase();
    const rawValue = Number(moist.raw);
    const raw = Number.isFinite(rawValue) ? Math.round(rawValue) : 0;

    DOM.moistRawDisplay.textContent = `ADC: ${raw}`;
    DOM.adcNeedleIndicator.style.left =
      `${clampNumber(raw / 4095 * 100, 0, 100, 0)}%`;

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
      DOM.itemClassificationBadge.className = 'status-badge badge-moist-unknown';
      DOM.itemClassText.textContent = 'AMBIGUOUS ITEM';
      DOM.moistResultBox.classList.add('hero-unknown');
      DOM.moistClassDisplay.textContent = 'UNKNOWN';
      DOM.moistNoteDisplay.textContent = 'Ambiguous - handled safely';
      setMoistHeroIcon('unknown');
    }
  }

  const door = String(doorState || 'CLOSED').toUpperCase();

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

function setMoistHeroIcon(type) {
  const icons = {
    wet: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>',
    dry: '<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>',
    unknown: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
  };

  DOM.moistHeroIcon.innerHTML =
    `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2">${icons[type] || icons.unknown}</svg>`;
}

// ============================================================================
// 10. ALERT BANNER — FIXED DISMISSAL LOGIC
// ============================================================================

function updateAlertBanner(wet, dry, previousData = null) {
  const wetFull = Boolean(wet?.full);
  const dryFull = Boolean(dry?.full);

  const wasWetFull = Boolean(previousData?.wet?.full);
  const wasDryFull = Boolean(previousData?.dry?.full);

  // A newly full bin resets a previous dismissal.
  if ((wetFull && !wasWetFull) || (dryFull && !wasDryFull)) {
    state.alertDismissed = false;
  }

  if (!wetFull && !dryFull) {
    DOM.alertBanner.classList.add('hidden');
    state.alertDismissed = false;
    return;
  }

  if (state.alertDismissed) {
    DOM.alertBanner.classList.add('hidden');
    return;
  }

  DOM.alertBanner.classList.remove('hidden');

  if (wetFull && dryFull) {
    DOM.alertTitle.textContent = 'CRITICAL ALERT: BOTH BINS ARE FULL!';
    DOM.alertMessage.textContent =
      'Both Wet and Dry compartments are full. Please empty both bins.';
  } else if (wetFull) {
    DOM.alertTitle.textContent = 'WARNING: Wet Waste Compartment is FULL!';
    DOM.alertMessage.textContent =
      'The wet bin has reached its full threshold. Please empty it.';
  } else {
    DOM.alertTitle.textContent = 'WARNING: Dry Waste Compartment is FULL!';
    DOM.alertMessage.textContent =
      'The dry bin has reached its full threshold. Please empty it.';
  }
}

function updateRelativeTimeDisplay() {
  if (!state.lastUpdateTime) {
    DOM.lastUpdateText.textContent = 'Last update: --';
    return;
  }

  const seconds = Math.floor((Date.now() - state.lastUpdateTime.getTime()) / 1000);

  if (seconds < 2) {
    DOM.lastUpdateText.textContent = 'Last update: Just now';
  } else if (seconds < 60) {
    DOM.lastUpdateText.textContent = `Last update: ${seconds}s ago`;
  } else {
    DOM.lastUpdateText.textContent =
      `Last update: ${state.lastUpdateTime.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })}`;
  }
}

function updateCommandFeedback(message) {
  if (DOM.commandFeedbackText) DOM.commandFeedbackText.textContent = message;
}

// ============================================================================
// 11. EVENT HISTORY
// ============================================================================

function detectAndLogTransitions(previous, current) {
  if (!current) return;

  if (current.wet?.full && !previous?.wet?.full) {
    addHistoryItem('full', 'Wet Compartment Full',
      `Capacity reached (${current.wet.pct ?? '--'}% fill, ${current.wet.cm ?? '--'} cm)`);
  }

  if (current.dry?.full && !previous?.dry?.full) {
    addHistoryItem('full', 'Dry Compartment Full',
      `Capacity reached (${current.dry.pct ?? '--'}% fill, ${current.dry.cm ?? '--'} cm)`);
  }

  const currentDoor = String(current.door || 'CLOSED').toUpperCase();
  const previousDoor = String(previous?.door || 'CLOSED').toUpperCase();

  if (currentDoor !== 'CLOSED' && currentDoor !== previousDoor) {
    addHistoryItem('door', `${currentDoor} Door Opened`, 'Chute opened for waste intake');
  }

  if (current.moist) {
    const oldMoist = previous?.moist;
    const currentRaw = Number(current.moist.raw);
    const oldRaw = Number(oldMoist?.raw);

    const classificationChanged =
      !oldMoist ||
      String(oldMoist.cls).toUpperCase() !== String(current.moist.cls).toUpperCase();

    const rawChanged =
      Number.isFinite(currentRaw) &&
      Number.isFinite(oldRaw) &&
      Math.abs(oldRaw - currentRaw) > 200;

    if (classificationChanged || rawChanged) {
      const cls = String(current.moist.cls || 'UNKNOWN').toUpperCase();
      const type = cls === 'WET' ? 'wet' : cls === 'DRY' ? 'dry' : 'info';

      addHistoryItem(
        type,
        `Item Classified: ${cls}`,
        cls === 'UNKNOWN' ? 'Ambiguous item detected' : `${cls} detected (ADC: ${current.moist.raw ?? '--'})`
      );
    }
  }

  if (current.buzzer && !previous?.buzzer) {
    addHistoryItem('buzzer', 'Alert Buzzer Triggered', 'The ESP32 reports that the buzzer is active');
  }
}

function getHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[History] Could not read history:', error);
    return [];
  }
}

function addHistoryItem(type, title, meta) {
  const history = getHistoryFromStorage();
  const now = new Date();

  history.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    meta,
    timestamp: now.toISOString(),
    timeStr: now.toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
  });

  history.length = Math.min(history.length, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
  } catch (error) {
    console.warn('[History] Could not save history:', error);
  }

  renderHistory();
}

function renderHistory() {
  const history = getHistoryFromStorage();

  if (!DOM.historyList) return;

  if (history.length === 0) {
    DOM.historyList.innerHTML = `
      <li class="history-empty">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>No recorded events yet. Connect your SmartBin or toggle Demo Mode!</span>
      </li>`;
    return;
  }

  const iconPaths = {
    full: '<path d="M10 2L1 18h18L10 2zm-1 5h2v5H9zm0 7h2v2H9z"/>',
    wet: '<path d="M10 1C8 5 3 9 3 13a7 7 0 0014 0c0-4-5-8-7-12z"/>',
    dry: '<path d="M3 2h4v16H3zM11 5h6v13h-6z"/>',
    door: '<path d="M4 2h12v16H4zM12 9h1v2h-1z"/>',
    buzzer: '<path d="M2 8h4l5-4v12l-5-4H2zM14 7q4 3 0 6"/>',
    info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v5m0-8v1"/>'
  };

  DOM.historyList.innerHTML = history.map(item => {
    const safeType = Object.prototype.hasOwnProperty.call(iconPaths, item.type)
      ? item.type : 'info';

    const iconClass = {
      full: 'hist-icon-full',
      wet: 'hist-icon-wet',
      dry: 'hist-icon-dry',
      door: 'hist-icon-door',
      buzzer: 'hist-icon-buzzer',
      info: 'hist-icon-info'
    }[safeType];

    return `
      <li class="history-item">
        <div class="history-icon-box ${iconClass}" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
            ${iconPaths[safeType]}
          </svg>
        </div>
        <div class="history-content">
          <span class="history-title">${escapeHtml(item.title)}</span>
          <span class="history-meta">${escapeHtml(item.meta || '')}</span>
        </div>
        <span class="history-time" title="${escapeHtml(item.timestamp || '')}">
          ${escapeHtml(item.timeStr || '')}
        </span>
      </li>`;
  }).join('');
}

function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY_HISTORY);
  } catch (error) {
    console.warn('[History] Could not clear history:', error);
  }

  renderHistory();
  showToast('Event history cleared.', 'info');
}

// ============================================================================
// 12. DEMO MODE
// ============================================================================

function toggleDemoMode(forceState) {
  const enable = typeof forceState === 'boolean' ? forceState : !state.isDemoMode;

  if (enable === state.isDemoMode) return;

  if (enable) {
    if (state.isConnected || state.device) {
      disconnectBluetooth(false);
    }

    state.isDemoMode = true;

    DOM.demoModeBtn.classList.add('active');
    DOM.demoModeBtn.setAttribute('aria-pressed', 'true');
    DOM.demoBadge.textContent = 'ON';
    DOM.demoControlBar.classList.remove('hidden');

    setConnectionState('connected', 'Demo Mode (Simulated)');
    showToast('Demo Mode activated. Displaying simulated sensor readings.', 'info');
    addHistoryItem('info', 'Demo Mode Activated', 'Started simulated telemetry');

    startDemoSimulationLoop();
  } else {
    state.isDemoMode = false;

    DOM.demoModeBtn.classList.remove('active');
    DOM.demoModeBtn.setAttribute('aria-pressed', 'false');
    DOM.demoBadge.textContent = 'OFF';
    DOM.demoControlBar.classList.add('hidden');

    if (state.demoIntervalId) clearInterval(state.demoIntervalId);
    if (state.demoDoorTimerId) clearTimeout(state.demoDoorTimerId);

    state.demoIntervalId = null;
    state.demoDoorTimerId = null;

    setConnectionState('disconnected', 'Disconnected');
    showToast('Demo Mode deactivated.', 'info');
    addHistoryItem('info', 'Demo Mode Stopped', 'Simulation stopped');
  }
}

function startDemoSimulationLoop() {
  if (state.demoIntervalId) clearInterval(state.demoIntervalId);

  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));

  let cycles = 0;

  state.demoIntervalId = setInterval(() => {
    if (!state.isDemoMode) return;

    cycles++;

    if (cycles % 3 === 0) {
      state.demoData.wet.pct = clampNumber(
        state.demoData.wet.pct + (Math.random() > 0.3 ? 1 : -1), 0, 100, 45
      );

      state.demoData.dry.pct = clampNumber(
        state.demoData.dry.pct + (Math.random() > 0.4 ? 1 : 0), 0, 100, 30
      );

      if (state.demoData.wet.cm !== -1) {
        state.demoData.wet.cm =
          Number(Math.max(2, (100 - state.demoData.wet.pct) * 0.28).toFixed(1));
      }

      if (state.demoData.dry.cm !== -1) {
        state.demoData.dry.cm =
          Number(Math.max(2, (100 - state.demoData.dry.pct) * 0.32).toFixed(1));
      }

      state.demoData.wet.full = state.demoData.wet.pct >= 90;
      state.demoData.dry.full = state.demoData.dry.pct >= 90;
      state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;
    }

    if (cycles % 16 === 0 && state.demoData.door === 'CLOSED') {
      const random = Math.random();

      if (random < 0.45) simulateDropItem('WET');
      else if (random < 0.85) simulateDropItem('DRY');
      else simulateDropItem('UNKNOWN');
    }

    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 600);
}

function simulateDropItem(cls) {
  let raw = 2100;

  if (cls === 'WET') raw = Math.floor(2700 + Math.random() * 1200);
  else if (cls === 'DRY') raw = Math.floor(500 + Math.random() * 900);
  else raw = Math.floor(1800 + Math.random() * 500);

  state.demoData.moist = { raw, cls };
  state.demoData.door = cls === 'DRY' ? 'DRY' : 'WET';

  if (state.demoDoorTimerId) clearTimeout(state.demoDoorTimerId);

  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));

  state.demoDoorTimerId = setTimeout(() => {
    state.demoData.door = 'CLOSED';
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 2500);
}

function simulateDemoCommand(command) {
  const door = command === 'W' ? 'WET' : 'DRY';

  state.demoData.door = door;

  updateCommandFeedback(`Demo: Servo triggered -> Opened ${door} compartment door.`);
  showToast(`Demo: Opened ${door} door.`, 'info');
  addHistoryItem('door', `Manual Command: ${command} (Demo)`, `Opened ${door} door chute`);

  updateDashboard(JSON.parse(JSON.stringify(state.demoData)));

  if (state.demoDoorTimerId) clearTimeout(state.demoDoorTimerId);

  state.demoDoorTimerId = setTimeout(() => {
    state.demoData.door = 'CLOSED';
    updateCommandFeedback('Demo: Chute door closed automatically.');
    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  }, 2500);
}

// ============================================================================
// 13. EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  DOM.bleConnectBtn?.addEventListener('click', connectBluetooth);
  DOM.demoModeBtn?.addEventListener('click', () => toggleDemoMode());

  DOM.enableDemoFromWarning?.addEventListener('click', () => {
    DOM.browserWarning?.classList.add('hidden');
    toggleDemoMode(true);
  });

  DOM.themeToggleBtn?.addEventListener('click', toggleTheme);

  DOM.alertDismissBtn?.addEventListener('click', () => {
    state.alertDismissed = true;
    DOM.alertBanner?.classList.add('hidden');
  });

  DOM.btnOpenWet?.addEventListener('click', () => sendBleCommand('W'));
  DOM.btnOpenDry?.addEventListener('click', () => sendBleCommand('D'));
  DOM.clearHistoryBtn?.addEventListener('click', clearHistory);

  window.addEventListener('keydown', event => {
    const tag = event.target?.tagName;

    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      animateButtonPress(DOM.btnOpenWet);
      sendBleCommand('W');
    } else if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      animateButtonPress(DOM.btnOpenDry);
      sendBleCommand('D');
    }
  });

  DOM.demoToggleWetFull?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);

    state.demoData.wet.full = !state.demoData.wet.full;
    state.demoData.wet.pct = state.demoData.wet.full ? 98 : 45;
    state.demoData.wet.cm = state.demoData.wet.full ? 2.5 : 9.5;
    state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;

    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  });

  DOM.demoToggleDryFull?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);

    state.demoData.dry.full = !state.demoData.dry.full;
    state.demoData.dry.pct = state.demoData.dry.full ? 95 : 30;
    state.demoData.dry.cm = state.demoData.dry.full ? 3.0 : 12.0;
    state.demoData.buzzer = state.demoData.wet.full || state.demoData.dry.full;

    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
  });

  DOM.demoSimWetItem?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('WET');
  });

  DOM.demoSimDryItem?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('DRY');
  });

  DOM.demoSimUnknownItem?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);
    simulateDropItem('UNKNOWN');
  });

  DOM.demoSimSensorError?.addEventListener('click', () => {
    if (!state.isDemoMode) toggleDemoMode(true);

    state.demoData.wet.cm = -1;
    state.demoData.dry.cm = -1;

    updateDashboard(JSON.parse(JSON.stringify(state.demoData)));
    showToast('Simulated ultrasonic sensor error.', 'warning');
  });
}

function animateButtonPress(button) {
  if (!button) return;

  button.style.transform = 'scale(0.96)';

  setTimeout(() => {
    button.style.transform = '';
  }, 120);
}

// ============================================================================
// 14. TOAST NOTIFICATIONS AND UTILITIES
// ============================================================================

function showToast(message, type = 'info') {
  if (!DOM.toastContainer) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13L5 10l1.4-1.4L9 11.2l4.6-4.6L15 8z"/>',
    error: '<path d="M10 1a9 9 0 100 18 9 9 0 000-18zm4 12l-1.4 1.4L10 11.8l-2.6 2.6L6 13l2.6-3L6 7l1.4-1.4L10 8.2l2.6-2.6L14 7l-2.6 3z"/>',
    warning: '<path d="M10 1L0 19h20L10 1zm-1 6h2v6H9zm0 8h2v2H9z"/>',
    info: '<path d="M10 1a9 9 0 100 18 9 9 0 000-18zm1 13H9V9h2zm0-7H9V5h2z"/>'
  };

  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#0ea5e9'
  };

  toast.innerHTML = `
    <svg viewBox="0 0 20 20" width="18" height="18" fill="${colors[type] || colors.info}" aria-hidden="true">
      ${icons[type] || icons.info}
    </svg>
    <span>${escapeHtml(message)}</span>`;

  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';

    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
