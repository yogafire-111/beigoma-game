// tops.js
// Top definitions, stats, drawing functions
// No dependencies on other game modules

// ─── Top Definitions ────────────────────────────────────────────────────────

const TOP_DEFS = {
  nomaru: {
    id:          'nomaru',
    hiragana:    'のーまる',
    color:       '#707070',   // darker gray so glitter/effects read clearly
    colorDim:    '#444444',
    profile:     'hexagon',
    tipType:     'round',
    spinDuration: 40,
    impactForce:  1.0,
    deflection:   0.5,
    drift:        0.5,
    stability:    0.6,
    mass:         1.0,
    radius:       32,
  },

  riki: {
    id:          'riki',
    hiragana:    'りき',
    color:       '#1a2744',
    colorDim:    '#0d1422',
    profile:     'hexagon',
    tipType:     'fine',
    spinDuration: 60,
    impactForce:  0.8,
    deflection:   0.3,
    drift:        0.3,
    stability:    0.9,
    mass:         0.8,
    radius:       30,
  },

  maru: {
    id:          'maru',
    hiragana:    'まる',
    color:       '#9DC416',
    colorDim:    '#5a7a0a',
    profile:     'circle',
    tipType:     'fine',
    spinDuration: 50,
    impactForce:  0.6,
    deflection:   0.8,
    drift:        0.4,
    stability:    0.7,
    mass:         0.7,
    radius:       26,
  },

  hajiki: {
    id:          'hajiki',
    hiragana:    'はじき',
    color:       '#CC2200',
    colorDim:    '#7a1500',
    profile:     'hexagon',
    tipType:     'flat',
    spinDuration: 25,
    impactForce:  1.5,
    deflection:   0.6,
    drift:        0.9,
    stability:    0.35,
    mass:         0.75,
    radius:       28,
  },
};

const TOP_ORDER = ['nomaru', 'riki', 'maru', 'hajiki'];

// ─── Alignment ──────────────────────────────────────────────────────────────

function randomAlignment() {
  return 0.8 + Math.random() * 0.2;
}

// ─── Top Instance Factory ───────────────────────────────────────────────────

function createTopInstance(defId, owner) {
  const def = TOP_DEFS[defId];
  if (!def) throw new Error(`Unknown top id: ${defId}`);

  return {
    defId,
    owner,
    def,
    body:         null,
    spinSpeed:    0,
    angle:        0,
    auraPhase:    0,   // independent aura wave timer, set by physics.js
    tilt:         0,
    sideContact:  false,
    alignment:    randomAlignment(),
    hasContacted: false,
    alive:        true,
    opacity:      1.0,
    launched:     false,
  };
}

// ─── Drawing ────────────────────────────────────────────────────────────────

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

// ─── Wavy Aura (outer energy halo) ──────────────────────────────────────────
// Drawn in a separate pass BEFORE top bodies so bodies render on top.
// auraPhase: independent timer, not tied to spin rotation.
// Only visible while alive -- zeroed out on ejection/death.

