// sound.js
// Web Audio synthesis: spin hum, collision, ejection
// Depends on nothing -- pure Web Audio API
// Must call Sound.init() on first user gesture before other methods work.

// ─── Tuning ──────────────────────────────────────────────────────────────────

const SOUND = {
  // Spin hum pitch range (Hz) at spinSpeed 0.0 → 1.0
  HUM_FREQ_MIN:      140,
  HUM_FREQ_MAX:      540,

  // Player top base pitch offset vs CPU (Hz) so the two tones are distinct
  PLAYER_PITCH_OFFSET: 14,

  // Hum volume
  HUM_GAIN_MAX:      0.18,
  HUM_FADE_RATE:     0.004,   // gain step per frame when fading out

  // Flat-tip noise mix ratio (0 = pure osc, 1 = pure noise)
  FLAT_NOISE_MIX:    0.35,

  // Round-tip detune (cents)
  ROUND_DETUNE:      8,

  // Collision
  COL_GAIN_MIN:      0.08,    // gain at normForce 0
  COL_GAIN_MAX:      0.55,    // gain at normForce 1
  COL_FREQ_MIN:      900,     // bandpass center at normForce 0
  COL_FREQ_MAX:      3800,    // bandpass center at normForce 1
  COL_DURATION:      0.09,    // seconds
  COL_Q:             12,      // bandpass Q -- higher = more metallic ring

  // Ejection crack
  EJECT_GAIN:        0.7,
  EJECT_NOISE_DUR:   0.12,    // seconds of noise burst
  EJECT_PITCH_START: 520,     // Hz, pitch-drop oscillator start
  EJECT_PITCH_END:   80,      // Hz, pitch-drop oscillator end
  EJECT_PITCH_DUR:   0.18,    // seconds for pitch drop
};

// ─── Module State ────────────────────────────────────────────────────────────

let _ctx        = null;   // AudioContext
let _masterGain = null;   // master output gain node
let _ready      = false;

// Per-instance hum state keyed by instanceId
// { osc, noiseGain, gainNode, noiseSource, active }
const _hums = {};

// ─── Init ────────────────────────────────────────────────────────────────────

// Call once on first user gesture (click/touch).
function init() {
  if (_ready) return;
  try {
    _ctx        = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 1.0;
    _masterGain.connect(_ctx.destination);
    _ready = true;
  } catch (e) {
    console.warn('Sound: Web Audio not available', e);
  }
}

function _ensureReady() {
  if (!_ready) return false;
  if (_ctx.state === 'suspended') _ctx.resume();
  return true;
}

// ─── Noise Buffer ────────────────────────────────────────────────────────────

// Cached 1-second white noise buffer, reused for all noise sources.
let _noiseBuffer = null;

function _getNoiseBuffer() {
  if (_noiseBuffer) return _noiseBuffer;
  const length = _ctx.sampleRate;
  _noiseBuffer = _ctx.createBuffer(1, length, _ctx.sampleRate);
  const data   = _noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return _noiseBuffer;
}

// ─── Spin Hum ────────────────────────────────────────────────────────────────

// Call when a top is launched. Creates oscillator(s) and connects them.
// Defers until AudioContext is running in case init() was just called.
function startHum(instance) {
  init();  // safe to call multiple times; no-op if already ready
  if (!_ensureReady()) return;
  // Small delay ensures AudioContext is fully running before we create nodes.
  // Necessary when startHum is called on the same tick as init().
  setTimeout(() => {
    if (_ctx.state === 'suspended') {
      _ctx.resume().then(() => _startHumNow(instance));
    } else {
      _startHumNow(instance);
    }
  }, 80);
}

