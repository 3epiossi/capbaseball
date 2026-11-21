import {
  simulateBattedCap,
  simToField,
  type BattedCapParams,
  type BattedCapResult,
  type FieldV3,
} from './batted';
import type { PitchTrajectoryResult } from './pitches';
import { FENCE_DIST } from '../rules/field';
import { judgeBattedCap, type BattedOutcome } from '../rules/judge';

export const HIT_PLANE_Z = -0.22;

export const OUTFIELDER_REACTION_DELAY = 0.45;
export const OUTFIELDER_SPRINT_SPEED = 3.2;
export const OUTFIELDER_CATCH_RADIUS = 0.48;
export const OUTFIELDER_MAX_CHASE_DIST = 2.6;
export const UNCATCHABLE_EXIT_SPEED_MS = 16.5;
export const UNCATCHABLE_LAUNCH_ANGLE_DEG = 22;
export const UNCATCHABLE_AIR_TIME_SEC = 0.72;
export const MAX_CATCH_RADIUS_M = FENCE_DIST - 0.4; // 12.60m
export const MAX_FIELDER_RADIUS_M = FENCE_DIST - 0.55; // 12.45m

// Enhanced outfield ground/bounce blocking (cutoff): stricter air catch, much stronger stopping balls before wall
export const OUTFIELDER_BLOCK_REACTION_DELAY = 0.24;
export const OUTFIELDER_BLOCK_SPRINT_SPEED = 4.5;
export const OUTFIELDER_BLOCK_RADIUS = 1.05;
export const OUTFIELDER_BLOCK_MAX_CHASE = 4.2;

export type SwingMode = 'normal' | 'power';
export type BatterSide = 'R' | 'L' | 'right' | 'left';
export type ContactQuality = 'perfect' | 'good' | 'early' | 'late' | 'miss';

export interface OutfielderInit {
  id: 'LF' | 'RF';
  homePos: FieldV3;
  pos: readonly [number, number, number];
}

export interface SwingEvaluationInput {
  trajectory: PitchTrajectoryResult;
  flightTimeSec: number;
  batX: number;
  batY: number;
  swingMode: SwingMode;
  batterSide: BatterSide;
  seed: number;
  outfielders?: readonly OutfielderInit[];
}

export interface CatchInfo {
  caught: boolean;
  bobbled: boolean;
  blocked?: boolean;
  fielderId: 'LF' | 'RF' | null;
  fielderIndex: number | null;
  catchTimeSec: number | null;
  catchPos: FieldV3 | null;
  pos: FieldV3 | null;
  blockTimeSec?: number | null;
  blockPos?: FieldV3 | null;
}

export interface SwingMissResolution {
  contact: false;
  feedback: string;
  label: string;
  detail: string;
  color: string;
  quality: 'miss';
  dtTiming: number;
  missDist: number;
  hitField: FieldV3;
}

export interface SwingHitResolution {
  contact: true;
  feedback: string;
  label: string;
  detail: string;
  color: string;
  quality: Exclude<ContactQuality, 'miss'>;
  rawQuality: number;
  dtTiming: number;
  missDist: number;
  hitField: FieldV3;
  battedParams: BattedCapParams;
  battedResult: BattedCapResult;
  catchInfo: CatchInfo;
  outcome: BattedOutcome;
  exitSpeedKmh: number;
  launchAngleDeg?: number;
  distanceM: number;
}

export type SwingResolution = SwingMissResolution | SwingHitResolution;