function drawAura(ctx, r, spinSpeed, auraPhase, topColor, alive) {
  if (!alive) return;
  if (spinSpeed < 0.15) return;

  const [tr, tg, tb] = hexToRgb(topColor);
  const strength     = Math.min((spinSpeed - 0.15) / 0.5, 1.0);
  const outerR       = r * (1.1 + spinSpeed * 1.3);
  const wavePoints   = 64;
  const waveAmp      = r * 0.18 * strength;
  const waveFreq     = 5;   // number of waves around the circumference
  const waveFreq2    = 7;   // second harmonic for more organic shape
  const alpha        = strength * 0.55;

  ctx.save();

  // Outer wavy fill -- soft diffuse glow
  ctx.beginPath();
  for (let i = 0; i <= wavePoints; i++) {
    const t   = (i / wavePoints) * Math.PI * 2;
    const wave =
      Math.sin(t * waveFreq  + auraPhase * 1.3) * waveAmp +
      Math.sin(t * waveFreq2 + auraPhase * 0.9) * waveAmp * 0.45;
    const rad = outerR + wave;
    const x   = Math.cos(t) * rad;
    const y   = Math.sin(t) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, outerR + waveAmp);
  grad.addColorStop(0,    `rgba(${tr},${tg},${tb},0)`);
  grad.addColorStop(0.35, `rgba(${tr},${tg},${tb},${alpha * 0.25})`);
  grad.addColorStop(0.72, `rgba(${tr},${tg},${tb},${alpha * 0.65})`);
  grad.addColorStop(1,    `rgba(${tr},${tg},${tb},0)`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Second wavy ring -- slightly different phase for depth
  ctx.beginPath();
  const innerR = r * (1.02 + spinSpeed * 0.7);
  for (let i = 0; i <= wavePoints; i++) {
    const t    = (i / wavePoints) * Math.PI * 2;
    const wave =
      Math.sin(t * waveFreq  + auraPhase * 1.7 + 1.0) * waveAmp * 0.5 +
      Math.sin(t * waveFreq2 + auraPhase * 1.1 + 2.3) * waveAmp * 0.3;
    const rad = innerR + wave;
    const x   = Math.cos(t) * rad;
    const y   = Math.sin(t) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(${tr},${tg},${tb},${alpha * 0.5})`;
  ctx.lineWidth   = 2.5 * strength;
  ctx.stroke();

  ctx.restore();
}

// ─── Spin Blur (inner arc streaks) ───────────────────────────────────────────
// Inner white streaks close to the body -- always present above min spin.

function drawSpinBlur(ctx, r, spinSpeed, angle) {
  if (spinSpeed < 0.05) return;

  const streakCount = 6;
  const maxArcLen   = Math.PI * 1.1;
  const arcLen      = maxArcLen * Math.min(spinSpeed / 0.65, 1.0);
  const baseAlpha   = Math.min(spinSpeed * 1.4, 0.88);
  const lineWidth   = r * 0.42;

  ctx.save();
  ctx.rotate(angle);

  for (let i = 0; i < streakCount; i++) {
    const startAngle = (Math.PI * 2 / streakCount) * i;
    const segments   = 8;
    for (let s = 0; s < segments; s++) {
      const t0       = s / segments;
      const a0       = startAngle + arcLen * t0;
      const a1       = startAngle + arcLen * ((s + 1) / segments);
      const segAlpha = baseAlpha * (1 - t0 * 0.88);

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.74, a0, a1);
      ctx.strokeStyle = `rgba(255,255,255,${segAlpha})`;
      ctx.lineWidth   = lineWidth * (1 - t0 * 0.5);
      ctx.stroke();
    }
  }

  // White glow disc at high spin
  if (spinSpeed > 0.4) {
    const glowAlpha = Math.min((spinSpeed - 0.4) * 1.3, 0.55);
    const grad = ctx.createRadialGradient(0, 0, r * 0.45, 0, 0, r * 1.05);
    grad.addColorStop(0,    `rgba(255,255,255,0)`);
    grad.addColorStop(0.6,  `rgba(255,255,255,${glowAlpha * 0.3})`);
    grad.addColorStop(0.88, `rgba(255,255,255,${glowAlpha})`);
    grad.addColorStop(1,    `rgba(255,255,255,0)`);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.restore();
}

// ─── Glitter ──────────────────────────────────────────────────────────────────

const GLITTER_POINTS = _generateGlitterPoints(18);

function _generateGlitterPoints(count) {
  const pts    = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const t    = i / count;
    const dist = 0.15 + t * 0.78;
    const ang  = golden * i;
    pts.push({
      rx:         Math.cos(ang) * dist,
      ry:         Math.sin(ang) * dist,
      catchWidth: 0.32 + Math.random() * 0.38,
      phase:      Math.random() * Math.PI * 2,
      size:       2.2 + Math.random() * 3.0,
      gold:       Math.random() < 0.45,
    });
  }
  return pts;
}

function drawGlitter(ctx, r, spinSpeed, angle) {
  if (spinSpeed < 0.06) return;

  const masterAlpha = Math.min((spinSpeed - 0.06) / 0.35, 1.0);
  if (masterAlpha <= 0) return;

  ctx.save();

  for (const pt of GLITTER_POINTS) {
    const px = pt.rx * r;
    const py = pt.ry * r;

    const catchAngle   = pt.phase;
    const currentAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const diff         = Math.abs(currentAngle - catchAngle);
    const wrap         = Math.min(diff, Math.PI * 2 - diff);

    if (wrap > pt.catchWidth) continue;

    const intensity = Math.pow(1 - wrap / pt.catchWidth, 1.5) * masterAlpha;
    if (intensity < 0.04) continue;

    // Large soft outer glow
    ctx.beginPath();
    ctx.arc(px, py, pt.size * 4.5, 0, Math.PI * 2);
    ctx.fillStyle = pt.gold
      ? `rgba(255,200,60,${intensity * 0.18})`
      : `rgba(255,255,255,${intensity * 0.15})`;
    ctx.fill();

    // Medium glow
    ctx.beginPath();
    ctx.arc(px, py, pt.size * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = pt.gold
      ? `rgba(255,220,100,${intensity * 0.45})`
      : `rgba(255,255,255,${intensity * 0.4})`;
    ctx.fill();

    // Bright center
    ctx.beginPath();
    ctx.arc(px, py, pt.size, 0, Math.PI * 2);
    ctx.fillStyle = pt.gold
      ? `rgba(255,240,160,${intensity})`
      : `rgba(255,255,255,${intensity})`;
    ctx.fill();

    // Star flare on bright catches
    if (intensity > 0.6) {
      const flareLen = pt.size * 5 * intensity;
      ctx.strokeStyle = pt.gold
        ? `rgba(255,230,120,${intensity * 0.5})`
        : `rgba(255,255,255,${intensity * 0.45})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px - flareLen, py);
      ctx.lineTo(px + flareLen, py);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py - flareLen);
      ctx.lineTo(px, py + flareLen);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ─── Shadow ──────────────────────────────────────────────────────────────────

function drawShadow(ctx, r) {
  const grad = ctx.createRadialGradient(3, 4, r * 0.1, 3, 4, r * 1.1);
  grad.addColorStop(0,   'rgba(0,0,0,0.28)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(3, 4, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

// ─── Tilt Ring ───────────────────────────────────────────────────────────────

function drawTiltRing(ctx, r, tiltAmount) {
  const ringR = r + 8;
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

// ─── Draw functions split into aura pass and body pass ───────────────────────
// main.js calls drawTopAura() for ALL tops first, then drawTop() for all tops.
// This ensures no aura renders on top of another top's body.

function drawTopAura(ctx, instance, tickPhase) {
  if (!instance.launched) return;
  const { def, spinSpeed, auraPhase, opacity, alive } = instance;
  const r = def.radius;

  ctx.save();
  ctx.globalAlpha = opacity;
  drawAura(ctx, r, spinSpeed, auraPhase || tickPhase, def.color, alive);
  ctx.restore();
}

function drawTop(ctx, instance, tickPhase, showTilt, tiltAmount) {
  const { def, spinSpeed, angle, tilt, opacity } = instance;
  const r = def.radius;

  ctx.save();
  ctx.globalAlpha = opacity;

  drawShadow(ctx, r);

  if (tilt > 0) {
    const skew = tilt * 0.25;
    ctx.transform(1, 0, skew, 1 - tilt * 0.1, 0, 0);
  }

  ctx.rotate(angle);

  if (def.profile === 'hexagon') {
    hexPath(ctx, r);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }

  const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
  bodyGrad.addColorStop(0, lighten(def.color, 0.35));
  bodyGrad.addColorStop(1, def.color);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  ctx.strokeStyle = darken(def.color, 0.3);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (def.id === 'riki')   drawRikiRibs(ctx, r, 0);
  if (def.id === 'hajiki') drawHajikiSlashes(ctx, r, 0);

  ctx.restore();
  ctx.save();
  ctx.globalAlpha = opacity;

  // Inner spin blur
  drawSpinBlur(ctx, r, spinSpeed, tickPhase);

  // Glitter
  drawGlitter(ctx, r, spinSpeed, tickPhase);

  if (showTilt) {
    drawTiltRing(ctx, r, tiltAmount);
  }

  ctx.restore();
}

// ─── Three-View Display ──────────────────────────────────────────────────────

function drawThreeView(canvas, defId) {
  const def = TOP_DEFS[defId];
  if (!def) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const panelW = w / 3;
  const cx = panelW / 2;

  ctx.font = '10px monospace';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText('上',   cx,            14);
  ctx.fillText('前',   cx + panelW,   14);
  ctx.fillText('横',   cx + panelW*2, 14);

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

  ctx.save();
  ctx.translate(cx + panelW, h / 2 + 4);
  drawSideProfile(ctx, def, false);
  ctx.restore();

  ctx.save();
  ctx.translate(cx + panelW * 2, h / 2 + 4);
  drawSideProfile(ctx, def, true);
  ctx.restore();
}

function drawSideProfile(ctx, def, rotated) {
  const r  = def.radius;
  const h2 = r * 1.1;

  ctx.save();
  if (rotated) ctx.rotate(Math.PI / 6);

  ctx.beginPath();
  const topW    = def.profile === 'circle' ? r * 0.9 : r * 0.95;
  const bottomW = r * 0.12;
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

  if (def.tipType === 'flat') {
    ctx.beginPath();
    ctx.moveTo(-bottomW * 1.8, h2 * 0.7);
    ctx.lineTo( bottomW * 1.8, h2 * 0.7);
    ctx.strokeStyle = darken(def.color, 0.5);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
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

if (typeof window !== 'undefined') {
  window.Tops = {
    TOP_DEFS,
    TOP_ORDER,
    randomAlignment,
    createTopInstance,
    drawTop,
    drawTopAura,
    drawThreeView,
    hexToRgb,
  };
}