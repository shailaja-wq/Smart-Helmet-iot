/**
 * =========================================================================================
 * Project: IoT Based Smart Helmet with Emergency Alert System (SafeRider IoT)
 * Target Hardware: ESP32 DevKit V1 (30 or 38 pins)
 * 
 * Features:
 *  1. Alcohol Detection & Breath Analysis (MQ-3 Gas Sensor)
 *  2. Drowsiness & Fatigue Monitoring (IR Eye-Blink Sensor & Head-Tilt Analysis)
 *  3. Crash / Fall / Accident Detection (MPU-6050 6-Axis Accelerometer & Gyroscope)
 *  4. False Alarm Cancellation (15-second grace countdown with buzzer & cancel button)
 *  5. Emergency Alert Dispatch with Live GPS (NEO-6M GPS Module via TinyGPS++)
 *  6. Direct Telegram Bot Notification (HTTPS REST API / sendMessage & sendLocation)
 *  7. Smart Engine Ignition Interlock Relay (Enforces: Helmet Worn + Sober BAC)
 *  8. Status Display (SSD1306 0.96" I2C OLED)
 *  9. Real-time Telemetry Push to Cloud IoT Server (HTTP POST / WebSocket)
 * =========================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <MPU6050_tockn.h>
#include <TinyGPSPlus.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// -----------------------------------------------------------------------------------------
// 1. PIN DEFINITIONS & HARDWARE MAPPING
// -----------------------------------------------------------------------------------------
#define PIN_MQ3_ANALOG       34    // MQ-3 Alcohol Sensor (ADC1_CH6)
#define PIN_MQ3_DIGITAL      35    // MQ-3 Digital Threshold pin
#define PIN_HELMET_SWITCH    18    // Limit / Touch Switch inside Helmet (INPUT_PULLUP)
#define PIN_EYE_SENSOR       19    // IR Eye-Blink Sensor (LOW = Eye Closed, HIGH = Open)
#define PIN_CANCEL_BTN       4     // Emergency Cancel / "I AM OK" Button (INPUT_PULLUP)
#define PIN_SOS_BTN          5     // Manual SOS Panic Button (INPUT_PULLUP)
#define PIN_RELAY_IGNITION   23    // Relay Module (Active HIGH/LOW for Bike Ignition)
#define PIN_BUZZER           25    // Piezo Buzzer / Alarm (PWM capable)
#define PIN_VIBRATION_MOTOR  26    // Haptic Wake-Up Vibration Motor
#define PIN_STATUS_LED_GREEN 27    // System Ready LED
#define PIN_ALERT_LED_RED    14    // Danger / Alert LED

// GPS Module (NEO-6M connected to HardwareSerial 2)
#define PIN_GPS_RX           16    // ESP32 RX2 connected to GPS TX
#define PIN_GPS_TX           17    // ESP32 TX2 connected to GPS RX

// OLED Display (SSD1306 128x64 I2C: SDA = GPIO 21, SCL = GPIO 22)
#define SCREEN_WIDTH         128
#define SCREEN_HEIGHT        64
#define OLED_RESET           -1
#define SCREEN_ADDRESS       0x3C

// -----------------------------------------------------------------------------------------
// 2. CONFIGURATION PARAMETERS & THRESHOLDS
// -----------------------------------------------------------------------------------------
const char* WIFI_SSID         = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD     = "YOUR_WIFI_PASSWORD";

// Telegram Bot Credentials
const String TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
const String TELEGRAM_CHAT_ID   = "YOUR_TELEGRAM_CHAT_ID";

// IoT Cloud Server Backend Endpoint
const char* IOT_SERVER_URL    = "http://192.168.1.100:5000/api/telemetry";

// Safety Thresholds
const int   ALCOHOL_THRESHOLD_PPM   = 350;     // MQ-3 threshold (PPM)
const float CRASH_G_FORCE_THRESHOLD = 3.5;     // Impact acceleration threshold in Gs
const float TILT_ANGLE_THRESHOLD    = 60.0;    // Degrees of bike/head tilt indicating fall
const unsigned long EYE_CLOSURE_DROWSY_MS = 1800; // 1.8 seconds eye closure = Drowsiness
const unsigned long ACCIDENT_GRACE_PERIOD_MS = 15000; // 15 seconds to cancel false alarm

// -----------------------------------------------------------------------------------------
// 3. OBJECTS & GLOBAL VARIABLES
// -----------------------------------------------------------------------------------------
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
MPU6050 mpu6050(Wire);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
WiFiClientSecure secClient;

// System States
enum HelmetState {
  STATE_STANDBY,        // Helmet not worn
  STATE_READY_SAFE,     // Helmet worn, sober, alert
  STATE_ALCOHOL_LOCK,   // Drunk detected, ignition locked
  STATE_DROWSY_WARNING, // Drowsiness detected, buzzer waking rider
  STATE_CRASH_COUNTDOWN,// Crash detected, counting down 15s to cancel
  STATE_ALERT_DISPATCHED// SOS sent to Telegram & emergency server
};

HelmetState currentState = STATE_STANDBY;

// Sensor Variables
int   alcoholRawValue   = 0;
int   alcoholPpm        = 0;
bool  isHelmetWorn      = false;
bool  isEyeClosed       = false;
float currentGForce     = 1.0;
float currentRoll       = 0.0;
float currentPitch      = 0.0;
double currentLat       = 17.3850; // Default simulated/fallback coordinates (Hyderabad)
double currentLng       = 78.4867;
float currentSpeedKmh   = 0.0;
bool  isIgnitionArmed   = false;

// Timers
unsigned long eyeClosedStartTime   = 0;
unsigned long crashDetectedTime     = 0;
unsigned long lastTelemetrySendTime = 0;
unsigned long lastBlinkBeepTime     = 0;

// -----------------------------------------------------------------------------------------
// 4. FUNCTION DECLARATIONS
// -----------------------------------------------------------------------------------------
void setupHardware();
void connectWiFi();
void readSensors();
void processSafetyLogic();
void handleDisplay();
void triggerAccidentCountdown();
void cancelAccidentAlert();
void dispatchTelegramEmergencyAlert(String reason);
void sendTelegramMessage(String message);
void sendTelegramLocation(double lat, double lng);
void sendTelemetryToCloud();
void soundBuzzerPattern(int freq, int durationMs, int repetitions);
int readAlcoholPpm();

// -----------------------------------------------------------------------------------------
// 5. SETUP
// -----------------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[INIT] SafeRider IoT - Smart Helmet System Booting...");

  setupHardware();
  connectWiFi();
  secClient.setInsecure(); // Telegram API SSL handshake

  Serial.println("[READY] SafeRider IoT Smart Helmet is Active!");
}

// -----------------------------------------------------------------------------------------
// 6. MAIN LOOP
// -----------------------------------------------------------------------------------------
void loop() {
  mpu6050.update();
  
  // Read incoming GPS data
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
    if (gps.location.isUpdated()) {
      currentLat = gps.location.lat();
      currentLng = gps.location.lng();
      currentSpeedKmh = gps.speed.kmph();
    }
  }

  readSensors();
  processSafetyLogic();
  handleDisplay();

  // Push telemetry to cloud server every 1000ms
  if (millis() - lastTelemetrySendTime >= 1000) {
    sendTelemetryToCloud();
    lastTelemetrySendTime = millis();
  }

  delay(20);
}

// -----------------------------------------------------------------------------------------
// 7. HARDWARE SETUP
// -----------------------------------------------------------------------------------------
void setupHardware() {
  pinMode(PIN_HELMET_SWITCH, INPUT_PULLUP);
  pinMode(PIN_EYE_SENSOR, INPUT);
  pinMode(PIN_CANCEL_BTN, INPUT_PULLUP);
  pinMode(PIN_SOS_BTN, INPUT_PULLUP);
  pinMode(PIN_RELAY_IGNITION, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_VIBRATION_MOTOR, OUTPUT);
  pinMode(PIN_STATUS_LED_GREEN, OUTPUT);
  pinMode(PIN_ALERT_LED_RED, OUTPUT);

  // Default states
  digitalWrite(PIN_RELAY_IGNITION, LOW); // Locked
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_VIBRATION_MOTOR, LOW);
  digitalWrite(PIN_STATUS_LED_GREEN, LOW);
  digitalWrite(PIN_ALERT_LED_RED, LOW);

  // Initialize I2C OLED
  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("[ERROR] SSD1306 OLED allocation failed"));
  } else {
    display.clearDisplay();
    display.setTextColor(WHITE);
    display.setTextSize(1);
    display.setCursor(10, 15);
    display.println("SAFERIDER IOT");
    display.setCursor(10, 30);
    display.println("Smart Helmet Boot...");
    display.display();
    delay(1000);
  }

  // Initialize MPU-6050
  mpu6050.begin();
  mpu6050.calcGyroOffsets(true);

  // Initialize GPS UART2
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
}

// -----------------------------------------------------------------------------------------
// 8. SENSOR ACQUISITION
// -----------------------------------------------------------------------------------------
void readSensors() {
  // Helmet Wear Switch: LOW when pressed (worn on head)
  isHelmetWorn = (digitalRead(PIN_HELMET_SWITCH) == LOW);

  // MQ-3 Alcohol Sensor calculation
  alcoholPpm = readAlcoholPpm();

  // Eye Sensor: LOW indicates eye closed (IR beam reflected)
  isEyeClosed = (digitalRead(PIN_EYE_SENSOR) == LOW);

  // MPU-6050 G-Force & Orientation
  float ax = mpu6050.getAccX();
  float ay = mpu6050.getAccY();
  float az = mpu6050.getAccZ();
  currentGForce = sqrt(ax * ax + ay * ay + az * az);
  currentRoll   = mpu6050.getAngleX();
  currentPitch  = mpu6050.getAngleY();

  // Check Manual SOS Button
  if (digitalRead(PIN_SOS_BTN) == LOW) {
    Serial.println("[ALERT] Manual SOS Button Pressed!");
    dispatchTelegramEmergencyAlert("MANUAL SOS PANIC BUTTON ACTIVATED");
    delay(500);
  }
}

// -----------------------------------------------------------------------------------------
// 9. CORE SAFETY & EMERGENCY LOGIC
// -----------------------------------------------------------------------------------------
void processSafetyLogic() {
  // 1. If in Crash Countdown state, check cancel button or timer expiry
  if (currentState == STATE_CRASH_COUNTDOWN) {
    unsigned long elapsed = millis() - crashDetectedTime;

    // Check if user pressed "I AM OK" cancel button
    if (digitalRead(PIN_CANCEL_BTN) == LOW) {
      cancelAccidentAlert();
      return;
    }

    // Audible warning beep pattern during grace period
    if (millis() - lastBlinkBeepTime > 300) {
      digitalWrite(PIN_BUZZER, !digitalRead(PIN_BUZZER));
      digitalWrite(PIN_ALERT_LED_RED, !digitalRead(PIN_ALERT_LED_RED));
      lastBlinkBeepTime = millis();
    }

    // If grace period expires, dispatch emergency alert!
    if (elapsed >= ACCIDENT_GRACE_PERIOD_MS) {
      digitalWrite(PIN_BUZZER, HIGH);
      dispatchTelegramEmergencyAlert("ROAD ACCIDENT DETECTED (HIGH-G IMPACT & VEHICLE TILT)");
      currentState = STATE_ALERT_DISPATCHED;
    }
    return;
  }

  // 2. Accident / Fall Detection Algorithm
  bool isHighImpact = (currentGForce >= CRASH_G_FORCE_THRESHOLD);
  bool isSevereTilt = (abs(currentRoll) >= TILT_ANGLE_THRESHOLD || abs(currentPitch) >= TILT_ANGLE_THRESHOLD);

  if (isHelmetWorn && (isHighImpact || (isSevereTilt && currentGForce > 2.0))) {
    triggerAccidentCountdown();
    return;
  }

  // 3. Helmet Wear & Alcohol Interlock Logic
  if (!isHelmetWorn) {
    currentState = STATE_STANDBY;
    isIgnitionArmed = false;
    digitalWrite(PIN_RELAY_IGNITION, LOW); // Disarm bike engine
    digitalWrite(PIN_STATUS_LED_GREEN, LOW);
    digitalWrite(PIN_ALERT_LED_RED, LOW);
    digitalWrite(PIN_VIBRATION_MOTOR, LOW);
    return;
  }

  // If Helmet is worn, check alcohol
  if (alcoholPpm >= ALCOHOL_THRESHOLD_PPM) {
    currentState = STATE_ALCOHOL_LOCK;
    isIgnitionArmed = false;
    digitalWrite(PIN_RELAY_IGNITION, LOW); // Lock engine
    digitalWrite(PIN_STATUS_LED_GREEN, LOW);
    digitalWrite(PIN_ALERT_LED_RED, HIGH);
    soundBuzzerPattern(1500, 150, 1);
    return;
  }

  // 4. Drowsiness Monitoring Logic
  if (isEyeClosed) {
    if (eyeClosedStartTime == 0) {
      eyeClosedStartTime = millis();
    } else if (millis() - eyeClosedStartTime >= EYE_CLOSURE_DROWSY_MS) {
      // Drowsiness detected!
      currentState = STATE_DROWSY_WARNING;
      digitalWrite(PIN_VIBRATION_MOTOR, HIGH); // Haptic vibration wake-up
      soundBuzzerPattern(2500, 200, 2);
      return;
    }
  } else {
    eyeClosedStartTime = 0;
    digitalWrite(PIN_VIBRATION_MOTOR, LOW);
  }

  // If all checks pass: SOBER, WEARING HELMET, ALERT
  currentState = STATE_READY_SAFE;
  isIgnitionArmed = true;
  digitalWrite(PIN_RELAY_IGNITION, HIGH); // Unlock bike engine!
  digitalWrite(PIN_STATUS_LED_GREEN, HIGH);
  digitalWrite(PIN_ALERT_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_VIBRATION_MOTOR, LOW);
}

// -----------------------------------------------------------------------------------------
// 10. ACCIDENT COUNTDOWN & CANCELLATION
// -----------------------------------------------------------------------------------------
void triggerAccidentCountdown() {
  Serial.println("[CRASH] Severe Impact Detected! Commencing 15s Countdown...");
  currentState = STATE_CRASH_COUNTDOWN;
  crashDetectedTime = millis();
  isIgnitionArmed = false;
  digitalWrite(PIN_RELAY_IGNITION, LOW); // Cut engine
}

void cancelAccidentAlert() {
  Serial.println("[CANCEL] Rider pressed I AM OK! Cancelling Alert.");
  currentState = STATE_READY_SAFE;
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_ALERT_LED_RED, LOW);
  digitalWrite(PIN_STATUS_LED_GREEN, HIGH);
  
  display.clearDisplay();
  display.setCursor(15, 25);
  display.println("ALERT CANCELLED");
  display.setCursor(20, 40);
  display.println("RIDER IS SAFE");
  display.display();
  delay(1500);
}

// -----------------------------------------------------------------------------------------
// 11. TELEGRAM EMERGENCY ALERT DISPATCHER
// -----------------------------------------------------------------------------------------
void dispatchTelegramEmergencyAlert(String reason) {
  Serial.println("[EMERGENCY] Dispatching Telegram Alert...");
  
  // Format Google Maps URL
  String mapsUrl = "https://www.google.com/maps?q=" + String(currentLat, 6) + "," + String(currentLng, 6);

  // Compose formatted Telegram Alert text
  String alertMsg = "🚨 *EMERGENCY SOS: SMART HELMET ALERT* 🚨\n\n";
  alertMsg += "⚠️ *Incident:* " + reason + "\n";
  alertMsg += "👤 *Rider:* Registered User\n";
  alertMsg += "🏍️ *Bike Ignition:* CUT OFF (Engine Disabled)\n";
  alertMsg += "📊 *Impact Force:* " + String(currentGForce, 2) + " G\n";
  alertMsg += "🧭 *Tilt Angle:* " + String(currentRoll, 1) + "°\n";
  alertMsg += "⚡ *Speed at Impact:* " + String(currentSpeedKmh, 1) + " km/h\n";
  alertMsg += "🍷 *BAC Level:* " + String(alcoholPpm) + " PPM\n\n";
  alertMsg += "📍 *Live GPS Location:*\n" + mapsUrl + "\n\n";
  alertMsg += "⏰ *Timestamp:* " + String(millis() / 1000) + "s since boot\n";
  alertMsg += "🚑 *Immediate medical/paramedic assistance required!*";

  // Send Text Message
  sendTelegramMessage(alertMsg);

  // Send Native Map Pin
  sendTelegramLocation(currentLat, currentLng);
}

void sendTelegramMessage(String message) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ERROR] Cannot send Telegram: WiFi disconnected");
    return;
  }

  HTTPClient http;
  String url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";

  http.begin(secClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<1024> doc;
  doc["chat_id"] = TELEGRAM_CHAT_ID;
  doc["text"] = message;
  doc["parse_mode"] = "Markdown";

  String requestBody;
  serializeJson(doc, requestBody);

  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode > 0) {
    Serial.printf("[TELEGRAM] Message sent successfully (HTTP %d)\n", httpResponseCode);
  } else {
    Serial.printf("[TELEGRAM] Message failed: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}

void sendTelegramLocation(double lat, double lng) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendLocation";

  http.begin(secClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["chat_id"] = TELEGRAM_CHAT_ID;
  doc["latitude"] = lat;
  doc["longitude"] = lng;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpResponseCode = http.POST(requestBody);
  Serial.printf("[TELEGRAM] Location pin sent (HTTP %d)\n", httpResponseCode);
  http.end();
}

// -----------------------------------------------------------------------------------------
// 12. TELEMETRY PUSH TO CLOUD BACKEND
// -----------------------------------------------------------------------------------------
void sendTelemetryToCloud() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(IOT_SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<512> doc;
  doc["isHelmetWorn"]    = isHelmetWorn;
  doc["alcoholPpm"]      = alcoholPpm;
  doc["isEyeClosed"]     = isEyeClosed;
  doc["gForce"]          = currentGForce;
  doc["roll"]            = currentRoll;
  doc["pitch"]           = currentPitch;
  doc["latitude"]        = currentLat;
  doc["longitude"]       = currentLng;
  doc["speedKmh"]        = currentSpeedKmh;
  doc["isIgnitionArmed"] = isIgnitionArmed;
  doc["state"]           = currentState;

  String requestBody;
  serializeJson(doc, requestBody);

  int code = http.POST(requestBody);
  http.end();
}

// -----------------------------------------------------------------------------------------
// 13. OLED DISPLAY HANDLING
// -----------------------------------------------------------------------------------------
void handleDisplay() {
  display.clearDisplay();
  display.setTextColor(WHITE);

  // Top Status Bar
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("SAFERIDER");
  display.setCursor(75, 0);
  display.print(WiFi.status() == WL_CONNECTED ? "WIFI:OK" : "NO-WIFI");
  display.drawLine(0, 9, 128, 9, WHITE);

  switch (currentState) {
    case STATE_STANDBY:
      display.setCursor(15, 25);
      display.println("HELMET NOT WORN");
      display.setCursor(10, 42);
      display.println("ENGINE LOCKED (OFF)");
      break;

    case STATE_READY_SAFE:
      display.setCursor(0, 16);
      display.printf("BAC: %d PPM (SAFE)\n", alcoholPpm);
      display.setCursor(0, 28);
      display.printf("G-FORCE: %.2f G\n", currentGForce);
      display.setCursor(0, 40);
      display.printf("SPEED: %.1f KM/H\n", currentSpeedKmh);
      display.setCursor(0, 52);
      display.print("IGNITION: [ ARMED ]");
      break;

    case STATE_ALCOHOL_LOCK:
      display.setTextSize(1);
      display.setCursor(10, 18);
      display.println("! ALCOHOL DETECTED !");
      display.setCursor(25, 32);
      display.printf("%d PPM > SAFE\n", alcoholPpm);
      display.setCursor(5, 48);
      display.println("ENGINE START LOCKED");
      break;

    case STATE_DROWSY_WARNING:
      display.setCursor(10, 20);
      display.println("! DROWSY ALERT !");
      display.setCursor(10, 35);
      display.println("WAKE UP - PULL OVER");
      break;

    case STATE_CRASH_COUNTDOWN: {
      int remainingSec = (ACCIDENT_GRACE_PERIOD_MS - (millis() - crashDetectedTime)) / 1000;
      if (remainingSec < 0) remainingSec = 0;
      display.setCursor(15, 15);
      display.println("CRASH DETECTED!");
      display.setTextSize(2);
      display.setCursor(45, 30);
      display.printf("%d s", remainingSec);
      display.setTextSize(1);
      display.setCursor(10, 52);
      display.println("PRESS CANCEL IF OK");
      break;
    }

    case STATE_ALERT_DISPATCHED:
      display.setCursor(5, 20);
      display.println("EMERGENCY SOS SENT");
      display.setCursor(10, 36);
      display.println("TELEGRAM ALERT LIVE");
      display.setCursor(20, 50);
      display.println("HELP ON THE WAY");
      break;
  }

  display.display();
}

// -----------------------------------------------------------------------------------------
// 14. HELPER UTILITIES
// -----------------------------------------------------------------------------------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connecting to ");
  Serial.println(WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 6000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WIFI] Connection timeout - continuing in offline mode");
  }
}

int readAlcoholPpm() {
  // Read analog value from MQ-3 (0 - 4095 on ESP32 ADC)
  int raw = analogRead(PIN_MQ3_ANALOG);
  // Calibration conversion formula: PPM approximation
  float voltage = (raw / 4095.0) * 3.3;
  int ppm = (int)(voltage * 300.0);
  return ppm;
}

void soundBuzzerPattern(int freq, int durationMs, int repetitions) {
  for (int i = 0; i < repetitions; i++) {
    tone(PIN_BUZZER, freq, durationMs);
    delay(durationMs + 50);
    noTone(PIN_BUZZER);
  }
}
