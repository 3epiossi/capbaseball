import {
  simulateBattedCap,
  simToField,
  type BattedCapParams,
  type BattedCapResult,
  type FieldV3,
} from './batted';
import type { PitchTrajectoryResult } from './pitches';
import { FENCE_DIST, isFair, isInfield, isPastFenceExtension, MOUND_DIST } from '../rules/field';
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

// Ground/bouncer interception (tight physical glove reach — no phantom teleports!)
export const OUTFIELDER_BLOCK_REACTION_DELAY = 0.22;
export const OUTFIELDER_BLOCK_SPRINT_SPEED = 4.6;
export const OUTFIELDER_BLOCK_RADIUS = 0.68;
export const OUTFIELDER_BLOCK_MAX_CHASE = 4.5;

export const PITCHER_HOME_POS: FieldV3 = [0, 0, -MOUND_DIST];
// Pitcher just finished throwing follow-through -> slower reaction than LF/RF/C!
// Hard comebackers (< 0.58s to mound or still screaming past > 13.5 m/s) shoot right past Pitcher;
// slower/medium grounders give Pitcher time to recover, sprint over, and block for an infield OUT.
export const PITCHER_BLOCK_REACTION_DELAY = 0.58;
export const PITCHER_BLOCK_SPRINT_SPEED = 3.9;
export const PITCHER_BLOCK_RADIUS = 0.54;
export const PITCHER_BLOCK_MAX_CHASE = 2.8;
export const PITCHER_MAX_INTERCEPT_SPEED_MS = 13.5;

export const CATCHER_HOME_POS: FieldV3 = [0, 0, 0.85];
export const CATCHER_BLOCK_REACTION_DELAY = 0.20;
export const CATCHER_BLOCK_SPRINT_SPEED = 3.8;
export const CATCHER_BLOCK_RADIUS = 0.60;
export const CATCHER_BLOCK_MAX_CHASE = 3.4;

// Aerial catch (catcher must stand up, locate the pop-up in the air, and turn around)
export const CATCHER_CATCH_REACTION_DELAY_FOUL = 0.46;
export const CATCHER_CATCH_REACTION_DELAY_FAIR = 0.56;
export const CATCHER_CATCH_SPRINT_SPEED_FOUL = 3.7;
export const CATCHER_CATCH_SPRINT_SPEED_FAIR = 3.2;
export const CATCHER_CATCH_MAX_CHASE_FOUL = 3.5;
export const CATCHER_CATCH_MAX_CHASE_FAIR = 2.6;
export const CATCHER_CATCH_RADIUS = 0.45;

export type FielderId = 'LF' | 'RF' | 'P' | 'C';

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
  id: FielderId;
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
  fielderId: FielderId | null;
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

export function defaultOutfielders(): OutfielderInit[] {
  return [
    { id: 'LF', homePos: [-4.2, 0, -9.8], pos: [-4.2, 0, -9.8] },
    { id: 'RF', homePos: [4.2, 0, -9.8], pos: [4.2, 0, -9.8] },
  ];
}

export function buildFullDefense(baseFielders?: readonly OutfielderInit[]): OutfielderInit[] {
  const list = baseFielders ? [...baseFielders] : defaultOutfielders();
  if (!list.some((f) => f.id === 'P')) {
    list.push({ id: 'P', homePos: PITCHER_HOME_POS, pos: PITCHER_HOME_POS });
  }
  if (!list.some((f) => f.id === 'C')) {
    list.push({ id: 'C', homePos: CATCHER_HOME_POS, pos: CATCHER_HOME_POS });
  }
  return list;
}

/**
 * Clamps a fielder position to physical gym walls and the fair-sector outfield fence,
 * while freely allowing ALL defenders (P, C, LF, RF) to run across foul lines into foul territory!
 */
