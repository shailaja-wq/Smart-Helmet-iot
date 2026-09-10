/**
 * SafeRider IoT - Web Audio & Voice Synthesizer
 * Provides realistic hardware buzzer tones, sirens, and speech synthesis alerts.
 */

class SafeRiderAudio {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.activeSirenOsc = null;
    this.activeSirenGain = null;
    this.sirenInterval = null;
  }

  initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.isMuted) {
      this.stopSiren();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
  }

  playTone(freq = 880, type = 'sine', durationMs = 200, volume = 0.25) {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + durationMs / 1000);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  playSafeChime() {
    if (this.isMuted) return;
    this.playTone(523.25, 'sine', 120, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 'sine', 120, 0.15), 120); // E5
    setTimeout(() => this.playTone(783.99, 'sine', 220, 0.2), 240); // G5
  }

  playDrowsyWakeup() {
    if (this.isMuted) return;
    // Rapid aggressive high-pitch beeps
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        this.playTone(2400, 'square', 80, 0.35);
      }, i * 140);
    }
    this.speak('Wake up! Drowsiness detected. Please pull over safely.');
  }

  playAlcoholWarning() {
    if (this.isMuted) return;
    this.playTone(400, 'sawtooth', 250, 0.3);
    setTimeout(() => this.playTone(300, 'sawtooth', 350, 0.35), 250);
    this.speak('Warning! High alcohol level detected. Bike engine ignition is locked.');
  }

  startEmergencySiren() {
    if (this.isMuted) return;
    this.stopSiren();
    this.initContext();
    if (!this.audioCtx) return;

    let high = false;
    this.sirenInterval = setInterval(() => {
      if (this.isMuted) return;
      this.playTone(high ? 950 : 650, 'sawtooth', 280, 0.3);
      high = !high;
    }, 320);

    this.speak('Emergency! Severe crash impact detected. Emergency alert counting down.');
  }

  stopSiren() {
    if (this.sirenInterval) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }
  }

  playCancelSound() {
    this.stopSiren();
    if (this.isMuted) return;
    this.playTone(783.99, 'sine', 150, 0.2);
    setTimeout(() => this.playTone(1046.5, 'sine', 250, 0.25), 150);
    this.speak('Emergency alert cancelled. Rider is confirmed safe.');
  }

  playDispatchedSound() {
    this.stopSiren();
    if (this.isMuted) return;
    this.playTone(440, 'triangle', 200, 0.3);
    setTimeout(() => this.playTone(880, 'triangle', 400, 0.35), 200);
    this.speak('Emergency SOS dispatched to linked Telegram with live GPS coordinates.');
  }

  speak(text) {
    if (this.isMuted) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // Stop prior speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 0.85;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }
}

// Global Audio Instance
window.safeRiderAudio = new SafeRiderAudio();
