/**
 * 3D batted-cap physics in Field3D coordinates + explicit coordinate converters
 * between cap-flight-sim FLU coordinates and Field3D coordinates.
 *
 * Field3D Coordinate System:
 *   Origin (0, 0, 0) = Home plate tip/center
 *   +X = Right (1st base side)
 *   -X = Left (3rd base side)
 *   +Y = Up (height above gym floor)
 *   -Z = Toward pitcher / center field (pitcher plate at z = -9.22, fence arc at r = 13.0m)
 *   +Z = Behind home plate (pass line at z = +2.334m)
 *
 * cap-flight-sim FLU Coordinate System:
 *   +X = Pitcher -> Catcher (0 at mound -> 9.22 at plate)
 *   +Y = Pitcher's left (= Batter/Catcher's right = Field3D +X)
 *   +Z = Up (= Field3D +Y)
 */
import type { V3 } from './vector';
import { FENCE_DIST, FENCE_HEIGHT, isInfield, isOutfield, isPastFenceExtension } from '../rules/field';

export type FieldV3 = readonly [number, number, number];

export const PLATE_TO_MOUND_M = 9.22;

/** Convert cap-flight-sim [x, y, z] to Field3D [x, y, z]. */
export function simToField(v: V3): FieldV3 {
  return [v[1], v[2], v[0] - PLATE_TO_MOUND_M];
}

/** Convert Field3D [x, y, z] to cap-flight-sim [x, y, z]. */
export function fieldToSim(v: FieldV3): V3 {
  return [v[2] + PLATE_TO_MOUND_M, v[0], v[1]];
}

export interface BattedCapParams {
  /** Initial position in Field3D coordinates */
  position: FieldV3;
  /** Initial velocity in Field3D coordinates (m/s) */
  velocity: FieldV3;
  /** Topspin/backspin/sidespin factor (rad/s, optional) */
  spinRpm?: number;
  /** Optional random seed for subtle aerodynamic flutter */
  seed?: number;
  /** Gym ceiling height (m), default 7.5m */
  ceilingHeightM?: number;
  /** Gym side/back wall radius or half-width (m), default 18m */
  gymHalfWidthM?: number;
  /** Gym back wall behind plate (+Z), default 5m */
  gymBackZ?: number;
  /** Gym outfield wall (-Z), default -20m */
  gymOutfieldZ?: number;
}

export interface BattedFrame {
  t: number;
  pos: FieldV3;
  vel: FieldV3;
}

export interface BattedCapResult {
  frames: BattedFrame[];
  flightTimeSec: number;
  bounces: number;
  bouncesBeforeFence: number;
  firstLandingPos: FieldV3 | null;
  stoppedPos: FieldV3;
  hitInfield: boolean;
  hitOutfield: boolean;
  hitFence: boolean;
  overFence: boolean;
  crossedFenceExtension: boolean;
  maxHeightM: number;
  maxDistanceM: number;
}

const GRAVITY = 9.80665;
const CAP_RADIUS = 0.0155;
const FLOOR_RESTITUTION = 0.36;
const FLOOR_BOUNCE_FRICTION = 0.78;
const FLOOR_SLIDE_DECEL = 4.6;
const FENCE_RESTITUTION = 0.42;
const WALL_RESTITUTION = 0.38;
const AIR_DRAG_COEFF = 0.07; // 1/m effective quadratic drag (a_drag = -k * |v| * v)

