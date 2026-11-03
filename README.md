# Smart Waste Monitor ♻️📶

A responsive, modern, and colourful web dashboard application built with **HTML5, CSS3, and vanilla JavaScript** (zero backend, zero build tools). It connects wirelessly to an **ESP32 microcontroller over Bluetooth Low Energy (BLE)** using the **Web Bluetooth API** to display real-time telemetry from a dual-compartment smart waste bin: **WET** (organic) and **DRY** (recyclable).

---

## 🌟 Key Features

- **Real-Time BLE Telemetry**: Connects via the Nordic UART Service to receive live sensor data ~every 500ms.
- **Robust Chunk Buffering**: Intelligently buffers fragmented BLE notification chunks and parses newline-delimited JSON strings (`\n`).
- **Two Compartment Cards**:
  - **Wet Compartment (Emerald / Teal theme)**: Animated liquid fill gauge with wavy liquid ripple effect, distance clearance in cm, capacity percentage, and dynamic status badges (`NOT FULL`, `FULL`, `SENSOR ERROR`).
  - **Dry Compartment (Blue / Orange theme)**: Matching animated liquid gauge and real-time ultrasonic distance tracking.
- **Audio Alert Buzzer Card**: Visual speaker indicator with radiating animated soundwave rings when hardware alarm sounds on the ESP32.
- **Moisture Classification & Physical Chute Card**:
  - Displays classification: **WET**, **DRY**, or **UNKNOWN** (*"Ambiguous - handled safely"*).
  - Raw ADC reading with a color-coded threshold needle track.
  - 3D animated dual-flap chute graphic showing which servo door opened (`WET`, `DRY`, or `CLOSED`).
- **Manual Chute Controls**: Send plain-text commands (`W` to open Wet door, `D` to open Dry door) via touch buttons or keyboard shortcuts (`[W]` and `[D]`).
- **Critical Alert Banner**: Warning banner at the top of the dashboard whenever either or both compartments are full.
- **Local Event History**: Stores the last 10 significant events (fill state changes, door openings, classifications, connection events) in `localStorage`.
- **Integrated Demo Mode**: Test all animations, alerts, and commands immediately without physical hardware.
- **Progressive Web App (PWA)**: Offline-ready with `manifest.json` and `sw.js` service worker. Installable on desktops and Android devices.
- **Light & Dark Mode**: Glassmorphism design with responsive 1, 2, and 3-column layouts.

---

## 🚀 How to Run with VS Code Live Server

Web Bluetooth is a high-security browser API. Browsers **strictly enforce** that Web Bluetooth can **only** be accessed from:
1. `localhost` / `127.0.0.1` (development)
2. `https://` secure domains (production)

Opening an HTML file directly via `file:///C:/.../index.html` will **block Web Bluetooth**.

### Step-by-Step:
1. Open this project folder in **Visual Studio Code**.
2. Install the **Live Server** extension (by *Ritwick Dey*) from the VS Code Extensions marketplace (`Ctrl + Shift + X` -> search `Live Server`).
3. Right-click `index.html` in the VS Code file explorer and click **"Open with Live Server"** (or click **"Go Live"** in the bottom status bar).
4. Your browser will automatically launch at `http://127.0.0.1:5500/index.html` or `http://localhost:5500/index.html`.

---

## 🌐 Browser Compatibility Matrix

| Platform | Browser | Web Bluetooth Support | Notes |
| :--- | :--- | :---: | :--- |
| **Windows / macOS / Linux** | **Google Chrome** | ✅ **Supported** | Recommended browser |
| **Windows / macOS** | **Microsoft Edge** | ✅ **Supported** | Fully compatible |
| **Android** | **Google Chrome** | ✅ **Supported** | Turn on Location/Bluetooth on phone |
| **Android** | **Microsoft Edge** | ✅ **Supported** | Fully compatible |
| **iOS / iPadOS** | **Safari** | ❌ **Not Supported** | Apple does not expose Web Bluetooth in WebKit |
| **iOS / iPadOS** | **Chrome / Edge** | ❌ **Not Supported** | iOS browsers are forced to use WebKit |
| **iOS / iPadOS** | **Bluefy Browser** | ⚠️ **Specialized** | Specialized 3rd-party BLE browser for iOS |
| **Desktop** | **Mozilla Firefox** | ❌ **Not Supported** | Mozilla has not implemented Web Bluetooth |

