// main.js
// Game loop, canvas rendering, mouse input
// Depends on: tops.js, physics.js, game.js (all via window globals)

// ─── Canvas Setup ────────────────────────────────────────────────────────────

const canvas  = document.getElementById('arena');
const ctx     = canvas.getContext('2d');
const SIZE    = Physics.PHYSICS.CANVAS_SIZE;   // 800
const RADIUS  = Physics.PHYSICS.ARENA_RADIUS;  // 340
const CX      = SIZE / 2;
const CY      = SIZE / 2;

canvas.width  = SIZE;
canvas.height = SIZE;

// ─── Launch Constants ────────────────────────────────────────────────────────

const LAUNCH = {
  PATH_HISTORY:     12,
  VEL_MIN:          1.5,
  VEL_SWEET_LOW:    8.0,
  VEL_SWEET_HIGH:   22.0,
  VEL_MAX:          32.0,
  CURVE_FLAT:       6,
  CURVE_TILT:       22,
  CURVE_STEEP:      45,
  CURVE_MISS:       75,
  PLAYER_LAUNCH_FRACTION: 0.78,
  CPU_LAUNCH_FRACTION:    0.78,
  CPU_ANIMATE_FRAMES: 30,
};

// ─── Input State ─────────────────────────────────────────────────────────────

const input = {
  dragging:    false,
  startX:      0,
  startY:      0,
  currentX:    0,
  currentY:    0,
  path:        [],
  releaseVelX: 0,
  releaseVelY: 0,
};

// ─── Render State ────────────────────────────────────────────────────────────

let liveInstances   = [];
let particles       = [];
let cpuAnimProgress = 0;
let cpuAnimating    = false;

// Impact effects state
let shakeFrames     = 0;
let shakeMagnitude  = 0;
let hitStopFrames   = 0;
let impactFlashes   = [];

// ─── Motion Trail State ───────────────────────────────────────────────────────

const trailHistory     = new Map();
const TRAIL_LENGTH     = 8;
const TRAIL_VEL_THRESH = 3.0;

// ─── Spark Particle System ───────────────────────────────────────────────────

