// game.js
// Turn logic, CPU AI, win conditions, match state
// Depends on: tops.js (window.Tops), physics.js (window.Physics)

// ─── Game Constants ──────────────────────────────────────────────────────────

const GAME = {
  // Win conditions
  ROTATION_WIN_SECONDS:  3.0,    // margin needed to claim rotation win
  DRAW_MARGIN_SECONDS:   0.5,    // if both die within this window, it's a draw

  // CPU
  CPU_LAUNCH_DELAY:      90,     // frames to wait before CPU launches (feels natural)
  CPU_AIM_SPREAD_BASE:   0.28,   // base aim error in radians (skill 0)
  CPU_AIM_SPREAD_MIN:    0.04,   // minimum aim error at max skill

  // Player skill
  SKILL_MIN:             0,
  SKILL_MAX:             100,
  SKILL_XP_PER_MATCH:    2,      // XP gained just for playing
  SKILL_XP_PER_WIN:      8,      // bonus XP for winning
  PLAYER_AIM_SPREAD_BASE: 0.32,  // aim error at skill 0
  PLAYER_AIM_SPREAD_MIN:  0.05,  // aim error at skill 100
  MISS_ARENA_CHANCE_BASE: 0.18,  // chance of missing arena entirely at skill 0
  MISS_ARENA_CHANCE_MIN:  0.02,  // chance at skill 100

  // Modes
  MODE_MATCH: 'match',
  MODE_FREE:  'free',
};

// ─── Counter / Personality Tables ───────────────────────────────────────────

// What top the CPU picks based on player's top and CPU personality
const CPU_COUNTER = {
  nomaru: {
    aggressive: 'hajiki',
    defensive:  'maru',
    standard:   'riki',
  },
  riki:   { aggressive: 'hajiki', defensive: 'hajiki', standard: 'hajiki' },
  maru:   { aggressive: 'hajiki', defensive: 'hajiki', standard: 'hajiki' },
  hajiki: { aggressive: 'maru',   defensive: 'maru',   standard: 'maru'   },
};

const CPU_PERSONALITIES = ['aggressive', 'defensive', 'standard'];

// ─── Module State ────────────────────────────────────────────────────────────

let gameState = _freshState();

