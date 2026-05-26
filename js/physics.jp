// physics.js
// Matter.js world setup, bowl force, spin decay, collision handling
// Depends on: Matter.js (global), tops.js (window.Tops)

// ─── Tuning Constants ────────────────────────────────────────────────────────

const PHYSICS = {
  // Canvas / arena
  CANVAS_SIZE:      800,       // px, square canvas
  ARENA_RADIUS:     340,       // px, bowl rim radius

  // Bowl
  BOWL_TENSION:     0.5,       // 0 = flat, 1 = steep funnel
  BOWL_FORCE_MAX:   0.0018,    // max radial force at rim (tune for feel)
  BOWL_CENTER_DEAD: 0.08,      // fraction of radius where bowl is flat (no force)

  // Spin
  SPIN_LAUNCH_MAX:  1.0,       // normalized spin at launch (1.0 = perfect throw)
  SPIN_DECAY_BASE:  0.00055,   // spin lost per frame under normal conditions
  SPIN_DEAD_THRESH: 0.08,      // below this → top starts wobbling
  SPIN_FALL_THRESH: 0.03,      // below this → top falls and dies
  SIDE_CONTACT_PENALTY: 0.004, // extra spin loss per frame when sides rub canvas
  WOBBLE_RATE:      0.04,      // how fast tilt increases once wobbling starts

  // Collision
  JUMP_CHANCE:      0.06,      // probability of jump on high-force impact (0–1)
  JUMP_FORCE_MIN:   0.012,     // minimum impact force to trigger possible jump
  JUMP_HEIGHT_MAX:  18,        // px of upward visual offset during jump

  // Hajiki drift
  HAJIKI_DRIFT_STRENGTH: 0.00055, // random lateral force per frame
  HAJIKI_DRIFT_CHANGE:   0.04,    // how often drift direction shifts (per frame probability)

  // Sharp tip sticking (Riki, Maru)
  STICK_CHANCE:     0.0006,    // per-frame probability when near center
  STICK_RADIUS:     90,        // px from center where sticking can occur
  STICK_DURATION:   90,        // frames a stuck top stays stuck

  // Fade-out
  FADE_RATE:        0.018,     // opacity lost per frame once dead

  // Engine
  FPS:              60,
  GRAVITY_SCALE:    0,         // we handle all forces manually
};

// ─── Module State ────────────────────────────────────────────────────────────

let engine   = null;
let world    = null;
let arenaBodies = [];   // static boundary bodies
let topBodies   = {};   // map of instance id → Matter body

// Per-top extended state (physics details not on the instance itself)
let topPhysState = {};
// topPhysState[id] = {
//   driftAngle,       // current hajiki drift direction (radians)
//   stuckFrames,      // frames remaining if stuck (0 = not stuck)
//   jumpOffset,       // current visual Y jump offset
//   jumpVel,          // jump velocity (decays)
//   tickPhase,        // accumulated rotation for rim tick animation
// }

// Callbacks set by game.js
let onTopDied     = null;   // fn(instance)
let onCollision   = null;   // fn(instanceA, instanceB, force)

// ─── Init ────────────────────────────────────────────────────────────────────

function initPhysics(callbacks) {
  if (callbacks.onTopDied)   onTopDied   = callbacks.onTopDied;
  if (callbacks.onCollision) onCollision = callbacks.onCollision;

  engine = Matter.Engine.create({ gravity: { x: 0, y: PHYSICS.GRAVITY_SCALE } });
  world  = engine.world;

  _buildArena();
  _attachCollisionHandler();
}

// Build circular arena wall from many small static segments
function _buildArena() {
  const cx    = PHYSICS.CANVAS_SIZE / 2;
  const cy    = PHYSICS.CANVAS_SIZE / 2;
  const r     = PHYSICS.ARENA_RADIUS;
  const segs  = 48;
  const walls = [];

  for (let i = 0; i < segs; i++) {
    const a1 = (Math.PI * 2 / segs) * i;
    const a2 = (Math.PI * 2 / segs) * (i + 1);
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const x2 = cx + Math.cos(a2) * r;
    const y2 = cy + Math.sin(a2) * r;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1);

    const seg = Matter.Bodies.rectangle(mx, my, len + 2, 8, {
      isStatic: true,
      angle: ang,
      friction: 0.3,
      restitution: 0.55,
      label: 'arena_wall',
    });
    walls.push(seg);
  }

  arenaBodies = walls;
  Matter.World.add(world, walls);
}

