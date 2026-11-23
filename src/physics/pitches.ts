/**
 * 7 authentic Cap Baseball pitch types driven by the 6-DOF cap-flight-sim engine,
 * plus an aim solver that computes launch azimuth & elevation to hit a target
 * in the strike zone.
 */
import { configFromRaw, type RawConfig } from './config';
import { runSimulation, type SimFrame, type SimResult } from './simulate';
import {
  deg2rad,
  matVec,
  qFromAxisAngle,
  qMultiply,
  qNormalize,
  qToMatrix,
  type Q4,
  type V3,
} from './vector';

export type PitchId = 'straight' | 'cutter' | 'fork' | 'changeup';

export type BaseAttitude = 'flat' | 'edge_on';
export type RotationSense = 'clockwise' | 'counterclockwise';

export interface PitchEnvelope {
  /** Minimum legal height above floor before plate (prevents ground-skimming rise). */
  minFlightZ: number;
  /** Maximum legal height ceiling before plate (prevents sky-lob drop). */
  maxFlightZ: number;
  /** Maximum lateral horizontal excursion |y| before plate. */
  maxAbsFlightY: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  maxAbsAzimuthDeg: number;
}

export interface PitchSpec {
  id: PitchId;
  code: string;
  nameEn: string;
  baseAttitude: BaseAttitude;
  bankRightDeg: number;
  noseUpDeg: number;
  yawLeftDeg: number;
  rpm: number;
  spinAxis: 'cap' | 'world_y';
  rotationSense: RotationSense;
  speedRangeKmh: readonly [number, number];
  defaultSpeedKmh: number;
  clAlphaPerRad?: number;
  magnusCoeff?: number;
  magnusMaxCoeff?: number;
  cdProjected?: number;
  wake?: {
    force_coefficient: number;
    moment_coefficient: number;
  };
  envelope: PitchEnvelope;
  description: string;
}

export const PITCH_SPECS: Record<PitchId, PitchSpec> = {
  straight: {
    id: 'straight',
    code: '4SFB',
    nameEn: 'Fastball',
    baseAttitude: 'flat',
    bankRightDeg: 0,
    noseUpDeg: 20,
    yawLeftDeg: 0,
    rpm: 3000,
    spinAxis: 'cap',
    rotationSense: 'counterclockwise',
    speedRangeKmh: [64, 76],
    defaultSpeedKmh: 70,
    clAlphaPerRad: 0.8,
    magnusCoeff: 0.015,
    envelope: {
      minFlightZ: 0.24,
      maxFlightZ: 1.85,
      maxAbsFlightY: 0.64,
      minElevationDeg: -7.5,
      maxElevationDeg: 7.5,
      maxAbsAzimuthDeg: 8.0,
    },
    description: '12 o\'clock high-spin rising hop.',
  },
  cutter: {
    id: 'cutter',
    code: 'CUT',
    nameEn: 'Cutter',
    baseAttitude: 'flat',
    bankRightDeg: -30,
    noseUpDeg: 5,
    yawLeftDeg: 5,
    rpm: 1300,
    spinAxis: 'cap',
    rotationSense: 'clockwise',
    speedRangeKmh: [64, 75],
    defaultSpeedKmh: 70,
    clAlphaPerRad: 0.9,
    magnusCoeff: 0.04,
    envelope: {
      minFlightZ: 0.22,
      maxFlightZ: 1.92,
      maxAbsFlightY: 0.72,
      minElevationDeg: -6.5,
      maxElevationDeg: 10.5,
      maxAbsAzimuthDeg: 10.0,
    },
    description: 'Sharp right-cutting break.',
  },
  fork: {
    id: 'fork',
    code: 'FORK',
    nameEn: 'Forkball',
    baseAttitude: 'edge_on',
    bankRightDeg: 0,
    noseUpDeg: 0,
    yawLeftDeg: 0,
    rpm: 500,
    spinAxis: 'world_y',
    rotationSense: 'counterclockwise',
    speedRangeKmh: [58, 70],
    defaultSpeedKmh: 65,
    clAlphaPerRad: 0.08,
    magnusCoeff: 0.25,
    magnusMaxCoeff: 1.0,
    envelope: {
      minFlightZ: 0.2,
      maxFlightZ: 2.02,
      maxAbsFlightY: 0.64,
      minElevationDeg: -4.5,
      maxElevationDeg: 14.5,
      maxAbsAzimuthDeg: 8.0,
    },
    description: '6 o\'clock sharp downward drop.',
  },
  changeup: {
    id: 'changeup',
    code: 'CH',
    nameEn: 'Changeup',
    baseAttitude: 'edge_on',
    bankRightDeg: -90,
    noseUpDeg: 75,
    yawLeftDeg: 5,
    rpm: 0,
    spinAxis: 'cap',
    rotationSense: 'counterclockwise',
    speedRangeKmh: [44, 56],
    defaultSpeedKmh: 50,
    clAlphaPerRad: 0.25,
    magnusCoeff: 0.03,
    cdProjected: 0.16,
    envelope: {
      minFlightZ: 0.22,
      maxFlightZ: 2.08,
      maxAbsFlightY: 0.72,
      minElevationDeg: -2.5,
      maxElevationDeg: 17.0,
      maxAbsAzimuthDeg: 10.0,
    },
    description: 'Face-on high-drag off-speed fade and drop.',
  },
};

