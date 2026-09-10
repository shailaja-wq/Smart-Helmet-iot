/**
 * SafeRider IoT - Hardware & Digital Twin Simulator Logic
 */

class SafeRiderSimulator {
  constructor(app) {
    this.app = app;
    this.countdownTimer = null;
    this.remainingSeconds = 15;
    this.totalGraceSeconds = 15;
    this.activeIncidentId = null;

    this.initEventListeners();
  }

  initEventListeners() {
    // Helmet Worn Toggle
    const simWearToggle = document.getElementById('simWearToggle');
    if (simWearToggle) {
      simWearToggle.addEventListener('click', () => {
        const isWorn = !this.app.telemetry.isHelmetWorn;
        this.app.sendTelemetryUpdate({ isHelmetWorn: isWorn });
        simWearToggle.classList.toggle('active', isWorn);
        simWearToggle.querySelector('span').textContent = isWorn ? 'Helmet Worn' : 'Helmet Removed';
        
        if (!isWorn) {
          window.safeRiderAudio.playTone(300, 'sine', 150, 0.2);
        } else {
          window.safeRiderAudio.playTone(600, 'sine', 150, 0.2);
        }
      });
    }

    // Alcohol Slider
    const simAlcoholSlider = document.getElementById('simAlcoholSlider');
    const simAlcoholDisplay = document.getElementById('simAlcoholDisplay');
    if (simAlcoholSlider) {
      simAlcoholSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        simAlcoholDisplay.textContent = `${val} PPM`;
        this.handleAlcoholChange(val);
      });
    }

    // Alcohol Presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const ppm = parseInt(btn.dataset.ppm, 10);
        if (simAlcoholSlider) simAlcoholSlider.value = ppm;
        if (simAlcoholDisplay) simAlcoholDisplay.textContent = `${ppm} PPM`;
        this.handleAlcoholChange(ppm);
      });
    });

    // Drowsiness Trigger Button
    const simDrowsyTriggerBtn = document.getElementById('simDrowsyTriggerBtn');
    if (simDrowsyTriggerBtn) {
      simDrowsyTriggerBtn.addEventListener('click', () => {
        this.simulateDrowsinessEvent();
      });
    }

    // Crash Simulation Presets
    const btnSimBump = document.getElementById('btnSimBump');
    if (btnSimBump) {
      btnSimBump.addEventListener('click', () => {
        // Minor bump: 1.4 G, 3° tilt -> below threshold, should not trigger countdown
        this.simulateImpact(1.4, 3.2, 1.8, 'Road Pothole / Speed Bump', false);
      });
    }

    const btnSimSevereCrash = document.getElementById('btnSimSevereCrash');
    if (btnSimSevereCrash) {
      btnSimSevereCrash.addEventListener('click', () => {
        // Severe crash: 4.8 G, 75° tilt -> starts 15s countdown
        this.simulateImpact(4.85, 76.5, -34.2, 'High-Impact Vehicle Collision', true);
      });
    }

    const btnSimSkid = document.getElementById('btnSimSkid');
    if (btnSimSkid) {
      btnSimSkid.addEventListener('click', () => {
        // Skid fall: 2.9 G, 82° tilt -> starts 15s countdown
        this.simulateImpact(2.95, 82.0, 15.0, 'Motorcycle Skid & Sideways Fall', true);
      });
    }

    // Manual SOS Button
    const simSosBtn = document.getElementById('simSosBtn');
    if (simSosBtn) {
      simSosBtn.addEventListener('click', () => {
        this.triggerManualSos();
      });
    }

    // Emergency Modal Cancel Button ("I AM OK")
    const cancelEmergencyBtn = document.getElementById('cancelEmergencyBtn');
    if (cancelEmergencyBtn) {
      cancelEmergencyBtn.addEventListener('click', () => {
        this.cancelEmergencyCountdown();
      });
    }

    // Emergency Modal Force Dispatch Button
    const forceDispatchBtn = document.getElementById('forceDispatchBtn');
    if (forceDispatchBtn) {
      forceDispatchBtn.addEventListener('click', () => {
        this.finalizeEmergencyDispatch();
      });
    }

    // Bike Engine Starter Button
    const engineStartBtn = document.getElementById('engineStartBtn');
    if (engineStartBtn) {
      engineStartBtn.addEventListener('click', () => {
        this.handleEngineStartAttempt();
      });
    }
  }

  handleAlcoholChange(ppm) {
    const wasSober = this.app.telemetry.alcoholPpm < 350;
    const isNowDrunk = ppm >= 350;

    this.app.sendTelemetryUpdate({ alcoholPpm: ppm });

    if (wasSober && isNowDrunk) {
      window.safeRiderAudio.playAlcoholWarning();
    }
  }

  simulateDrowsinessEvent() {
    // 1. Set eye closed
    this.app.sendTelemetryUpdate({
      isEyeClosed: true,
      drowsinessDetected: true,
      drowsinessDurationMs: 2200
    });

    // 2. Play warning audio and speech
    window.safeRiderAudio.playDrowsyWakeup();

    // 3. Highlight eye sensor visual on SVG
    const svgSensorEye = document.getElementById('svgSensorEye');
    if (svgSensorEye) {
      svgSensorEye.setAttribute('fill', '#ef4444');
      setTimeout(() => {
        svgSensorEye.setAttribute('fill', '#00ffcc');
      }, 4000);
    }

    // 4. Auto-recover after 4 seconds of wake-up buzzer
    setTimeout(() => {
      this.app.sendTelemetryUpdate({
        isEyeClosed: false,
        drowsinessDetected: false,
        drowsinessDurationMs: 0
      });
    }, 4500);
  }

  async simulateImpact(gForce, roll, pitch, reason, willTriggerEmergency) {
    // 1. Temporarily spike telemetry
    this.app.sendTelemetryUpdate({
      gForce: gForce,
      roll: roll,
      pitch: pitch
    });

    if (willTriggerEmergency) {
      // Must wear helmet to detect rider crash
      if (!this.app.telemetry.isHelmetWorn) {
        alert('Helmet is currently detected as NOT worn. Put on helmet to test crash system.');
        return;
      }

      // Call API to start crash event
      try {
        const res = await fetch('/api/alert/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'ROAD_ACCIDENT',
            severity: 'CRITICAL',
            gForce: gForce,
            roll: roll,
            pitch: pitch,
            details: reason,
            bypassGrace: false
          })
        });
        const data = await res.json();
        if (data.success) {
          this.startGraceCountdown(data.incident);
        }
      } catch (e) {
        console.error('Crash trigger error:', e);
      }
    } else {
      // Harmless bump chime
      window.safeRiderAudio.playTone(280, 'triangle', 120, 0.2);
    }
  }

  async triggerManualSos() {
    try {
      const res = await fetch('/api/alert/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MANUAL_SOS_PANIC',
          severity: 'HIGH_PRIORITY',
          details: 'Rider triggered the manual SOS panic button on helmet strap.',
          bypassGrace: true // Instant dispatch
        })
      });
      const data = await res.json();
      if (data.success) {
        window.safeRiderAudio.playDispatchedSound();
        alert('🚨 Manual SOS Triggered! Emergency notification and live GPS location dispatched to Telegram.');
        this.app.fetchIncidents();
      }
    } catch (e) {
      console.error('SOS trigger error:', e);
    }
  }

  startGraceCountdown(incident) {
    this.activeIncidentId = incident ? incident.id : null;
    this.remainingSeconds = 15;
    this.totalGraceSeconds = 15;

    // Show Modal
    const modal = document.getElementById('emergencyModal');
    const countdownNumber = document.getElementById('countdownSeconds');
    const radialProgress = document.getElementById('radialProgressCircle');

    if (modal) modal.classList.add('active');
    if (countdownNumber) countdownNumber.textContent = this.remainingSeconds;

    // Start siren & speech
    window.safeRiderAudio.startEmergencySiren();

    if (this.countdownTimer) clearInterval(this.countdownTimer);

    // Initial radial state (full circumference = 440)
    if (radialProgress) radialProgress.style.strokeDashoffset = '0';

    this.countdownTimer = setInterval(() => {
      this.remainingSeconds--;
      if (countdownNumber) countdownNumber.textContent = this.remainingSeconds;

      // Animate radial progress ring
      if (radialProgress) {
        const offset = ((15 - this.remainingSeconds) / 15) * 440;
        radialProgress.style.strokeDashoffset = `${offset}`;
      }

      if (this.remainingSeconds <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.finalizeEmergencyDispatch();
      }
    }, 1000);
  }

  async cancelEmergencyCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    const modal = document.getElementById('emergencyModal');
    if (modal) modal.classList.remove('active');

    window.safeRiderAudio.playCancelSound();

    try {
      await fetch('/api/alert/cancel', { method: 'POST' });
      this.app.fetchIncidents();
    } catch (e) {
      console.error('Cancel alert error:', e);
    }
  }

  async finalizeEmergencyDispatch() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    const modal = document.getElementById('emergencyModal');
    if (modal) modal.classList.remove('active');

    window.safeRiderAudio.playDispatchedSound();

    try {
      const res = await fetch('/api/alert/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: this.activeIncidentId })
      });
      const data = await res.json();
      this.app.fetchIncidents();

      // Show temporary notification
      const tgStatus = data.telegramResult && data.telegramResult.message && data.telegramResult.message.success
        ? 'Successfully delivered to your Telegram account!'
        : 'Emergency logged. (Configure Telegram Bot Token & Chat ID in settings to deliver to phone)';

      alert(`🚨 EMERGENCY SOS DISPATCHED!\nLive GPS coordinates & accident telemetry broadcast.\n\nTelegram Status: ${tgStatus}`);
    } catch (e) {
      console.error('Dispatch error:', e);
    }
  }

  handleEngineStartAttempt() {
    const isWorn = this.app.telemetry.isHelmetWorn;
    const isSober = this.app.telemetry.alcoholPpm < 350;
    const engineBtn = document.getElementById('engineStartBtn');
    const feedback = document.getElementById('engineFeedbackHint');

    if (isWorn && isSober) {
      // SUCCESS
      window.safeRiderAudio.playSafeChime();
      if (feedback) {
        feedback.innerHTML = '<span class="text-success">VROOM! Engine ignited successfully. Safe riding!</span>';
      }
      if (engineBtn) {
        engineBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>ENGINE RUNNING</span>';
        setTimeout(() => {
          engineBtn.innerHTML = '<i class="fa-solid fa-power-off"></i> <span>START ENGINE</span>';
        }, 3000);
      }
    } else {
      // DENIED
      window.safeRiderAudio.playAlcoholWarning();
      let reason = '';
      if (!isWorn && !isSober) {
        reason = 'HELMET NOT WORN & HIGH ALCOHOL LEVEL!';
      } else if (!isWorn) {
        reason = 'HELMET NOT DETECTED! Wear helmet to enable ignition.';
      } else {
        reason = 'INTOXICATION DETECTED! Alcohol above safety threshold.';
      }

      if (feedback) {
        feedback.innerHTML = `<span class="text-danger">START BLOCKED: ${reason}</span>`;
      }
    }
  }
}
