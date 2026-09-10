/**
 * SafeRider IoT - Smart Helmet Backend Server
 * Node.js (v20+) with Express, WebSockets, and Native Fetch for Telegram Bot API
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, 'data');
const INCIDENTS_FILE = path.join(DATA_DIR, 'incidents.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default Configuration
let systemConfig = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  emergencyContactName: 'Dr. Sarah Connor (Emergency Care / Family)',
  emergencyContactPhone: '+1-555-0199',
  vehicleId: 'SR-HELMET-902',
  riderName: 'Alex Mercer',
  bloodGroup: 'O+ Positive',
  alcoholThresholdPpm: 350,
  crashGForceThreshold: 3.5,
  gracePeriodSeconds: 15
};

// Load saved config if exists
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    systemConfig = { ...systemConfig, ...saved };
  } catch (err) {
    console.error('Error loading config file:', err.message);
  }
}

// Load or initialize incidents log
let incidentLog = [];
if (fs.existsSync(INCIDENTS_FILE)) {
  try {
    incidentLog = JSON.parse(fs.readFileSync(INCIDENTS_FILE, 'utf8'));
  } catch (err) {
    incidentLog = [];
  }
}

function saveIncidents() {
  try {
    fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(incidentLog.slice(0, 100), null, 2));
  } catch (err) {
    console.error('Failed to save incidents:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(systemConfig, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

// Current Live Telemetry State
let currentTelemetry = {
  isHelmetWorn: true,
  alcoholPpm: 45,
  isEyeClosed: false,
  drowsinessDetected: false,
  drowsinessDurationMs: 0,
  gForce: 1.02,
  roll: 1.2,
  pitch: -0.5,
  latitude: 17.385044,
  longitude: 78.486671,
  altitudeMeters: 536,
  speedKmh: 42.5,
  satellites: 9,
  isIgnitionArmed: true,
  state: 'READY_SAFE', // STANDBY, READY_SAFE, ALCOHOL_LOCK, DROWSY_WARNING, CRASH_COUNTDOWN, ALERT_DISPATCHED
  batteryPercent: 94,
  lastUpdated: new Date().toISOString()
};

// Simulated Route Coordinates (Scenic Ride Route)
const simulatedRoute = [
  { lat: 17.385044, lng: 78.486671, speed: 38 },
  { lat: 17.386210, lng: 78.487850, speed: 45 },
  { lat: 17.387920, lng: 78.489110, speed: 52 },
  { lat: 17.389540, lng: 78.490890, speed: 48 },
  { lat: 17.391200, lng: 78.493020, speed: 55 },
  { lat: 17.392810, lng: 78.495210, speed: 40 },
  { lat: 17.394100, lng: 78.497500, speed: 35 },
  { lat: 17.392500, lng: 78.499800, speed: 44 },
  { lat: 17.390100, lng: 78.498100, speed: 50 },
  { lat: 17.387200, lng: 78.494400, speed: 46 }
];
let routeIndex = 0;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files directly from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// -----------------------------------------------------------------------------------------
// TELEGRAM BOT DISPATCH SERVICE (Using Native Fetch)
// -----------------------------------------------------------------------------------------
async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) {
    console.warn('[TELEGRAM] Skipped send: Bot Token or Chat ID is not configured.');
    return { success: false, reason: 'Bot Token or Chat ID not configured' };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('[TELEGRAM ERROR]', data);
      return { success: false, error: data.description };
    }

    console.log('[TELEGRAM SUCCESS] Message dispatched to Chat ID:', chatId);
    return { success: true, result: data.result };
  } catch (err) {
    console.error('[TELEGRAM FETCH FAILED]', err.message);
    return { success: false, error: err.message };
  }
}

async function sendTelegramLocation(token, chatId, lat, lng) {
  if (!token || !chatId) return { success: false };

  try {
    const url = `https://api.telegram.org/bot${token}/sendLocation`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        latitude: lat,
        longitude: lng
      })
    });
    return await response.json();
  } catch (err) {
    console.error('[TELEGRAM LOCATION ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------------------
// REST API ROUTES
// -----------------------------------------------------------------------------------------

// Health & System Info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'SafeRider IoT - Smart Helmet Server',
    time: new Date().toISOString(),
    websocketClients: wss.clients.size,
    telegramConfigured: Boolean(systemConfig.telegramBotToken && systemConfig.telegramChatId)
  });
});

// Get Latest Telemetry
app.get('/api/telemetry/latest', (req, res) => {
  res.json(currentTelemetry);
});

// Update Telemetry (From ESP32 or Simulator)
app.post('/api/telemetry', (req, res) => {
  const incoming = req.body;
  
  // Merge incoming telemetry with current
  currentTelemetry = {
    ...currentTelemetry,
    ...incoming,
    lastUpdated: new Date().toISOString()
  };

  // Re-evaluate Ignition Interlock State
  if (!currentTelemetry.isHelmetWorn) {
    currentTelemetry.isIgnitionArmed = false;
    currentTelemetry.state = 'STANDBY';
  } else if (currentTelemetry.alcoholPpm >= systemConfig.alcoholThresholdPpm) {
    currentTelemetry.isIgnitionArmed = false;
    currentTelemetry.state = 'ALCOHOL_LOCK';
  } else if (currentTelemetry.state === 'CRASH_COUNTDOWN' || currentTelemetry.state === 'ALERT_DISPATCHED') {
    currentTelemetry.isIgnitionArmed = false;
  } else if (currentTelemetry.drowsinessDetected) {
    currentTelemetry.state = 'DROWSY_WARNING';
  } else {
    currentTelemetry.isIgnitionArmed = true;
    currentTelemetry.state = 'READY_SAFE';
  }

  // Broadcast to all connected WebSockets
  broadcastWs({
    type: 'TELEMETRY_UPDATE',
    payload: currentTelemetry
  });

  res.json({ success: true, telemetry: currentTelemetry });
});

// Trigger Emergency Alert Event
app.post('/api/alert/trigger', async (req, res) => {
  const { type, severity, gForce, roll, pitch, details, bypassGrace } = req.body;
  
  const incident = {
    id: 'INC-' + Date.now().toString(36).toUpperCase(),
    type: type || 'CRASH_ACCIDENT',
    severity: severity || 'CRITICAL',
    gForce: gForce || currentTelemetry.gForce,
    tiltAngle: roll || currentTelemetry.roll,
    latitude: currentTelemetry.latitude,
    longitude: currentTelemetry.longitude,
    speedKmh: currentTelemetry.speedKmh,
    alcoholPpm: currentTelemetry.alcoholPpm,
    timestamp: new Date().toISOString(),
    details: details || 'High-impact collision and bike tilt detected by MPU6050 sensor.',
    status: bypassGrace ? 'DISPATCHED' : 'COUNTDOWN_ACTIVE'
  };

  if (bypassGrace) {
    // Immediate dispatch (e.g. Manual SOS button)
    currentTelemetry.state = 'ALERT_DISPATCHED';
    currentTelemetry.isIgnitionArmed = false;
    incident.status = 'DISPATCHED';
    incidentLog.unshift(incident);
    saveIncidents();

    await dispatchEmergencyTelegram(incident);

    broadcastWs({
      type: 'EMERGENCY_DISPATCHED',
      payload: incident
    });
  } else {
    // Start 15-second grace countdown
    currentTelemetry.state = 'CRASH_COUNTDOWN';
    currentTelemetry.isIgnitionArmed = false;
    incidentLog.unshift(incident);
    saveIncidents();

    broadcastWs({
      type: 'CRASH_COUNTDOWN_START',
      payload: {
        incident,
        graceSeconds: systemConfig.gracePeriodSeconds
      }
    });
  }

  res.json({ success: true, incident });
});

// Cancel Alert (Rider pressed "I AM OK")
app.post('/api/alert/cancel', (req, res) => {
  if (currentTelemetry.state === 'CRASH_COUNTDOWN') {
    currentTelemetry.state = 'READY_SAFE';
    currentTelemetry.isIgnitionArmed = currentTelemetry.isHelmetWorn && (currentTelemetry.alcoholPpm < systemConfig.alcoholThresholdPpm);
    
    // Update incident log status
    if (incidentLog.length > 0 && incidentLog[0].status === 'COUNTDOWN_ACTIVE') {
      incidentLog[0].status = 'CANCELLED_BY_RIDER';
      incidentLog[0].cancelledAt = new Date().toISOString();
      saveIncidents();
    }

    broadcastWs({
      type: 'ALERT_CANCELLED',
      payload: {
        message: 'Accident alert cancelled by rider. Rider confirmed safe.',
        timestamp: new Date().toISOString()
      }
    });

    return res.json({ success: true, message: 'Alert cancelled successfully' });
  }

  res.json({ success: false, message: 'No active countdown to cancel' });
});

// Finalize Grace Period and Dispatch SOS to Telegram
app.post('/api/alert/dispatch', async (req, res) => {
  const { incidentId } = req.body;
  const incident = incidentLog.find(inc => inc.id === incidentId) || incidentLog[0];

  currentTelemetry.state = 'ALERT_DISPATCHED';
  currentTelemetry.isIgnitionArmed = false;

  if (incident) {
    incident.status = 'DISPATCHED';
    saveIncidents();
  }

  const tgResult = await dispatchEmergencyTelegram(incident || {
    type: 'ACCIDENT_DETECTED',
    severity: 'CRITICAL',
    latitude: currentTelemetry.latitude,
    longitude: currentTelemetry.longitude,
    speedKmh: currentTelemetry.speedKmh,
    gForce: currentTelemetry.gForce,
    alcoholPpm: currentTelemetry.alcoholPpm,
    timestamp: new Date().toISOString()
  });

  broadcastWs({
    type: 'EMERGENCY_DISPATCHED',
    payload: {
      incident,
      telegramResult: tgResult
    }
  });

  res.json({ success: true, telegramResult: tgResult });
});

// Helper: Dispatch Full Telegram Emergency Suite
async function dispatchEmergencyTelegram(incident) {
  const mapsUrl = `https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`;
  
  const textMessage = 
`🚨 *EMERGENCY SOS: SMART HELMET ACCIDENT DETECTED* 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *Incident:* ${incident.type.replace(/_/g, ' ')}
🔴 *Severity:* ${incident.severity}
👤 *Rider:* ${systemConfig.riderName} (Blood Group: ${systemConfig.bloodGroup})
🏍️ *Vehicle ID:* ${systemConfig.vehicleId}
🛑 *Engine Ignition:* DISABLED (Relay Locked)

📊 *Telemetry at Impact:*
• *Impact Force:* ${Number(incident.gForce || currentTelemetry.gForce).toFixed(2)} G
• *Speed:* ${Number(incident.speedKmh || currentTelemetry.speedKmh).toFixed(1)} km/h
• *BAC Alcohol Level:* ${incident.alcoholPpm || currentTelemetry.alcoholPpm} PPM
• *Tilt Angle:* ${Number(incident.tiltAngle || currentTelemetry.roll).toFixed(1)}°

📍 *Live Accident Coordinates:*
${mapsUrl}

⏰ *Time:* ${new Date().toLocaleString()}
📞 *Emergency Contact:* ${systemConfig.emergencyContactName} (${systemConfig.emergencyContactPhone})
🚑 *ACTION REQUIRED:* Dispatching emergency paramedics to GPS coordinates!`;

  const msgRes = await sendTelegramMessage(systemConfig.telegramBotToken, systemConfig.telegramChatId, textMessage);
  const locRes = await sendTelegramLocation(systemConfig.telegramBotToken, systemConfig.telegramChatId, incident.latitude, incident.longitude);

  return { message: msgRes, location: locRes };
}

// Telegram Configuration & Testing
app.get('/api/telegram/config', (req, res) => {
  res.json({
    hasToken: Boolean(systemConfig.telegramBotToken),
    maskedToken: systemConfig.telegramBotToken ? systemConfig.telegramBotToken.replace(/^(.{6})(.*)(.{4})$/, '$1••••••••$3') : '',
    chatId: systemConfig.telegramChatId,
    riderName: systemConfig.riderName,
    vehicleId: systemConfig.vehicleId,
    emergencyContactName: systemConfig.emergencyContactName,
    emergencyContactPhone: systemConfig.emergencyContactPhone
  });
});

app.post('/api/telegram/config', (req, res) => {
  const { token, chatId, riderName, vehicleId, contactName, contactPhone } = req.body;
  
  if (token !== undefined) systemConfig.telegramBotToken = token.trim();
  if (chatId !== undefined) systemConfig.telegramChatId = chatId.trim();
  if (riderName !== undefined) systemConfig.riderName = riderName;
  if (vehicleId !== undefined) systemConfig.vehicleId = vehicleId;
  if (contactName !== undefined) systemConfig.emergencyContactName = contactName;
  if (contactPhone !== undefined) systemConfig.emergencyContactPhone = contactPhone;

  saveConfig();
  res.json({ success: true, message: 'Settings saved successfully' });
});

// Test Telegram Ping
app.post('/api/telegram/test', async (req, res) => {
  const token = req.body.token || systemConfig.telegramBotToken;
  const chatId = req.body.chatId || systemConfig.telegramChatId;

  if (!token || !chatId) {
    return res.status(400).json({ success: false, error: 'Both Bot Token and Chat ID are required to test.' });
  }

  const testMessage = 
`✅ *SafeRider IoT - Telegram Alert Verification*
━━━━━━━━━━━━━━━━━━━━━━━━━━
Your Telegram number/channel is successfully linked to the **IoT Smart Helmet Emergency System**!

🏍️ *Vehicle:* ${systemConfig.vehicleId}
👤 *Rider:* ${systemConfig.riderName}
📡 *GPS Live Beacon:* Active
⏰ *Timestamp:* ${new Date().toLocaleTimeString()}

You will receive instant SOS alerts with clickable Google Maps coordinates if an accident, high-impact fall, or emergency is detected.`;

  const result = await sendTelegramMessage(token, chatId, testMessage);
  
  if (result.success) {
    // Also test sending location pin
    await sendTelegramLocation(token, chatId, currentTelemetry.latitude, currentTelemetry.longitude);
  }

  res.json(result);
});

// Incidents Log
app.get('/api/incidents', (req, res) => {
  res.json(incidentLog);
});

app.delete('/api/incidents', (req, res) => {
  incidentLog = [];
  saveIncidents();
  res.json({ success: true, message: 'Incident log cleared' });
});

// Simulated GPS Movement Loop (Runs in background to simulate riding)
setInterval(() => {
  if (currentTelemetry.state !== 'CRASH_COUNTDOWN' && currentTelemetry.state !== 'ALERT_DISPATCHED') {
    routeIndex = (routeIndex + 1) % simulatedRoute.length;
    const pt = simulatedRoute[routeIndex];
    // Add small realistic jitter
    currentTelemetry.latitude = Number((pt.lat + (Math.random() - 0.5) * 0.0001).toFixed(6));
    currentTelemetry.longitude = Number((pt.lng + (Math.random() - 0.5) * 0.0001).toFixed(6));
    currentTelemetry.speedKmh = Math.max(0, Number((pt.speed + (Math.random() - 0.5) * 4).toFixed(1)));
    currentTelemetry.gForce = Number((1.0 + (Math.random() - 0.5) * 0.15).toFixed(2));
    currentTelemetry.roll = Number(((Math.random() - 0.5) * 6).toFixed(1));
    currentTelemetry.pitch = Number(((Math.random() - 0.5) * 4).toFixed(1));
    currentTelemetry.lastUpdated = new Date().toISOString();

    broadcastWs({
      type: 'TELEMETRY_UPDATE',
      payload: currentTelemetry
    });
  }
}, 2500);

// -----------------------------------------------------------------------------------------
// WEBSOCKET BROADCASTING
// -----------------------------------------------------------------------------------------
function broadcastWs(msgObj) {
  const msgStr = JSON.stringify(msgObj);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msgStr);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected to live telemetry stream');
  // Send initial state immediately
  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    payload: {
      telemetry: currentTelemetry,
      config: {
        riderName: systemConfig.riderName,
        vehicleId: systemConfig.vehicleId,
        hasTelegramConfig: Boolean(systemConfig.telegramBotToken && systemConfig.telegramChatId)
      },
      incidents: incidentLog.slice(0, 10)
    }
  }));

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 SafeRider IoT - Smart Helmet Server Running!`);
  console.log(`🌐 Dashboard UI & API: http://localhost:${PORT}`);
  console.log(`📡 WebSocket Stream:   ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});
