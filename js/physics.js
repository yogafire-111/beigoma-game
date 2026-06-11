// physics.js
// Matter.js world setup, bowl force, spin decay, collision handling
// Depends on: Matter.js (global), tops.js (window.Tops)

// ─── Tuning Constants ────────────────────────────────────────────────────────

const PHYSICS = {
  // Canvas / arena
  CANVAS_SIZE:      800,
  ARENA_RADIUS:     340,

  // Bowl
  BOWL_TENSION:          0.5,
  BOWL_FORCE_MAX:        0.004,   // baked from debug (was 0.0022)
  BOWL_DAMPING:          0.002,   // baked from debug (was 0.008)
  BOWL_CENTER_DEAD:      0.08,
  BOWL_LATERAL_DAMP_RATIO: 0.001,  // tangential damping as fraction of radial damping

  // Out of bounds
  EJECT_RADIUS:     1.02,

  // Spin
  SPIN_LAUNCH_MAX:  1.0,
  SPIN_DEAD_THRESH: 0.08,
  SPIN_FALL_THRESH: 0.03,
  SIDE_CONTACT_PENALTY: 0.006,
  WOBBLE_RATE:      0.012,

  // Collision
  JUMP_CHANCE:      0.06,
  JUMP_FORCE_MIN:   0.012,
  JUMP_HEIGHT_MAX:  18,

  // Hajiki drift
  HAJIKI_DRIFT_STRENGTH: 0.00018,
  HAJIKI_DRIFT_CHANGE:   0.018,

  // Sharp tip sticking (Riki, Maru)
  STICK_CHANCE:     0.0006,
  STICK_RADIUS:     90,
  STICK_DURATION:   90,

  // Fade-out
  FADE_RATE:        0.018,

  // Corner strike / ejection
  CORNER_STRIKE_THRESHOLD: 1.5,
  CORNER_STRIKE_IMPULSE:   14.0,
  CORNER_STRIKE_CHANCE:    0.50,
  EJECT_SUPPRESS_FRAMES:   25,   // frames to suppress radial damping after corner strike

  // Engine
  FPS:              60,
  GRAVITY_SCALE:    0,
};

// ─── Module State ────────────────────────────────────────────────────────────

let engine      = null;
let world       = null;
let arenaBodies = [];
let topBodies   = {};
let topPhysState = {};

let onTopDied      = null;
let onCollision    = null;
let onCornerStrike = null;   // fn(striker, target, force, impulse, selfEjected)

// ─── Init ────────────────────────────────────────────────────────────────────

function initPhysics(callbacks) {
  if (callbacks.onTopDied)      onTopDied      = callbacks.onTopDied;
  if (callbacks.onCollision)    onCollision    = callbacks.onCollision;
  if (callbacks.onCornerStrike) onCornerStrike = callbacks.onCornerStrike;

  engine = Matter.Engine.create({
    gravity: { x: 0, y: PHYSICS.GRAVITY_SCALE },
    enableSleeping: false,
  });
  world  = engine.world;

  _buildArena();
  _attachCollisionHandler();
}

// Replace callbacks without reinitializing the engine.
// Use this when a second script (e.g. debug.html) wants to intercept events.
function setCallbacks(callbacks) {
  if (callbacks.onTopDied)      onTopDied      = callbacks.onTopDied;
  if (callbacks.onCollision)    onCollision    = callbacks.onCollision;
  if (callbacks.onCornerStrike) onCornerStrike = callbacks.onCornerStrike;
}

function _buildArena() {
  arenaBodies = [];
}

// ─── Add / Remove Tops ───────────────────────────────────────────────────────