// ─── Add / Remove Tops ───────────────────────────────────────────────────────

// Called by game.js when a top is launched into the arena.
// instance: top instance from tops.js
// x, y: launch position (canvas coords)
// vx, vy: initial velocity
// spinSpeed: 0–1 normalized
function addTopToWorld(instance, x, y, vx, vy, spinSpeed) {
  const def = instance.def;

  const body = Matter.Bodies.circle(x, y, def.radius, {
    mass:        def.mass * 2.5,   // scale up so forces feel right
    friction:    0.01,
    frictionAir: 0.008,
    restitution: 0.45,
    label:       instance.defId,
  });

  Matter.Body.setVelocity(body, { x: vx, y: vy });
  Matter.World.add(world, body);

  // Store references
  const id = _instanceId(instance);
  topBodies[id]    = body;
  instance.body    = body;
  instance.spinSpeed = Math.min(spinSpeed, PHYSICS.SPIN_LAUNCH_MAX);
  instance.launched  = true;

  topPhysState[id] = {
    driftAngle:  Math.random() * Math.PI * 2,
    stuckFrames: 0,
    jumpOffset:  0,
    jumpVel:     0,
    tickPhase:   0,
  };
}

function removeTopFromWorld(instance) {
  const id   = _instanceId(instance);
  const body = topBodies[id];
  if (body) {
    Matter.World.remove(world, body);
    delete topBodies[id];
    delete topPhysState[id];
  }
  instance.body = null;
}

// ─── Per-Frame Update ────────────────────────────────────────────────────────

// Call this every frame from main.js game loop, passing all live instances.
function updatePhysics(instances) {
  Matter.Engine.update(engine, 1000 / PHYSICS.FPS);

  const cx = PHYSICS.CANVAS_SIZE / 2;
  const cy = PHYSICS.CANVAS_SIZE / 2;

  for (const instance of instances) {
    if (!instance.alive || !instance.launched) continue;

    const id    = _instanceId(instance);
    const body  = topBodies[id];
    const pstate = topPhysState[id];
    if (!body || !pstate) continue;

    const dx   = body.position.x - cx;
    const dy   = body.position.y - cy;
    const dist = Math.hypot(dx, dy);

    // ── Bowl force ──
    _applyBowlForce(body, dx, dy, dist);

    // ── Hajiki drift ──
    if (instance.defId === 'hajiki') {
      _applyHajikiDrift(body, pstate);
    }

    // ── Sharp tip sticking ──
    if (instance.def.tipType === 'fine' && pstate.stuckFrames <= 0) {
      _checkSticking(body, pstate, dist, instance.spinSpeed);
    }
    if (pstate.stuckFrames > 0) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      pstate.stuckFrames--;
    }

    // ── Spin decay ──
    _updateSpinDecay(instance, body, dist);

    // ── Jump animation ──
    _updateJump(pstate);

    // ── Tick phase (rim animation) ──
    pstate.tickPhase += instance.spinSpeed * 0.18;

    // ── Sync visual angle from physics body ──
    instance.angle = body.angle + pstate.tickPhase * 0.5;

    // ── Death check ──
    if (instance.spinSpeed <= PHYSICS.SPIN_FALL_THRESH && instance.alive) {
      instance.alive = false;
      if (onTopDied) onTopDied(instance);
    }

    // ── Fade out dead tops ──
    if (!instance.alive) {
      instance.opacity = Math.max(0, instance.opacity - PHYSICS.FADE_RATE);
    }
  }
}

// ─── Bowl Force ──────────────────────────────────────────────────────────────

function _applyBowlForce(body, dx, dy, dist) {
  const r        = PHYSICS.ARENA_RADIUS;
  const deadZone = r * PHYSICS.BOWL_CENTER_DEAD;

  if (dist < deadZone) return;

  // Normalised distance from center (0 at center, 1 at rim)
  const t = Math.min(dist / r, 1.0);

  // Bowl shape: steeper near rim, flatter near center
  // BOWL_TENSION controls how curved the bowl is
  const tension = PHYSICS.BOWL_TENSION;
  const slope   = Math.pow(t, 1.5 + tension);

  const forceMag = slope * PHYSICS.BOWL_FORCE_MAX * body.mass;
  const fx = -(dx / dist) * forceMag;
  const fy = -(dy / dist) * forceMag;

  Matter.Body.applyForce(body, body.position, { x: fx, y: fy });
}