function _freshState() {
  return {
    mode:            GAME.MODE_MATCH,
    phase:           'setup',       // setup → player_launch → cpu_launch → battle → result
    cpuPersonality:  'standard',
    cpuSkill:        50,            // 0–100

    playerInstance:  null,
    cpuInstance:     null,

    // Match timing
    battleStartTime: null,          // ms timestamp when both tops are in play
    lastAliveTime:   {},            // { instanceId: timestamp } when each top died

    // Win state
    result:          null,          // null | 'player_win' | 'cpu_win' | 'draw'
    resultReason:    null,

    // CPU launch countdown
    cpuLaunchTimer:  0,

    // Player skill (loaded from localStorage)
    playerSkill:     _loadSkill(),
    playerXP:        _loadXP(),
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

// Call at start of each match.
// playerTopId: 'nomaru'|'riki'|'maru'|'hajiki'
// cpuTopId: same options -- player picks this directly
function startMatch(playerTopId, cpuTopId, mode) {
  gameState = _freshState();
  gameState.mode  = mode || GAME.MODE_MATCH;
  gameState.phase = 'player_launch';

  const playerInst = Tops.createTopInstance(playerTopId, 'player');
  const cpuInst    = Tops.createTopInstance(cpuTopId, 'cpu');

  gameState.playerInstance = playerInst;
  gameState.cpuInstance    = cpuInst;

  Physics.registerInstance(playerInst);
  Physics.registerInstance(cpuInst);

  gameState.cpuLaunchTimer = GAME.CPU_LAUNCH_DELAY;

  return { playerInstance: playerInst, cpuInstance: cpuInst };
}

// ─── Turn Logic ──────────────────────────────────────────────────────────────

// Called by main.js when player releases launch drag.
// Returns launch params (possibly modified by skill miss chance).
function playerLaunch(aimAngle, spinSpeed) {
  if (gameState.phase !== 'player_launch') return null;

  const skill      = gameState.playerSkill;
  const missChance = _lerp(GAME.MISS_ARENA_CHANCE_BASE, GAME.MISS_ARENA_CHANCE_MIN, skill / GAME.SKILL_MAX);
  const aimSpread  = _lerp(GAME.PLAYER_AIM_SPREAD_BASE, GAME.PLAYER_AIM_SPREAD_MIN, skill / GAME.SKILL_MAX);

  const missed = Math.random() < missChance;
  const finalAngle = aimAngle + (Math.random() - 0.5) * aimSpread;
  const finalSpin  = Math.max(0.1, spinSpeed + (Math.random() - 0.5) * 0.15);

  gameState.phase = 'cpu_launch';

  return { angle: finalAngle, spin: finalSpin, missed };
}

// Called every frame during cpu_launch phase.
// Returns launch params when ready, null otherwise.
function updateCpuLaunch() {
  if (gameState.phase !== 'cpu_launch') return null;

  gameState.cpuLaunchTimer--;
  if (gameState.cpuLaunchTimer > 0) return null;

  // CPU is ready to launch
  const params = _calculateCpuLaunch();
  gameState.phase = 'battle';
  gameState.battleStartTime = Date.now();

  return params;
}

// ─── CPU AI ──────────────────────────────────────────────────────────────────

function _calculateCpuLaunch() {
  const personality = gameState.cpuPersonality;
  const skill       = gameState.cpuSkill;
  const aimSpread   = _lerp(GAME.CPU_AIM_SPREAD_BASE, GAME.CPU_AIM_SPREAD_MIN, skill / 100);

  const cx = Physics.PHYSICS.CANVAS_SIZE / 2;
  const cy = Physics.PHYSICS.CANVAS_SIZE / 2;
  const r  = Physics.PHYSICS.ARENA_RADIUS;

  let targetAngle;

  if (personality === 'aggressive') {
    // Aim directly at player's current position (or center if not yet launched)
    const playerBody = gameState.playerInstance && gameState.playerInstance.body;
    if (playerBody) {
      targetAngle = Math.atan2(
        playerBody.position.y - cy,
        playerBody.position.x - cx
      ) + Math.PI; // launch from opposite side toward player
    } else {
      targetAngle = Math.random() * Math.PI * 2;
    }
  } else if (personality === 'defensive') {
    // Aim toward the edge, away from center
    targetAngle = Math.random() * Math.PI * 2;
  } else {
    // Standard: aim toward center with slight variation
    targetAngle = Math.PI + (Math.random() - 0.5) * 0.6;
  }

  // Apply skill-based aim error
  const finalAngle = targetAngle + (Math.random() - 0.5) * aimSpread;
  const finalSpin  = 0.55 + Math.random() * 0.35; // CPU always gets a decent spin

  // CPU launch position: from the rim opposite to aim direction
  const launchX = cx + Math.cos(finalAngle + Math.PI) * (r * 0.72);
  const launchY = cy + Math.sin(finalAngle + Math.PI) * (r * 0.72);

  // Velocity toward target
  const speed = 9 + Math.random() * 2;
  const vx    = Math.cos(finalAngle) * speed;
  const vy    = Math.sin(finalAngle) * speed;

  return {
    x:     launchX,
    y:     launchY,
    vx,
    vy,
    spin:  finalSpin,
    angle: finalAngle,
  };
}

// ─── Battle Update ───────────────────────────────────────────────────────────

// Call every frame during battle phase.
// instances: [playerInstance, cpuInstance]
// Returns result object if match is over, null otherwise.
function updateBattle(instances) {
  if (gameState.phase !== 'battle') return null;

  const now     = Date.now();
  const alive   = instances.filter(i => i.alive);
  const dead    = instances.filter(i => !i.alive);

  // Record death times
  for (const inst of dead) {
    const id = `${inst.owner}_${inst.defId}`;
    if (!gameState.lastAliveTime[id]) {
      gameState.lastAliveTime[id] = now;
    }
  }

  // Both still alive -- keep going
  if (alive.length === 2) return null;

  // Both dead -- check draw conditions
  if (alive.length === 0) {
    return _resolveAllDead();
  }

  // One survivor
  if (alive.length === 1) {
    return _resolveOneSurvivor(alive[0], dead[0], now);
  }

  return null;
}

function _resolveAllDead() {
  const pId = `player_${gameState.playerInstance.defId}`;
  const cId = `cpu_${gameState.cpuInstance.defId}`;
  const pTime = gameState.lastAliveTime[pId] || 0;
  const cTime = gameState.lastAliveTime[cId] || 0;
  const margin = Math.abs(pTime - cTime) / 1000;

  if (margin < GAME.DRAW_MARGIN_SECONDS) {
    return _setResult('draw', 'simultaneous_stop');
  }
  // Whoever died last was the winner -- but check contact
  if (pTime > cTime) {
    return gameState.playerInstance.hasContacted
      ? _setResult('player_win', 'outlasted')
      : _setResult('draw', 'no_contact');
  } else {
    return gameState.cpuInstance.hasContacted
      ? _setResult('cpu_win', 'outlasted')
      : _setResult('draw', 'no_contact');
  }
}

function _resolveOneSurvivor(survivor, loser, now) {
  const loserId  = `${loser.owner}_${loser.defId}`;
  const lostTime = gameState.lastAliveTime[loserId] || now;
  const margin   = (now - lostTime) / 1000;

  // No contact = draw
  if (!survivor.hasContacted) {
    return _setResult('draw', 'no_contact');
  }

  // Not enough margin yet -- wait for rotation win threshold
  if (margin < GAME.ROTATION_WIN_SECONDS) return null;

  const winner = survivor.owner === 'player' ? 'player_win' : 'cpu_win';
  return _setResult(winner, 'rotation_win');
}

function _setResult(result, reason) {
  gameState.phase       = 'result';
  gameState.result      = result;
  gameState.resultReason = reason;

  // Update player skill/XP
  _updateSkill(result === 'player_win');

  return { result, reason };
}

// ─── Free Mode ───────────────────────────────────────────────────────────────

// In free mode, any top can be removed and relaunched.
function freeModeRemoveTop(instance) {
  if (gameState.mode !== GAME.MODE_FREE) return;
  Physics.removeTopFromWorld(instance);
  Physics.unregisterInstance(instance);
  instance.launched = false;
  instance.alive    = true;
  instance.opacity  = 1.0;
  instance.spinSpeed = 0;
  instance.tilt     = 0;
}

// ─── Player Skill ────────────────────────────────────────────────────────────

function _updateSkill(won) {
  let xp = gameState.playerXP;
  xp += GAME.SKILL_XP_PER_MATCH;
  if (won) xp += GAME.SKILL_XP_PER_WIN;

  // Skill = sqrt curve so early gains feel fast, late gains feel earned
  const newSkill = Math.min(GAME.SKILL_MAX, Math.floor(Math.sqrt(xp) * 2.2));

  gameState.playerXP    = xp;
  gameState.playerSkill = newSkill;

  _saveSkill(newSkill);
  _saveXP(xp);
}

function _loadSkill() {
  return parseInt(localStorage.getItem('beigoma_skill') || '0', 10);
}
function _saveSkill(val) {
  localStorage.setItem('beigoma_skill', String(val));
}
function _loadXP() {
  return parseInt(localStorage.getItem('beigoma_xp') || '0', 10);
}
function _saveXP(val) {
  localStorage.setItem('beigoma_xp', String(val));
}

// Save match result to history (last 20 matches)
function _saveMatchHistory(result) {
  const history = JSON.parse(localStorage.getItem('beigoma_history') || '[]');
  history.unshift({
    date:   new Date().toISOString(),
    result,
    skill:  gameState.playerSkill,
  });
  localStorage.setItem('beigoma_history', JSON.stringify(history.slice(0, 20)));
}

function getMatchHistory() {
  return JSON.parse(localStorage.getItem('beigoma_history') || '[]');
}

function resetProgress() {
  localStorage.removeItem('beigoma_skill');
  localStorage.removeItem('beigoma_xp');
  localStorage.removeItem('beigoma_history');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _pickCpuTop(playerTopId, personality) {
  return CPU_COUNTER[playerTopId]?.[personality] || 'nomaru';
}

function _randomPersonality() {
  return CPU_PERSONALITIES[Math.floor(Math.random() * CPU_PERSONALITIES.length)];
}

function _lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Expose current game state snapshot for UI rendering
function getGameState() {
  return {
    phase:          gameState.phase,
    mode:           gameState.mode,
    cpuPersonality: gameState.cpuPersonality,
    result:         gameState.result,
    resultReason:   gameState.resultReason,
    playerSkill:    gameState.playerSkill,
    playerXP:       gameState.playerXP,
    playerTop:      gameState.playerInstance,
    cpuTop:         gameState.cpuInstance,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.Game = {
    GAME,
    startMatch,
    playerLaunch,
    updateCpuLaunch,
    updateBattle,
    freeModeRemoveTop,
    getGameState,
    getMatchHistory,
    resetProgress,
  };
}