function seededFloat(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultOutfielders(): OutfielderInit[] {
  return [
    { id: 'LF', homePos: [-4.2, 0, -9.8], pos: [-4.2, 0, -9.8] },
    { id: 'RF', homePos: [4.2, 0, -9.8], pos: [4.2, 0, -9.8] },
  ];
}

export function simulateDeterministicCatch(
  batted: BattedCapResult,
  initialOutfielders: readonly OutfielderInit[],
  options?: {
    exitSpeedMs?: number;
    launchAngleDeg?: number;
    seed?: number;
  },
): CatchInfo {
  const noCatch: CatchInfo = {
    caught: false,
    bobbled: false,
    fielderId: null,
    fielderIndex: null,
    catchTimeSec: null,
    catchPos: null,
    pos: null,
  };

  if (batted.frames.length === 0) {
    return noCatch;
  }

  // Infer exit speed & launch angle from initial frame velocity if not explicitly provided
  const v0 = batted.frames[0].vel;
  const exitSpeedMs = options?.exitSpeedMs ?? Math.hypot(v0[0], v0[1], v0[2]);
  const horiz0 = Math.hypot(v0[0], v0[2]);
  const launchAngleDeg =
    options?.launchAngleDeg ?? (Math.atan2(v0[1], Math.max(1e-6, horiz0)) * 180) / Math.PI;

  // 1. High exit velocity (>= 18.0 m/s) cannot be caught in the air
  if (exitSpeedMs >= UNCATCHABLE_EXIT_SPEED_MS) {
    return noCatch;
  }

  // 2. Low launch angle (< 12 deg) cannot be caught in the air
  if (launchAngleDeg < UNCATCHABLE_LAUNCH_ANGLE_DEG) {
    return noCatch;
  }

  const landingTarget = batted.firstLandingPos ?? batted.stoppedPos;

  const actors = initialOutfielders.map((f, idx) => ({
    id: f.id,
    idx,
    homePos: f.homePos,
    x: f.pos[0],
    z: f.pos[2],
  }));

  let prevT = 0;
  let bounced = false;

  for (let i = 1; i < batted.frames.length; i++) {
    const frame = batted.frames[i];
    const dt = Math.max(0, frame.t - prevT);
    prevT = frame.t;

    const capPos = frame.pos;
    if (frame.t > 0.08 && capPos[1] <= 0.03) {
      bounced = true;
    }
    if (bounced) {
      break;
    }
    // Reject any point at/past the 13m fence arc
    const capR = Math.hypot(capPos[0], capPos[2]);
    if (capR > MAX_CATCH_RADIUS_M) {
      break;
    }

    for (const f of actors) {
      // 3. Reaction delay + ramp-up acceleration over first 0.35s of running
      if (frame.t >= OUTFIELDER_REACTION_DELAY && dt > 0) {
        const runElapsed = Math.max(0, frame.t - OUTFIELDER_REACTION_DELAY);
        const accelFactor = Math.min(1, runElapsed / 0.35);
        const isMySide =
          (f.id === 'LF' && landingTarget[0] <= 1.2) ||
          (f.id === 'RF' && landingTarget[0] >= -1.2);

        const tx = isMySide ? landingTarget[0] : f.homePos[0] * 0.65;
        const tz = isMySide
          ? Math.max(-MAX_FIELDER_RADIUS_M, Math.min(-6.5, landingTarget[2]))
          : f.homePos[2];

        const dx = tx - f.x;
        const dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const step = Math.min(d, OUTFIELDER_SPRINT_SPEED * accelFactor * dt);
          let nx = f.x + (dx / d) * step;
          let nz = f.z + (dz / d) * step;
          // Enforce maxChaseDist (2.6m) from starting position
          const chaseX = nx - f.homePos[0];
          const chaseZ = nz - f.homePos[2];
          const chaseDist = Math.hypot(chaseX, chaseZ);
          if (chaseDist > OUTFIELDER_MAX_CHASE_DIST) {
            const scale = OUTFIELDER_MAX_CHASE_DIST / chaseDist;
            nx = f.homePos[0] + chaseX * scale;
            nz = f.homePos[2] + chaseZ * scale;
          }
          // Strictly clamp inside 12.45m fence buffer & fair territory
          nz = Math.min(-2.5, nz);
          if (Math.abs(nx) > -nz) nx = Math.sign(nx) * -nz;
          const nr = Math.hypot(nx, nz);
          if (nr > MAX_FIELDER_RADIUS_M) {
            const scale = MAX_FIELDER_RADIUS_M / nr;
            nx *= scale;
            nz *= scale;
          }
          f.x = nx;
          f.z = nz;
        }
      }

      const distFromStart = Math.hypot(capPos[0] - f.homePos[0], capPos[2] - f.homePos[2]);
      const distToCap = Math.hypot(capPos[0] - f.x, capPos[2] - f.z);
      if (
        frame.t >= UNCATCHABLE_AIR_TIME_SEC &&
        capR <= MAX_CATCH_RADIUS_M &&
        distFromStart <= OUTFIELDER_MAX_CHASE_DIST &&
        distToCap <= OUTFIELDER_CATCH_RADIUS &&
        capPos[1] <= 1.95
      ) {
        const hitPos: FieldV3 = [capPos[0], capPos[1], capPos[2]];
        // 4. Deterministic bobble / drop probability even when reachable (0.30..0.55)
        const speedFactor = Math.max(0, Math.min(1, (exitSpeedMs - 9) / 7.5));
        const diveFactor = distFromStart > 1.4 ? Math.min(1, (distFromStart - 1.4) / 1.2) : 0;
        const dropProb = Math.min(0.55, 0.30 + speedFactor * 0.14 + diveFactor * 0.11);
        const bobbleRoll = seededFloat(((options?.seed ?? 1) ^ 0x517cc1b7) >>> 0)();

        if (bobbleRoll < dropProb) {
          return {
            caught: false,
            bobbled: true,
            fielderId: f.id,
            fielderIndex: f.idx,
            catchTimeSec: frame.t,
            catchPos: hitPos,
            pos: hitPos,
          };
        }

        return {
          caught: true,
          bobbled: false,
          fielderId: f.id,
          fielderIndex: f.idx,
          catchTimeSec: frame.t,
          catchPos: hitPos,
          pos: hitPos,
        };
      }
    }
  }

  return noCatch;
}