const BODY_PARAMS = {
  friction:    0.03,
  frictionAir: 0.001,
  restitution: 0.45,   // raised from 0.30 for more knockback
  colLossMult: 0.05,   // baked from debug (was 0.08)
  colSustain:  0.06,
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

  const id = _instanceId(instance);
  topBodies[id]      = body;
  instance.body      = body;
  instance.spinSpeed = Math.min(spinSpeed, PHYSICS.SPIN_LAUNCH_MAX);
  instance.launched  = true;

  topPhysState[id] = {
    driftAngle:   Math.random() * Math.PI * 2,
    stuckFrames:  0,
    jumpOffset:   0,
    jumpVel:      0,
    tickPhase:    0,
    ejectFrames:  0,   // frames remaining where radial damping is suppressed
    auraPhase:    Math.random() * Math.PI * 2,  // independent aura wave timer
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

function updatePhysics(instances) {
  Matter.Engine.update(engine, 1000 / PHYSICS.FPS);

  const cx = PHYSICS.CANVAS_SIZE / 2;
  const cy = PHYSICS.CANVAS_SIZE / 2;

  for (const instance of instances) {
    if (!instance.alive || !instance.launched) continue;

    const id     = _instanceId(instance);
    const body   = topBodies[id];
    const pstate = topPhysState[id];
    if (!body || !pstate) continue;

    const dx   = body.position.x - cx;
    const dy   = body.position.y - cy;
    const dist = Math.hypot(dx, dy);

    // ── Out of bounds check ──
    if (dist > PHYSICS.ARENA_RADIUS * PHYSICS.EJECT_RADIUS && instance.alive) {
      instance.alive   = false;
      instance.ejected = true;
      Matter.Body.setStatic(body, true);
      if (onTopDied) onTopDied(instance);
    }

    if (!instance.alive) {
      instance.opacity = Math.max(0, instance.opacity - PHYSICS.FADE_RATE);
      continue;
    }

    // Pass pstate so bowl force can check ejectFrames
    _applyBowlForce(body, dx, dy, dist, pstate);

    if (instance.defId === 'hajiki') {
      _applyHajikiDrift(body, pstate);
    }

    if (instance.def.tipType === 'fine' && pstate.stuckFrames <= 0) {
      _checkSticking(body, pstate, dist, instance.spinSpeed);
    }
    if (pstate.stuckFrames > 0) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      pstate.stuckFrames--;
    }

    _updateSpinDecay(instance, body, dist);
    _updateJump(pstate);

    pstate.tickPhase += instance.spinSpeed * 8.7;
    pstate.auraPhase += 0.04;   // fixed rate, independent of spin
    instance.angle    = pstate.tickPhase;
    instance.auraPhase = pstate.auraPhase;

    if (instance.spinSpeed <= PHYSICS.SPIN_FALL_THRESH && instance.alive) {
      instance.alive = false;
      if (body) Matter.Body.setStatic(body, true);
      if (onTopDied) onTopDied(instance);
    }

    if (!instance.alive) {
      instance.opacity = Math.max(0, instance.opacity - PHYSICS.FADE_RATE);
    }
  }

  // Proximity contact penalty -- catches silent grinding that collisionActive misses.
  // If two live tops are overlapping, apply a small spin loss each frame.
  _applyProximityPenalty(instances);
}

function _applyProximityPenalty(instances) {
  const live = instances.filter(i => i.alive && i.launched && i.body);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const instA = live[i];
      const instB = live[j];
      const dx   = instA.body.position.x - instB.body.position.x;
      const dy   = instA.body.position.y - instB.body.position.y;
      const dist = Math.hypot(dx, dy);
      const minDist = instA.def.radius + instB.def.radius;

      if (dist < minDist) {
        // Flat penalty per frame of contact -- meaningful even at low overlap.
        // Overlap scaling adds a little extra for deep locks.
        const overlap = (minDist - dist) / minDist;
        const penalty = 0.0012 + overlap * 0.003;
        instA.spinSpeed = Math.max(0, instA.spinSpeed - penalty);
        instB.spinSpeed = Math.max(0, instB.spinSpeed - penalty);
      }
    }
  }
}

// ─── Bowl Force ──────────────────────────────────────────────────────────────

