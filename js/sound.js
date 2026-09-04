/*
 * Sound: short synthesised cues for correct/wrong answers, via the Web
 * Audio API - same approach as the Millionaire app's sound cues, not
 * ripped game audio (keeps this clear of any Pokemon sound assets).
 * On/off preference stored in localStorage, default on.
 */
window.Sound = (function () {
  'use strict';

  var KEY = 'pokedex.sound.v1';
  var ctx = null;

  function enabled() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw === null ? true : raw === 'on';
    } catch (e) {
      return true;
    }
  }

  function setEnabled(on) {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (e) { /* ignore */ }
  }

  function ensureContext() {
    if (!ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(c, freq, startTime, duration, waveType, peakGain) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = waveType;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function correct() {
    if (!enabled()) return;
    var c = ensureContext();
    if (!c) return;
    var t = c.currentTime;
    tone(c, 523.25, t, 0.12, 'square', 0.12);       // C5
    tone(c, 783.99, t + 0.1, 0.18, 'square', 0.12); // G5
  }

  function wrong() {
    if (!enabled()) return;
    var c = ensureContext();
    if (!c) return;
    tone(c, 220, c.currentTime, 0.22, 'sawtooth', 0.08); // low buzz
  }

  return { enabled: enabled, setEnabled: setEnabled, correct: correct, wrong: wrong };
})();