/**
 * Outfield ground/bounce cutoff: LF & RF aggressively block bouncing/rolling caps
 * before they reach the 13m fence, holding potential wall-doubles to clean singles (1B).
 */
export function simulateOutfieldGroundBlock(
  batted: BattedCapResult,
  initialOutfielders: readonly OutfielderInit[],
): {
  blocked: boolean;
  fielderId: 'LF' | 'RF' | null;
  fielderIndex: number | null;
  blockTimeSec: number | null;
  blockPos: FieldV3 | null;
  battedResult: BattedCapResult;
} {
  const noBlock = {
    blocked: false,
    fielderId: null,
    fielderIndex: null,
    blockTimeSec: null,
    blockPos: null,
    battedResult: batted,
  };

  if (batted.frames.length < 3 || batted.overFence || !batted.firstLandingPos) {
    return noBlock;
  }
  // Only block fair balls that enter the outfield (never steal infield outs)
  if (!batted.hitOutfield && !batted.hitFence) {
    return noBlock;
  }

  const actors = initialOutfielders.map((f, idx) => ({
    id: f.id,
    idx,
    homePos: f.homePos,
    x: f.pos[0],
    z: f.pos[2],
  }));

  let prevT = 0;
  let bounced = false;

  for (let i = 1; i < batted.frames.length; i++) {
    const frame = batted.frames[i];
    const dt = Math.max(0, frame.t - prevT);
    prevT = frame.t;

    const capPos = frame.pos;
    if (frame.t > 0.06 && capPos[1] <= 0.04) {
      bounced = true;
    }

    const capR = Math.hypot(capPos[0], capPos[2]);
    const inFair = capPos[2] < 0 && Math.abs(capPos[0]) <= -capPos[2];
    if (capR >= FENCE_DIST - 0.08) {
      // Already reached fence
      break;
    }

    for (const f of actors) {
      if (frame.t >= OUTFIELDER_BLOCK_REACTION_DELAY && dt > 0) {
        const runElapsed = Math.max(0, frame.t - OUTFIELDER_BLOCK_REACTION_DELAY);
        const accelFactor = Math.min(1, runElapsed / 0.22);
        const isMySide =
          (f.id === 'LF' && capPos[0] <= 1.8) ||
          (f.id === 'RF' && capPos[0] >= -1.8);

        const tx = isMySide ? capPos[0] : f.homePos[0] * 0.55;
        const tz = isMySide
          ? Math.max(-MAX_FIELDER_RADIUS_M, Math.min(-7.6, capPos[2]))
          : f.homePos[2];

        const dx = tx - f.x;
        const dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.08) {
          const step = Math.min(d, OUTFIELDER_BLOCK_SPRINT_SPEED * accelFactor * dt);
          let nx = f.x + (dx / d) * step;
          let nz = f.z + (dz / d) * step;
          const chaseX = nx - f.homePos[0];
          const chaseZ = nz - f.homePos[2];
          const chaseDist = Math.hypot(chaseX, chaseZ);
          if (chaseDist > OUTFIELDER_BLOCK_MAX_CHASE) {
            const scale = OUTFIELDER_BLOCK_MAX_CHASE / chaseDist;
            nx = f.homePos[0] + chaseX * scale;
            nz = f.homePos[2] + chaseZ * scale;
          }
          nz = Math.min(-3.0, nz);
          if (Math.abs(nx) > -nz) nx = Math.sign(nx) * -nz;
          const nr = Math.hypot(nx, nz);
          if (nr > MAX_FIELDER_RADIUS_M) {
            const scale = MAX_FIELDER_RADIUS_M / nr;
            nx *= scale;
            nz *= scale;
          }
          f.x = nx;
          f.z = nz;
        }
      }

      if (bounced && inFair && capR >= 8.05 && capR < FENCE_DIST - 0.15 && capPos[1] <= 1.25) {
        const distToCap = Math.hypot(capPos[0] - f.x, capPos[2] - f.z);
        if (distToCap <= OUTFIELDER_BLOCK_RADIUS) {
          const blockPos: FieldV3 = [capPos[0], 0.02, capPos[2]];
          const trimmedFrames = batted.frames.slice(0, i + 1);
          const trimmedResult: BattedCapResult = {
            ...batted,
            frames: trimmedFrames,
            flightTimeSec: frame.t,
            stoppedPos: blockPos,
            hitOutfield: true,
            hitFence: false,
            overFence: false,
            crossedFenceExtension: false,
            maxDistanceM: Math.min(batted.maxDistanceM, Math.hypot(blockPos[0], blockPos[2])),
          };
          return {
            blocked: true,
            fielderId: f.id,
            fielderIndex: f.idx,
            blockTimeSec: frame.t,
            blockPos,
            battedResult: trimmedResult,
          };
        }
      }
    }
  }

  return noBlock;
}

