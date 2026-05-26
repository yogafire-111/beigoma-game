// tops.js
// Top definitions, stats, drawing functions
// No dependencies on other game modules

// ─── Top Definitions ────────────────────────────────────────────────────────

const TOP_DEFS = {
  nomaru: {
    id:          'nomaru',
    hiragana:    'のーまる',
    color:       '#C0C0C0',   // silver
    colorDim:    '#888888',
    profile:     'hexagon',
    tipType:     'round',
    spinDuration: 40,         // seconds at ideal conditions
    impactForce:  1.0,
    deflection:   0.5,
    drift:        0.5,
    stability:    0.6,
    mass:         1.0,
    radius:       22,         // canvas pixels
  },

  riki: {
    id:          'riki',
    hiragana:    'りき',
    color:       '#1a2744',   // dark navy
    colorDim:    '#0d1422',
    profile:     'hexagon',
    tipType:     'fine',
    spinDuration: 60,
    impactForce:  0.8,
    deflection:   0.3,
    drift:        0.3,
    stability:    0.9,
    mass:         0.8,
    radius:       20,
  },

  maru: {
    id:          'maru',
    hiragana:    'まる',
    color:       '#9DC416',   // yellow-green
    colorDim:    '#5a7a0a',
    profile:     'circle',
    tipType:     'fine',
    spinDuration: 50,
    impactForce:  0.6,
    deflection:   0.8,
    drift:        0.4,
    stability:    0.7,
    mass:         0.7,
    radius:       18,
  },

  hajiki: {
    id:          'hajiki',
    hiragana:    'はじき',
    color:       '#CC2200',   // red
    colorDim:    '#7a1500',
    profile:     'hexagon',
    tipType:     'flat',
    spinDuration: 25,
    impactForce:  1.5,
    deflection:   0.6,
    drift:        0.9,
    stability:    0.35,
    mass:         0.75,
    radius:       20,
  },
};

// Order for UI display
const TOP_ORDER = ['nomaru', 'riki', 'maru', 'hajiki'];

// ─── Alignment ──────────────────────────────────────────────────────────────

// Returns a random tip-to-CoM alignment float in [0.8, 1.0]
// 1.0 = perfect, lower = more wobble and faster spin decay
function randomAlignment() {
  return 0.8 + Math.random() * 0.2;
}

// ─── Top Instance Factory ───────────────────────────────────────────────────

// Creates a live top instance from a definition.
// owner: 'player' | 'cpu'
function createTopInstance(defId, owner) {
  const def = TOP_DEFS[defId];
  if (!def) throw new Error(`Unknown top id: ${defId}`);

  return {
    // identity
    defId,
    owner,
    def,                          // reference to static def

    // physics state (populated by physics.js when body is created)
    body:        null,            // Matter.js body
    spinSpeed:   0,               // current spin rate (rad/s equivalent, 0–1 normalized)
    angle:       0,               // current visual rotation (radians)
    tilt:        0,               // 0 = upright, 1 = fallen (for visual wobble)
    sideContact: false,           // true when sides are rubbing canvas

    // alignment (randomized at match start)
    alignment:   randomAlignment(),

    // match tracking
    hasContacted: false,          // has this top touched an opponent?
    alive:        true,           // false once spin < threshold and falling
    opacity:      1.0,            // for fade-out

    // launch state
    launched:    false,
  };
}

// ─── Drawing ────────────────────────────────────────────────────────────────

// Draw a hexagon path centered at (0,0) with given radius.
// ctx should already be translated/rotated to top center.
function hexPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0
      ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

