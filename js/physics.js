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
  BOWL_FORCE_MAX:   0.0022,    // inward pull strength
  BOWL_DAMPING:     0.008,     // radial-only damping -- low enough to preserve spiral
  BOWL_CENTER_DEAD: 0.08,      // fraction of radius where bowl is flat

  // Out of bounds
  EJECT_RADIUS:     1.08,      // fraction of ARENA_RADIUS before top is ejected

  // Spin
  SPIN_LAUNCH_MAX:  1.0,       // normalized spin at launch (1.0 = perfect throw)
  SPIN_DEAD_THRESH: 0.08,      // below this → top starts wobbling
  SPIN_FALL_THRESH: 0.03,      // below this → top falls and dies
  SIDE_CONTACT_PENALTY: 0.006, // extra spin loss per frame when sides rub canvas (large -- body contact is devastating)
  WOBBLE_RATE:      0.012,     // how fast tilt increases once wobbling starts

  // Collision
  JUMP_CHANCE:      0.06,      // probability of jump on high-force impact (0–1)
  JUMP_FORCE_MIN:   0.012,     // minimum impact force to trigger possible jump
  JUMP_HEIGHT_MAX:  18,        // px of upward visual offset during jump

  // Hajiki drift
  HAJIKI_DRIFT_STRENGTH: 0.00018, // reduced -- erratic but not chaotic
  HAJIKI_DRIFT_CHANGE:   0.018,   // direction shifts less often

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
  // No physical wall -- bowl force contains tops naturally
  arenaBodies = [];
}

// ─── Add / Remove Tops ───────────────────────────────────────────────────────

// Called by game.js when a top is launched into the arena.
// instance: top instance from tops.js
// x, y: launch position (canvas coords)
// vx, vy: initial velocity
// spinSpeed: 0–1 normalized
// Body params -- can be overridden by debug.html at runtime
const BODY_PARAMS = {
  friction:    0.0,
  frictionAir: 0.0005,
  restitution: 0.85,   // cast iron is bouncy -- increase for visible knockback
  colLossMult: 0.08,   // increased for meaningful collision damage
  colSustain:  0.08,
};