function clampDefenderToGym(x: number, z: number, role: FielderId): [number, number] {
  let nx = Math.max(-15.5, Math.min(15.5, x));
  let nz = role === 'C' ? Math.max(-5.2, Math.min(3.4, z)) : Math.max(-14.2, Math.min(2.4, z));
  // Only clamp against the 12.45m fence arc when inside the fair sector (foul territory stays open up to walls)
  if (nz < 0 && Math.abs(nx) <= -nz) {
    const r = Math.hypot(nx, nz);
    if (r > MAX_FIELDER_RADIUS_M) {
      const scale = MAX_FIELDER_RADIUS_M / r;
      nx *= scale;
      nz *= scale;
    }
  } else if (nz < 0) {
    // Foul territory: stop at the fence extension line (perpendicular to the foul line) instead of running through it
    const d = (Math.abs(nx) - nz) * Math.SQRT1_2;
    if (d > MAX_FIELDER_RADIUS_M) {
      const k = (d - MAX_FIELDER_RADIUS_M) * Math.SQRT1_2;
      nx -= Math.sign(nx) * k;
      nz += k;
    }
  }
  return [nx, nz];
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
  const isFoulFly = !isFair(landingTarget[0], landingTarget[2]);

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
    // Reject any point past the 13m fence arc (fair) or fence extension (foul)
    const capR = Math.hypot(capPos[0], capPos[2]);
    if ((isFair(capPos[0], capPos[2]) && capR > MAX_CATCH_RADIUS_M) || isPastFenceExtension(capPos[0], capPos[2])) {
      break;
    }

    for (const f of actors) {
      const reactDelay =
        f.id === 'P'
          ? isFoulFly ? 0.50 : 0.62
          : f.id === 'C'
            ? isFoulFly ? CATCHER_CATCH_REACTION_DELAY_FOUL : CATCHER_CATCH_REACTION_DELAY_FAIR
            : isFoulFly ? 0.36 : OUTFIELDER_REACTION_DELAY;
      const sprintSpd =
        f.id === 'P'
          ? isFoulFly ? 3.7 : 3.5
          : f.id === 'C'
            ? isFoulFly ? CATCHER_CATCH_SPRINT_SPEED_FOUL : CATCHER_CATCH_SPRINT_SPEED_FAIR
            : isFoulFly ? 3.6 : OUTFIELDER_SPRINT_SPEED;
      const maxChase =
        f.id === 'P'
          ? isFoulFly ? 3.8 : 2.8
          : f.id === 'C'
            ? isFoulFly ? CATCHER_CATCH_MAX_CHASE_FOUL : CATCHER_CATCH_MAX_CHASE_FAIR
            : isFoulFly ? 4.5 : OUTFIELDER_MAX_CHASE_DIST;
      const catchRad =
        f.id === 'P' ? (isFoulFly ? 0.56 : 0.50) : f.id === 'C' ? CATCHER_CATCH_RADIUS : isFoulFly ? 0.54 : OUTFIELDER_CATCH_RADIUS;

      // 3. Reaction delay + ramp-up acceleration over first 0.35s of running
      if (frame.t >= reactDelay && dt > 0) {
        const runElapsed = Math.max(0, frame.t - reactDelay);
        const accelFactor = Math.min(1, runElapsed / 0.35);
        const isMySide =
          (f.id === 'LF' && landingTarget[0] <= 1.2) ||
          (f.id === 'RF' && landingTarget[0] >= -1.2) ||
          (f.id === 'P' &&
            Math.abs(landingTarget[0]) <= (isFoulFly ? 4.5 : 3.0) &&
            landingTarget[2] >= -11.5 &&
            landingTarget[2] <= (isFoulFly ? -3.6 : -4.5)) ||
          (f.id === 'C' &&
            Math.abs(landingTarget[0]) <= 3.6 &&
            landingTarget[2] >= -3.6 &&
            landingTarget[2] <= 3.0);

        const tx = isMySide ? landingTarget[0] : f.id === 'LF' || f.id === 'RF' ? f.homePos[0] * 0.65 : f.homePos[0];
        const tz = isMySide
          ? f.id === 'C'
            ? Math.max(-3.6, Math.min(3.0, landingTarget[2]))
            : f.id === 'P'
              ? Math.max(-11.5, Math.min(isFoulFly ? -3.6 : -4.5, landingTarget[2]))
              : Math.max(-MAX_FIELDER_RADIUS_M, Math.min(isFoulFly ? 2.2 : 1.5, landingTarget[2]))
          : f.homePos[2];

        const dx = tx - f.x;
        const dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const step = Math.min(d, sprintSpd * accelFactor * dt);
          let nx = f.x + (dx / d) * step;
          let nz = f.z + (dz / d) * step;
          const chaseX = nx - f.homePos[0];
          const chaseZ = nz - f.homePos[2];
          const chaseDist = Math.hypot(chaseX, chaseZ);
          if (chaseDist > maxChase) {
            const scale = maxChase / chaseDist;
            nx = f.homePos[0] + chaseX * scale;
            nz = f.homePos[2] + chaseZ * scale;
          }
          [nx, nz] = clampDefenderToGym(nx, nz, f.id);
          f.x = nx;
          f.z = nz;
        }
      }

      const distFromStart = Math.hypot(capPos[0] - f.homePos[0], capPos[2] - f.homePos[2]);
      const distToCap = Math.hypot(capPos[0] - f.x, capPos[2] - f.z);
      const inCatchableSpace =
        !isPastFenceExtension(capPos[0], capPos[2]) &&
        (!isFair(capPos[0], capPos[2]) || capR <= MAX_CATCH_RADIUS_M) &&
        capPos[2] <= (isFoulFly ? 3.4 : 2.8);
      if (
        frame.t >= UNCATCHABLE_AIR_TIME_SEC &&
        inCatchableSpace &&
        distFromStart <= maxChase &&
        distToCap <= catchRad &&
        capPos[1] <= 1.95
      ) {
        const hitPos: FieldV3 = [capPos[0], capPos[1], capPos[2]];
        // 4. Deterministic bobble / drop probability:
        //    High fly balls (>= 28 deg) are routine fielding fundamentals (4% base, up to 12% on long diving chases).
        //    Lower line drives (20..28 deg) are harder to squeeze (12%..28%), while scorching liners already shoot past.
        const speedFactor = Math.max(0, Math.min(1, (exitSpeedMs - 9) / 7.5));
        const diveFactor = distFromStart > 1.8 ? Math.min(1, (distFromStart - 1.8) / 2.2) : 0;
        // Catcher turning backward to track a high pop-up over the mask has extra drop risk
        const catcherBackTurnPenalty = f.id === 'C' && capPos[2] > CATCHER_HOME_POS[2] ? 0.16 : 0;
        const dropProb =
          launchAngleDeg >= 28
            ? Math.min(0.28, 0.04 + diveFactor * 0.08 + catcherBackTurnPenalty)
            : Math.min(0.36, 0.12 + speedFactor * 0.08 + diveFactor * 0.08 + catcherBackTurnPenalty);
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
 * Ground & low-liner interception across all defenders (P, C, LF, RF):
 * - Pitcher (P), Catcher (C), and forward-charging LF/RF can intercept grounders/bouncers
 *   INSIDE the infield before they escape -> trimmed to infield stop -> OUT (Rule 5.06 C1).
 * - LF/RF cutting off harder bouncing balls in the outfield hold potential wall-doubles
 *   to clean singles -> 1B (Rule 5.07 A1).
 */
export function simulateOutfieldGroundBlock(
  batted: BattedCapResult,
  initialOutfielders: readonly OutfielderInit[],
): {
  blocked: boolean;
  fielderId: FielderId | null;
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

  if (batted.frames.length < 3 || batted.overFence) {
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
  let touchedOutfieldBeforeBlock = false;

  for (let i = 1; i < batted.frames.length; i++) {
    const frame = batted.frames[i];
    const dt = Math.max(0, frame.t - prevT);
    prevT = frame.t;

    const capPos = frame.pos;
    const capR = Math.hypot(capPos[0], capPos[2]);
    const inFair = capPos[2] < 0 && Math.abs(capPos[0]) <= -capPos[2];
    if (frame.t > 0.06 && capPos[1] <= 0.045) {
      bounced = true;
      if (inFair && !isInfield(capPos[0], capPos[2])) {
        touchedOutfieldBeforeBlock = true;
      }
    }
    if (bounced && inFair && !isInfield(capPos[0], capPos[2]) && capPos[1] <= 0.35) {
      touchedOutfieldBeforeBlock = true;
    }

    if (capR >= FENCE_DIST - 0.08) {
      // Already reached fence
      break;
    }

    for (const f of actors) {
      const reactDelay =
        f.id === 'P'
          ? PITCHER_BLOCK_REACTION_DELAY
          : f.id === 'C'
            ? CATCHER_BLOCK_REACTION_DELAY
            : OUTFIELDER_BLOCK_REACTION_DELAY;
      const sprintSpd =
        f.id === 'P'
          ? PITCHER_BLOCK_SPRINT_SPEED
          : f.id === 'C'
            ? CATCHER_BLOCK_SPRINT_SPEED
            : OUTFIELDER_BLOCK_SPRINT_SPEED;
      const maxChase =
        f.id === 'P'
          ? PITCHER_BLOCK_MAX_CHASE
          : f.id === 'C'
            ? CATCHER_BLOCK_MAX_CHASE
            : OUTFIELDER_BLOCK_MAX_CHASE;
      const blockRad =
        f.id === 'P'
          ? PITCHER_BLOCK_RADIUS
          : f.id === 'C'
            ? CATCHER_BLOCK_RADIUS
            : OUTFIELDER_BLOCK_RADIUS;

      if (frame.t >= reactDelay && dt > 0) {
        const runElapsed = Math.max(0, frame.t - reactDelay);
        const accelFactor = Math.min(1, runElapsed / 0.20);
        const isMyZone =
          (f.id === 'LF' && capPos[0] <= 1.8) ||
          (f.id === 'RF' && capPos[0] >= -1.8) ||
          (f.id === 'P' && Math.abs(capPos[0]) <= 3.4 && capPos[2] <= -3.0 && capPos[2] >= -11.4) ||
          (f.id === 'C' && capPos[2] >= -3.8 && capPos[2] <= 2.4 && Math.abs(capPos[0]) <= 3.2);

        const tx = isMyZone ? capPos[0] : f.id === 'LF' || f.id === 'RF' ? f.homePos[0] * 0.65 : f.homePos[0];
        const tz = isMyZone
          ? f.id === 'C'
            ? Math.max(-3.8, Math.min(2.2, capPos[2]))
            : f.id === 'P'
              ? Math.max(-10.8, Math.min(-4.8, capPos[2]))
              : Math.max(-MAX_FIELDER_RADIUS_M, Math.min(1.2, capPos[2]))
          : f.homePos[2];

        const dx = tx - f.x;
        const dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.06) {
          const step = Math.min(d, sprintSpd * accelFactor * dt);
          let nx = f.x + (dx / d) * step;
          let nz = f.z + (dz / d) * step;
          const chaseX = nx - f.homePos[0];
          const chaseZ = nz - f.homePos[2];
          const chaseDist = Math.hypot(chaseX, chaseZ);
          if (chaseDist > maxChase) {
            const scale = maxChase / chaseDist;
            nx = f.homePos[0] + chaseX * scale;
            nz = f.homePos[2] + chaseZ * scale;
          }
          [nx, nz] = clampDefenderToGym(nx, nz, f.id);
          f.x = nx;
          f.z = nz;
        }
      }

      // Can block bounced grounders OR low comebackers/liners right at the defender (both fair & foul territory!),
      // ONLY AFTER the defender's reaction delay has elapsed (so hard comebackers rocket past a recovering Pitcher!).
      const canInterceptHeight =
        (bounced && capPos[1] <= 1.25) ||
        (!bounced && frame.t >= 0.14 && capPos[1] <= 1.05 && (f.id === 'P' || f.id === 'C' || capR >= 5.5));
      const inPlayableGym =
        !isPastFenceExtension(capPos[0], capPos[2]) &&
        (!inFair || capR < FENCE_DIST - 0.15) &&
        capPos[2] <= 2.6;
      const capSpeedAtFrame = Math.hypot(frame.vel[0], frame.vel[1], frame.vel[2]);
      const pitcherCanReactSpeed = f.id !== 'P' || capSpeedAtFrame <= PITCHER_MAX_INTERCEPT_SPEED_MS;
      if (frame.t >= reactDelay && pitcherCanReactSpeed && canInterceptHeight && inPlayableGym && capR >= 0.45) {
        const distToCap = Math.hypot(capPos[0] - f.x, capPos[2] - f.z);
        if (distToCap <= blockRad) {
          const blockPos: FieldV3 = [capPos[0], Math.max(0.02, Math.min(0.65, capPos[1])), capPos[2]];
          const stoppedInInfield = inFair && !touchedOutfieldBeforeBlock && isInfield(blockPos[0], blockPos[2]);
          const stoppedInFairOutfield = inFair && !stoppedInInfield;
          const trimmedFrames = batted.frames.slice(0, i + 1);
          const trimmedResult: BattedCapResult = {
            ...batted,
            frames: trimmedFrames,
            flightTimeSec: frame.t,
            stoppedPos: blockPos,
            hitInfield: batted.hitInfield || stoppedInInfield,
            hitOutfield: touchedOutfieldBeforeBlock || stoppedInFairOutfield,
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
    // Realistic Foul Ball: launch into 1B/3B foul territory or pop-up around/behind home plate
    // when grazing the top of the bat cylinder (giving catchable foul flies for C/P/LF/RF).
    const foulSide =
      absTiming > phys.fairTimingWindowSec
        ? dtTiming < 0
          ? pullSign
          : -pullSign
        : relX >= 0
          ? 1
          : -1;
    const isTimingFoul = absTiming > phys.fairTimingWindowSec;
    const isHighFoulPop = isTimingFoul && uY > 0.22;
    const isSteepCatcherPop = isHighFoulPop && uY > 0.52;
    const sprayDeg = isSteepCatcherPop
      ? foulSide * (48 + rng() * 72)
      : isHighFoulPop
        ? foulSide * (46 + rng() * 15)
        : foulSide * (50 + rng() * 26);
    const sprayRad = (sprayDeg * Math.PI) / 180;
    const clampedGrazeUy = Math.max(-1, Math.min(1, uY));
    const foulSinPhi = Math.max(-0.95, Math.min(0.95, clampedGrazeUy * phys.sinPhiMax));
    const foulCosPhi = Math.sqrt(Math.max(0.05, 1 - foulSinPhi * foulSinPhi));
    const foulExit = isSteepCatcherPop
      ? 5.5 + foulCosPhi * 2.2 + rng() * 1.5
      : isHighFoulPop
        ? 9.4 + foulCosPhi * 2.6 + rng() * 1.8
        : isTimingFoul
          ? 10.5 + foulCosPhi * 6.5 + rng() * 2.5
          : 8.0 + foulCosPhi * 4.5 + rng() * 2.5;
    const foulPhiDeg = (Math.asin(foulSinPhi) * 180) / Math.PI;
    const elevDeg = Math.max(
      -18,
      Math.min(
        74,
        (isSteepCatcherPop ? 38 : isHighFoulPop ? 26 : isPower ? 14 : 12) +
          foulPhiDeg * 0.78 +
          (rng() - 0.5) * 8,
      ),
    );
    const elevRad = (elevDeg * Math.PI) / 180;

    const horiz = foulExit * Math.cos(elevRad);
    const battedParams: BattedCapParams = {
      position: [hitField[0], Math.max(0.15, hitField[1]), HIT_PLANE_Z],
      velocity: [horiz * Math.sin(sprayRad), foulExit * Math.sin(elevRad), -horiz * Math.cos(sprayRad)],
      seed: input.seed,
    };
    const rawFoulResult = simulateBattedCap(battedParams);
    const defenders = buildFullDefense(input.outfielders);
    const launchAngleDeg = Math.round(elevDeg);
    // All defenders (P, C, LF, RF) can chase foul pop-ups into foul territory for a foul fly out (OUT),
    // while PCI-edge foul tips remain FOUL TIP and foul grounders can be stopped cleanly (FOUL).
    const catchInfo: CatchInfo = isTimingFoul
      ? simulateDeterministicCatch(rawFoulResult, defenders, {
          exitSpeedMs: foulExit,
          launchAngleDeg,
          seed: input.seed,
        })
      : {
          caught: false,
          bobbled: false,
          fielderId: null,
          fielderIndex: null,
          catchTimeSec: null,
          catchPos: null,
          pos: null,
        };
    let battedResult = rawFoulResult;
    if (!catchInfo.caught) {
      const blk = simulateOutfieldGroundBlock(rawFoulResult, defenders);
      if (blk.blocked) {
        battedResult = blk.battedResult;
        catchInfo.blocked = true;
        catchInfo.fielderId = blk.fielderId;
        catchInfo.fielderIndex = blk.fielderIndex;
        catchInfo.blockTimeSec = blk.blockTimeSec;
        catchInfo.blockPos = blk.blockPos;
      }
    }
    const isFoulFlyOut = catchInfo.caught;
    const label = isFoulFlyOut
      ? 'OUT'
      : absTiming > phys.fairTimingWindowSec
        ? dtTiming < 0
          ? 'EARLY FOUL'
          : 'LATE FOUL'
        : 'FOUL TIP';
    const feedback = label;
    const color = isFoulFlyOut
      ? '#f43f5e'
      : absTiming > phys.fairTimingWindowSec
        ? dtTiming < 0
          ? '#38bdf8'
          : '#fb923c'
        : '#cbd5e1';
    const exitSpeedKmh = Math.round(foulExit * 3.6);
    const distanceM = battedResult.maxDistanceM;

    return {
      contact: true,
      feedback,
      label,
      detail: `${exitSpeedKmh} km/h · ${isFoulFlyOut ? 'FOUL OUT' : 'FOUL'}`,
      color,
      quality: dtTiming < 0 ? 'early' : 'late',
      rawQuality: 0.25,
      dtTiming,
      missDist: dist,
      hitField,
      battedParams,
      battedResult,
      catchInfo,
      outcome: isFoulFlyOut ? 'OUT' : 'FOUL',
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
  const defenders = buildFullDefense(input.outfielders);
  const catchInfo = simulateDeterministicCatch(
    rawBattedResult,
    defenders,
    {
      exitSpeedMs: baseExit,
      launchAngleDeg,
      seed: input.seed,
    },
  );
  let battedResult = rawBattedResult;
  if (!catchInfo.caught && !rawBattedResult.overFence) {
    const block = simulateOutfieldGroundBlock(rawBattedResult, defenders);
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