// Draw ribbed lines pattern for りき (riki)
function drawRikiRibs(ctx, r, angle) {
  ctx.save();
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  const ribCount = 6;
  for (let i = 0; i < ribCount; i++) {
    const a = (Math.PI / ribCount) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

// Draw slash marks pattern for はじき (hajiki)
function drawHajikiSlashes(ctx, r, angle) {
  ctx.save();
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(255,220,200,0.35)';
  ctx.lineWidth = 2;
  const slashes = [
    [-r * 0.5,  r * 0.15,  r * 0.1,  -r * 0.55],
    [ r * 0.1,  r * 0.55,  r * 0.55, -r * 0.1],
    [-r * 0.15, -r * 0.4,  r * 0.4,   r * 0.15],
  ];
  slashes.forEach(([x1, y1, x2, y2]) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.restore();
}

// Draw radial tick marks on rim (spin indicator)
// tickPhase: driven by accumulated rotation so ticks appear to spin
function drawRimTicks(ctx, r, tickPhase, spinSpeed) {
  const tickCount = 12;
  const alpha = 0.3 + spinSpeed * 0.5; // more visible when spinning fast
  ctx.save();
  ctx.rotate(tickPhase);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < tickCount; i++) {
    const a = (Math.PI * 2 / tickCount) * i;
    const inner = r * 0.78;
    const outer = r * 0.96;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

// Draw motion blur ring (spin indicator)
// blurAlpha driven by spinSpeed
function drawSpinBlur(ctx, r, spinSpeed) {
  if (spinSpeed < 0.15) return;
  const alpha = Math.min(spinSpeed * 0.45, 0.35);
  const grad = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 0.97);
  grad.addColorStop(0,   `rgba(255,255,255,0)`);
  grad.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(1,   `rgba(255,255,255,0)`);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

// Draw shadow at base (depth cue)
function drawShadow(ctx, r) {
  const grad = ctx.createRadialGradient(3, 4, r * 0.1, 3, 4, r * 1.1);
  grad.addColorStop(0,   'rgba(0,0,0,0.28)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(3, 4, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

// Tilt indicator ring -- shown during launch drag
// tiltAmount: 0 (flat) to 1 (very steep / will fall over)
function drawTiltRing(ctx, r, tiltAmount) {
  const ringR = r + 8;
  // Color shifts green -> yellow -> red with tilt
  const red   = Math.min(255, Math.round(tiltAmount * 2 * 255));
  const green = Math.min(255, Math.round((1 - tiltAmount) * 2 * 255));
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${red},${green},40,0.85)`;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Main draw function for a top instance.
// Call with ctx already translated to top's canvas position.
// instance: top instance object
// tickPhase: accumulated rotation angle (drives rim ticks visual)
// showTilt: bool -- show tilt ring (during launch drag)
// tiltAmount: 0–1
function drawTop(ctx, instance, tickPhase, showTilt, tiltAmount) {
  const { def, spinSpeed, angle, tilt, opacity } = instance;
  const r = def.radius;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Shadow
  drawShadow(ctx, r);

  // Wobble skew: as tilt increases, squash the top slightly
  if (tilt > 0) {
    const skew = tilt * 0.25;
    ctx.transform(1, 0, skew, 1 - tilt * 0.1, 0, 0);
  }

  // Rotate to current angle
  ctx.rotate(angle);

  // Body fill
  if (def.profile === 'hexagon') {
    hexPath(ctx, r);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }

  // Radial gradient for depth
  const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
  bodyGrad.addColorStop(0, lighten(def.color, 0.35));
  bodyGrad.addColorStop(1, def.color);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Edge stroke
  ctx.strokeStyle = darken(def.color, 0.3);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pattern overlay
  if (def.id === 'riki')   drawRikiRibs(ctx, r, 0);
  if (def.id === 'hajiki') drawHajikiSlashes(ctx, r, 0);

  ctx.restore();
  ctx.save();
  ctx.globalAlpha = opacity;

  // Spin blur (not rotated with body)
  drawSpinBlur(ctx, r, spinSpeed);

  // Rim ticks
  drawRimTicks(ctx, r, tickPhase, spinSpeed);

  // Tilt indicator ring (during launch)
  if (showTilt) {
    drawTiltRing(ctx, r, tiltAmount);
  }

  ctx.restore();
}

// ─── Three-View Display ──────────────────────────────────────────────────────
// Draws top/front/side schematic for the selection panel.
// Returns nothing; draws onto provided canvas element directly.

function drawThreeView(canvas, defId) {
  const def = TOP_DEFS[defId];
  if (!def) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const panelW = w / 3;
  const cx = panelW / 2;

  // Labels
  ctx.font = '10px monospace';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText('上',   cx,            14);
  ctx.fillText('前',   cx + panelW,   14);
  ctx.fillText('横',   cx + panelW*2, 14);

  // ── Top view (birds eye) ──
  ctx.save();
  ctx.translate(cx, h / 2 + 4);
  const r = def.radius;
  if (def.profile === 'hexagon') {
    hexPath(ctx, r);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.strokeStyle = darken(def.color, 0.35);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // ── Front view (silhouette) ──
  ctx.save();
  ctx.translate(cx + panelW, h / 2 + 4);
  drawSideProfile(ctx, def, false);
  ctx.restore();

  // ── Side view ──
  ctx.save();
  ctx.translate(cx + panelW * 2, h / 2 + 4);
  drawSideProfile(ctx, def, true);
  ctx.restore();
}

// Draw a simplified side/front profile silhouette
function drawSideProfile(ctx, def, rotated) {
  const r  = def.radius;
  const h2 = r * 1.1;  // half-height of top body

  ctx.save();
  if (rotated) ctx.rotate(Math.PI / 6); // slight angle for side view

  // Body outline -- tapered trapezoid
  ctx.beginPath();
  const topW   = def.profile === 'circle' ? r * 0.9 : r * 0.95;
  const bottomW = r * 0.12; // tapers to tip
  ctx.moveTo(-topW, -h2);
  ctx.lineTo( topW, -h2);
  ctx.lineTo( bottomW,  h2 * 0.7);
  ctx.lineTo(-bottomW,  h2 * 0.7);
  ctx.closePath();
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.strokeStyle = darken(def.color, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tip
  if (def.tipType === 'flat') {
    ctx.beginPath();
    ctx.moveTo(-bottomW * 1.8, h2 * 0.7);
    ctx.lineTo( bottomW * 1.8, h2 * 0.7);
    ctx.strokeStyle = darken(def.color, 0.5);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    // pointed tip
    ctx.beginPath();
    ctx.moveTo(-bottomW, h2 * 0.7);
    ctx.lineTo(0, h2 * 1.0);
    ctx.lineTo( bottomW, h2 * 0.7);
    ctx.fillStyle = darken(def.color, 0.4);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Color Utilities ─────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

function lighten(hex, amount) {
  const [r,g,b] = hexToRgb(hex);
  const l = (c) => Math.min(255, Math.round(c + (255 - c) * amount));
  return `rgb(${l(r)},${l(g)},${l(b)})`;
}

function darken(hex, amount) {
  const [r,g,b] = hexToRgb(hex);
  const d = (c) => Math.max(0, Math.round(c * (1 - amount)));
  return `rgb(${d(r)},${d(g)},${d(b)})`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

// For plain-script (non-module) use, attach to window
if (typeof window !== 'undefined') {
  window.Tops = {
    TOP_DEFS,
    TOP_ORDER,
    randomAlignment,
    createTopInstance,
    drawTop,
    drawThreeView,
  };
}