function _applyBowlForce(body, dx, dy, dist, pstate) {
  const r        = PHYSICS.ARENA_RADIUS;
  const deadZone = r * PHYSICS.BOWL_CENTER_DEAD;

  if (dist < deadZone) return;

  const t        = Math.min(dist / r, 1.0);
  const slope    = Math.pow(t, 1.5 + PHYSICS.BOWL_TENSION);
  const forceMag = slope * PHYSICS.BOWL_FORCE_MAX * body.mass;
  const nx = dx / dist;
  const ny = dy / dist;

  Matter.Body.applyForce(body, body.position, {
    x: -nx * forceMag,
    y: -ny * forceMag,
  });

  // Suppress radial damping for EJECT_SUPPRESS_FRAMES after a corner strike.
  if (pstate && pstate.ejectFrames > 0) {
    pstate.ejectFrames--;
    return;
  }

  const vel     = body.velocity;
  const radialV = vel.x * nx + vel.y * ny;
  Matter.Body.applyForce(body, body.position, {
    x: -nx * radialV * PHYSICS.BOWL_DAMPING * body.mass,
    y: -ny * radialV * PHYSICS.BOWL_DAMPING * body.mass,
  });

  // Lateral (tangential) damping -- reduces sideways sliding.
  // Applied outside the ejectFrames guard so it doesn't fight the ejection impulse.
  const tangV = vel.x * (-ny) + vel.y * nx;
  Matter.Body.applyForce(body, body.position, {
    x:  ny * tangV * PHYSICS.BOWL_DAMPING * PHYSICS.BOWL_LATERAL_DAMP_RATIO * body.mass,
    y: -nx * tangV * PHYSICS.BOWL_DAMPING * PHYSICS.BOWL_LATERAL_DAMP_RATIO * body.mass,
  });
}

// ─── Hajiki Drift ────────────────────────────────────────────────────────────

function _applyHajikiDrift(body, pstate) {
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
  const chance = PHYSICS.STICK_CHANCE * (1.2 - spinSpeed);
  if (Math.random() < chance) {
    pstate.stuckFrames = PHYSICS.STICK_DURATION;
  }
}

// ─── Spin Decay ──────────────────────────────────────────────────────────────

const TIP_FRICTION = {
  fine:  0.000120,
  round: 0.000195,
  flat:  0.000380,
};

function _updateSpinDecay(instance, body, dist) {
  const def = instance.def;

  const tipFriction  = TIP_FRICTION[def.tipType] || TIP_FRICTION.round;
  const massPressure = 0.85 + def.mass * 0.18;
  const alignFactor  = 1.9 - instance.alignment;

  let decay = tipFriction * massPressure * alignFactor;

  if (instance.tilt > 0.6 || instance.sideContact) {
    const tiltFactor = Math.max(0, instance.tilt - 0.6) / 0.4;
    decay += PHYSICS.SIDE_CONTACT_PENALTY * tiltFactor * 3;
    instance.sideContact = instance.tilt > 0.75;
  } else {
    instance.sideContact = false;
  }

  instance.spinSpeed = Math.max(0, instance.spinSpeed - decay);

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
    pstate.jumpVel    -= 1.1;
    if (pstate.jumpOffset <= 0) {
      pstate.jumpOffset = 0;
      pstate.jumpVel    = 0;
    }
  }
}

function _triggerJump(pstate) {
  if (pstate.jumpOffset > 0) return;
  pstate.jumpVel = 6 + Math.random() * 6;
}

// ─── Collision Handler ───────────────────────────────────────────────────────

function _attachCollisionHandler() {
  Matter.Events.on(engine, 'collisionStart', (event) => {
    _handleCollisionPairs(event.pairs, true);
  });

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

    // Track sustained contact duration per pair
    const pairKey = [_instanceId(instA), _instanceId(instB)].sort().join('|');

    if (isInitial) {
      // Reset contact counter on fresh collision
      _contactFrames[pairKey] = 0;

      _applyCollisionSpinLoss(instA, instB, force, 1.0);
      _applyCollisionSpinLoss(instB, instA, force, 1.0);
      _applyDeflection(instA, bodyA, bodyB, force);
      _applyDeflection(instB, bodyB, bodyA, force);
      _applyCornerStrike(instA, instB, bodyA, bodyB, force);

      if (instA.defId === 'riki' || instB.defId === 'riki') {
        _applyHexagonImpulse(instA, instB, bodyA, bodyB);
      }

      if (force > PHYSICS.JUMP_FORCE_MIN && Math.random() < PHYSICS.JUMP_CHANCE) {
        const pA = topPhysState[_instanceId(instA)];
        const pB = topPhysState[_instanceId(instB)];
        if (pA) _triggerJump(pA);
        if (pB && Math.random() < 0.4) _triggerJump(pB);
      }

      if (onCollision) onCollision(instA, instB, force);

    } else {
      // Sustained contact -- increment counter and apply escalating spin loss
      _contactFrames[pairKey] = (_contactFrames[pairKey] || 0) + 1;
      const frames = _contactFrames[pairKey];

      // Base loss applies immediately; escalating loss kicks in after 10 frames
      // to avoid penalising brief grazing contacts
      const escalation = Math.min(frames / 30, 1.0);
      // Per-top grind factor: maru slides off, hajiki is erratic, nomaru/riki are equivalent round grinders.
      const GRIND_FACTOR = { nomaru: 0.70, riki: 0.70, maru: 0.52, hajiki: 0.64 };
      const gfA = GRIND_FACTOR[instA.defId] || 0.70;
      const gfB = GRIND_FACTOR[instB.defId] || 0.70;
      const grindFactor  = Math.max(gfA, gfB);
      const sustainScale = BODY_PARAMS.colSustain + escalation * 0.018 * grindFactor;

      _applyCollisionSpinLoss(instA, instB, Math.max(force, 0.5), sustainScale);
      _applyCollisionSpinLoss(instB, instA, Math.max(force, 0.5), sustainScale);

      // After 45 frames of grinding, apply a separating impulse to break the lock
      if (frames === 45) {
        const dx  = bodyB.position.x - bodyA.position.x;
        const dy  = bodyB.position.y - bodyA.position.y;
        const mag = Math.hypot(dx, dy) || 1;
        const sep = 0.006 * body_avgMass(instA, instB);
        Matter.Body.applyForce(bodyA, bodyA.position, { x: -(dx / mag) * sep, y: -(dy / mag) * sep });
        Matter.Body.applyForce(bodyB, bodyB.position, { x:  (dx / mag) * sep, y:  (dy / mag) * sep });
      }
    }
  }
}