function addTopToWorld(instance, x, y, vx, vy, spinSpeed) {
  const def = instance.def;

  const body = Matter.Bodies.circle(x, y, def.radius, {
    mass:        def.mass * 2.5,
    friction:    BODY_PARAMS.friction,
    frictionAir: BODY_PARAMS.frictionAir,
    restitution: BODY_PARAMS.restitution,
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

    // ── Out of bounds check -- eject if past rim ──
    if (dist > PHYSICS.ARENA_RADIUS * PHYSICS.EJECT_RADIUS && instance.alive) {
      instance.alive    = false;
      instance.ejected  = true;
      Matter.Body.setStatic(body, true);  // freeze in place
      if (onTopDied) onTopDied(instance);
    }

    // ── Dead top -- static, just fade out ──
    if (!instance.alive) {
      instance.opacity = Math.max(0, instance.opacity - PHYSICS.FADE_RATE);
      continue;
    }

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
      if (body) Matter.Body.setStatic(body, true);
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

  const t       = Math.min(dist / r, 1.0);
  const tension = PHYSICS.BOWL_TENSION;
  const slope   = Math.pow(t, 1.5 + tension);

  // Inward pull
  const forceMag = slope * PHYSICS.BOWL_FORCE_MAX * body.mass;
  const nx = dx / dist;  // unit vector outward from center
  const ny = dy / dist;
  Matter.Body.applyForce(body, body.position, {
    x: -nx * forceMag,
    y: -ny * forceMag,
  });

  // Directional damping -- only damp the RADIAL component of velocity.
  // This preserves tangential (orbital) velocity, creating the spiral inward.
  // Damping the full velocity vector killed the spiral entirely.
  const vel    = body.velocity;
  const radialV = vel.x * nx + vel.y * ny;  // dot product = radial speed
  Matter.Body.applyForce(body, body.position, {
    x: -nx * radialV * PHYSICS.BOWL_DAMPING * body.mass,
    y: -ny * radialV * PHYSICS.BOWL_DAMPING * body.mass,
  });
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

// ─── Spin Decay ──────────────────────────────────────────────────────────────
// Spin slows due to friction between tip and canvas surface.
// Contact area of tip is the key variable -- fine point < round < flat line.
// Heavier tops press harder on tip (more friction) but gyroscopic mass helps stability.

const TIP_FRICTION = {
  fine:  0.000120,   // Riki, Maru -- fine point, minimal contact area
  round: 0.000195,   // Nōmaru -- round tip, moderate contact
  flat:  0.000380,   // Hajiki -- flat line tip, maximum contact area
};

function _updateSpinDecay(instance, body, dist) {
  const def   = instance.def;

  // Base decay from tip-canvas friction
  // Mass increases downward force on tip → more friction, but heavier tops
  // also have more rotational inertia → net effect is roughly neutral on duration,
  // which matches real beigoma (weight matters less than tip shape for spin duration)
  const tipFriction  = TIP_FRICTION[def.tipType] || TIP_FRICTION.round;
  const massPressure = 0.85 + def.mass * 0.18;  // heavier = slightly more friction
  const alignFactor  = 1.9 - instance.alignment; // poor alignment = more wobble = more friction

  let decay = tipFriction * massPressure * alignFactor;

  // Side contact penalty -- only kicks in at significant tilt
  // Below 0.6 tilt, top is still mostly upright -- no body contact
  if (instance.tilt > 0.6 || instance.sideContact) {
    const tiltFactor = Math.max(0, instance.tilt - 0.6) / 0.4; // 0 at tilt=0.6, 1 at tilt=1.0
    decay += PHYSICS.SIDE_CONTACT_PENALTY * tiltFactor * 3;
    instance.sideContact = instance.tilt > 0.75; // only lock in sideContact at severe tilt
  } else {
    instance.sideContact = false;
  }

  instance.spinSpeed = Math.max(0, instance.spinSpeed - decay);

  // Wobble onset: below dead threshold, tilt increases
  if (instance.spinSpeed < PHYSICS.SPIN_DEAD_THRESH) {
    instance.tilt = Math.min(1.0, instance.tilt + PHYSICS.WOBBLE_RATE);
  } else {
    instance.tilt = Math.max(0, instance.tilt - 0.004);
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
  // Initial impact
  Matter.Events.on(engine, 'collisionStart', (event) => {
    _handleCollisionPairs(event.pairs, true);
  });

  // Sustained contact -- runs every frame while touching
  // Scaled down vs initial impact but accumulates over time
  Matter.Events.on(engine, 'collisionActive', (event) => {
    _handleCollisionPairs(event.pairs, false);
  });
}

function _handleCollisionPairs(pairs, isInitial) {
  for (const pair of pairs) {
    const { bodyA, bodyB } = pair;
    if (bodyA.label === 'arena_wall' || bodyB.label === 'arena_wall') continue;

    const instA = _findInstanceByBody(bodyA);
    const instB = _findInstanceByBody(bodyB);
    if (!instA || !instB) continue;
    if (!instA.alive || !instB.alive) continue;

    const rvx   = bodyA.velocity.x - bodyB.velocity.x;
    const rvy   = bodyA.velocity.y - bodyB.velocity.y;
    const force = Math.hypot(rvx, rvy);

    instA.hasContacted = true;
    instB.hasContacted = true;

    if (isInitial) {
      // Sharp impact -- full spin loss
      _applyCollisionSpinLoss(instA, instB, force, 1.0);
      _applyCollisionSpinLoss(instB, instA, force, 1.0);
      _applyDeflection(instA, bodyA, bodyB, force);
      _applyDeflection(instB, bodyB, bodyA, force);

      // Riki hexagon edge -- periodic sharp impulse
      if (instA.defId === 'riki' || instB.defId === 'riki') {
        _applyHexagonImpulse(instA, instB, bodyA, bodyB);
      }

      // Rare jump on high impact
      if (force > PHYSICS.JUMP_FORCE_MIN && Math.random() < PHYSICS.JUMP_CHANCE) {
        const pA = topPhysState[_instanceId(instA)];
        const pB = topPhysState[_instanceId(instB)];
        if (pA) _triggerJump(pA);
        if (pB && Math.random() < 0.4) _triggerJump(pB);
      }

      if (onCollision) onCollision(instA, instB, force);

    } else {
      // Sustained grinding contact -- smaller per-frame loss
      // Only significant if they're actually rubbing (low relative velocity)
      if (force < 1.5) {
        _applyCollisionSpinLoss(instA, instB, 0.4, BODY_PARAMS.colSustain);
        _applyCollisionSpinLoss(instB, instA, 0.4, BODY_PARAMS.colSustain);
      }
    }
  }
}

function _applyHexagonImpulse(instA, instB, bodyA, bodyB) {
  // When Riki's hexagon edge rotates past contact point, it creates
  // a periodic sharp push rather than smooth sliding
  const rikiInst = instA.defId === 'riki' ? instA : instB;
  const rikiBody = instA.defId === 'riki' ? bodyA : bodyB;
  const otherBody = instA.defId === 'riki' ? bodyB : bodyA;
  const otherInst = instA.defId === 'riki' ? instB : instA;

  // Impulse fires based on rotation phase (6 edges = every PI/3 radians)
  const phase = rikiBody.angle % (Math.PI / 3);
  if (phase < 0.15) {
    const awayX = otherBody.position.x - rikiBody.position.x;
    const awayY = otherBody.position.y - rikiBody.position.y;
    const mag   = Math.hypot(awayX, awayY) || 1;
    const impulse = 0.008 * rikiInst.spinSpeed;
    Matter.Body.applyForce(otherBody, otherBody.position, {
      x: (awayX / mag) * impulse,
      y: (awayY / mag) * impulse,
    });
    // Spin loss on the receiving top
    otherInst.spinSpeed = Math.max(0, otherInst.spinSpeed - 0.025 * rikiInst.spinSpeed);
  }
}

function _applyCollisionSpinLoss(instance, opponent, force, scale) {
  const s         = scale !== undefined ? scale : 1.0;
  const impactMod = opponent.def.impactForce;
  const massMod   = opponent.def.mass / instance.def.mass;
  const loss      = force * BODY_PARAMS.colLossMult * impactMod * massMod * (1.1 - instance.def.stability) * s;
  instance.spinSpeed = Math.max(0, instance.spinSpeed - loss);

  // Side contact only on very hard hits relative to stability
  const tipThreshold = 0.8 * instance.def.stability;
  if (force * impactMod > tipThreshold) {
    const excess = (force * impactMod - tipThreshold) / tipThreshold;
    // Small tilt increment -- a single hit should nudge, not instantly topple
    // Multiple hard hits accumulate to eventually destabilize
    instance.tilt = Math.min(1.0, instance.tilt + excess * 0.04);
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
    BODY_PARAMS,
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