// ─── Hajiki Drift ────────────────────────────────────────────────────────────

function _applyHajikiDrift(body, pstate) {
  // Occasionally shift drift direction
  if (Math.random() < PHYSICS.HAJIKI_DRIFT_CHANGE) {
    pstate.driftAngle += (Math.random() - 0.5) * Math.PI * 0.9;
  }
  const strength = PHYSICS.HAJIKI_DRIFT_STRENGTH * body.mass;
  Matter.Body.applyForce(body, body.position, {
    x: Math.cos(pstate.driftAngle) * strength,
    y: Math.sin(pstate.driftAngle) * strength,
  });
}

// ─── Sharp Tip Sticking ──────────────────────────────────────────────────────

function _checkSticking(body, pstate, dist, spinSpeed) {
  if (dist > PHYSICS.STICK_RADIUS) return;
  // More likely to stick when spinning slower
  const chance = PHYSICS.STICK_CHANCE * (1.2 - spinSpeed);
  if (Math.random() < chance) {
    pstate.stuckFrames = PHYSICS.STICK_DURATION;
  }
}

// ─── Spin Decay ──────────────────────────────────────────────────────────────

function _updateSpinDecay(instance, body, dist) {
  const def   = instance.def;
  const speed = instance.spinSpeed;

  // Base decay -- modified by alignment, mass, tip type
  const alignmentFactor = 1.8 - instance.alignment;      // worse alignment = faster decay
  const massFactor      = 1.1 - def.mass * 0.12;         // lighter tops decay slightly faster
  const tipFactor       = def.tipType === 'flat' ? 1.25  // flat tip decays faster
                        : def.tipType === 'fine' ? 0.88  // fine tip is efficient
                        : 1.0;

  let decay = PHYSICS.SPIN_DECAY_BASE * alignmentFactor * massFactor * tipFactor;

  // Side contact penalty (when top is tilting)
  if (instance.tilt > 0.35 || instance.sideContact) {
    decay += PHYSICS.SIDE_CONTACT_PENALTY;
    instance.sideContact = true;
  } else {
    instance.sideContact = false;
  }

  instance.spinSpeed = Math.max(0, speed - decay);

  // Wobble: once below dead threshold, tilt increases
  if (instance.spinSpeed < PHYSICS.SPIN_DEAD_THRESH) {
    instance.tilt = Math.min(1.0, instance.tilt + PHYSICS.WOBBLE_RATE);
  } else {
    // Recover tilt slightly if spin picks up (e.g. after bowl centering)
    instance.tilt = Math.max(0, instance.tilt - 0.005);
  }
}

// ─── Jump ────────────────────────────────────────────────────────────────────

function _updateJump(pstate) {
  if (pstate.jumpOffset > 0 || pstate.jumpVel > 0) {
    pstate.jumpOffset += pstate.jumpVel;
    pstate.jumpVel    -= 1.1;   // gravity pulls it back down
    if (pstate.jumpOffset <= 0) {
      pstate.jumpOffset = 0;
      pstate.jumpVel    = 0;
    }
  }
}

function _triggerJump(pstate) {
  if (pstate.jumpOffset > 0) return; // already jumping
  pstate.jumpVel = 6 + Math.random() * 6;
}

// ─── Collision Handler ───────────────────────────────────────────────────────