const _contactFrames = {};

function body_avgMass(instA, instB) {
  const bA = instA.body;
  const bB = instB.body;
  if (!bA || !bB) return 1;
  return (bA.mass + bB.mass) / 2;
}

// ─── Hexagon Impulse ─────────────────────────────────────────────────────────

function _applyHexagonImpulse(instA, instB, bodyA, bodyB) {
  const rikiInst  = instA.defId === 'riki' ? instA : instB;
  const rikiBody  = instA.defId === 'riki' ? bodyA : bodyB;
  const otherBody = instA.defId === 'riki' ? bodyB : bodyA;
  const otherInst = instA.defId === 'riki' ? instB : instA;

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
    otherInst.spinSpeed = Math.max(0, otherInst.spinSpeed - 0.025 * rikiInst.spinSpeed);
  }
}

// ─── Collision Spin Loss ─────────────────────────────────────────────────────

function _applyCollisionSpinLoss(instance, opponent, force, scale) {
  const s             = scale !== undefined ? scale : 1.0;
  const impactMod     = opponent.def.impactForce;
  const massMod       = opponent.def.mass / instance.def.mass;
  const deflectAbsorb = 1.0 - (instance.def.deflection * 0.5);

  const loss = force * BODY_PARAMS.colLossMult * impactMod * massMod
             * (1.1 - instance.def.stability) * deflectAbsorb * s;
  instance.spinSpeed = Math.max(0, instance.spinSpeed - loss);

  const tipThreshold = 0.8 * instance.def.stability;
  if (force * impactMod > tipThreshold) {
    const excess = (force * impactMod - tipThreshold) / tipThreshold;
    instance.tilt = Math.min(1.0, instance.tilt + excess * 0.04);
  }
}

// ─── Deflection ──────────────────────────────────────────────────────────────

function _applyDeflection(instance, ownBody, otherBody, force) {
  const dvx = ownBody.velocity.x;
  const dvy = ownBody.velocity.y;

  if (instance.defId === 'maru') {
    const awayX = ownBody.position.x - otherBody.position.x;
    const awayY = ownBody.position.y - otherBody.position.y;
    const mag   = Math.hypot(awayX, awayY) || 1;
    const spd   = Math.hypot(dvx, dvy);
    Matter.Body.setVelocity(ownBody, {
      x: (awayX / mag) * spd * 0.85,
      y: (awayY / mag) * spd * 0.85,
    });

  } else if (instance.defId === 'hajiki') {
    const randAngle = Math.random() * Math.PI * 2;
    const spd       = Math.hypot(dvx, dvy);
    const keep      = 0.5 + Math.random() * 0.3;
    Matter.Body.setVelocity(ownBody, {
      x: Math.cos(randAngle) * spd * keep,
      y: Math.sin(randAngle) * spd * keep,
    });
  }
  // nomaru / riki: standard Matter.js response
}