function spawnSparks(x, y, force) {
  const count = Math.floor(50 + force * 140);
  for (let i = 0; i < count; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const speed  = 14 + Math.random() * force * 38;
    const isGold = Math.random() < 0.5;
    particles.push({
      x, y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      life:  1.0,
      decay: 0.016 + Math.random() * 0.016,
      size:  1.0 + Math.random() * 1.5,
      color: isGold
        ? (Math.random() < 0.5 ? '#FFD700' : '#FFAA00')
        : (Math.random() < 0.5 ? '#FFFFFF' : '#FFFACC'),
      isSpark: true,
    });
  }
  // Large central flash
  particles.push({
    x, y,
    vx: 0, vy: 0,
    life: 1.0, decay: 0.07,
    size: 32 + force * 48,
    color: 'rgba(255,240,180,0.6)',
    isFlash: true,
  });
  // Second smaller hot flash
  particles.push({
    x, y,
    vx: 0, vy: 0,
    life: 1.0, decay: 0.11,
    size: 16 + force * 24,
    color: 'rgba(255,210,80,0.5)',
    isFlash: true,
  });
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx;
    p.y    += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    if (p.isFlash) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.isSpark) {
      // Line segment -- tail trails behind current position
      const tailX = p.x - p.vx * 0.12;
      const tailY = p.y - p.vy * 0.12;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = p.size * p.life;
      ctx.lineCap     = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ─── Impact Effects ──────────────────────────────────────────────────────────

function triggerImpact(x, y, force) {
  if (force > 0.3) {
    shakeFrames    = Math.floor(4 + force * 10);
    shakeMagnitude = Math.min(force * 14, 18);
  }
  if (force > 0.6) {
    hitStopFrames = Math.floor(force * 5);
  }
  impactFlashes.push({
    x, y,
    radius:  10,
    maxR:    40 + force * 80,
    life:    1.0,
    decay:   0.07 + (1 - force) * 0.04,
    color:   force > 0.7 ? '#FFFFFF' : '#FFD700',
  });
  if (force > 0.5) {
    impactFlashes.push({
      x, y,
      radius:  5,
      maxR:    20 + force * 40,
      life:    1.0,
      decay:   0.12,
      color:   '#FF6600',
    });
  }
}

function updateImpactFlashes() {
  for (let i = impactFlashes.length - 1; i >= 0; i--) {
    const f  = impactFlashes[i];
    f.radius = f.maxR * (1 - f.life);
    f.life  -= f.decay;
    if (f.life <= 0) impactFlashes.splice(i, 1);
  }
}

function drawImpactFlashes() {
  for (const f of impactFlashes) {
    ctx.save();
    ctx.globalAlpha  = f.life * 0.8;
    ctx.strokeStyle  = f.color;
    ctx.lineWidth    = 3 * f.life;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function applyScreenShake() {
  if (shakeFrames <= 0) return;
  const dx = (Math.random() - 0.5) * shakeMagnitude;
  const dy = (Math.random() - 0.5) * shakeMagnitude;
  ctx.translate(dx, dy);
  shakeFrames--;
  shakeMagnitude *= 0.82;
}

// ─── Arena Rendering ─────────────────────────────────────────────────────────

function drawArena() {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const vignette = ctx.createRadialGradient(CX, CY, RADIUS * 0.1, CX, CY, RADIUS * 1.1);
  vignette.addColorStop(0,   'rgba(60,45,30,0.0)');
  vignette.addColorStop(0.6, 'rgba(20,15,10,0.3)');
  vignette.addColorStop(1.0, 'rgba(0,0,0,0.72)');

  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS * 1.12, 0, Math.PI * 2);
  ctx.fillStyle = vignette;
  ctx.fill();

  _drawClothTexture();

  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180,150,100,0.55)';
  ctx.lineWidth   = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS + 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(100,80,50,0.3)';
  ctx.lineWidth   = 8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(CX, CY, 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180,150,100,0.18)';
  ctx.fill();
}

function _drawClothTexture() {
  const step = 10;
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS - 2, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = 'rgba(120,100,70,0.07)';
  ctx.lineWidth   = 0.5;

  for (let x = 0; x < SIZE; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SIZE);
    ctx.stroke();
  }
  for (let y = 0; y < SIZE; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Motion Trails ───────────────────────────────────────────────────────────

function drawMotionTrails() {
  trailHistory.forEach((trail, id) => {
    if (trail.length < 2) return;

    const inst = liveInstances.find(i => `${i.owner}_${i.defId}` === id);
    if (!inst || !inst.alive) return;

    const [r, g, b] = _hexToRgb(inst.def.color);

    for (let i = 0; i < trail.length; i++) {
      const pos    = trail[i];
      const age    = i / trail.length;
      const alpha  = (1 - age) * 0.22;
      const radius = inst.def.radius * (1 - age * 0.4);

      if (alpha < 0.02) continue;

      ctx.save();
      ctx.globalAlpha = alpha * inst.opacity;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
      ctx.restore();
    }
  });
}

function _hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

// ─── Top Rendering ───────────────────────────────────────────────────────────

function drawAllTops() {
  for (const inst of liveInstances) {
    if (!inst.launched && inst.owner === 'player') {
      const pos = _playerLaunchPos();
      _drawTopAt(inst, pos.x, pos.y, 0, false, 0);
      continue;
    }
    if (!inst.launched && inst.owner === 'cpu') {
      if (cpuAnimating) {
        const pos = _cpuLaunchPos();
        _drawTopAt(inst, pos.x, pos.y, 0, false, 0);
      }
      continue;
    }
    if (!inst.body) continue;

    const pstate = Physics.getPhysState(inst);
    if (!pstate) continue;

    const x = inst.body.position.x;
    const y = inst.body.position.y - (pstate ? pstate.jumpOffset : 0);

    const gs       = Game.getGameState();
    const showTilt = (gs.phase === 'player_launch' && input.dragging && inst.owner === 'player');
    const tiltAmt  = showTilt ? _currentTiltAmount() : 0;

    _drawTopAt(inst, x, y, pstate.tickPhase, showTilt, tiltAmt);
  }
}

function _drawTopAt(inst, x, y, tickPhase, showTilt, tiltAmount) {
  ctx.save();
  ctx.translate(x, y);
  Tops.drawTop(ctx, inst, tickPhase, showTilt, tiltAmount);
  ctx.restore();
}

// ─── Launch Aim Indicator ────────────────────────────────────────────────────

function drawLaunchIndicator() {
  const gs = Game.getGameState();
  if (gs.phase !== 'player_launch' || !input.dragging) return;

  const pos   = _playerLaunchPos();
  const dx    = input.currentX - pos.x;
  const dy    = input.currentY - pos.y;
  const dist  = Math.hypot(dx, dy);
  if (dist < 5) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(input.currentX, input.currentY);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.atan2(dy, dx);
  ctx.translate(input.currentX, input.currentY);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 5);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ─── Launch Logic ────────────────────────────────────────────────────────────

function handlePlayerLaunchButton() {
  const gs = Game.getGameState();
  if (gs.phase !== 'player_launch') return;

  const pos       = _playerLaunchPos();
  const spread    = (Math.random() - 0.5) * 0.3;
  const aimAngle  = -Math.PI / 2 + spread;
  const spinSpeed = 0.88;

  const result = Game.playerLaunch(aimAngle, spinSpeed);
  if (!result) return;

  const speed   = 5.5 + Math.random() * 1.5;
  const finalVx = Math.cos(result.angle) * speed;
  const finalVy = Math.sin(result.angle) * speed;

  const inst = gs.playerTop;
  Physics.addTopToWorld(inst, pos.x, pos.y, finalVx, finalVy, result.spin);
  Sound.startHum(inst);

  // Launch CPU simultaneously
  if (result.cpuParams) {
    _startCpuAnimation(result.cpuParams);
  }

  const btn = document.getElementById('launch-btn');
  if (btn) btn.disabled = true;
}

function _mapVelocityToSpin(speed) {
  const { VEL_MIN, VEL_SWEET_LOW, VEL_SWEET_HIGH, VEL_MAX } = LAUNCH;

  if (speed < VEL_MIN)        return 0.05;
  if (speed < VEL_SWEET_LOW)  return _lerp(0.1, 0.65, (speed - VEL_MIN) / (VEL_SWEET_LOW - VEL_MIN));
  if (speed < VEL_SWEET_HIGH) return _lerp(0.65, 1.0,  (speed - VEL_SWEET_LOW) / (VEL_SWEET_HIGH - VEL_SWEET_LOW));
  if (speed < VEL_MAX)        return _lerp(1.0, 0.7,   (speed - VEL_SWEET_HIGH) / (VEL_MAX - VEL_SWEET_HIGH));
  return 0.45;
}

function _classifyLaunch(speed, curve) {
  if (speed < LAUNCH.VEL_MIN)    return 'miss';
  if (speed > LAUNCH.VEL_MAX)    return 'miss';
  if (curve > LAUNCH.CURVE_MISS)  return 'miss';
  if (curve > LAUNCH.CURVE_STEEP) return 'steep';
  if (curve > LAUNCH.CURVE_TILT)  return 'tilt';
  return 'good';
}

function _measureCurvature() {
  const path = input.path;
  if (path.length < 3) return 0;

  const start = path[0];
  const end   = path[path.length - 1];
  const lineLen = Math.hypot(end.x - start.x, end.y - start.y);
  if (lineLen < 1) return 0;

  let maxDev = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const dx  = end.x - start.x;
    const dy  = end.y - start.y;
    const dev = Math.abs(dy * path[i].x - dx * path[i].y + end.x * start.y - end.y * start.x) / lineLen;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

function _currentTiltAmount() {
  const curve = _measureCurvature();
  return Math.min(1.0, curve / LAUNCH.CURVE_MISS);
}

function _showMissEffect(pos) {
  particles.push({
    x: pos.x, y: pos.y,
    vx: 0, vy: -2,
    life: 1.0, decay: 0.04,
    size: 12,
    color: 'rgba(255,100,50,0.7)',
  });
  _setStatusMessage('ミス！', 90);
}

// ─── CPU Launch Animation ────────────────────────────────────────────────────

function _startCpuAnimation(launchParams) {
  cpuAnimating    = true;
  cpuAnimProgress = 0;
  _cpuLaunchParams = launchParams;
}

let _cpuLaunchParams = null;

function _updateCpuAnimation() {
  if (!cpuAnimating) return;
  cpuAnimProgress += 1 / LAUNCH.CPU_ANIMATE_FRAMES;
  if (cpuAnimProgress >= 1) {
    cpuAnimating    = false;
    cpuAnimProgress = 1;
    const p    = _cpuLaunchParams;
    const inst = Game.getGameState().cpuTop;
    if (inst && p) {
      Physics.addTopToWorld(inst, p.x, p.y, p.vx, p.vy, p.spin);
      Sound.startHum(inst);
    }
  }
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

let _statusMessage = '';
let _statusFrames  = 0;

function _setStatusMessage(msg, frames) {
  _statusMessage = msg;
  _statusFrames  = frames;
}

function drawHUD() {
  const gs = Game.getGameState();

  if (_statusFrames > 0) {
    const alpha = Math.min(1, _statusFrames / 20);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font        = 'bold 28px sans-serif';
    ctx.fillStyle   = '#FFD700';
    ctx.textAlign   = 'center';
    ctx.fillText(_statusMessage, CX, CY - RADIUS * 0.55);
    ctx.restore();
    _statusFrames--;
  }

  ctx.font      = '14px monospace';
  ctx.fillStyle = 'rgba(200,180,140,0.8)';
  ctx.textAlign = 'left';

  let prompt = '';
  if (gs.phase === 'player_launch') {
    prompt = '「なげる」ボタンをおす';
  } else if (gs.phase === 'cpu_launch') {
    prompt = 'CPU 投げ中...';
  } else if (gs.phase === 'battle') {
    prompt = '戦闘中';
  } else if (gs.phase === 'result') {
    _drawResultScreen(gs);
    return;
  }
  ctx.fillText(prompt, 16, SIZE - 16);

  ctx.textAlign = 'right';
  ctx.fillText(`スキル: ${gs.playerSkill}`, SIZE - 16, SIZE - 16);

  _drawTopLabels();
}

function _drawTopLabels() {
  const instances = [
    Game.getGameState().playerTop,
    Game.getGameState().cpuTop,
  ].filter(Boolean);

  for (const inst of instances) {
    if (!inst.launched || !inst.body) continue;
    const x = inst.body.position.x;
    const y = inst.body.position.y - inst.def.radius - 12;
    ctx.save();
    ctx.font      = '13px sans-serif';
    ctx.fillStyle = inst.owner === 'player'
      ? 'rgba(180,220,255,0.9)'
      : 'rgba(255,180,160,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(inst.def.hiragana, x, y);
    ctx.restore();
  }
}

function _drawResultScreen(gs) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = 'center';

  let line1, line2, color;
  if (gs.result === 'player_win') {
    line1 = 'WINNER!';
    line2 = 'プレイヤーの勝ち';
    color = '#FFD700';
  } else if (gs.result === 'cpu_win') {
    line1 = 'YOU LOSE';
    line2 = 'CPUの勝ち';
    color = '#FF6644';
  } else {
    line1 = 'DRAW';
    line2 = gs.resultReason === 'no_contact' ? '接触なし' : '引き分け';
    color = '#AAAAAA';
  }

  ctx.font      = 'bold 48px sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(line1, CX, CY - 30);

  ctx.font      = '22px sans-serif';
  ctx.fillStyle = 'rgba(220,200,160,0.9)';
  ctx.fillText(line2, CX, CY + 16);

  ctx.font      = '15px monospace';
  ctx.fillStyle = 'rgba(180,160,120,0.7)';
  ctx.fillText('もう一回あそぶ →', CX, CY + 60);

  ctx.restore();

  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.classList.remove('hidden');
    restartBtn.onclick = () => {
      restartBtn.classList.add('hidden');
      initGame();
    };
  }
}

// ─── Launch Positions ────────────────────────────────────────────────────────

function _playerLaunchPos() {
  return {
    x: CX,
    y: CY + RADIUS * LAUNCH.PLAYER_LAUNCH_FRACTION,
  };
}

function _cpuLaunchPos() {
  return {
    x: CX,
    y: CY - RADIUS * LAUNCH.CPU_LAUNCH_FRACTION,
  };
}

// ─── Game Loop ───────────────────────────────────────────────────────────────

function gameLoop() {
  ctx.clearRect(0, 0, SIZE, SIZE);

  drawArena();

  const gs = Game.getGameState();

  if (hitStopFrames > 0) {
    hitStopFrames--;
  } else if (gs.phase === 'battle' || gs.phase === 'cpu_launch') {
    Physics.updatePhysics(liveInstances);
    Sound.updateHums(liveInstances);

    // Update motion trail history
    for (const inst of liveInstances) {
      if (!inst.launched || !inst.body) continue;
      const id  = `${inst.owner}_${inst.defId}`;
      const vel = Math.hypot(inst.body.velocity.x, inst.body.velocity.y);

      if (vel >= TRAIL_VEL_THRESH) {
        if (!trailHistory.has(id)) trailHistory.set(id, []);
        const trail = trailHistory.get(id);
        trail.unshift({ x: inst.body.position.x, y: inst.body.position.y });
        if (trail.length > TRAIL_LENGTH) trail.pop();
      } else {
        if (trailHistory.has(id)) {
          const trail = trailHistory.get(id);
          if (trail.length > 0) trail.pop();
          else trailHistory.delete(id);
        }
      }
    }
  }

  _updateCpuAnimation();

  if (gs.phase === 'battle') {
    const result = Game.updateBattle(liveInstances);
    if (result) {
      Sound.stopAllHums();
      _setStatusMessage(
        result.result === 'player_win' ? '勝ち！' :
        result.result === 'cpu_win'    ? '負け...' : '引き分け',
        120
      );
    }

    for (const inst of liveInstances) {
      if (!inst.alive && inst.opacity <= 0 && inst.body) {
        Physics.removeTopFromWorld(inst);
        Physics.unregisterInstance(inst);
      }
    }
  }

  ctx.save();
  applyScreenShake();

  // Motion trails drawn behind everything
  drawMotionTrails();

  // Pass 1: auras for all tops (so no aura renders over another top's body)
  for (const inst of liveInstances) {
    if (!inst.launched || !inst.body) continue;
    const pstate = Physics.getPhysState(inst);
    if (!pstate) continue;
    const x = inst.body.position.x;
    const y = inst.body.position.y - pstate.jumpOffset;
    ctx.save();
    ctx.translate(x, y);
    Tops.drawTopAura(ctx, inst, pstate.tickPhase);
    ctx.restore();
  }

  // Pass 2: top bodies on top of all auras
  drawAllTops();

  updateParticles();
  drawParticles();

  updateImpactFlashes();
  drawImpactFlashes();

  ctx.restore();

  drawLaunchIndicator();
  drawHUD();

  requestAnimationFrame(gameLoop);
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initGame() {
  Physics.resetPhysics();
  particles       = [];
  liveInstances   = [];
  cpuAnimating    = false;
  cpuAnimProgress = 0;
  _cpuLaunchParams = null;
  input.dragging  = false;
  input.path      = [];
  shakeFrames     = 0;
  shakeMagnitude  = 0;
  hitStopFrames   = 0;
  impactFlashes   = [];
  trailHistory.clear();

  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn) launchBtn.disabled = false;

  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.classList.add('hidden');

  if (typeof showTopSelection === 'function') {
    showTopSelection((playerTopId, cpuTopId) => {
      const { playerInstance, cpuInstance } = Game.startMatch(
        playerTopId,
        cpuTopId,
        Game.GAME.MODE_MATCH
      );
      liveInstances = [playerInstance, cpuInstance];
    });
  } else {
    const { playerInstance, cpuInstance } = Game.startMatch(
      'nomaru', 'hajiki', Game.GAME.MODE_MATCH
    );
    liveInstances = [playerInstance, cpuInstance];
  }
}

// ─── Collision Callback ──────────────────────────────────────────────────────

const _mainCallbacks = {
  onTopDied: (instance) => {
    if (instance.ejected) Sound.playEjection();
    Sound.stopHum(instance);
  },
  onCollision: (instA, instB, force) => {
    if (instA.body && instB.body) {
      const mx        = (instA.body.position.x + instB.body.position.x) / 2;
      const my        = (instA.body.position.y + instB.body.position.y) / 2;
      const normForce = Math.min(force / 10, 1.0);
      spawnSparks(mx, my, normForce);
      triggerImpact(mx, my, normForce);
      Sound.playCollision(normForce);
    }
  },
  onCornerStrike: (striker, target, force, impulse, selfEjected) => {
    // Reserved for future crack layering.
  },
};
window._physicsCallbacks = _mainCallbacks;

Physics.initPhysics(_mainCallbacks);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ─── Start ───────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  // Sound.init() must be called on a user gesture.
  // We hook the confirm button and launch button -- whichever fires first.
  const _initSound = () => { Sound.init(); };
  const _confirmBtn = document.getElementById('confirm-btn');
  const _launchBtn  = document.getElementById('launch-btn');
  if (_confirmBtn) _confirmBtn.addEventListener('click', _initSound, { once: true });
  if (_launchBtn)  _launchBtn.addEventListener('click',  _initSound, { once: true });

  initGame();
  requestAnimationFrame(gameLoop);
});