function _attachCollisionHandler() {
  Matter.Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA.label === 'arena_wall' || bodyB.label === 'arena_wall') continue;

      // Find matching instances
      const instA = _findInstanceByBody(bodyA);
      const instB = _findInstanceByBody(bodyB);
      if (!instA || !instB) continue;
      if (!instA.alive || !instB.alive) continue;

      // Relative velocity magnitude = impact force proxy
      const rvx   = bodyA.velocity.x - bodyB.velocity.x;
      const rvy   = bodyA.velocity.y - bodyB.velocity.y;
      const force = Math.hypot(rvx, rvy);

      // Mark contact
      instA.hasContacted = true;
      instB.hasContacted = true;

      // Apply spin loss proportional to impact and mass ratio
      _applyCollisionSpinLoss(instA, instB, force);
      _applyCollisionSpinLoss(instB, instA, force);

      // Deflection modifier by top type
      _applyDeflection(instA, bodyA, bodyB, force);
      _applyDeflection(instB, bodyB, bodyA, force);

      // Rare jump
      if (force > PHYSICS.JUMP_FORCE_MIN && Math.random() < PHYSICS.JUMP_CHANCE) {
        const pstateA = topPhysState[_instanceId(instA)];
        const pstateB = topPhysState[_instanceId(instB)];
        if (pstateA) _triggerJump(pstateA);
        if (pstateB && Math.random() < 0.4) _triggerJump(pstateB);
      }

      // Notify game.js
      if (onCollision) onCollision(instA, instB, force);
    }
  });
}

function _applyCollisionSpinLoss(instance, opponent, force) {
  // Heavier, higher-impact opponents cause more spin loss
  const impactMod = opponent.def.impactForce;
  const massMod   = opponent.def.mass / instance.def.mass;
  const loss      = force * 0.022 * impactMod * massMod * (1.1 - instance.def.stability);
  instance.spinSpeed = Math.max(0, instance.spinSpeed - loss);

  // Side contact if hit hard enough relative to stability
  if (force * impactMod > 0.08 && instance.def.stability < 0.7) {
    instance.sideContact = true;
  }
}

function _applyDeflection(instance, ownBody, otherBody, force) {
  const deflection = instance.def.deflection;
  let   dvx = ownBody.velocity.x;
  let   dvy = ownBody.velocity.y;

  if (instance.defId === 'maru') {
    // Smooth deflect: redirect cleanly away from opponent
    const awayX = ownBody.position.x - otherBody.position.x;
    const awayY = ownBody.position.y - otherBody.position.y;
    const mag   = Math.hypot(awayX, awayY) || 1;
    const spd   = Math.hypot(dvx, dvy);
    dvx = (awayX / mag) * spd * deflection;
    dvy = (awayY / mag) * spd * deflection;
    Matter.Body.setVelocity(ownBody, { x: dvx, y: dvy });

  } else if (instance.defId === 'hajiki') {
    // Erratic deflect: add random component
    const randAngle = Math.random() * Math.PI * 2;
    const spd       = Math.hypot(dvx, dvy);
    dvx = dvx * 0.6 + Math.cos(randAngle) * spd * deflection * 0.7;
    dvy = dvy * 0.6 + Math.sin(randAngle) * spd * deflection * 0.7;
    Matter.Body.setVelocity(ownBody, { x: dvx, y: dvy });
  }
  // nomaru / riki: standard Matter.js collision response, no override needed
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Simple instance ID: owner + defId (assumes max one of each per owner in arena)
function _instanceId(instance) {
  return `${instance.owner}_${instance.defId}`;
}

function _findInstanceByBody(body) {
  for (const [id, b] of Object.entries(topBodies)) {
    if (b === body) {
      // Retrieve instance via game.js callback isn't available here,
      // so we return the id and let the caller resolve -- see note below.
      return _instanceRegistry[id] || null;
    }
  }
  return null;
}

// Instance registry: game.js registers instances here so collision
// handler can look them up by id.
const _instanceRegistry = {};

function registerInstance(instance) {
  _instanceRegistry[_instanceId(instance)] = instance;
}

function unregisterInstance(instance) {
  delete _instanceRegistry[_instanceId(instance)];
}

// Get the extended physics state for a top (for rendering jump offset, tick phase)
function getPhysState(instance) {
  return topPhysState[_instanceId(instance)] || null;
}

// Reset everything between matches
function resetPhysics() {
  if (world) {
    Matter.World.clear(world);
    Matter.Engine.clear(engine);
  }
  topBodies        = {};
  topPhysState     = {};
  Object.keys(_instanceRegistry).forEach(k => delete _instanceRegistry[k]);
  _buildArena();
}

// ─── Exports ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.Physics = {
    PHYSICS,
    initPhysics,
    addTopToWorld,
    removeTopFromWorld,
    updatePhysics,
    registerInstance,
    unregisterInstance,
    getPhysState,
    resetPhysics,
  };
}