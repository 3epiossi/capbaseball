/**
 * Pure judgment functions matching 2025-02 Cap Baseball rules (5.05, 5.06, 5.07).
 */
import type { BattedCapResult } from '../physics/batted';
import {
  isFair,
  isInfield,
  isInStrikeZone,
  PLATE_WIDTH,
  STRIKE_ZONE_HI,
  STRIKE_ZONE_LO,
} from './field';

export type PitchCall =
  | 'STRIKE'
  | 'BALL'
  | 'UNCAUGHT_THIRD_STRIKE'
  | 'IN_PLAY';

export interface PitchJudgeInput {
  /** Plate X in Field3D coordinates (meters, 0 = center of plate) */
  plateX: number;
  /** Plate Y in Field3D coordinates (height above floor, meters) */
  plateY: number;
  swung: boolean;
  contacted: boolean;
  caughtByCatcher: boolean;
  reachesPassLine: boolean;
  currentStrikes: number;
  runnersOnBase: boolean;
  /** Optional override call (e.g. from human umpire or ABS challenge overturn) */
  forceCall?: 'strike' | 'ball';
}

export interface PitchJudgeResult {
  call: PitchCall;
  isStrike: boolean;
  isBall: boolean;
  isUncaughtThirdStrike: boolean;
  isWildPitch: boolean;
}

const CAP_RADIUS_M = 0.015;
const ABS_BORDERLINE_MARGIN_M = 0.065;
const UMPIRE_BLOWN_CALL_RATE = 0.26;

/**
 * Signed distance in meters from the strike zone rectangle, accounting for cap radius (~0.015m).
 * <= 0 means TRUE STRIKE (inside or touching edge); > 0 means TRUE BALL (outside).
 */
export function computeStrikeZoneMarginM(plateX: number, plateY: number): number {
  const halfW = PLATE_WIDTH * 0.5;
  const dx = Math.abs(plateX) - halfW;
  const dy = Math.max(STRIKE_ZONE_LO - plateY, plateY - STRIKE_ZONE_HI);
  const boxDist = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  return boxDist - CAP_RADIUS_M;
}

export interface UmpirePitchCallResult {
  trueCall: 'strike' | 'ball';
  umpireCall: 'strike' | 'ball';
  marginM: number;
  blownCall: boolean;
}

function seededUnitFloat(seed: number): number {
  let x = (seed >>> 0) || 1;
  x = (x + 0x6d2b79f5) | 0;
  let t = Math.imul(x ^ (x >>> 15), 1 | x);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Evaluates a taken pitch with human umpire borderline miss simulation (~26% on |marginM| <= 0.065m).
 */
export function evaluateUmpirePitchCall(
  plateX: number,
  plateY: number,
  seed: number,
): UmpirePitchCallResult {
  const marginM = computeStrikeZoneMarginM(plateX, plateY);
  const trueCall: 'strike' | 'ball' = marginM <= 0 ? 'strike' : 'ball';
  const isBorderline = Math.abs(marginM) <= ABS_BORDERLINE_MARGIN_M;
  const blownCall = isBorderline && seededUnitFloat(seed) < UMPIRE_BLOWN_CALL_RATE;
  const umpireCall: 'strike' | 'ball' = blownCall
    ? trueCall === 'strike'
      ? 'ball'
      : 'strike'
    : trueCall;
  return { trueCall, umpireCall, marginM, blownCall };
}

export function judgePitch(input: PitchJudgeInput): PitchJudgeResult {
  if (input.contacted) {
    return {
      call: 'IN_PLAY',
      isStrike: false,
      isBall: false,
      isUncaughtThirdStrike: false,
      isWildPitch: false,
    };
  }

  const isStrike =
    input.forceCall !== undefined
      ? input.forceCall === 'strike' || input.swung
      : input.swung || isInStrikeZone(input.plateX, input.plateY);
  const uncaughtPass = !input.caughtByCatcher && input.reachesPassLine;

  if (isStrike) {
    const isUncaughtThird = input.currentStrikes >= 2 && uncaughtPass;
    return {
      call: isUncaughtThird ? 'UNCAUGHT_THIRD_STRIKE' : 'STRIKE',
      isStrike: true,
      isBall: false,
      isUncaughtThirdStrike: isUncaughtThird,
      isWildPitch: !isUncaughtThird && uncaughtPass && input.runnersOnBase,
    };
  }

  return {
    call: 'BALL',
    isStrike: false,
    isBall: true,
    isUncaughtThirdStrike: false,
    isWildPitch: uncaughtPass && input.runnersOnBase,
  };
}

export type BattedOutcome = 'FOUL' | 'OUT' | '1B' | '2B' | '3B' | 'HR';

export interface BattedJudgeOptions {
  /** True if a fielder caught the cap in the air before it touched the floor */
  caughtInAir?: boolean;
}

/**
 * Judge a batted cap according to 2025-02 rules 5.06 & 5.07:
 * - Caught in air before floor -> OUT (5.06 C2)
 * - Foul ball -> FOUL (5.06 A)
 * - Fair + clears fence on the fly (bounces === 0) -> HR (5.07 A4)
 * - Fair + hits fence on the fly (bounces === 0) -> 3B (5.07 A3)
 * - Fair + bounces >= 1 AND (hits fence OR clears fence OR crosses fence extension) -> 2B (5.07 A2)
 * - Fair + stops in infield -> OUT (5.06 C1)
 * - Fair + touches outfield floor (not caught, didn't hit/clear fence or extension) -> 1B (5.07 A1)
 */
export function judgeBattedCap(
  sim: BattedCapResult,
  options?: BattedJudgeOptions,
): BattedOutcome {
  if (options?.caughtInAir) {
    return 'OUT';
  }

  // On-the-fly fence outcomes (always in fair sector)
  if (sim.bouncesBeforeFence === 0 && sim.overFence) {
    return 'HR';
  }
  if (sim.bouncesBeforeFence === 0 && sim.hitFence) {
    return '3B';
  }

  // Determine if the batted ball was fair
  const landing = sim.firstLandingPos;
  const landedFair = landing !== null && isFair(landing[0], landing[2]);
  const stoppedFair = isFair(sim.stoppedPos[0], sim.stoppedPos[2]);

  // If it landed in foul territory without touching fair ground, it's foul
  if (landing !== null && !landedFair && !sim.hitInfield && !sim.hitOutfield) {
    return 'FOUL';
  }

  // If it landed in the infield but rolled foul before passing the infield corners
  if (
    sim.hitInfield &&
    !sim.hitOutfield &&
    !stoppedFair &&
    !sim.hitFence &&
    !sim.overFence &&
    !sim.crossedFenceExtension
  ) {
    return 'FOUL';
  }

  // Bounced fair ball that hits fence, clears fence, or crosses fence extension -> 2B (5.07 A2)
  if (
    sim.bounces >= 1 &&
    (sim.hitFence || sim.overFence || sim.crossedFenceExtension) &&
    (landedFair || sim.hitOutfield || sim.hitFence || sim.overFence)
  ) {
    return '2B';
  }

  // Fair ball that stops in the infield -> OUT (5.06 C1)
  if (isInfield(sim.stoppedPos[0], sim.stoppedPos[2])) {
    return 'OUT';
  }

  // Fair ball that touches outfield floor -> 1B (5.07 A1)
  if (sim.hitOutfield || landedFair || stoppedFair) {
    return '1B';
  }

  return 'FOUL';
}
