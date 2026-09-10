/**
 * SafeRider IoT - Main Application Controller
 * Synchronizes WebSockets, Leaflet Map, Chart.js, and Telegram Integrations.
 */

class SafeRiderApp {
  constructor() {
    this.ws = null;
    this.telemetry = {
      isHelmetWorn: true,
      alcoholPpm: 45,
      isEyeClosed: false,
      drowsinessDetected: false,
      gForce: 1.02,
      roll: 1.2,
      pitch: -0.5,
      latitude: 17.385044,
      longitude: 78.486671,
      altitudeMeters: 536,
      speedKmh: 42.5,
      satellites: 9,
      isIgnitionArmed: true,
      state: 'READY_SAFE',
      batteryPercent: 94
    };

    this.map = null;
    this.riderMarker = null;
    this.crashBeaconMarker = null;
    this.routePolyline = null;
    this.routeHistory = [];

    this.chart = null;
    this.chartMaxPoints = 20;

    this.init();
  }

  async init() {
    this.initMap();
    this.initChart();
    this.initAudioToggle();
    this.initTelegramControls();
    this.initLogControls();

    // Initialize Simulator Engine
    this.simulator = new SafeRiderSimulator(this);

    // Connect Real-time Stream
    this.connectWebSocket();

    // Initial Data Fetch
    await this.fetchInitialData();
    await this.fetchTelegramConfig();
    await this.fetchIncidents();
  }