export const PITCH_IDS: PitchId[] = ['straight', 'cutter', 'fork', 'changeup'];

export const DEFAULT_RELEASE_POS: V3 = [0.35, -0.22, 1.18];
export const HIT_PLANE_X = 9.0;
export const PLATE_PLANE_X = 9.22;
export const PASS_LINE_SIM_X = 9.22 + 2.334; // 11.554m
export const PITCH_END_SIM_X = 12.0;

const BASE_NORMAL: Record<BaseAttitude, V3> = {
  flat: [0, 0, 1],
  edge_on: [0, 1, 0],
};

function faceNormalFor(spec: PitchSpec, azimuthDeg: number, elevationDeg: number): V3 {
  const qSpec = qMultiply(
    qMultiply(
      qFromAxisAngle([0, 0, 1], deg2rad(spec.yawLeftDeg)),
      qFromAxisAngle([0, 1, 0], -deg2rad(spec.noseUpDeg)),
    ),
    qFromAxisAngle([1, 0, 0], deg2rad(spec.bankRightDeg)),
  );
  const qLaunch = qMultiply(
    qFromAxisAngle([0, 0, 1], deg2rad(azimuthDeg)),
    qFromAxisAngle([0, 1, 0], -deg2rad(elevationDeg)),
  );
  return matVec(qToMatrix(qMultiply(qLaunch, qSpec)), BASE_NORMAL[spec.baseAttitude]);
}

function angularVelocityFor(spec: PitchSpec): Record<string, unknown> {
  const sign = spec.rotationSense === 'counterclockwise' ? 1 : -1;
  if (spec.spinAxis === 'world_y') {
    return { rpm: spec.rpm, axis_world: [0, sign, 0] };
  }
  return { rpm: spec.rpm, axis_body: [0, 0, sign] };
}

