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

/**
 * 2D catcher-view cross-section of the horizontal cylindrical bat barrel.
 * The left/right parentheses "(" and ")" follow exact quadratic Beziers whose
 * outer midpoints sit at x = +-halfW and whose top/bottom tips sit at
 * x = +-(1 - bracketCurveFrac) * halfW, y = +-halfH, connected by two
 * invisible horizontal boundary lines y = +-halfH.
 */
export interface BatPciExtents {
  halfW: number;
  halfH: number;
  bracketCurveFrac: number;
}

/**
 * Effective collision radius of the pitched cap/ball (m) used in both
 * 3D cylinder-sphere Minkowski contact (R_eff = halfH + CONTACT_BALL_RADIUS_M)
 * and 1:1 WYSIWYG rendering on the Side Feedback Card.
 */
export const CONTACT_BALL_RADIUS_M = 0.038;

export const BAT_PCI_NORMAL: BatPciExtents = {
  halfW: 0.128,
  halfH: 0.050,
  bracketCurveFrac: 0.14,
};

export const BAT_PCI_POWER: BatPciExtents = {
  halfW: 0.092,
  halfH: 0.036,
  bracketCurveFrac: 0.14,
};

export function getBatPciExtents(swingMode: SwingMode): BatPciExtents {
  return swingMode === 'power' ? BAT_PCI_POWER : BAT_PCI_NORMAL;
}

/**
 * 3D horizontal cylindrical bat barrel collision physics constants.
 * Vertical offset u_y = (hitY - batY) / halfH maps onto cylinder surface normal angle
 * phi = asin(sinPhiMax * u_y), projecting normal impulse by cos(phi) = sqrt(1 - (sinPhiMax * u_y)^2)
 * and deflecting launch elevation angle along the cylinder normal.
 */