function _startHumNow(instance) {
  if (!_ready) return;

  const id      = _instanceId(instance);
  const tipType = instance.def.tipType;
  const isPlayer = instance.owner === 'player';

  // Clean up any existing hum for this id
  stopHum(instance);

  const gainNode = _ctx.createGain();
  gainNode.gain.value = 0.001;
  const panner = _ctx.createStereoPanner();
  panner.pan.value = isPlayer ? -0.8 : 0.8;
  gainNode.connect(panner);
  panner.connect(_masterGain);

  const humState = { gainNode, panner, active: true };

  if (tipType === 'flat') {
    // Sawtooth oscillator + noise blend
    const osc = _ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = SOUND.HUM_FREQ_MIN + (isPlayer ? SOUND.PLAYER_PITCH_OFFSET : 0);

    // Low-pass the sawtooth to soften it slightly
    const oscFilter = _ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = 1200;
    oscFilter.Q.value = 0.8;

    const oscGain = _ctx.createGain();
    oscGain.gain.value = 1 - SOUND.FLAT_NOISE_MIX;

    osc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(gainNode);

    // Noise source for the rattly component
    const noise      = _ctx.createBufferSource();
    noise.buffer     = _getNoiseBuffer();
    noise.loop       = true;

    const noiseFilter = _ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 600;
    noiseFilter.Q.value = 2.5;

    const noiseGainNode = _ctx.createGain();
    noiseGainNode.gain.value = SOUND.FLAT_NOISE_MIX;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGainNode);
    noiseGainNode.connect(gainNode);

    osc.start();
    noise.start();

    humState.osc          = osc;
    humState.oscFilter    = oscFilter;
    humState.noiseSource  = noise;
    humState.noiseFilter  = noiseFilter;

  } else if (tipType === 'round') {
    // Two slightly detuned sine oscillators for mild beating
    const osc1 = _ctx.createOscillator();
    osc1.type  = 'sine';
    osc1.frequency.value = SOUND.HUM_FREQ_MIN + (isPlayer ? SOUND.PLAYER_PITCH_OFFSET : 0);
    osc1.detune.value    = -SOUND.ROUND_DETUNE / 2;

    const osc2 = _ctx.createOscillator();
    osc2.type  = 'sine';
    osc2.frequency.value = SOUND.HUM_FREQ_MIN + (isPlayer ? SOUND.PLAYER_PITCH_OFFSET : 0);
    osc2.detune.value    = SOUND.ROUND_DETUNE / 2;

    const g1 = _ctx.createGain();
    const g2 = _ctx.createGain();
    g1.gain.value = 0.6;
    g2.gain.value = 0.6;

    osc1.connect(g1); g1.connect(gainNode);
    osc2.connect(g2); g2.connect(gainNode);

    osc1.start();
    osc2.start();

    humState.osc  = osc1;
    humState.osc2 = osc2;

  } else {
    // fine -- pure sine, clean and sustained
    const osc = _ctx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = SOUND.HUM_FREQ_MIN + (isPlayer ? SOUND.PLAYER_PITCH_OFFSET : 0);
    osc.connect(gainNode);
    osc.start();
    humState.osc = osc;
  }

  _hums[id] = humState;
}

// Call every frame while tops are alive. Updates pitch and gain.
function updateHums(instances) {
  if (!_ensureReady()) return;

  for (const instance of instances) {
    const id    = _instanceId(instance);
    const state = _hums[id];
    if (!state || !state.active) continue;

    const spin     = instance.spinSpeed || 0;
    const isPlayer = instance.owner === 'player';
    const baseFreq = SOUND.HUM_FREQ_MIN + (isPlayer ? SOUND.PLAYER_PITCH_OFFSET : 0);
    const freq     = baseFreq + spin * (SOUND.HUM_FREQ_MAX - SOUND.HUM_FREQ_MIN);
    const targetGain = instance.alive
      ? spin * SOUND.HUM_GAIN_MAX
      : 0;

    // Update oscillator frequency
    if (state.osc) {
      state.osc.frequency.setTargetAtTime(freq, _ctx.currentTime, 0.05);
    }
    if (state.osc2) {
      state.osc2.frequency.setTargetAtTime(freq, _ctx.currentTime, 0.05);
    }
    // Flat: also track noise filter center frequency
    if (state.noiseFilter) {
      const noiseFreq = 300 + spin * 500;
      state.noiseFilter.frequency.setTargetAtTime(noiseFreq, _ctx.currentTime, 0.08);
    }

    // Gain -- use setTargetAtTime for smooth tracking
    state.gainNode.gain.setTargetAtTime(targetGain, _ctx.currentTime, 0.04);

    // Clean up fully silent dead tops
    if (!instance.alive && spin <= 0 && state.gainNode.gain.value < 0.001) {
      stopHum(instance);
    }
  }
}