export function buildPitchRawConfig(
  spec: PitchSpec,
  speedKmh: number,
  azimuthDeg: number,
  elevationDeg: number,
  releasePos: V3,
  options?: {
    enableWake?: boolean;
    disableAero?: boolean;
    seed?: number;
    fixedStepSec?: number;
    outputHz?: number;
    stopAtGround?: boolean;
    pitchDistanceM?: number;
  },
): RawConfig {
  const enableWake = Boolean(options?.enableWake && spec.wake);
  const aeroOn = !options?.disableAero;
  return {
    name: spec.id,
    label: 'game',
    cap: {
      mass_kg: 0.0022,
      outer_diameter_m: 0.031,
      height_m: 0.014,
      surface_orientation: 'body_z_is_top',
      inertia_method: 'thin_walled_cup',
    },
    environment: {
      air_density_kg_m3: 1.204,
      gravity_m_s2: 9.80665,
    },
    field: {
      pitch_distance_m: options?.pitchDistanceM ?? PITCH_END_SIM_X,
      ground_z_m: 0,
    },
    initial_state: {
      position_world_m: [...releasePos],
      speed_kmh: speedKmh,
      launch_azimuth_deg: azimuthDeg,
      launch_elevation_deg: elevationDeg,
      face_normal_world: [...faceNormalFor(spec, azimuthDeg, elevationDeg)],
      angular_velocity: angularVelocityFor(spec),
    },
    simulation: {
      solver: 'rk4',
      duration_sec: 2.5,
      fixed_step_sec: options?.fixedStepSec ?? 0.001,
      output_hz: options?.outputHz ?? 120,
      termination: {
        stop_at_ground: options?.stopAtGround ?? true,
        stop_at_catcher_plane: true,
      },
    },
    aerodynamics: {
      model: 'simple',
      enable: { drag: aeroOn, lift: aeroOn, magnus: aeroOn, moments: aeroOn },
      drag: { model: 'projected_area', cd_projected: spec.cdProjected ?? 0.6 },
      lift: {
        cl0: 0,
        cl_alpha_per_rad: spec.clAlphaPerRad ?? 1.4,
        stall_angle_deg: 45,
        post_stall: 'decay',
      },
      magnus: {
        model: 'linear_spin_parameter',
        coefficient: spec.magnusCoeff ?? 1.0,
        max_coefficient: spec.magnusMaxCoeff ?? 1.0,
      },
      moments: {
        cm_pitch0: 0,
        cm_pitch_alpha_per_rad: 0,
        spin_damping: 0.02,
        tumble_damping: 0.05,
      },
      ...(enableWake && spec.wake
        ? {
            wake: {
              force_coefficient: spec.wake.force_coefficient,
              moment_coefficient: spec.wake.moment_coefficient,
              seed: options?.seed ?? 1,
            },
          }
        : {}),
    },
  };
}

export interface PitchTrajectoryOptions {
  releasePos?: V3;
  seed?: number;
  errorY?: number;
  errorZ?: number;
  outputHz?: number;
  fixedStepSec?: number;
  /** Lightweight solver tolerances & step sizes for interactive UI preview ribbons only. */
  previewMode?: boolean;
  /** Optional warm-start launch azimuth (deg) from a nearby speed solve. */
  initialAzDeg?: number;
  /** Optional warm-start launch elevation (deg) from a nearby speed solve. */
  initialElDeg?: number;
}

export interface PitchTrajectoryResult {
  pitchId: PitchId;
  spec: PitchSpec;
  speedKmh: number;
  launchAzimuthDeg: number;
  launchElevationDeg: number;
  releasePos: V3;
  /** Position where the cap crosses the hit plane (X = 9.00m) */
  hitPlanePos: V3;
  /** Time when the cap crosses the hit plane (X = 9.00m) */
  hitPlaneTimeSec: number;
  /** Cap linear speed (m/s) when crossing the hit plane (X = 9.00m) */
  hitPlaneSpeedMs: number;
  /** Position where the cap crosses the front of home plate (X = 9.22m) */
  plateCrossPos: V3;
  /** Time when the cap crosses X = 9.22m */
  plateCrossTimeSec: number;
  /** [dx=0, actualY - straightLineY, actualZ - straightLineZ] at X = 9.00m */
  breakDelta: V3;
  /** True if the uncaught cap crosses the pass line (X = 11.554m) above ground */
  reachesPassLine: boolean;
  /** Position at the pass line (X = 11.554m) if reached */
  passLinePos: V3 | null;
  flightTimeSec: number;
  peakSpeedKmh: number;
  frames: SimFrame[];
  simResult: SimResult;
  sampleAt: (t: number) => SimFrame;
}

function interpolateXCrossing(
  frames: SimFrame[],
  targetX: number,
): { pos: V3; timeSec: number } | null {
  for (let i = 1; i < frames.length; i++) {
    const p0 = frames[i - 1];
    const p1 = frames[i];
    const x0 = p0.y[0];
    const x1 = p1.y[0];
    if (x0 <= targetX && x1 >= targetX && x1 > x0) {
      const alpha = (targetX - x0) / (x1 - x0);
      return {
        timeSec: p0.t + alpha * (p1.t - p0.t),
        pos: [
          targetX,
          p0.y[1] + alpha * (p1.y[1] - p0.y[1]),
          p0.y[2] + alpha * (p1.y[2] - p0.y[2]),
        ],
      };
    }
  }
  return null;
}