> **Note for Unsupported Browsers**: If opened on an unsupported browser, the app displays a helpful warning banner and allows you to test everything in **Demo Mode**.

---

## 📶 Bluetooth Low Energy (BLE) Protocol

The application implements the industry-standard **Nordic UART Service (NUS)** over BLE:

### Service & Characteristic UUIDs
- **Service UUID**: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **TX Characteristic (ESP32 ➔ App, NOTIFY)**: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- **RX Characteristic (App ➔ ESP32, WRITE)**: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- **Advertised Device Name**: Must start with prefix `SmartBin` (e.g., `SmartBin-ESP32`, `SmartBin-01`).

### Telemetry JSON Format (ESP32 ➔ App)
The ESP32 broadcasts a JSON string ending with a newline character (`\n`) approximately every 500 ms:

```json
{"wet":{"cm":7.2,"pct":60,"full":false},"dry":{"cm":4.5,"pct":75,"full":true},"buzzer":true,"moist":{"raw":2100,"cls":"WET"},"door":"WET"}\n
```

#### Field Specifications:
| Field | Type | Description |
| :--- | :--- | :--- |
| `wet.pct` | Number (0 - 100) | Fill percentage of the wet waste compartment |
| `wet.cm` | Number | Distance in cm from ultrasonic sensor to waste level (`-1` indicates sensor error) |
| `wet.full` | Boolean (`true`/`false`) | `true` when the compartment has reached maximum safe capacity |
| `dry.pct` | Number (0 - 100) | Fill percentage of the dry waste compartment |
| `dry.cm` | Number | Distance in cm (`-1` indicates sensor error) |
| `dry.full` | Boolean (`true`/`false`) | `true` when the dry compartment is confirmed full |
| `buzzer` | Boolean (`true`/`false`) | `true` when the audio buzzer alarm is actively sounding |
| `moist.raw`| Number (0 - 4095) | Raw 12-bit analog reading from the moisture sensor probe |
| `moist.cls`| String | Classification: `"WET"`, `"DRY"`, or `"UNKNOWN"` |
| `door` | String | Active compartment door: `"WET"`, `"DRY"`, or `"CLOSED"` |

### Control Commands (App ➔ ESP32)
Commands are plain single ASCII characters transmitted to the **RX Characteristic**:
- `"W"`: Trigger servo to open the **Wet** compartment door.
- `"D"`: Trigger servo to open the **Dry** compartment door.

---

## 📱 How to Pair with the ESP32

1. Power on your ESP32 running the Nordic UART BLE firmware.
2. In the web dashboard, click the blue **"Connect Bin"** button in the header.
3. The browser will present a native device selector listing nearby devices starting with `SmartBin`.
4. Select your device (e.g., `SmartBin-ESP32`) and click **"Pair"**.
5. The status dot will turn **Green ("Connected: SmartBin-...")** and real-time telemetry will begin streaming immediately!

---

## 🧪 Demo Mode (Testing Without Hardware)

Want to test or demonstrate the dashboard without having an ESP32 connected?
- Click the **"Demo Mode"** button in the top right.
- The dashboard immediately generates realistic simulated telemetry every 600 ms.
- A quick control bar will appear at the top, allowing you to test on demand:
  - **Toggle Wet Full**: Tests the red pulsing badge and top alert banner.
  - **Toggle Dry Full**: Tests the dry compartment overflow state.
  - **Drop Wet Item**: Tests classification, moisture meter needle, and wet door flap animation.
  - **Drop Dry Item**: Tests dry waste classification and dry door flap animation.
  - **Drop Unknown Item**: Tests the ambiguous classification badge (*"Ambiguous - handled safely"*).
  - **Sensor Error (-1)**: Tests the grey `SENSOR ERROR` status badge when ultrasonic sensors fail.
