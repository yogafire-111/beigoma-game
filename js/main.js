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
  // Mouse path history for curvature detection
  PATH_HISTORY:     12,       // frames of mouse positions to track

  // Velocity thresholds (px/frame)
  VEL_MIN:          1.5,      // below this = too slow, weak launch
  VEL_SWEET_LOW:    8.0,      // sweet spot starts here
  VEL_SWEET_HIGH:   22.0,     // sweet spot ends here (peak spin)
  VEL_MAX:          32.0,     // above this = overshoot / miss

  // Curvature thresholds (deviation px over path history)
  CURVE_FLAT:       6,        // below this = flat launch (good)
  CURVE_TILT:       22,       // moderate tilt, spin penalty on landing
  CURVE_STEEP:      45,       // steep, side contact, rapid decay
  CURVE_MISS:       75,       // too curved, misses or lands on side fully

  // Launch position (fraction of arena radius from center)
  PLAYER_LAUNCH_FRACTION: 0.78,
  CPU_LAUNCH_FRACTION:    0.78,

  // CPU visual launch animation
  CPU_ANIMATE_FRAMES: 30,     // frames for CPU top to slide into position
};

// ─── Input State ─────────────────────────────────────────────────────────────

const input = {
  dragging:    false,
  startX:      0,
  startY:      0,
  currentX:    0,
  currentY:    0,
  path:        [],            // [{x,y}] recent mouse positions
  releaseVelX: 0,
  releaseVelY: 0,
};

// ─── Render State ────────────────────────────────────────────────────────────

let liveInstances   = [];     // all top instances currently tracked
let particles       = [];     // collision spark particles
let cpuAnimProgress = 0;      // 0→1 during CPU launch animation
let cpuAnimating    = false;

// ─── Spark Particle System ───────────────────────────────────────────────────