export const BAT_CYLINDER_PHYSICS = {
  /** Maps |u_y| = 1 to cylinder normal angle phi_max = asin(0.95) ~= 71.8 deg */
  sinPhiMax: 0.95,
  /** Oblique cylinder impulse exponent: f_cyl = cos(phi)^normalProjectionExp (normal cos(phi) + oblique spin/slip loss) */
  normalProjectionExp: 1.45,
  /** Launch elevation coupling from cylinder surface normal angle phi */
  launchPhiScale: 0.95,
  /** Natural swing uppercut angle (deg) at cylinder centerline u_y = 0 */
  baseAttackAngleDeg: { normal: 10.0, power: 13.0 },
  /** Fair-ball launch elevation bounds (deg) */
  minLaunchDeg: -35.0,
  maxLaunchDeg: 74.0,
  /** Horizontal barrel taper / vibration energy loss: f_axis = 1 - axisLossK * effUX^2 */
  axisLossK: 0.52,
  /** Rounded barrel-end horizontal normal sine max: psi = asin(sinPsiMax * effUX) (~12.7 deg) */
  sinPsiMax: 0.22,
  /** Swing timing bat-speed loss: f_time = 1 - timingLossK * (|dt| / fairTimingWindowSec)^2 */
  timingLossK: 0.28,
  /** Fair contact timing half-window (s) */
  fairTimingWindowSec: 0.085,
  /** Timing-foul outer timing window (s) */
  foulTimingWindowSec: 0.145,
  /** Edge-graze foul timing window (s) */
  grazeTimingWindowSec: 0.105,
  /** Extra outer margin (m) beyond ball-edge tangency (d_edge <= R_ball + margin) for FOUL TIP */
  grazeOuterMarginM: 0.016,
  /** Extra outer margin (m) beyond ball-edge tangency for early/late timing foul */
  timingFoulMarginM: 0.024,
  /** Base batter swing speed at sweet spot (m/s) for normal swing (~65 km/h) */
  defaultBatSpeedMs: 18.0,
  /** Power swing bat-speed multiplier (smaller barrel, faster swing: ~79 km/h) */
  powerBatSpeedMult: 1.22,
  /** Bat-cap collision efficiency q in BBS equation: v_peak = q * v_pitch + (1 + q) * v_bat */
  collisionEfficiencyQ: 0.22,
  /** Fallback incoming pitch speed at hit plane (m/s) when trajectory summary omits it */
  defaultPitchHitSpeedMs: 11.5,
  /** Residual tangential-contact floor exit speed (m/s) */
  floorExitSpeedMs: 2.5,
} as const;

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
  /** Optional batter base swing speed (m/s); defaults to BAT_CYLINDER_PHYSICS.defaultBatSpeedMs */
  batSpeedMs?: number;
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

  // Cap position relative to bat barrel center (Field3D: +X right/1B, +Y up)
  const relX = hitField[0] - input.batX;
  const relY = hitField[1] - input.batY;
  const dist = Math.hypot(relX, relY);

  const isPower = input.swingMode === 'power';
  const pci = getBatPciExtents(input.swingMode);
  const phys = BAT_CYLINDER_PHYSICS;
  const ballR = CONTACT_BALL_RADIUS_M;

  // Exact 2D Euclidean distance from ball center (relX, relY) to the visual "(" ")" barrel shape
  // bounded by y in [-halfH, +halfH] and |x| <= halfW * (1 - beta * (y / halfH)^2).
  // Ball collides with bat barrel iff d_edge <= CONTACT_BALL_RADIUS_M (Minkowski sum)!
  const clampedBarrelY = Math.max(-pci.halfH, Math.min(pci.halfH, relY));
  const yFracBarrel = clampedBarrelY / pci.halfH;
  const barrelHalfWAtY = pci.halfW * (1 - pci.bracketCurveFrac * yFracBarrel * yFracBarrel);
  const clampedBarrelX = Math.max(-barrelHalfWAtY, Math.min(barrelHalfWAtY, relX));
  const edgeDistM = Math.hypot(relX - clampedBarrelX, relY - clampedBarrelY);

  // Normalized 3D cylinder-sphere contact coordinates:
  // R_eff_y = halfH + R_ball (true cylinder + sphere center-to-center contact radius)
  // R_eff_x = barrelHalfWAtY + R_ball
  const effHalfH = pci.halfH + ballR;
  const effHalfW = barrelHalfWAtY + ballR;
  const uY = relY / effHalfH;
  const absUY = Math.abs(uY);
  const effUX = relX / effHalfW;
  const absEffUX = Math.abs(effUX);

  const inFairBarrelBox = edgeDistM <= ballR + 1e-9;
  const isFairContact = inFairBarrelBox && absTiming <= phys.fairTimingWindowSec + 1e-9;
  const isTimingFoul =
    absTiming > phys.fairTimingWindowSec &&
    absTiming <= phys.foulTimingWindowSec &&
    edgeDistM <= ballR + phys.timingFoulMarginM + 1e-9;
  const isEdgeGrazeFoul =
    !inFairBarrelBox &&
    edgeDistM <= ballR + phys.grazeOuterMarginM + 1e-9 &&
    absTiming <= phys.grazeTimingWindowSec + 1e-9;

  if (!isFairContact && !isTimingFoul && !isEdgeGrazeFoul) {
    return {
      contact: false,
      feedback: 'SWING & MISS',
      label: 'MISS',
      detail: absTiming > phys.fairTimingWindowSec ? (dtTiming < 0 ? 'TOO EARLY' : 'TOO LATE') : 'OFF TARGET',
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
    // with 3D cylinder-edge elevation bias (top edge -> high foul pop, bottom edge -> low foul chop).
    const foulSide =
      absTiming > phys.fairTimingWindowSec
        ? dtTiming < 0
          ? pullSign
          : -pullSign
        : relX >= 0
          ? 1
          : -1;
    const sprayDeg = foulSide * (56 + rng() * 22);
    const sprayRad = (sprayDeg * Math.PI) / 180;
    const clampedGrazeUy = Math.max(-1, Math.min(1, uY));
    const foulSinPhi = Math.max(-0.95, Math.min(0.95, clampedGrazeUy * phys.sinPhiMax));
    const foulCosPhi = Math.sqrt(Math.max(0.05, 1 - foulSinPhi * foulSinPhi));
    const foulExit =
      absTiming > phys.fairTimingWindowSec
        ? 10.5 + foulCosPhi * 6.5 + rng() * 2.5
        : 8.0 + foulCosPhi * 4.5 + rng() * 2.5;
    const foulPhiDeg = (Math.asin(foulSinPhi) * 180) / Math.PI;
    const elevDeg = Math.max(
      -18,
      Math.min(68, (isPower ? 14 : 12) + foulPhiDeg * 0.72 + (rng() - 0.5) * 10),
    );
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
    const label = absTiming > phys.fairTimingWindowSec ? (dtTiming < 0 ? 'EARLY FOUL' : 'LATE FOUL') : 'FOUL TIP';
    const feedback = label;
    const color = absTiming > phys.fairTimingWindowSec ? (dtTiming < 0 ? '#38bdf8' : '#fb923c') : '#cbd5e1';
    const exitSpeedKmh = Math.round(foulExit * 3.6);
    const launchAngleDeg = Math.round(elevDeg);
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
      launchAngleDeg,
      distanceM,
    };
  }

  // --- 3D Horizontal Cylindrical Bat Barrel Collision Model ---
  // 1. Vertical cross-section surface normal angle phi = asin(sinPhiMax * u_y)
  //    u_y > 0 (cap hits upper half of cylinder / bat under cap) => phi > 0 (lifts ball up)
  //    u_y < 0 (cap hits lower half of cylinder / bat over cap)  => phi < 0 (drives ball down)
  const clampedUY = Math.max(-1, Math.min(1, uY));
  const clampedEffUX = Math.max(-1, Math.min(1, effUX));
  const sinPhi = Math.max(-phys.sinPhiMax, Math.min(phys.sinPhiMax, clampedUY * phys.sinPhiMax));
  const phiRad = Math.asin(sinPhi);
  const phiDeg = (phiRad * 180) / Math.PI;

  // 2. Normal-force impulse projection onto cylinder surface normal:
  //    cos(phi) = sqrt(1 - sin^2(phi)), raised to normalProjectionExp for oblique spin/slip transfer loss
  const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
  const fCyl = Math.pow(cosPhi, phys.normalProjectionExp);

  // 3. Horizontal barrel sweet-spot efficiency (handle/endcap MOI + vibration loss)
  const fAxis = 1 - phys.axisLossK * clampedEffUX * clampedEffUX;

  // 4. Swing timing velocity transfer (bat speed peaks at dtTiming = 0)
  const tau = Math.min(1, absTiming / phys.fairTimingWindowSec);
  const fTime = 1 - phys.timingLossK * tau * tau;

  // 5. Bat-speed-driven peak exit velocity (Nathan BBS collision equation):
  //    v_peak = q * v_pitch_hit + (1 + q) * v_bat
  //    Power swing uses a smaller cylindrical barrel with faster bat speed (powerBatSpeedMult).
  let vPitchHitMs: number = phys.defaultPitchHitSpeedMs;
  if (typeof input.trajectory.hitPlaneSpeedMs === 'number' && Number.isFinite(input.trajectory.hitPlaneSpeedMs)) {
    vPitchHitMs = input.trajectory.hitPlaneSpeedMs;
  } else if (typeof input.trajectory.sampleAt === 'function') {
    const hitFrame = input.trajectory.sampleAt(input.trajectory.hitPlaneTimeSec);
    vPitchHitMs = Math.hypot(hitFrame.y[3], hitFrame.y[4], hitFrame.y[5]);
  }
  const baseBatSpeedMs = input.batSpeedMs ?? phys.defaultBatSpeedMs;
  const effectiveBatSpeedMs = baseBatSpeedMs * (isPower ? phys.powerBatSpeedMult : 1.0);
  const q = phys.collisionEfficiencyQ;
  const peakExit = q * vPitchHitMs + (1 + q) * effectiveBatSpeedMs;
  const baseExit =
    phys.floorExitSpeedMs + Math.max(0, peakExit - phys.floorExitSpeedMs) * fCyl * fAxis * fTime;

  // Contact quality rating (multiplicative so grazing the cylinder edge stays weak even on-time)
  const barrelEfficiency = fCyl * fAxis;
  const timingQuality = Math.max(0, 1 - tau);
  const rawQuality = barrelEfficiency * (0.65 + 0.35 * timingQuality);

  let quality: Exclude<ContactQuality, 'miss'> = 'good';
  let label = 'GOOD';
  let color = '#4ade80';

  if (rawQuality > 0.80 && absUY <= 0.45 && absEffUX <= 0.55) {
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

  // 5. 3D Launch elevation angle: natural swing uppercut + cylinder surface normal deflection
  const attackAngleDeg = isPower ? phys.baseAttackAngleDeg.power : phys.baseAttackAngleDeg.normal;
  const rawElevDeg = attackAngleDeg + phys.launchPhiScale * phiDeg;
  const elevDeg = Math.max(phys.minLaunchDeg, Math.min(phys.maxLaunchDeg, rawElevDeg));
  const elevRad = (elevDeg * Math.PI) / 180;

  // 6. Horizontal spray angle: timing pull/push + rounded barrel-end normal deflection psi
  const psiDeg = (Math.asin(phys.sinPsiMax * clampedEffUX) * 180) / Math.PI;
  const sprayDeg = pullSign * (-dtTiming * 480) + psiDeg + (rng() - 0.5) * 10;
  const sprayRad = (Math.max(-44, Math.min(44, sprayDeg)) * Math.PI) / 180;

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
  const launchAngleDeg = Math.round(elevDeg);
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
