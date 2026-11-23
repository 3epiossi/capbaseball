import { simToField, type FieldV3 } from '../physics/batted';
import {
  CATCHER_BLOCK_MAX_CHASE,
  CATCHER_BLOCK_REACTION_DELAY,
  CATCHER_BLOCK_SPRINT_SPEED,
  CATCHER_HOME_POS,
  OUTFIELDER_BLOCK_MAX_CHASE,
  OUTFIELDER_BLOCK_REACTION_DELAY,
  OUTFIELDER_SPRINT_SPEED,
  PITCHER_BLOCK_MAX_CHASE,
  PITCHER_BLOCK_REACTION_DELAY,
  PITCHER_BLOCK_SPRINT_SPEED,
  PITCHER_HOME_POS,
  type FielderId,
} from '../physics/contact';
import {
  PITCH_IDS,
  PITCH_SPECS,
  type PitchId,
  type PitchTrajectoryResult,
} from '../physics/pitches';
import { FENCE_DIST, isInStrikeZone, PLATE_WIDTH, STRIKE_ZONE_HI, STRIKE_ZONE_LO } from '../rules/field';
import type { FielderAnim } from '../render/sprites';

export interface CpuPitchChoice {
  pitchId: PitchId;
  speedKmh: number;
  targetX: number;
  targetY: number;
  scatterX: number;
  scatterY: number;
}

function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function chooseCpuPitch(
  difficulty: number,
  balls: number,
  strikes: number,
): CpuPitchChoice {
  const diff = Math.max(1, Math.min(5, difficulty));
  const pitchId = PITCH_IDS[Math.floor(Math.random() * PITCH_IDS.length)];
  const spec = PITCH_SPECS[pitchId];

  const [minS, maxS] = spec.speedRangeKmh;
  const speedBias = 0.45 + diff * 0.09;
  const speedKmh = Math.round(
    Math.max(minS, Math.min(maxS, minS + (maxS - minS) * randRange(speedBias - 0.25, speedBias + 0.15))),
  );

  // Aim corners/edges when ahead in count, more in zone when behind
  const throwStrikeBias = balls >= 2 ? 0.85 : strikes >= 2 ? 0.52 : 0.72;
  const hw = PLATE_WIDTH * 0.5;
  const targetX =
    Math.random() < throwStrikeBias
      ? randRange(-hw * 0.85, hw * 0.85)
      : (Math.random() < 0.5 ? -1 : 1) * randRange(hw * 0.95, hw * 1.45);
  const targetY =
    Math.random() < throwStrikeBias
      ? randRange(STRIKE_ZONE_LO + 0.05, STRIKE_ZONE_HI - 0.05)
      : Math.random() < 0.5
        ? randRange(STRIKE_ZONE_LO - 0.16, STRIKE_ZONE_LO)
        : randRange(STRIKE_ZONE_HI, STRIKE_ZONE_HI + 0.16);

  // Scatter shrinks with difficulty
  const maxScatter = (6 - diff) * 0.028;
  return {
    pitchId,
    speedKmh,
    targetX,
    targetY,
    scatterX: randRange(-maxScatter, maxScatter),
    scatterY: randRange(-maxScatter, maxScatter),
  };
}

export interface CpuSwingPlan {
  shouldSwing: boolean;
  swingTimeSec: number;
  aimX: number;
  aimY: number;
}

export function evaluateCpuSwing(
  pitch: PitchTrajectoryResult,
  difficulty: number,
): CpuSwingPlan {
  const diff = Math.max(1, Math.min(5, difficulty));
  const hitField = simToField(pitch.hitPlanePos);
  const inZone = isInStrikeZone(hitField[0], hitField[1]);

  // Break makes CPU more likely to chase drops/knuckleballs
  const breakMag = Math.hypot(pitch.breakDelta[1], pitch.breakDelta[2]);
  const chaseProb = Math.max(0.08, 0.42 - diff * 0.06 + breakMag * 0.35);
  const takeStrikeProb = Math.max(0.08, 0.32 - diff * 0.05);

  const shouldSwing = inZone ? Math.random() > takeStrikeProb : Math.random() < chaseProb;

  const aimErr = (6 - diff) * 0.025 + breakMag * 0.12;
  const timingErr = (6 - diff) * 0.016;

  return {
    shouldSwing,
    swingTimeSec: pitch.hitPlaneTimeSec + randRange(-timingErr, timingErr),
    aimX: hitField[0] + randRange(-aimErr, aimErr),
    aimY: hitField[1] + randRange(-aimErr, aimErr),
  };
}

export interface CatcherCatchContext {
  pitchId?: PitchId;
  speedKmh?: number;
  breakCm?: number;
  seed?: number;
}

