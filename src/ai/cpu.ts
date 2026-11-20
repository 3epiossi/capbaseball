import { simToField, type FieldV3 } from '../physics/batted';
import {
  OUTFIELDER_MAX_CHASE_DIST,
  OUTFIELDER_REACTION_DELAY,
  OUTFIELDER_SPRINT_SPEED,
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

export function checkCatcherCatch(
  plateX: number,
  plateY: number,
  reachesPassLine: boolean,
  seed?: number,
): boolean {
  if (!reachesPassLine) return true;
  // Catcher can comfortably catch within ~0.58m horizontally and [0.12m, 1.48m] vertically
  const dx = Math.abs(plateX);
  const inReach = dx <= 0.58 && plateY >= 0.10 && plateY <= 1.48;
  if (inReach) return true;
  // Borderline wild pitch: small chance of diving stop
  if (dx <= 0.78 && plateY >= 0.05 && plateY <= 1.68) {
    if (seed !== undefined) {
      let a = (seed ^ 0x9e3779b9) >>> 0 || 1;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return r < 0.35;
    }
    return Math.random() < 0.35;
  }
  return false;
}

export interface OutfielderActor {
  id: 'LF' | 'RF';
  homePos: FieldV3;
  pos: [number, number, number];
  anim: FielderAnim;
  animTime: number;
  flipX: boolean;
  diveTimer: number;
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

export function resetOutfielders(fielders: [OutfielderActor, OutfielderActor]): void {
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

function clampFielderInsideFence(x: number, z: number): [number, number] {
  let cx = x;
  let cz = Math.min(-2.5, z);
  if (Math.abs(cx) > -cz) {
    cx = Math.sign(cx) * -cz;
  }
  const r = Math.hypot(cx, cz);
  if (r > MAX_FIELDER_R) {
    const scale = MAX_FIELDER_R / r;
    cx *= scale;
    cz *= scale;
  }
  return [cx, cz];
}

export function updateOutfielders(
  fielders: [OutfielderActor, OutfielderActor],
  dt: number,
  capPos: FieldV3 | null,
  landingTarget: FieldV3 | null,
  _airborne: boolean,
  alreadyCaught: boolean,
  flightTimeSec = 1.0,
): boolean {
  const speedMps = OUTFIELDER_SPRINT_SPEED;

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
        const step = Math.min(d, speedMps * 0.7 * dt);
        const [cx, cz] = clampFielderInsideFence(f.pos[0] + (dx / d) * step, f.pos[2] + (dz / d) * step);
        f.pos[0] = cx;
        f.pos[2] = cz;
        f.anim = 'run';
        f.flipX = dx < 0;
      } else {
        f.anim = 'idle';
      }
      continue;
    }

    // Reaction delay before sprinting
    if (flightTimeSec < OUTFIELDER_REACTION_DELAY) {
      f.anim = 'idle';
      continue;
    }

    // Ramp-up acceleration over first 0.35s of running
    const runElapsed = Math.max(0, flightTimeSec - OUTFIELDER_REACTION_DELAY);
    const accelFactor = Math.min(1, runElapsed / 0.35);

    // Choose target: LF covers left side (x <= 1.2), RF covers right side (x >= -1.2)
    const isMySide =
      (f.id === 'LF' && landingTarget[0] <= 1.2) ||
      (f.id === 'RF' && landingTarget[0] >= -1.2);

    const tx = isMySide ? landingTarget[0] : f.homePos[0] * 0.65;
    const tz = isMySide ? Math.max(-MAX_FIELDER_R, Math.min(-6.5, landingTarget[2])) : f.homePos[2];

    const dx = tx - f.pos[0];
    const dz = tz - f.pos[2];
    const d = Math.hypot(dx, dz);

    if (d > 0.12) {
      const step = Math.min(d, speedMps * accelFactor * dt);
      let nx = f.pos[0] + (dx / d) * step;
      let nz = f.pos[2] + (dz / d) * step;
      const chaseX = nx - f.homePos[0];
      const chaseZ = nz - f.homePos[2];
      const chaseDist = Math.hypot(chaseX, chaseZ);
      if (chaseDist > OUTFIELDER_MAX_CHASE_DIST) {
        const scale = OUTFIELDER_MAX_CHASE_DIST / chaseDist;
        nx = f.homePos[0] + chaseX * scale;
        nz = f.homePos[2] + chaseZ * scale;
      }
      const [cx, cz] = clampFielderInsideFence(nx, nz);
      f.pos[0] = cx;
      f.pos[2] = cz;
      f.anim = 'run';
      f.flipX = dx < -0.02;
    } else {
      f.anim = 'idle';
    }
  }

  return false;
}