function seededFloat(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateBattedCap(params: BattedCapParams): BattedCapResult {
  const dt = 0.005;
  const maxTime = 6.0;
  const recordInterval = 1 / 60;
  const ceilingY = params.ceilingHeightM ?? 7.5;
  const gymHalfX = params.gymHalfWidthM ?? 18.0;
  const gymBackZ = params.gymBackZ ?? 5.0;
  const gymOutZ = params.gymOutfieldZ ?? -20.0;
  const rng = seededFloat(params.seed ?? 42);
  const flutterPhase = rng() * Math.PI * 2;

  let x = params.position[0];
  let y = Math.max(CAP_RADIUS, params.position[1]);
  let z = params.position[2];
  let vx = params.velocity[0];
  let vy = params.velocity[1];
  let vz = params.velocity[2];

  const frames: BattedFrame[] = [{ t: 0, pos: [x, y, z], vel: [vx, vy, vz] }];
  let nextRecord = recordInterval;

  let t = 0;
  let bounces = 0;
  let bouncesBeforeFence = 0;
  let firstLandingPos: FieldV3 | null = null;
  let hitInfield = false;
  let hitOutfield = false;
  let hitFence = false;
  let overFence = false;
  let crossedFenceExtension = false;
  let maxHeightM = y;
  let maxDistanceM = Math.hypot(x, z);
  let prevR = Math.hypot(x, z);
  let sliding = false;

  while (t < maxTime) {
    t += dt;
    const speed = Math.hypot(vx, vy, vz);

    if (!sliding) {
      // Quadratic air drag + subtle cap lift/flutter when airborne
      const dragFactor = AIR_DRAG_COEFF * speed;
      const flutter =
        y > CAP_RADIUS + 0.05 && speed > 4
          ? 0.9 * Math.sin(t * 14 + flutterPhase)
          : 0;
      const ax = -dragFactor * vx + flutter * 0.4;
      const ay = -GRAVITY - dragFactor * vy + (speed > 8 ? 1.1 : 0);
      const az = -dragFactor * vz;

      vx += ax * dt;
      vy += ay * dt;
      vz += az * dt;

      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
    } else {
      // Sliding/rolling on gym floor
      const hSpeed = Math.hypot(vx, vz);
      if (hSpeed <= 0.12) {
        vx = 0;
        vy = 0;
        vz = 0;
        frames.push({ t, pos: [x, y, z], vel: [0, 0, 0] });
        break;
      }
      const decel = FLOOR_SLIDE_DECEL * dt;
      const newSpeed = Math.max(0, hSpeed - decel);
      const ratio = newSpeed / hSpeed;
      vx *= ratio;
      vz *= ratio;
      // Occasional slight edge-roll curve
      const rollCurl = (rng() - 0.5) * 0.04 * dt * newSpeed;
      const nx = -vz / hSpeed;
      const nz = vx / hSpeed;
      vx += nx * rollCurl;
      vz += nz * rollCurl;

      x += vx * dt;
      z += vz * dt;
      y = CAP_RADIUS;
    }

    // Ceiling bounce
    if (y > ceilingY - CAP_RADIUS) {
      y = ceilingY - CAP_RADIUS;
      if (vy > 0) vy = -vy * WALL_RESTITUTION;
    }

    // Gym boundary walls
    if (x > gymHalfX - CAP_RADIUS) {
      x = gymHalfX - CAP_RADIUS;
      if (vx > 0) vx = -vx * WALL_RESTITUTION;
    } else if (x < -gymHalfX + CAP_RADIUS) {
      x = -gymHalfX + CAP_RADIUS;
      if (vx < 0) vx = -vx * WALL_RESTITUTION;
    }
    if (z > gymBackZ - CAP_RADIUS) {
      z = gymBackZ - CAP_RADIUS;
      if (vz > 0) vz = -vz * WALL_RESTITUTION;
    } else if (z < gymOutZ + CAP_RADIUS) {
      z = gymOutZ + CAP_RADIUS;
      if (vz < 0) vz = -vz * WALL_RESTITUTION;
    }

    // 13m Fair Fence Arc Collision (z < 0 and |x| <= -z)
    const r = Math.hypot(x, z);
    const inFairSector = z < 0 && Math.abs(x) <= -z;
    if (inFairSector && prevR < FENCE_DIST && r >= FENCE_DIST) {
      if (y <= FENCE_HEIGHT) {
        hitFence = true;
        // Reflect radial velocity inward
        const nx = x / r;
        const nz = z / r;
        const vRad = vx * nx + vz * nz;
        if (vRad > 0) {
          vx -= (1 + FENCE_RESTITUTION) * vRad * nx;
          vz -= (1 + FENCE_RESTITUTION) * vRad * nz;
        }
        x = nx * (FENCE_DIST - CAP_RADIUS);
        z = nz * (FENCE_DIST - CAP_RADIUS);
      } else {
        overFence = true;
      }
    }

    if (isPastFenceExtension(x, z)) {
      crossedFenceExtension = true;
    }

    // Floor contact
    if (y <= CAP_RADIUS && !sliding) {
      y = CAP_RADIUS;
      if (firstLandingPos === null) {
        firstLandingPos = [x, 0, z];
      }
      if (isInfield(x, z)) hitInfield = true;
      else if (isOutfield(x, z)) hitOutfield = true;

      if (Math.abs(vy) > 0.7) {
        bounces += 1;
        if (!overFence && !hitFence && !crossedFenceExtension) bouncesBeforeFence += 1;
        vy = Math.abs(vy) * FLOOR_RESTITUTION;
        vx *= FLOOR_BOUNCE_FRICTION;
        vz *= FLOOR_BOUNCE_FRICTION;
      } else {
        bounces += 1;
        if (!overFence && !hitFence && !crossedFenceExtension) bouncesBeforeFence += 1;
        vy = 0;
        sliding = true;
      }
    }

    if (sliding) {
      if (isInfield(x, z)) hitInfield = true;
      else if (isOutfield(x, z)) hitOutfield = true;
    }

    if (y > maxHeightM) maxHeightM = y;
    const dist = Math.hypot(x, z);
    if (dist > maxDistanceM) maxDistanceM = dist;
    prevR = Math.hypot(x, z);

    if (t >= nextRecord) {
      frames.push({ t, pos: [x, y, z], vel: [vx, vy, vz] });
      nextRecord += recordInterval;
    }
  }

  const last = frames[frames.length - 1];
  if (last.t < t - 1e-4) {
    frames.push({ t, pos: [x, y, z], vel: [vx, vy, vz] });
  }

  return {
    frames,
    flightTimeSec: t,
    bounces,
    bouncesBeforeFence,
    firstLandingPos,
    stoppedPos: [x, y, z],
    hitInfield,
    hitOutfield,
    hitFence,
    overFence,
    crossedFenceExtension,
    maxHeightM,
    maxDistanceM,
  };
}