function spawnSparks(x, y, force) {
  const count = Math.floor(4 + force * 18);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * force * 6;
    particles.push({
      x, y,
      vx:      Math.cos(angle) * speed,
      vy:      Math.sin(angle) * speed,
      life:    1.0,
      decay:   0.045 + Math.random() * 0.04,
      size:    1.5 + Math.random() * 2,
      color:   Math.random() < 0.6 ? '#FFD700' : '#FF6600',
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.12;   // gravity
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Arena Rendering ─────────────────────────────────────────────────────────

function drawArena() {
  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Bowl vignette -- dark toward edges, lighter at center
  const vignette = ctx.createRadialGradient(CX, CY, RADIUS * 0.1, CX, CY, RADIUS * 1.1);
  vignette.addColorStop(0,   'rgba(60,45,30,0.0)');
  vignette.addColorStop(0.6, 'rgba(20,15,10,0.3)');
  vignette.addColorStop(1.0, 'rgba(0,0,0,0.72)');

  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS * 1.12, 0, Math.PI * 2);
  ctx.fillStyle = vignette;
  ctx.fill();

  // Canvas cloth texture (fine grid suggests weave)
  _drawClothTexture();

  // Bowl rim
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180,150,100,0.55)';
  ctx.lineWidth   = 3;
  ctx.stroke();

  // Outer rim highlight
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS + 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(100,80,50,0.3)';
  ctx.lineWidth   = 8;
  ctx.stroke();

  // Subtle center marker
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

// ─── Top Rendering ───────────────────────────────────────────────────────────

function drawAllTops() {
  for (const inst of liveInstances) {
    if (!inst.launched && inst.owner === 'player') {
      // Draw player top at launch position (pre-launch preview)
      const pos = _playerLaunchPos();
      _drawTopAt(inst, pos.x, pos.y, 0, false, 0);
      continue;
    }
    if (!inst.launched && inst.owner === 'cpu') {
      // CPU top not yet launched -- draw during animation only
      if (cpuAnimating) {
        const pos  = _cpuLaunchPos();
        const prog = cpuAnimProgress;
        const px   = CX + (pos.x - CX) * (1 - prog) * 0.3 + (pos.x - CX) * prog;
        const py   = CY + (pos.y - CY) * prog;
        _drawTopAt(inst, px, py, 0, false, 0);
      }
      continue;
    }
    if (!inst.body) continue;

    const pstate = Physics.getPhysState(inst);
    if (!pstate) continue;

    const x = inst.body.position.x;
    const y = inst.body.position.y - (pstate ? pstate.jumpOffset : 0);

    // Tilt indicator during player drag
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

  // Dashed aim line
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(input.currentX, input.currentY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrow tip
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

// ─── Mouse Input ─────────────────────────────────────────────────────────────

// ─── Launch Logic (Button-based, v0.1) ──────────────────────────────────────
// Drag mechanic deferred -- tops launch automatically with good default params.
// Player just presses the Launch button in the UI panel.

function handlePlayerLaunchButton() {
  const gs = Game.getGameState();
  if (gs.phase !== 'player_launch') return;

  const pos      = _playerLaunchPos();
  const aimAngle = -Math.PI / 2;   // straight up toward center
  const spinSpeed = 0.88;           // good strong spin

  const result = Game.playerLaunch(aimAngle, spinSpeed);
  if (!result) return;

  const finalVx = Math.cos(result.angle) * 4.5;
  const finalVy = Math.sin(result.angle) * 4.5;

  const inst = gs.playerTop;
  Physics.addTopToWorld(inst, pos.x, pos.y, finalVx, finalVy, result.spin);

  // Disable launch button
  const btn = document.getElementById('launch-btn');
  if (btn) btn.disabled = true;
}

function _mapVelocityToSpin(speed) {
  const { VEL_MIN, VEL_SWEET_LOW, VEL_SWEET_HIGH, VEL_MAX } = LAUNCH;

  if (speed < VEL_MIN)        return 0.05;
  if (speed < VEL_SWEET_LOW)  return _lerp(0.1, 0.65, (speed - VEL_MIN) / (VEL_SWEET_LOW - VEL_MIN));
  if (speed < VEL_SWEET_HIGH) return _lerp(0.65, 1.0,  (speed - VEL_SWEET_LOW) / (VEL_SWEET_HIGH - VEL_SWEET_LOW));
  if (speed < VEL_MAX)        return _lerp(1.0, 0.7,   (speed - VEL_SWEET_HIGH) / (VEL_MAX - VEL_SWEET_HIGH));
  return 0.45; // overshoot
}

function _classifyLaunch(speed, curve) {
  if (speed < LAUNCH.VEL_MIN)   return 'miss';
  if (speed > LAUNCH.VEL_MAX)   return 'miss';
  if (curve > LAUNCH.CURVE_MISS) return 'miss';
  if (curve > LAUNCH.CURVE_STEEP) return 'steep';
  if (curve > LAUNCH.CURVE_TILT)  return 'tilt';
  return 'good';
}

function _measureCurvature() {
  const path = input.path;
  if (path.length < 3) return 0;

  // Measure total lateral deviation from straight line (start → end)
  const start = path[0];
  const end   = path[path.length - 1];
  const lineLen = Math.hypot(end.x - start.x, end.y - start.y);
  if (lineLen < 1) return 0;

  let maxDev = 0;
  for (let i = 1; i < path.length - 1; i++) {
    // Distance from point to line
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
  // Brief flash at launch position to indicate miss
  particles.push({
    x: pos.x, y: pos.y,
    vx: 0, vy: -2,
    life: 1.0, decay: 0.04,
    size: 12,
    color: 'rgba(255,100,50,0.7)',
  });
  // UI feedback handled in drawHUD
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
    // Actually launch the CPU top into physics world
    const p    = _cpuLaunchParams;
    const inst = Game.getGameState().cpuTop;
    if (inst && p) {
      Physics.addTopToWorld(inst, p.x, p.y, p.vx, p.vy, p.spin);
    }
  }
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

let _statusMessage     = '';
let _statusFrames      = 0;

function _setStatusMessage(msg, frames) {
  _statusMessage = msg;
  _statusFrames  = frames;
}

function drawHUD() {
  const gs = Game.getGameState();

  // Status message (miss, win, etc.)
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

  // Phase prompt
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

  // Player skill indicator
  ctx.textAlign = 'right';
  ctx.fillText(`スキル: ${gs.playerSkill}`, SIZE - 16, SIZE - 16);

  // Top name labels near tops
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
  // Semi-transparent overlay
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = 'center';

  // Result text
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

  // Show restart button in panel
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
  // Clear
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Draw arena
  drawArena();

  // Physics update
  const gs = Game.getGameState();
  if (gs.phase === 'battle' || gs.phase === 'cpu_launch') {
    Physics.updatePhysics(liveInstances);
  }

  // CPU launch animation
  _updateCpuAnimation();

  // CPU launch trigger
  if (gs.phase === 'cpu_launch') {
    const params = Game.updateCpuLaunch();
    if (params) {
      _startCpuAnimation(params);
    }
  }

  // Battle update
  if (gs.phase === 'battle') {
    const result = Game.updateBattle(liveInstances);
    if (result) {
      _setStatusMessage(
        result.result === 'player_win' ? '勝ち！' :
        result.result === 'cpu_win'    ? '負け...' : '引き分け',
        120
      );
    }

    // Remove fully faded dead tops from physics
    for (const inst of liveInstances) {
      if (!inst.alive && inst.opacity <= 0 && inst.body) {
        Physics.removeTopFromWorld(inst);
        Physics.unregisterInstance(inst);
      }
    }
  }

  // Draw tops
  drawAllTops();

  // Draw particles
  updateParticles();
  drawParticles();

  // Draw aim indicator
  drawLaunchIndicator();

  // Draw HUD
  drawHUD();

  requestAnimationFrame(gameLoop);
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initGame() {
  // Reset physics world
  Physics.resetPhysics();
  particles       = [];
  liveInstances   = [];
  cpuAnimating    = false;
  cpuAnimProgress = 0;
  _cpuLaunchParams = null;
  input.dragging  = false;
  input.path      = [];

  // Reset launch button
  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn) launchBtn.disabled = false;

  // Hide restart button
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.classList.add('hidden');

  // Show top selection UI (defined in index.html)
  if (typeof showTopSelection === 'function') {
    showTopSelection((selectedTopId) => {
      const { playerInstance, cpuInstance } = Game.startMatch(
        selectedTopId,
        Game.GAME.MODE_MATCH,
        null   // random CPU personality
      );
      liveInstances = [playerInstance, cpuInstance];
    });
  } else {
    // Fallback: auto-start with nomaru for testing
    const { playerInstance, cpuInstance } = Game.startMatch(
      'nomaru',
      Game.GAME.MODE_MATCH,
      null
    );
    liveInstances = [playerInstance, cpuInstance];
  }
}

// ─── Collision Callback (registered with Physics) ───────────────────────────

Physics.initPhysics({
  onTopDied: (instance) => {
    // Nothing extra needed here; game.js handles win logic
  },
  onCollision: (instA, instB, force) => {
    if (instA.body && instB.body) {
      const mx = (instA.body.position.x + instB.body.position.x) / 2;
      const my = (instA.body.position.y + instB.body.position.y) / 2;
      spawnSparks(mx, my, Math.min(force / 12, 1.0));
    }
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ─── Start ───────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  initGame();
  requestAnimationFrame(gameLoop);
});