  // -----------------------------------------------------------------------------------------
  // 1. WEBSOCKET REAL-TIME TELEMETRY STREAM
  // -----------------------------------------------------------------------------------------
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const networkBadge = document.getElementById('networkBadge');
    const networkIcon = document.getElementById('networkIcon');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to SafeRider IoT telemetry stream');
        if (networkBadge) networkBadge.textContent = 'Live (WS)';
        if (networkIcon) networkIcon.className = 'fa-solid fa-wifi text-cyan';
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleSocketMessage(msg);
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WS] Connection closed. Retrying in 2.5s...');
        if (networkBadge) networkBadge.textContent = 'Reconnecting';
        if (networkIcon) networkIcon.className = 'fa-solid fa-wifi text-amber';
        setTimeout(() => this.connectWebSocket(), 2500);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.warn('[WS] Setup failed, falling back to HTTP polling:', e);
      setInterval(() => this.pollTelemetry(), 2000);
    }
  }

  handleSocketMessage(msg) {
    switch (msg.type) {
      case 'INITIAL_STATE':
        if (msg.payload.telemetry) this.updateTelemetryState(msg.payload.telemetry);
        if (msg.payload.incidents) this.renderIncidents(msg.payload.incidents);
        break;

      case 'TELEMETRY_UPDATE':
        this.updateTelemetryState(msg.payload);
        break;

      case 'CRASH_COUNTDOWN_START':
        if (this.simulator) {
          this.simulator.startGraceCountdown(msg.payload.incident);
        }
        break;

      case 'ALERT_CANCELLED':
        if (this.simulator) {
          this.simulator.cancelEmergencyCountdown();
        }
        break;

      case 'EMERGENCY_DISPATCHED':
        this.fetchIncidents();
        break;
    }
  }

  async sendTelemetryUpdate(patch) {
    try {
      const res = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (data.telemetry) {
        this.updateTelemetryState(data.telemetry);
      }
    } catch (e) {
      console.error('Failed to send telemetry update:', e);
    }
  }

  async pollTelemetry() {
    try {
      const res = await fetch('/api/telemetry/latest');
      const data = await res.json();
      this.updateTelemetryState(data);
    } catch (e) {
      console.warn('Poll failed:', e);
    }
  }

  async fetchInitialData() {
    try {
      const res = await fetch('/api/telemetry/latest');
      const data = await res.json();
      this.updateTelemetryState(data);
    } catch (e) {
      console.warn('Failed to load initial telemetry:', e);
    }
  }

  // -----------------------------------------------------------------------------------------
  // 2. STATE SYNCHRONIZATION & UI UPDATES
  // -----------------------------------------------------------------------------------------
  updateTelemetryState(t) {
    this.telemetry = { ...this.telemetry, ...t };

    // 1. Header Badges
    const satellitesBadge = document.getElementById('satellitesBadge');
    const batteryBadge = document.getElementById('batteryBadge');
    if (satellitesBadge) satellitesBadge.textContent = `${this.telemetry.satellites || 9} Sats`;
    if (batteryBadge) batteryBadge.textContent = `${this.telemetry.batteryPercent || 94}%`;

    // 2. System Mode Pill
    this.updateStatusPill(this.telemetry.state);

    // 3. KPI Card: Helmet Wear
    this.updateHelmetWearCard(this.telemetry.isHelmetWorn);

    // 4. KPI Card: Alcohol
    this.updateAlcoholCard(this.telemetry.alcoholPpm);

    // 5. KPI Card: Drowsiness
    this.updateDrowsinessCard(this.telemetry.drowsinessDetected, this.telemetry.isEyeClosed);

    // 6. KPI Card: Ignition Interlock
    this.updateIgnitionCard(this.telemetry.isIgnitionArmed);

    // 7. Digital Twin HUD & Visuals
    this.updateDigitalTwinVisuals();

    // 8. Map Position & Trail
    this.updateMapPosition(this.telemetry.latitude, this.telemetry.longitude, this.telemetry.speedKmh);

    // 9. Telemetry Charts
    this.updateChart(this.telemetry.gForce, this.telemetry.alcoholPpm, this.telemetry.speedKmh);
  }

  updateStatusPill(state) {
    const pill = document.getElementById('systemStatusPill');
    const label = document.getElementById('systemStatusLabel');
    if (!pill || !label) return;

    pill.className = 'system-status-pill';

    switch (state) {
      case 'STANDBY':
        label.textContent = 'STANDBY — HELMET NOT WORN';
        pill.classList.add('warning');
        break;
      case 'READY_SAFE':
        label.textContent = 'SYSTEM ARMED & SECURE';
        break;
      case 'ALCOHOL_LOCK':
        label.textContent = 'IGNITION LOCKED — DRIVER INTOXICATED';
        pill.classList.add('danger');
        break;
      case 'DROWSY_WARNING':
        label.textContent = 'DROWSINESS ALERT — WAKE UP';
        pill.classList.add('warning');
        break;
      case 'CRASH_COUNTDOWN':
        label.textContent = 'CRASH DETECTED — SOS COUNTDOWN';
        pill.classList.add('danger');
        break;
      case 'ALERT_DISPATCHED':
        label.textContent = 'EMERGENCY SOS DISPATCHED TO TELEGRAM';
        pill.classList.add('danger');
        break;
      default:
        label.textContent = 'MONITORING ACTIVE';
    }
  }

  updateHelmetWearCard(isWorn) {
    const status = document.getElementById('helmetWearStatus');
    const sub = document.getElementById('helmetWearSub');
    const bar = document.getElementById('helmetWearBar');
    const card = document.getElementById('cardHelmetWear');

    if (status) status.textContent = isWorn ? 'WORN' : 'OFF HEAD';
    if (sub) sub.textContent = isWorn ? 'Contact switch engaged' : 'Wear helmet to start';
    if (bar) {
      bar.className = `kpi-indicator-bar ${isWorn ? 'safe' : 'danger'}`;
    }
  }

  updateAlcoholCard(ppm) {
    const val = document.getElementById('alcoholVal');
    const text = document.getElementById('alcoholStatusText');
    const fill = document.getElementById('alcoholMeterFill');

    if (val) val.textContent = ppm;

    const isDrunk = ppm >= 350;
    const isBorderline = ppm >= 200 && ppm < 350;

    if (text) {
      if (isDrunk) {
        text.innerHTML = '<span class="text-danger">⚠️ INTOXICATED (> 350 PPM Limit)</span>';
      } else if (isBorderline) {
        text.innerHTML = '<span class="text-amber">⚠️ Borderline Level</span>';
      } else {
        text.textContent = 'Sober (Limit: 350 PPM)';
      }
    }

    if (fill) {
      const pct = Math.min(100, Math.max(5, (ppm / 600) * 100));
      fill.style.width = `${pct}%`;
      fill.className = `kpi-meter-fill ${isDrunk ? 'danger' : isBorderline ? 'warning' : 'safe'}`;
    }
  }

  updateDrowsinessCard(isDrowsy, isEyeClosed) {
    const val = document.getElementById('drowsyStatusVal');
    const sub = document.getElementById('drowsySubText');
    const bar = document.getElementById('drowsyIndicatorBar');

    if (val) {
      val.textContent = isDrowsy ? 'DROWSY!' : isEyeClosed ? 'EYES CLOSED' : 'ALERT';
      val.className = isDrowsy ? 'kpi-main-val text-danger' : isEyeClosed ? 'kpi-main-val text-amber' : 'kpi-main-val';
    }

    if (sub) {
      sub.textContent = isDrowsy
        ? 'Prolonged eye closure > 1.8s'
        : isEyeClosed ? 'Blinking / Micro-sleep' : 'Eye closure: Normal';
    }

    if (bar) {
      bar.className = `kpi-indicator-bar ${isDrowsy ? 'danger' : isEyeClosed ? 'warning' : 'safe'}`;
    }
  }

  updateIgnitionCard(isArmed) {
    const val = document.getElementById('ignitionStatusVal');
    const sub = document.getElementById('ignitionSubText');
    const bar = document.getElementById('ignitionIndicatorBar');
    const card = document.getElementById('cardIgnition');
    const engineBtn = document.getElementById('engineStartBtn');
    const feedback = document.getElementById('engineFeedbackHint');

    if (val) {
      val.textContent = isArmed ? 'ARMED' : 'LOCKED';
      val.className = isArmed ? 'kpi-main-val text-success' : 'kpi-main-val text-danger';
    }

    if (sub) {
      sub.textContent = isArmed ? 'Engine starter unlocked' : 'Ignition cut off by relay';
    }

    if (bar) {
      bar.className = `kpi-indicator-bar ${isArmed ? 'armed' : 'danger'}`;
    }

    if (card) {
      card.classList.toggle('locked', !isArmed);
    }

    if (engineBtn) {
      engineBtn.className = `btn-engine-start ${isArmed ? 'ready' : 'locked'}`;
    }

    if (feedback) {
      if (isArmed) {
        feedback.innerHTML = '<span class="text-success">System safe. Press to test starter.</span>';
      } else {
        feedback.innerHTML = '<span class="text-danger">Ignition relay open. Start disabled.</span>';
      }
    }
  }

  updateDigitalTwinVisuals() {
    // 1. HUD Callout values
    const gForceVal = document.getElementById('gForceHudVal');
    const eyeVal = document.getElementById('eyeSensorHudVal');
    const alcoholVal = document.getElementById('alcoholHudVal');
    const strapVal = document.getElementById('strapHudVal');

    if (gForceVal) gForceVal.textContent = `${this.telemetry.gForce.toFixed(2)} G`;
    if (eyeVal) {
      eyeVal.textContent = this.telemetry.isEyeClosed ? 'CLOSED' : 'OPEN';
      eyeVal.style.color = this.telemetry.isEyeClosed ? 'var(--neon-red)' : 'var(--neon-green)';
    }
    if (alcoholVal) {
      alcoholVal.textContent = `${this.telemetry.alcoholPpm} PPM`;
      alcoholVal.style.color = this.telemetry.alcoholPpm >= 350 ? 'var(--neon-red)' : 'var(--text-primary)';
    }
    if (strapVal) {
      strapVal.textContent = this.telemetry.isHelmetWorn ? 'LOCKED' : 'RELEASED';
      strapVal.style.color = this.telemetry.isHelmetWorn ? 'var(--neon-green)' : 'var(--neon-red)';
    }

    // 2. SVG Sensor Fill Updates
    const svgSensorEye = document.getElementById('svgSensorEye');
    const svgLedAlcohol = document.getElementById('svgLedAlcohol');
    const svgSensorStrap = document.getElementById('svgSensorStrap');

    if (svgSensorEye) {
      svgSensorEye.setAttribute('fill', this.telemetry.isEyeClosed ? '#ef4444' : '#00ffcc');
    }
    if (svgLedAlcohol) {
      svgLedAlcohol.setAttribute('fill', this.telemetry.alcoholPpm >= 350 ? '#ef4444' : '#22c55e');
    }
    if (svgSensorStrap) {
      svgSensorStrap.setAttribute('fill', this.telemetry.isHelmetWorn ? '#22c55e' : '#ef4444');
    }

    // 3. Horizon Tilt Gauge
    const horizonLine = document.getElementById('horizonLine');
    const rollAngleVal = document.getElementById('rollAngleVal');
    const pitchAngleVal = document.getElementById('pitchAngleVal');

    if (horizonLine) {
      const rollDeg = this.telemetry.roll || 0;
      const pitchOffset = Math.min(25, Math.max(-25, (this.telemetry.pitch || 0) * 1.5));
      horizonLine.style.transform = `translateY(${pitchOffset}px) rotate(${rollDeg}deg)`;
      horizonLine.style.background = Math.abs(rollDeg) > 45 ? 'var(--neon-red)' : 'var(--neon-cyan)';
    }

    if (rollAngleVal) rollAngleVal.textContent = `${(this.telemetry.roll || 0).toFixed(1)}°`;
    if (pitchAngleVal) pitchAngleVal.textContent = `${(this.telemetry.pitch || 0).toFixed(1)}°`;
  }

  // -----------------------------------------------------------------------------------------
  // 3. LEAFLET.JS INTERACTIVE GPS MAP
  // -----------------------------------------------------------------------------------------
  initMap() {
    const lat = this.telemetry.latitude || 17.385044;
    const lng = this.telemetry.longitude || 78.486671;

    // Dark-themed tiles from CartoDB
    this.map = L.map('gpsMap', {
      zoomControl: false,
      attributionControl: false
    }).setView([lat, lng], 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(this.map);

    // Custom Motorcycle Marker
    const bikeIcon = L.divIcon({
      className: 'custom-bike-marker',
      html: `
        <div style="
          width: 38px; height: 38px; border-radius: 50%;
          background: #0284c7; border: 2px solid #00f2fe;
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 16px; box-shadow: 0 0 15px #00f2fe;
        ">
          <i class="fa-solid fa-motorcycle"></i>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    this.riderMarker = L.marker([lat, lng], { icon: bikeIcon }).addTo(this.map);
    this.routeHistory.push([lat, lng]);

    // Polyline trail
    this.routePolyline = L.polyline(this.routeHistory, {
      color: '#00f2fe',
      weight: 3,
      opacity: 0.7,
      dashArray: '4, 8'
    }).addTo(this.map);
  }

  updateMapPosition(lat, lng, speed) {
    if (!this.map || !this.riderMarker) return;

    this.riderMarker.setLatLng([lat, lng]);
    this.routeHistory.push([lat, lng]);
    if (this.routeHistory.length > 50) this.routeHistory.shift();
    this.routePolyline.setLatLngs(this.routeHistory);

    // Map Meta
    const mapSpeed = document.getElementById('mapSpeed');
    const mapAlt = document.getElementById('mapAlt');
    const coordsText = document.getElementById('coordsText');
    const mapsLink = document.getElementById('googleMapsLink');

    if (mapSpeed) mapSpeed.textContent = Number(speed || 0).toFixed(1);
    if (mapAlt) mapAlt.textContent = this.telemetry.altitudeMeters || 536;
    if (coordsText) coordsText.textContent = `${lat.toFixed(6)}° N, ${lng.toFixed(6)}° E`;
    if (mapsLink) mapsLink.href = `https://www.google.com/maps?q=${lat},${lng}`;

    // If state is CRASH_COUNTDOWN or ALERT_DISPATCHED, center and show beacon
    if (this.telemetry.state === 'CRASH_COUNTDOWN' || this.telemetry.state === 'ALERT_DISPATCHED') {
      this.map.panTo([lat, lng]);
      this.showCrashBeacon(lat, lng);
    } else {
      this.removeCrashBeacon();
    }
  }

  showCrashBeacon(lat, lng) {
    if (!this.crashBeaconMarker) {
      const crashIcon = L.divIcon({
        className: 'pulse-marker',
        html: `
          <div style="
            width: 24px; height: 24px; border-radius: 50%;
            background: #ef4444; border: 2px solid #fff;
            box-shadow: 0 0 20px #ef4444;
          "></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      this.crashBeaconMarker = L.marker([lat, lng], { icon: crashIcon }).addTo(this.map);
    } else {
      this.crashBeaconMarker.setLatLng([lat, lng]);
    }
  }

  removeCrashBeacon() {
    if (this.crashBeaconMarker && this.map) {
      this.map.removeLayer(this.crashBeaconMarker);
      this.crashBeaconMarker = null;
    }
  }

  // -----------------------------------------------------------------------------------------
  // 4. CHART.JS REAL-TIME TELEMETRY CHARTS
  // -----------------------------------------------------------------------------------------
  initChart() {
    const ctx = document.getElementById('telemetryChart');
    if (!ctx) return;

    const initialLabels = Array.from({ length: this.chartMaxPoints }, (_, i) => `-${(this.chartMaxPoints - i) * 2}s`);
    const zeros = Array(this.chartMaxPoints).fill(0);

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: initialLabels,
        datasets: [
          {
            label: 'Impact Force (G)',
            data: Array(this.chartMaxPoints).fill(1.0),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'yGForce'
          },
          {
            label: 'Alcohol (PPM)',
            data: Array(this.chartMaxPoints).fill(45),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.05)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'yPpm'
          },
          {
            label: 'Speed (km/h)',
            data: Array(this.chartMaxPoints).fill(40),
            borderColor: '#00f2fe',
            backgroundColor: 'rgba(0, 242, 254, 0.05)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'ySpeed'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
          },
          yGForce: {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 6,
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#ef4444', font: { family: 'JetBrains Mono', size: 10 } }
          },
          yPpm: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 700,
            grid: { display: false },
            ticks: { color: '#f59e0b', font: { family: 'JetBrains Mono', size: 10 } }
          },
          ySpeed: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            grid: { display: false },
            ticks: { display: false }
          }
        }
      }
    });
  }

  updateChart(gForce, ppm, speed) {
    if (!this.chart) return;

    const datasets = this.chart.data.datasets;
    
    // Push new values
    datasets[0].data.push(gForce);
    datasets[1].data.push(ppm);
    datasets[2].data.push(speed);

    // Keep fixed window length
    if (datasets[0].data.length > this.chartMaxPoints) {
      datasets[0].data.shift();
      datasets[1].data.shift();
      datasets[2].data.shift();
    }

    this.chart.update('none'); // Fast update without full redraw
  }

  // -----------------------------------------------------------------------------------------
  // 5. TELEGRAM INTEGRATION CONTROLS
  // -----------------------------------------------------------------------------------------
  initTelegramControls() {
    const btnSave = document.getElementById('btnSaveTgConfig');
    const btnTest = document.getElementById('btnTestTgAlert');
    const tokenInput = document.getElementById('tgBotTokenInput');
    const chatIdInput = document.getElementById('tgChatIdInput');
    const riderInput = document.getElementById('riderNameInput');
    const phoneInput = document.getElementById('emergencyPhoneInput');
    const feedback = document.getElementById('tgTestFeedback');

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/telegram/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: tokenInput ? tokenInput.value : '',
              chatId: chatIdInput ? chatIdInput.value : '',
              riderName: riderInput ? riderInput.value : '',
              contactPhone: phoneInput ? phoneInput.value : ''
            })
          });
          const data = await res.json();
          if (data.success) {
            this.showFeedback(feedback, 'Configuration saved successfully!', 'success');
            this.fetchTelegramConfig();
          }
        } catch (e) {
          this.showFeedback(feedback, 'Failed to save config: ' + e.message, 'error');
        }
      });
    }

    if (btnTest) {
      btnTest.addEventListener('click', async () => {
        const token = tokenInput ? tokenInput.value : '';
        const chatId = chatIdInput ? chatIdInput.value : '';

        if (!token || !chatId) {
          this.showFeedback(feedback, 'Please enter both Bot Token and Chat ID to send a test.', 'error');
          return;
        }

        btnTest.disabled = true;
        btnTest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Alert...';

        try {
          const res = await fetch('/api/telegram/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chatId })
          });
          const data = await res.json();
          
          if (data.success) {
            this.showFeedback(feedback, '✅ Test Alert & Live GPS Location sent to your Telegram!', 'success');
            window.safeRiderAudio.playTone(800, 'sine', 150, 0.2);
          } else {
            this.showFeedback(feedback, '❌ Delivery failed: ' + (data.error || 'Check Bot Token & Chat ID'), 'error');
          }
        } catch (e) {
          this.showFeedback(feedback, 'Network error sending test: ' + e.message, 'error');
        } finally {
          btnTest.disabled = false;
          btnTest.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Alert to Telegram';
        }
      });
    }
  }

  showFeedback(el, msg, type) {
    if (!el) return;
    el.style.display = 'block';
    el.className = `tg-test-feedback ${type}`;
    el.textContent = msg;
    setTimeout(() => {
      el.style.display = 'none';
    }, 6000);
  }

  async fetchTelegramConfig() {
    try {
      const res = await fetch('/api/telegram/config');
      const data = await res.json();
      const badge = document.getElementById('tgConfigBadge');
      const tokenInput = document.getElementById('tgBotTokenInput');
      const chatIdInput = document.getElementById('tgChatIdInput');

      if (data.hasToken && tokenInput && !tokenInput.value) {
        tokenInput.placeholder = data.maskedToken || 'Token saved in system';
      }
      if (data.chatId && chatIdInput && !chatIdInput.value) {
        chatIdInput.value = data.chatId;
      }
      if (badge) {
        badge.textContent = data.hasToken && data.chatId ? 'LINKED' : 'UNLINKED';
        badge.className = data.hasToken && data.chatId ? 'badge-active' : 'badge-live';
      }
    } catch (e) {
      console.warn('Failed to fetch Telegram config:', e);
    }
  }

  // -----------------------------------------------------------------------------------------
  // 6. BLACK BOX INCIDENT LOGS
  // -----------------------------------------------------------------------------------------
  initLogControls() {
    const btnClear = document.getElementById('btnClearLogs');
    const btnExport = document.getElementById('btnExportLogs');

    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear the Black Box incident logs?')) {
          await fetch('/api/incidents', { method: 'DELETE' });
          this.fetchIncidents();
        }
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/incidents');
          const data = await res.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `SafeRider_Incidents_${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          alert('Export error: ' + e.message);
        }
      });
    }
  }

  async fetchIncidents() {
    try {
      const res = await fetch('/api/incidents');
      const data = await res.json();
      this.renderIncidents(data);
    } catch (e) {
      console.warn('Failed to fetch incidents:', e);
    }
  }

  renderIncidents(list) {
    const tbody = document.getElementById('incidentTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
            No incidents recorded. Helmet system monitoring active.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const sevClass = item.severity === 'CRITICAL' ? 'critical' : item.severity === 'WARNING' ? 'warning' : 'info';
      const typeLabel = item.type.replace(/_/g, ' ');
      const statusBadge = item.status === 'DISPATCHED'
        ? '<span class="text-danger">DISPATCHED (TG)</span>'
        : item.status === 'CANCELLED_BY_RIDER'
        ? '<span class="text-success">CANCELLED (SAFE)</span>'
        : '<span class="text-amber">COUNTDOWN</span>';

      return `
        <tr>
          <td><b>${typeLabel}</b></td>
          <td><span class="badge-incident ${sevClass}">${item.severity}</span></td>
          <td>${item.gForce ? item.gForce.toFixed(2) + ' G' : ''} / ${item.alcoholPpm ? item.alcoholPpm + ' PPM' : 'Normal'}</td>
          <td><a href="https://www.google.com/maps?q=${item.latitude},${item.longitude}" target="_blank" style="color: var(--neon-cyan); text-decoration: none;">${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}</a></td>
          <td>${timeStr}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  initAudioToggle() {
    const btn = document.getElementById('audioToggleBtn');
    const icon = document.getElementById('audioIcon');
    if (!btn || !icon) return;

    btn.addEventListener('click', () => {
      const isMuted = !window.safeRiderAudio.isMuted;
      window.safeRiderAudio.setMuted(isMuted);
      icon.className = isMuted ? 'fa-solid fa-volume-xmark text-muted' : 'fa-solid fa-volume-high text-cyan';
      btn.title = isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects';
    });
  }
}

// Instantiate on DOM Load
window.addEventListener('DOMContentLoaded', () => {
  window.safeRiderApp = new SafeRiderApp();
});