// Stop and disconnect all nodes for this instance.
function stopHum(instance) {
  const id    = _instanceId(instance);
  const state = _hums[id];
  if (!state) return;

  state.active = false;
  try {
    if (state.osc)         { state.osc.stop();         state.osc.disconnect(); }
    if (state.osc2)        { state.osc2.stop();        state.osc2.disconnect(); }
    if (state.noiseSource) { state.noiseSource.stop(); state.noiseSource.disconnect(); }
    if (state.gainNode)    state.gainNode.disconnect();
    if (state.panner)      state.panner.disconnect();
  } catch (e) {
    // Ignore stop-before-start errors
  }
  delete _hums[id];
}

// Stop all active hums -- call when match ends.
function stopAllHums() {
  Object.keys(_hums).forEach(id => {
    const state = _hums[id];
    if (!state) return;
    state.active = false;
    try {
      if (state.osc)         { state.osc.stop();         state.osc.disconnect(); }
      if (state.osc2)        { state.osc2.stop();        state.osc2.disconnect(); }
      if (state.noiseSource) { state.noiseSource.stop(); state.noiseSource.disconnect(); }
      if (state.gainNode)    state.gainNode.disconnect();
      if (state.panner)      state.panner.disconnect();
    } catch (e) {}
    delete _hums[id];
  });
}

// normForce: 0.0–1.0 (already normalized in main.js as force/10 clamped to 1)
function playCollision(normForce) {
  if (!_ensureReady()) return;

  const f    = Math.max(0, Math.min(1, normForce));
  const now  = _ctx.currentTime;
  const dur  = SOUND.COL_DURATION;

  // White noise burst
  const noise   = _ctx.createBufferSource();
  noise.buffer  = _getNoiseBuffer();

  // Bandpass filter -- center freq and gain scale with force
  const filter  = _ctx.createBiquadFilter();
  filter.type   = 'bandpass';
  filter.frequency.value = SOUND.COL_FREQ_MIN + f * (SOUND.COL_FREQ_MAX - SOUND.COL_FREQ_MIN);
  filter.Q.value         = SOUND.COL_Q;

  const gainNode = _ctx.createGain();
  const peakGain = SOUND.COL_GAIN_MIN + f * (SOUND.COL_GAIN_MAX - SOUND.COL_GAIN_MIN);
  gainNode.gain.setValueAtTime(peakGain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(_masterGain);

  noise.start(now);
  noise.stop(now + dur);
}

// ─── Ejection ────────────────────────────────────────────────────────────────

function playEjection() {
  if (!_ensureReady()) return;

  const now = _ctx.currentTime;

  // Layer 1: noise burst (the impact transient)
  const noise      = _ctx.createBufferSource();
  noise.buffer     = _getNoiseBuffer();

  const noiseFilter = _ctx.createBiquadFilter();
  noiseFilter.type  = 'highpass';
  noiseFilter.frequency.value = 1800;

  const noiseGain = _ctx.createGain();
  noiseGain.gain.setValueAtTime(SOUND.EJECT_GAIN, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + SOUND.EJECT_NOISE_DUR);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(_masterGain);

  // Layer 2: pitch-drop oscillator (the "crack" body)
  const osc  = _ctx.createOscillator();
  osc.type   = 'sine';
  osc.frequency.setValueAtTime(SOUND.EJECT_PITCH_START, now);
  osc.frequency.exponentialRampToValueAtTime(SOUND.EJECT_PITCH_END, now + SOUND.EJECT_PITCH_DUR);

  const oscGain = _ctx.createGain();
  oscGain.gain.setValueAtTime(SOUND.EJECT_GAIN * 0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + SOUND.EJECT_PITCH_DUR);

  osc.connect(oscGain);
  oscGain.connect(_masterGain);

  noise.start(now);
  noise.stop(now + SOUND.EJECT_NOISE_DUR);
  osc.start(now);
  osc.stop(now + SOUND.EJECT_PITCH_DUR);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _instanceId(instance) {
  return `${instance.owner}_${instance.defId}`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.Sound = {
    init,
    startHum,
    updateHums,
    stopHum,
    stopAllHums,
    playCollision,
    playEjection,
  };
}