export function evaluateSwingResolution(input: SwingEvaluationInput): SwingResolution {
  const hitField = simToField(input.trajectory.hitPlanePos);
  const dtTiming = input.flightTimeSec - input.trajectory.hitPlaneTimeSec;
  const absTiming = Math.abs(dtTiming);
  const dx = input.batX - hitField[0];
  const dy = input.batY - hitField[1];
  const dist = Math.hypot(dx, dy);
  const isPower = input.swingMode === 'power';
  const meetRadius = isPower ? 0.076 : 0.108;
  const radialNorm = dist / meetRadius;

  const isFairContact = radialNorm <= 1.0 && absTiming <= 0.085;
  const isTimingFoul = absTiming > 0.085 && absTiming <= 0.145 && radialNorm <= 1.42;
  const isEdgeGrazeFoul = radialNorm > 1.0 && radialNorm <= 1.38 && absTiming <= 0.105;

  if (!isFairContact && !isTimingFoul && !isEdgeGrazeFoul) {
    return {
      contact: false,
      feedback: 'SWING & MISS',
      label: 'MISS',
      detail: absTiming > 0.085 ? (dtTiming < 0 ? 'TOO EARLY' : 'TOO LATE') : 'OFF TARGET',
      color: '#94a3b8',
      quality: 'miss',
      dtTiming,
      missDist: dist,
      hitField,
    };
  }

  const rng = seededFloat(input.seed);
  const isRight = input.batterSide === 'R' || input.batterSide === 'right';
  const pullSign = isRight ? -1 : 1;

  if (!isFairContact) {
    // Realistic Foul Ball: launch physically into foul territory (+-56..78 deg)
    const foulSide =
      absTiming > 0.085
        ? dtTiming < 0
          ? pullSign
          : -pullSign
        : dx >= 0
          ? 1
          : -1;
    const sprayDeg = foulSide * (56 + rng() * 22);
    const sprayRad = (sprayDeg * Math.PI) / 180;
    const foulExit = 11.0 + rng() * 7.0; // 11..18 m/s
    const elevDeg = 10 + rng() * 28; // 10..38 deg
    const elevRad = (elevDeg * Math.PI) / 180;

    const horiz = foulExit * Math.cos(elevRad);
    const battedParams: BattedCapParams = {
      position: [hitField[0], Math.max(0.15, hitField[1]), HIT_PLANE_Z],
      velocity: [horiz * Math.sin(sprayRad), foulExit * Math.sin(elevRad), -horiz * Math.cos(sprayRad)],
      seed: input.seed,
    };
    const battedResult = simulateBattedCap(battedParams);
    const catchInfo: CatchInfo = {
      caught: false,
      bobbled: false,
      fielderId: null,
      fielderIndex: null,
      catchTimeSec: null,
      catchPos: null,
      pos: null,
    };
    const label = absTiming > 0.085 ? (dtTiming < 0 ? 'EARLY FOUL' : 'LATE FOUL') : 'FOUL TIP';
    const feedback = absTiming > 0.085 ? (dtTiming < 0 ? 'EARLY FOUL' : 'LATE FOUL') : 'FOUL TIP';
    const color = absTiming > 0.085 ? (dtTiming < 0 ? '#38bdf8' : '#fb923c') : '#cbd5e1';
    const exitSpeedKmh = Math.round(foulExit * 3.6);
    const distanceM = battedResult.maxDistanceM;

    return {
      contact: true,
      feedback,
      label,
      detail: `${exitSpeedKmh} km/h · FOUL`,
      color,
      quality: dtTiming < 0 ? 'early' : 'late',
      rawQuality: 0.25,
      dtTiming,
      missDist: dist,
      hitField,
      battedParams,
      battedResult,
      catchInfo,
      outcome: 'FOUL',
      exitSpeedKmh,
      distanceM,
    };
  }

  const centerQuality = Math.max(0, 1 - dist / meetRadius);
  const timingQuality = Math.max(0, 1 - absTiming / 0.085);
  const rawQuality = 0.55 * centerQuality + 0.45 * timingQuality;

  let quality: Exclude<ContactQuality, 'miss'> = 'good';
  let label = 'GOOD';
  let color = '#4ade80';

  if (rawQuality > 0.78) {
    quality = 'perfect';
    label = 'PERFECT!';
    color = '#ffd23f';
  } else if (dtTiming < -0.025) {
    quality = 'early';
    label = 'EARLY';
    color = '#38bdf8';
  } else if (dtTiming > 0.025) {
    quality = 'late';
    label = 'LATE';
    color = '#fb923c';
  }

  let baseExit: number;
  if (quality === 'perfect') {
    const t = Math.min(1, (rawQuality - 0.78) / 0.22);
    baseExit = isPower ? 24.0 + t * 7.0 : 21.0 + t * 5.5;
  } else {
    const t = Math.min(1, rawQuality / 0.78);
    baseExit = isPower ? 18.5 + t * 6.0 : 16.0 + t * 5.5;
  }

  const sprayDeg = pullSign * (-dtTiming * 480) + dx * 120 + (rng() - 0.5) * 14;
  const sprayRad = (Math.max(-44, Math.min(44, sprayDeg)) * Math.PI) / 180;
  const elevDeg = 14 + -dy * 240 + rawQuality * 14 + (isPower ? 6 : 0);
  const elevRad = (Math.max(-6, Math.min(52, elevDeg)) * Math.PI) / 180;

  const horiz = baseExit * Math.cos(elevRad);
  const vx = horiz * Math.sin(sprayRad);
  const vy = baseExit * Math.sin(elevRad);
  const vz = -horiz * Math.cos(sprayRad);

  const battedParams: BattedCapParams = {
    position: [hitField[0], Math.max(0.15, hitField[1]), HIT_PLANE_Z],
    velocity: [vx, vy, vz],
    seed: input.seed,
  };

  const rawBattedResult = simulateBattedCap(battedParams);
  const launchAngleDeg = Math.round((elevRad * 180) / Math.PI);
  const outfielders = input.outfielders ?? defaultOutfielders();
  const catchInfo = simulateDeterministicCatch(
    rawBattedResult,
    outfielders,
    {
      exitSpeedMs: baseExit,
      launchAngleDeg,
      seed: input.seed,
    },
  );
  let battedResult = rawBattedResult;
  if (!catchInfo.caught && !rawBattedResult.overFence) {
    const block = simulateOutfieldGroundBlock(rawBattedResult, outfielders);
    if (block.blocked) {
      battedResult = block.battedResult;
      catchInfo.blocked = true;
      catchInfo.fielderId = block.fielderId;
      catchInfo.fielderIndex = block.fielderIndex;
      catchInfo.blockTimeSec = block.blockTimeSec;
      catchInfo.blockPos = block.blockPos;
    }
  }
  const outcome = judgeBattedCap(battedResult, { caughtInAir: catchInfo.caught });
  const exitSpeedKmh = Math.round(baseExit * 3.6);
  const distanceM = battedResult.maxDistanceM;

  return {
    contact: true,
    feedback: label,
    label,
    detail: `${exitSpeedKmh} km/h · ${distanceM.toFixed(1)}m`,
    color,
    quality,
    rawQuality,
    dtTiming,
    missDist: dist,
    hitField,
    battedParams,
    battedResult,
    catchInfo,
    outcome,
    exitSpeedKmh,
    launchAngleDeg,
    distanceM,
  };
}