function measureAtHitPlane(sim: SimResult): { y: number; z: number; reached: boolean } {
  const cross = interpolateXCrossing(sim.frames, HIT_PLANE_X);
  if (cross) {
    return { y: cross.pos[1], z: cross.pos[2], reached: true };
  }
  const last = sim.frames[sim.frames.length - 1];
  return { y: last.y[1], z: last.y[2], reached: false };
}

function createSampleAt(frames: SimFrame[]): (t: number) => SimFrame {
  return (t: number): SimFrame => {
    if (frames.length === 0) {
      throw new Error('Cannot sample empty trajectory');
    }
    if (t <= frames[0].t) return frames[0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return last;

    let lo = 0;
    let hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= t) lo = mid;
      else hi = mid;
    }

    const f0 = frames[lo];
    const f1 = frames[hi];
    const dt = f1.t - f0.t;
    if (dt <= 0) return f0;
    const alpha = (t - f0.t) / dt;
    const lerp = (a: number, b: number) => a + alpha * (b - a);
    const y = f0.y.map((v, idx) => lerp(v, f1.y[idx]));
    const q = qNormalize([y[6], y[7], y[8], y[9]] as unknown as Q4);
    y[6] = q[0];
    y[7] = q[1];
    y[8] = q[2];
    y[9] = q[3];
    const R = qToMatrix(q);
    return {
      t,
      y,
      q,
      omegaWorld: [
        lerp(f0.omegaWorld[0], f1.omegaWorld[0]),
        lerp(f0.omegaWorld[1], f1.omegaWorld[1]),
        lerp(f0.omegaWorld[2], f1.omegaWorld[2]),
      ],
      normalWorld: [R[0][2], R[1][2], R[2][2]],
      aero: alpha < 0.5 ? f0.aero : f1.aero,
    };
  };
}

export function solvePitchTrajectory(
  pitchId: PitchId,
  speedKmh: number,
  targetPlateY: number,
  targetPlateZ: number,
  options?: PitchTrajectoryOptions,
): PitchTrajectoryResult {
  return solvePitchTrajectoryForSpec(PITCH_SPECS[pitchId], speedKmh, targetPlateY, targetPlateZ, options);
}