- Clicking **"Open Wet Door"** (`[W]`) or **"Open Dry Door"** (`[D]`) sends interactive commands that open the simulated chutes and log to history.

---

## 🛠️ ESP32 Sample Firmware (Arduino IDE)

You can flash this sample sketch to your ESP32 using the Arduino IDE:

```cpp
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>

#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { deviceConnected = true; };
    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        pServer->startAdvertising(); // Restart advertising on disconnect
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        String rxValue = pCharacteristic->getValue().c_str();
        if (rxValue.length() > 0) {
            char cmd = rxValue[0];
            if (cmd == 'W') {
                Serial.println("Command: OPEN WET DOOR");
                // Open wet door servo here
            } else if (cmd == 'D') {
                Serial.println("Command: OPEN DRY DOOR");
                // Open dry door servo here
            }
        }
    }
};

void setup() {
  Serial.begin(115200);
  BLEDevice::init("SmartBin-ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                           CHARACTERISTIC_UUID_RX,
                                           BLECharacteristic::PROPERTY_WRITE
                                         );
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("SmartBin BLE ready and advertising!");
}

void loop() {
  if (deviceConnected) {
    // Generate sample JSON line
    StaticJsonDocument<256> doc;
    doc["wet"]["cm"] = 7.2;
    doc["wet"]["pct"] = 60;
    doc["wet"]["full"] = false;
    doc["dry"]["cm"] = 4.5;
    doc["dry"]["pct"] = 75;
    doc["dry"]["full"] = true;
    doc["buzzer"] = true;
    doc["moist"]["raw"] = 2100;
    doc["moist"]["cls"] = "WET";
    doc["door"] = "WET";

    String output;
    serializeJson(doc, output);
    output += "\n"; // Must terminate with newline!

    pTxCharacteristic->setValue(output.c_str());
    pTxCharacteristic->notify();
  }
  delay(500);
}
```

---

## 📂 Project Structure

```text
├── index.html       # Semantic HTML5 dashboard layout with accessible markup
├── style.css        # Responsive CSS3 styles, glassmorphism, fluid liquid animations
├── app.js           # Web Bluetooth API, BLE chunk buffer, JSON parser, Demo mode
├── manifest.json    # Web App Manifest for PWA installation
├── sw.js            # Service worker for offline shell caching
├── README.md        # Comprehensive documentation and setup instructions
└── icons/           # Application icons (SVG, 192x192 PNG, 512x512 PNG)
    ├── favicon.svg
    ├── icon-192.png
    └── icon-512.png
```

---

## 💡 Troubleshooting & FAQ

1. **Why does Chrome say "Bluetooth adapter not available"?**
   - Ensure your computer or laptop has Bluetooth enabled in OS Settings.
2. **Why can't I see my device in the pairing popup?**
   - Verify that your ESP32's Bluetooth name begins with **`SmartBin`** (e.g., `SmartBin-01`).
   - Ensure the ESP32 is not already paired/connected to another phone or computer (BLE Nordic UART supports 1 active connection at a time).
3. **Why does it say Web Bluetooth is not supported on iPhone?**
   - Apple does not support the Web Bluetooth standard in Safari or any iOS browser. For mobile testing, use **Google Chrome on Android**.
4. **Why are packets arriving fragmented?**
   - BLE transmission limits packets to 20-23 bytes by default. The `app.js` script handles this by buffering all incoming bytes in `state.bleBuffer` and only parsing when a complete `\n` newline character is received.

---

## 📄 License
MIT License. Created for smart waste segregation monitoring with ESP32 IoT microcontrollers.