export interface CatcherCatchOutcome {
  caught: boolean;
  kind: 'caught' | 'wild_pitch' | 'passed_ball';
}

function deterministicCatchUnit(seed?: number): number {
  if (seed === undefined) return Math.random();
  let a = (seed ^ 0x9e3779b9) >>> 0 || 1;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Evaluates catcher reception of a non-contacted pitch:
 * - Wild Pitch: pitch misses outside catcher comfort reach (|x| > 0.42m or y < 0.18m or y > 1.35m)
 *   and eludes diving block (harder to block at higher velocity).
 * - Passed Ball: pitch is inside comfort reach, but unpredictable knuckleball flutter, sharp low
 *   vertical drop, or blazing velocity (>= 72 km/h) near edges slips past the catcher.
 */
export function evaluateCatcherCatch(
  plateX: number,
  plateY: number,
  reachesPassLine: boolean,
  ctx?: CatcherCatchContext | number,
): CatcherCatchOutcome {
  const opts: CatcherCatchContext = typeof ctx === 'number' ? { seed: ctx } : (ctx ?? {});
  const isDirtSkip = plateY < 0.14;
  if (!reachesPassLine && !isDirtSkip) {
    return { caught: true, kind: 'caught' };
  }

  const dx = Math.abs(plateX);
  const spd = opts.speedKmh ?? 65;
  const brk = opts.breakCm ?? 0;
  const r = deterministicCatchUnit(opts.seed);

  // 1. Inside catcher comfort box (|x| <= 0.42m, y in [0.18m, 1.35m])
  const inComfort = dx <= 0.42 && plateY >= 0.18 && plateY <= 1.35;
  if (inComfort) {
    let pbProb = 0;
    const nearEdge = dx > 0.24 || plateY < 0.34 || plateY > 1.12;

    // Knuckleball late unsteady wake flutter can fool even a ready catcher
    if (opts.pitchId === 'knuckle') {
      pbProb += nearEdge ? 0.105 : 0.072;
    }
    // Blazing fastball / cutter velocity reduces catcher reaction margin near edges
    if (spd >= 72) {
      const spdFactor = Math.min(1, (spd - 72) / 6); // 72 -> 78+ km/h
      pbProb += nearEdge ? 0.035 + 0.055 * spdFactor : 0.012 + 0.022 * spdFactor;
    }
    // Sharp low vertical drop (e.g. diving forkball near dirt)
    if ((opts.pitchId === 'fork' || brk >= 75) && plateY < 0.34) {
      pbProb += 0.048;
    }

    if (pbProb > 0 && r < Math.min(0.18, pbProb)) {
      return { caught: false, kind: 'passed_ball' };
    }
    return { caught: true, kind: 'caught' };
  }

  // 2. Outer diving block zone (|x| <= 0.62m, y in [0.06m, 1.56m]) -> Wild Pitch if missed
  if (dx <= 0.62 && plateY >= 0.06 && plateY <= 1.56) {
    const speedPenalty = spd >= 70 ? Math.min(0.24, ((spd - 70) / 8) * 0.24) : 0;
    const knucklePenalty = opts.pitchId === 'knuckle' ? 0.12 : 0;
    const blockProb = Math.max(0.12, 0.46 - speedPenalty - knucklePenalty);
    if (r < blockProb) {
      return { caught: true, kind: 'caught' };
    }
    return { caught: false, kind: 'wild_pitch' };
  }

  // 3. Completely wild outside diving reach (or heavy dirt bounce < 0.06m) -> Wild Pitch
  return { caught: false, kind: 'wild_pitch' };
}

export function checkCatcherCatch(
  plateX: number,
  plateY: number,
  reachesPassLine: boolean,
  ctx?: CatcherCatchContext | number,
): boolean {
  return evaluateCatcherCatch(plateX, plateY, reachesPassLine, ctx).caught;
}

export interface OutfielderActor {
  id: FielderId;
  homePos: FieldV3;
  pos: [number, number, number];
  anim: FielderAnim;
  animTime: number;
  flipX: boolean;
  diveTimer: number;
}

export interface FielderInterceptionTarget {
  fielderId: FielderId;
  targetPos: FieldV3;
  targetTimeSec: number;
  isBlock: boolean;
}

export function createOutfielders(): [OutfielderActor, OutfielderActor] {
  return [
    {
      id: 'LF',
      homePos: [-4.2, 0, -9.8],
      pos: [-4.2, 0, -9.8],
      anim: 'idle',
      animTime: 0,
      flipX: false,
      diveTimer: 0,
    },
    {
      id: 'RF',
      homePos: [4.2, 0, -9.8],
      pos: [4.2, 0, -9.8],
      anim: 'idle',
      animTime: 0,
      flipX: false,
      diveTimer: 0,
    },
  ];
}

export function createPitcherFielder(): OutfielderActor {
  return {
    id: 'P',
    homePos: [...PITCHER_HOME_POS],
    pos: [...PITCHER_HOME_POS],
    anim: 'idle',
    animTime: 0,
    flipX: false,
    diveTimer: 0,
  };
}

export function createCatcherFielder(): OutfielderActor {
  return {
    id: 'C',
    homePos: [...CATCHER_HOME_POS],
    pos: [...CATCHER_HOME_POS],
    anim: 'idle',
    animTime: 0,
    flipX: false,
    diveTimer: 0,
  };
}

export function resetOutfielders(fielders: OutfielderActor[]): void {
  for (const f of fielders) {
    f.pos[0] = f.homePos[0];
    f.pos[1] = f.homePos[1];
    f.pos[2] = f.homePos[2];
    f.anim = 'idle';
    f.animTime = 0;
    f.flipX = false;
    f.diveTimer = 0;
  }
}

const MAX_FIELDER_R = FENCE_DIST - 0.55; // 12.45m

function clampFielderInsideFence(x: number, z: number, role: FielderId = 'LF'): [number, number] {
  let cx = Math.max(-15.5, Math.min(15.5, x));
  let cz = role === 'C' ? Math.max(-4.8, Math.min(2.6, z)) : Math.max(-14.2, Math.min(2.2, z));
  // Only clamp to the 12.45m outfield fence when inside fair territory; foul territory stays freely accessible!
  if (cz < 0 && Math.abs(cx) <= -cz) {
    const r = Math.hypot(cx, cz);
    if (r > MAX_FIELDER_R) {
      const scale = MAX_FIELDER_R / r;
      cx *= scale;
      cz *= scale;
    }
  }
  return [cx, cz];
}

export function updateOutfielders(
  fielders: OutfielderActor[],
  dt: number,
  capPos: FieldV3 | null,
  landingTarget: FieldV3 | null,
  _airborne: boolean,
  alreadyCaught: boolean,
  flightTimeSec = 1.0,
  interception: FielderInterceptionTarget | null = null,
  finalTarget: FieldV3 | null = null,
): boolean {
  for (const f of fielders) {
    f.animTime += dt;
    if (f.diveTimer > 0) {
      f.diveTimer -= dt;
      continue;
    }

    if (!capPos || !landingTarget || alreadyCaught) {
      // Gently return home or idle
      const dx = f.homePos[0] - f.pos[0];
      const dz = f.homePos[2] - f.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const step = Math.min(d, OUTFIELDER_SPRINT_SPEED * 0.75 * dt);
        const [cx, cz] = clampFielderInsideFence(f.pos[0] + (dx / d) * step, f.pos[2] + (dz / d) * step, f.id);
        f.pos[0] = cx;
        f.pos[2] = cz;
        f.anim = 'run';
        f.flipX = dx < 0;
      } else {
        f.pos[0] = f.homePos[0];
        f.pos[2] = f.homePos[2];
        f.anim = 'idle';
      }
      continue;
    }

    // 1. Authoritative Interception Tracking (Zero "隔山打牛", 100% uniform constant velocity):
    //    If this defender is the exact fielder who catches/blocks/bobbles this ball,
    //    run straight to interception.targetPos at steady constant speed (d / remTime) so there is
    //    no early sprint + brake/stop, no deceleration wobble, and no snagging on fair/foul boundaries.
    if (interception && interception.fielderId === f.id) {
      // Pitcher finishes throwing follow-through briefly before transitioning into fielding sprint
      const reactDelay =
        f.id === 'P'
          ? Math.min(PITCHER_BLOCK_REACTION_DELAY * 0.85, Math.max(0.15, interception.targetTimeSec * 0.45))
          : interception.isBlock
            ? 0.10
            : 0.18;
      if (flightTimeSec < reactDelay) {
        f.anim = 'idle';
        continue;
      }
      const tx = Math.max(-18.0, Math.min(18.0, interception.targetPos[0]));
      const tz = Math.max(-16.0, Math.min(3.5, interception.targetPos[2]));
      const dx = tx - f.pos[0];
      const dz = tz - f.pos[2];
      const d = Math.hypot(dx, dz);
      const remTime = Math.max(dt, interception.targetTimeSec - flightTimeSec);
      const neededSpeed = d / remTime;
      // Exact uniform speed (d / remTime stays strictly constant across frames); only floor tiny
      // pop-up step-ins at a natural 1.8 m/s jog so the fielder never creeps in slow-motion.
      const runSpeed = Math.max(1.8, Math.min(8.5, neededSpeed));
      if (d > 0.04) {
        const step = Math.min(d, runSpeed * dt);
        f.pos[0] += (dx / d) * step;
        f.pos[2] += (dz / d) * step;
        f.anim = 'run';
        f.flipX = dx < -0.02;
      } else {
        f.pos[0] = tx;
        f.pos[2] = tz;
        f.anim = 'idle';
      }
      continue;
    }

    // 2. Uniform Constant-Speed Pursuit for non-intercepting defenders (fair & foul balls):
    //    Track ONE stable target for the entire play (never switching mid-flight from landingTarget
    //    to slowly-rolling capPos, and never jumping maxChase from 4.2m to 7.8m on bounce!) and
    //    pre-clamp the destination once so the defender runs smoothly in a straight line at constant speed.
    const reactDelay =
      f.id === 'P'
        ? PITCHER_BLOCK_REACTION_DELAY
        : f.id === 'C'
          ? CATCHER_BLOCK_REACTION_DELAY
          : OUTFIELDER_BLOCK_REACTION_DELAY;
    if (flightTimeSec < reactDelay) {
      f.anim = 'idle';
      continue;
    }

    const pursuitTarget = interception ? interception.targetPos : (finalTarget ?? landingTarget);

    let isMySide = false;
    let rawTx = f.homePos[0];
    let rawTz = f.homePos[2];
    let speedMps = OUTFIELDER_SPRINT_SPEED;
    let maxChase = OUTFIELDER_BLOCK_MAX_CHASE;

    if (f.id === 'LF' || f.id === 'RF') {
      isMySide =
        (f.id === 'LF' && pursuitTarget[0] <= 1.6) ||
        (f.id === 'RF' && pursuitTarget[0] >= -1.6);
      rawTx = isMySide ? pursuitTarget[0] : f.homePos[0] * 0.65;
      rawTz = isMySide ? Math.max(-14.2, Math.min(1.2, pursuitTarget[2])) : f.homePos[2];
      speedMps = OUTFIELDER_SPRINT_SPEED;
      maxChase = OUTFIELDER_BLOCK_MAX_CHASE;
    } else if (f.id === 'P') {
      isMySide = Math.abs(pursuitTarget[0]) <= 3.2 && pursuitTarget[2] <= -3.0 && pursuitTarget[2] >= -11.4;
      if (!isMySide) {
        f.anim = 'idle';
        continue;
      }
      rawTx = pursuitTarget[0];
      rawTz = Math.max(-10.8, Math.min(-5.2, pursuitTarget[2]));
      speedMps = PITCHER_BLOCK_SPRINT_SPEED;
      maxChase = PITCHER_BLOCK_MAX_CHASE;
    } else if (f.id === 'C') {
      isMySide = pursuitTarget[2] >= -4.8 && pursuitTarget[2] <= 3.2 && Math.abs(pursuitTarget[0]) <= 4.8;
      if (!isMySide) {
        f.anim = 'idle';
        continue;
      }
      rawTx = pursuitTarget[0];
      rawTz = Math.max(-4.8, Math.min(3.2, pursuitTarget[2]));
      speedMps = CATCHER_BLOCK_SPRINT_SPEED;
      maxChase = Math.max(CATCHER_BLOCK_MAX_CHASE, 4.6);
    }

    // Pre-clamp the fixed destination once to both maxChase radius and gym/fence bounds
    // so the fielder never hits an invisible boundary mid-run and slides or stalls.
    let goalX = rawTx;
    let goalZ = rawTz;
    const chaseX = goalX - f.homePos[0];
    const chaseZ = goalZ - f.homePos[2];
    const chaseDist = Math.hypot(chaseX, chaseZ);
    if (chaseDist > maxChase) {
      const scale = maxChase / chaseDist;
      goalX = f.homePos[0] + chaseX * scale;
      goalZ = f.homePos[2] + chaseZ * scale;
    }
    const [tx, tz] = clampFielderInsideFence(goalX, goalZ, f.id);

    const dx = tx - f.pos[0];
    const dz = tz - f.pos[2];
    const d = Math.hypot(dx, dz);

    if (d > 0.08) {
      const step = Math.min(d, speedMps * dt);
      f.pos[0] += (dx / d) * step;
      f.pos[2] += (dz / d) * step;
      f.anim = 'run';
      f.flipX = dx < -0.02;
    } else {
      f.pos[0] = tx;
      f.pos[2] = tz;
      f.anim = 'idle';
    }
  }

  return false;
}