export function solvePitchTrajectoryForSpec(
  spec: PitchSpec,
  speedKmh: number,
  targetPlateY: number,
  targetPlateZ: number,
  options?: PitchTrajectoryOptions,
): PitchTrajectoryResult {
  const pitchId = spec.id;
  const releasePos: V3 = options?.releasePos ?? DEFAULT_RELEASE_POS;
  const goalY = targetPlateY + (options?.errorY ?? 0);
  const goalZ = targetPlateZ + (options?.errorZ ?? 0);
  const dx = HIT_PLANE_X - releasePos[0];

  const env = spec.envelope;
  const clampAz = (v: number) => Math.max(-env.maxAbsAzimuthDeg, Math.min(env.maxAbsAzimuthDeg, v));
  const clampEl = (v: number) => Math.max(env.minElevationDeg, Math.min(env.maxElevationDeg, v));

  const preview = Boolean(options?.previewMode);
  let azDeg =
    options?.initialAzDeg !== undefined
      ? clampAz(options.initialAzDeg)
      : clampAz((Math.atan2(goalY - releasePos[1], dx) * 180) / Math.PI);
  let elDeg =
    options?.initialElDeg !== undefined
      ? clampEl(options.initialElDeg)
      : clampEl((Math.atan2(goalZ - releasePos[2], dx) * 180) / Math.PI);

  const evalOffset = (az: number, el: number) => {
    const raw = buildPitchRawConfig(spec, speedKmh, az, el, releasePos, {
      enableWake: false,
      fixedStepSec: preview ? 0.008 : 0.004,
      outputHz: preview ? 24 : 30,
      stopAtGround: false,
      pitchDistanceM: HIT_PLANE_X,
    });
    const sim = runSimulation(configFromRaw(raw, pitchId));
    return measureAtHitPlane(sim);
  };

  // Chord-Newton aim solver: compute Jacobian on iter 0 (or if stalled) for ~20x faster solving on ARM/Pi
  const epsDeg = 0.25;
  const maxIter = preview ? 6 : 14;
  const tolM = preview ? 0.014 : 0.008;
  let j11 = 0, j21 = 0, j12 = 0, j22 = 0, det = 0;
  let hasJac = false;
  let prevErr = Infinity;
  for (let iter = 0; iter < maxIter; iter++) {
    const cur = evalOffset(azDeg, elDeg);
    const errY = goalY - cur.y;
    const errZ = goalZ - cur.z;
    const errNorm = Math.hypot(errY, errZ);
    if (cur.reached && errNorm < tolM) {
      break;
    }

    if (!hasJac || errNorm >= prevErr * 0.7) {
      const pAz = evalOffset(azDeg + epsDeg, elDeg);
      const pEl = evalOffset(azDeg, elDeg + epsDeg);
      j11 = (pAz.y - cur.y) / epsDeg;
      j21 = (pAz.z - cur.z) / epsDeg;
      j12 = (pEl.y - cur.y) / epsDeg;
      j22 = (pEl.z - cur.z) / epsDeg;
      det = j11 * j22 - j12 * j21;
      hasJac = true;
    }
    prevErr = errNorm;

    const prevAz = azDeg;
    const prevEl = elDeg;
    if (Math.abs(det) > 1e-6) {
      const damp = errNorm > 0.3 ? 0.65 : 1.0;
      const dAz = ((j22 * errY - j12 * errZ) / det) * damp;
      const dEl = ((-j21 * errY + j11 * errZ) / det) * damp;
      azDeg = clampAz(azDeg + Math.max(-10, Math.min(10, dAz)));
      elDeg = clampEl(elDeg + Math.max(-10, Math.min(10, dEl)));
    } else {
      const gain = (180 / Math.PI) / dx;
      azDeg = clampAz(azDeg + errY * gain);
      elDeg = clampEl(elDeg + errZ * gain);
    }
    if (Math.abs(azDeg - prevAz) < 1e-4 && Math.abs(elDeg - prevEl) < 1e-4) {
      break;
    }
  }

  // Final high-resolution simulation (with wake enabled for knuckleball) + envelope ceiling/floor/side enforcement
  const seed = options?.seed ?? ((Math.floor(Math.random() * 0xffffffff) >>> 0) || 1);
  const runFinal = () => {
    const raw = buildPitchRawConfig(spec, speedKmh, azDeg, elDeg, releasePos, {
      enableWake: preview ? false : Boolean(spec.wake),
      seed,
      fixedStepSec: options?.fixedStepSec ?? (preview ? 0.008 : 0.002),
      outputHz: options?.outputHz ?? (preview ? 24 : 120),
      pitchDistanceM: preview ? PLATE_PLANE_X : PITCH_END_SIM_X,
    });
    return runSimulation(configFromRaw(raw, pitchId));
  };

  const measureEnvelope = (sim: SimResult) => {
    let maxZ = -Infinity;
    let minZ = Infinity;
    let worstY = 0;
    for (const f of sim.frames) {
      if (f.y[0] > PLATE_PLANE_X) break;
      if (f.y[2] > maxZ) maxZ = f.y[2];
      if (f.y[2] < minZ) minZ = f.y[2];
      if (Math.abs(f.y[1]) > Math.abs(worstY)) worstY = f.y[1];
    }
    return { maxZ, minZ, worstY };
  };

  const envSearchSteps = preview ? 4 : 7;
  let simResult = runFinal();
  let envStats = measureEnvelope(simResult);

  // Smooth monotonic binary search for vertical ceiling / floor (zero discrete jump or oscillation!)
  if (envStats.maxZ > env.maxFlightZ) {
    let loEl = env.minElevationDeg;
    let hiEl = elDeg;
    for (let i = 0; i < envSearchSteps; i++) {
      const mid = (loEl + hiEl) * 0.5;
      elDeg = clampEl(mid);
      simResult = runFinal();
      envStats = measureEnvelope(simResult);
      if (envStats.maxZ > env.maxFlightZ) {
        hiEl = mid;
      } else {
        loEl = mid;
      }
    }
    elDeg = clampEl(loEl);
    simResult = runFinal();
    envStats = measureEnvelope(simResult);
  } else if (envStats.minZ < env.minFlightZ) {
    let loEl = elDeg;
    let hiEl = env.maxElevationDeg;
    for (let i = 0; i < envSearchSteps; i++) {
      const mid = (loEl + hiEl) * 0.5;
      elDeg = clampEl(mid);
      simResult = runFinal();
      envStats = measureEnvelope(simResult);
      if (envStats.minZ < env.minFlightZ) {
        loEl = mid;
      } else {
        hiEl = mid;
      }
    }
    elDeg = clampEl(hiEl);
    simResult = runFinal();
    envStats = measureEnvelope(simResult);
  }

  // Smooth monotonic binary search for lateral wall |y| <= maxAbsFlightY
  if (Math.abs(envStats.worstY) > env.maxAbsFlightY) {
    const signY = Math.sign(envStats.worstY);
    let innerAz = 0;
    let outerAz = azDeg;
    for (let i = 0; i < envSearchSteps; i++) {
      const mid = (innerAz + outerAz) * 0.5;
      azDeg = clampAz(mid);
      simResult = runFinal();
      envStats = measureEnvelope(simResult);
      if (Math.abs(envStats.worstY) > env.maxAbsFlightY && Math.sign(envStats.worstY) === signY) {
        outerAz = mid;
      } else {
        innerAz = mid;
      }
    }
    azDeg = clampAz(innerAz);
    simResult = runFinal();
  }
  const frames = simResult.frames;

  const last = frames[frames.length - 1];
  const hitCross = interpolateXCrossing(frames, HIT_PLANE_X) ?? {
    pos: [last.y[0], last.y[1], last.y[2]] as V3,
    timeSec: last.t,
  };
  const plateCross = interpolateXCrossing(frames, PLATE_PLANE_X) ?? hitCross;
  const passCross = interpolateXCrossing(frames, PASS_LINE_SIM_X);

  // Gravity-only ballistic baseline (drag/lift/magnus off) via exact closed-form kinematics
  const speedMs = speedKmh / 3.6;
  const azRad = deg2rad(azDeg);
  const elRad = deg2rad(elDeg);
  const vx0 = speedMs * Math.cos(elRad) * Math.cos(azRad);
  const vy0 = speedMs * Math.cos(elRad) * Math.sin(azRad);
  const vz0 = speedMs * Math.sin(elRad);
  const tBallistic = (HIT_PLANE_X - releasePos[0]) / Math.max(1e-6, vx0);
  const ballisticY = releasePos[1] + vy0 * tBallistic;
  const ballisticZ = releasePos[2] + vz0 * tBallistic - 0.5 * 9.80665 * tBallistic * tBallistic;

  const breakDelta: V3 = [
    0,
    hitCross.pos[1] - ballisticY,
    hitCross.pos[2] - ballisticZ,
  ];

  let peakSpeedMS = 0;
  for (const f of frames) {
    const spd = Math.hypot(f.y[3], f.y[4], f.y[5]);
    if (spd > peakSpeedMS) peakSpeedMS = spd;
  }

  const sampleAt = createSampleAt(frames);
  const hitSample = sampleAt(hitCross.timeSec);
  const hitPlaneSpeedMs = Math.hypot(hitSample.y[3], hitSample.y[4], hitSample.y[5]);

  return {
    pitchId,
    spec,
    speedKmh,
    launchAzimuthDeg: azDeg,
    launchElevationDeg: elDeg,
    releasePos,
    hitPlanePos: hitCross.pos,
    hitPlaneTimeSec: hitCross.timeSec,
    hitPlaneSpeedMs,
    plateCrossPos: plateCross.pos,
    plateCrossTimeSec: plateCross.timeSec,
    breakDelta,
    reachesPassLine: passCross !== null && passCross.pos[2] > 0,
    passLinePos: passCross ? passCross.pos : null,
    flightTimeSec: last.t,
    peakSpeedKmh: peakSpeedMS * 3.6,
    frames,
    simResult,
    sampleAt,
  };
}