// ─── Corner Strike ───────────────────────────────────────────────────────────

function _applyCornerStrike(instA, instB, bodyA, bodyB, force) {
  if (force < PHYSICS.CORNER_STRIKE_THRESHOLD) return;

  const aCanStrike = instA.defId !== 'maru';
  const bCanStrike = instB.defId !== 'maru';
  if (!aCanStrike && !bCanStrike) return;

  if (Math.random() > PHYSICS.CORNER_STRIKE_CHANCE) return;

  const impulseScale = Math.min(Math.sqrt(force / PHYSICS.CORNER_STRIKE_THRESHOLD), 3.0);
  const impulse      = PHYSICS.CORNER_STRIKE_IMPULSE * impulseScale;

  let striker, target, strikerBody, targetBody;

  if (aCanStrike && !bCanStrike) {
    striker = instA; strikerBody = bodyA;
    target  = instB; targetBody  = bodyB;
  } else if (bCanStrike && !aCanStrike) {
    striker = instB; strikerBody = bodyB;
    target  = instA; targetBody  = bodyA;
  } else {
    const scoreA = instA.spinSpeed * instA.def.stability;
    const scoreB = instB.spinSpeed * instB.def.stability;
    const aIsStriker = Math.abs(scoreA - scoreB) < 0.01
      ? Math.random() < 0.5
      : scoreA > scoreB;
    if (aIsStriker) {
      striker = instA; strikerBody = bodyA;
      target  = instB; targetBody  = bodyB;
    } else {
      striker = instB; strikerBody = bodyB;
      target  = instA; targetBody  = bodyA;
    }
  }

  const dx  = targetBody.position.x - strikerBody.position.x;
  const dy  = targetBody.position.y - strikerBody.position.y;
  const mag = Math.hypot(dx, dy) || 1;

  const currentSpd = Math.hypot(targetBody.velocity.x, targetBody.velocity.y);
  Matter.Body.setVelocity(targetBody, {
    x: (dx / mag) * (impulse + currentSpd * 0.5),
    y: (dy / mag) * (impulse + currentSpd * 0.5),
  });

  const targetId = _instanceId(target);
  if (topPhysState[targetId]) {
    topPhysState[targetId].ejectFrames = PHYSICS.EJECT_SUPPRESS_FRAMES;
  }

  // Hajiki self-ejection -- 30% chance
  let selfEjected = false;
  if (striker.defId === 'hajiki' && Math.random() < 0.30) {
    const selfImpulse = impulse * 0.7;
    Matter.Body.setVelocity(strikerBody, {
      x: -(dx / mag) * selfImpulse,
      y: -(dy / mag) * selfImpulse,
    });
    const strikerId = _instanceId(striker);
    if (topPhysState[strikerId]) {
      topPhysState[strikerId].ejectFrames = PHYSICS.EJECT_SUPPRESS_FRAMES;
    }
    selfEjected = true;
  }

  if (onCornerStrike) onCornerStrike(striker, target, force, impulse, selfEjected);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _instanceId(instance) {
  return `${instance.owner}_${instance.defId}`;
}

function _findInstanceByBody(body) {
  for (const [id, b] of Object.entries(topBodies)) {
    if (b === body) {
      return _instanceRegistry[id] || null;
    }
  }
  return null;
}

const _instanceRegistry = {};

function registerInstance(instance) {
  _instanceRegistry[_instanceId(instance)] = instance;
}

function unregisterInstance(instance) {
  delete _instanceRegistry[_instanceId(instance)];
}

function getPhysState(instance) {
  return topPhysState[_instanceId(instance)] || null;
}

function resetPhysics() {
  if (world) {
    Matter.World.clear(world);
    Matter.Engine.clear(engine);
  }
  topBodies    = {};
  topPhysState = {};
  Object.keys(_contactFrames).forEach(k => delete _contactFrames[k]);
  Object.keys(_instanceRegistry).forEach(k => delete _instanceRegistry[k]);
  _buildArena();
}

// ─── Exports ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.Physics = {
    PHYSICS,
    BODY_PARAMS,
    initPhysics,
    setCallbacks,
    addTopToWorld,
    removeTopFromWorld,
    updatePhysics,
    registerInstance,
    unregisterInstance,
    getPhysState,
    resetPhysics,
  };
}