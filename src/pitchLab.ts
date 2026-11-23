import { configFromRaw } from './physics/config';
import {
  buildPitchRawConfig,
  DEFAULT_RELEASE_POS,
  HIT_PLANE_X,
  PASS_LINE_SIM_X,
  PITCH_SPECS,
  PLATE_PLANE_X,
  solvePitchTrajectoryForSpec,
  type BaseAttitude,
  type PitchId,
  type PitchSpec,
  type RotationSense,
} from './physics/pitches';
import { runSimulation, type SimFrame } from './physics/simulate';
import { deg2rad, qToMatrix, type V3 } from './physics/vector';
import { PLATE_WIDTH, STRIKE_ZONE_HI, STRIKE_ZONE_LO } from './rules/field';
import { computeStrikeZoneMarginM } from './rules/judge';
import {
  drawSpeedRibbon3D,
  RIBBON_SPRING_STOPS,
  type SpeedRibbonCurve,
  type SpeedRibbonData,
} from './render/speedRibbon';

const UNIFIED_LOCKED_AERO = {
  airDensityKgM3: 1.225,
  gravityMs2: 9.80665,
  capMassG: 2.2,
  capDiameterMm: 31.0,
  capHeightMm: 14.0,
  cdProjected: 0.24,
  clAlphaPerRad: 0.72,
  magnusCoeff: 0.12,
  stallAngleDeg: 45,
  spinDamping: 0.02,
} as const;

interface LabState {
  presetId: PitchId;
  aeroProfile: 'unified' | 'game_preset';
  controlMode: 'aim' | 'manual';
  speedKmh: number;
  baseAttitude: BaseAttitude;
  bankRightDeg: number;
  noseUpDeg: number;
  yawLeftDeg: number;
  rpm: number;
  rotationSense: RotationSense;
  spinAxis: 'cap' | 'world_y';
  targetX: number;
  targetY: number;
  launchAzimuthDeg: number;
  launchElevationDeg: number;
  releasePos: [number, number, number];
}

interface LabSimOutput {
  frames: SimFrame[];
  ballisticPts: V3[];
  hitPos: V3;
  hitTimeSec: number;
  hitSpeedKmh: number;
  ballisticHitPos: V3;
  breakCm: [number, number];
  breakMagCm: number;
  launchAzDeg: number;
  launchElDeg: number;
  isStrike: boolean;
  marginCm: number;
  activeAero: {
    cdProjected: number;
    clAlphaPerRad: number;
    magnusCoeff: number;
  };
}

interface OrbitCamera {
  // Target point in sim FLU coordinates [x(forward), y(right), z(up)]
  target: [number, number, number];
  // Azimuth around +Z (rad), Pitch above horizontal plane (rad)
  yaw: number;
  pitch: number;
  distance: number;
  fovDeg: number;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const aeroProfileEl = el<HTMLSelectElement>('aero-profile');
const lockedAeroGridEl = el<HTMLDivElement>('locked-aero-grid');
const telemetryStripEl = el<HTMLDivElement>('telemetry-strip');

const inSpeed = el<HTMLInputElement>('in-speed');
const valSpeed = el<HTMLElement>('val-speed');
const inAttitude = el<HTMLSelectElement>('in-attitude');
const inSpinAxis = el<HTMLSelectElement>('in-spin-axis');
const inRotSense = el<HTMLSelectElement>('in-rot-sense');
const inRpm = el<HTMLInputElement>('in-rpm');
const valRpm = el<HTMLElement>('val-rpm');
const inBank = el<HTMLInputElement>('in-bank');
const valBank = el<HTMLElement>('val-bank');
const inNose = el<HTMLInputElement>('in-nose');
const valNose = el<HTMLElement>('val-nose');
const inYaw = el<HTMLInputElement>('in-yaw');
const valYaw = el<HTMLElement>('val-yaw');

const modeAimBtn = el<HTMLButtonElement>('mode-aim');
const modeManualBtn = el<HTMLButtonElement>('mode-manual');
const aimControlsEl = el<HTMLDivElement>('aim-controls');
const manualControlsEl = el<HTMLDivElement>('manual-controls');
const inTx = el<HTMLInputElement>('in-tx');
const valTx = el<HTMLElement>('val-tx');
const inTy = el<HTMLInputElement>('in-ty');
const valTy = el<HTMLElement>('val-ty');
const inAz = el<HTMLInputElement>('in-az');
const valAz = el<HTMLElement>('val-az');
const inEl = el<HTMLInputElement>('in-el');
const valEl = el<HTMLElement>('val-el');

const inRx = el<HTMLInputElement>('in-rx');
const valRx = el<HTMLElement>('val-rx');
const inRy = el<HTMLInputElement>('in-ry');
const valRy = el<HTMLElement>('val-ry');
const inRz = el<HTMLInputElement>('in-rz');
const valRz = el<HTMLElement>('val-rz');

const btnReset = el<HTMLButtonElement>('btn-reset');
const btnCopyJson = el<HTMLButtonElement>('btn-copy-json');
const btnPlay = el<HTMLButtonElement>('btn-play');
const btnSlow = el<HTMLButtonElement>('btn-slow');
const btnLoop = el<HTMLButtonElement>('btn-loop');
const btnFollow = el<HTMLButtonElement>('btn-follow');
const btnVectors = el<HTMLButtonElement>('btn-vectors');
const btnSpeedRibbon = el<HTMLButtonElement>('btn-speed-ribbon');
const inScrub = el<HTMLInputElement>('in-scrub');
const valTime = el<HTMLElement>('val-time');

const cv3d = el<HTMLCanvasElement>('cv-3d');
const ctx = cv3d.getContext('2d')!;
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.preset-btn'));
const camButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.cam-btn[data-cam]'));

const state: LabState = {
  presetId: 'straight',
  aeroProfile: 'game_preset',
  controlMode: 'aim',
  speedKmh: PITCH_SPECS.straight.defaultSpeedKmh,
  baseAttitude: PITCH_SPECS.straight.baseAttitude,
  bankRightDeg: PITCH_SPECS.straight.bankRightDeg,
  noseUpDeg: PITCH_SPECS.straight.noseUpDeg,
  yawLeftDeg: PITCH_SPECS.straight.yawLeftDeg,
  rpm: PITCH_SPECS.straight.rpm,
  rotationSense: PITCH_SPECS.straight.rotationSense,
  spinAxis: PITCH_SPECS.straight.spinAxis,
  targetX: 0,
  targetY: 0.72,
  launchAzimuthDeg: 0,
  launchElevationDeg: 0,
  releasePos: [...DEFAULT_RELEASE_POS],
};

// Default 3D oblique view mirroring cap-flight-sim
const orbit: OrbitCamera = {
  target: [4.6, 0, 0.72],
  yaw: -2.42,
  pitch: 0.34,
  distance: 9.8,
  fovDeg: 42,
};

let currentSim: LabSimOutput | null = null;
let currentRibbon: SpeedRibbonData<V3> | null = null;
let animPlaying = true;
let animSlowMo = false;
let animLoop = true;
let followCap = false;
let showVectors = true;
let showSpeedRibbon = false;
let animProgress = 0.0;
let lastRafMs = 0;

function setCameraPreset(preset: string): void {
  followCap = false;
  btnFollow.setAttribute('aria-pressed', 'false');
  for (const b of camButtons) {
    b.classList.toggle('active', b.dataset.cam === preset);
  }
  switch (preset) {
    case 'catcher':
      orbit.target = [8.6, 0, 0.72];
      orbit.yaw = 0.0; // looking from +X toward -X (catcher behind plate looking at pitcher)
      orbit.pitch = 0.08;
      orbit.distance = 3.2;
      break;
    case 'pitcher':
      orbit.target = [4.5, 0, 0.78];
      orbit.yaw = Math.PI;
      orbit.pitch = 0.14;
      orbit.distance = 6.2;
      break;
    case 'side':
      orbit.target = [4.6, 0, 0.85];
      orbit.yaw = -Math.PI * 0.5;
      orbit.pitch = 0.06;
      orbit.distance = 11.4;
      break;
    case 'top':
      orbit.target = [4.6, 0, 0.4];
      orbit.yaw = -Math.PI * 0.5;
      orbit.pitch = 1.46;
      orbit.distance = 12.2;
      break;
    default: // 'iso'
      orbit.target = [4.6, 0, 0.72];
      orbit.yaw = -2.42;
      orbit.pitch = 0.34;
      orbit.distance = 9.8;
      break;
  }
}

function getActiveAero(): { cdProjected: number; clAlphaPerRad: number; magnusCoeff: number } {
  if (state.aeroProfile === 'unified') {
    return {
      cdProjected: UNIFIED_LOCKED_AERO.cdProjected,
      clAlphaPerRad: UNIFIED_LOCKED_AERO.clAlphaPerRad,
      magnusCoeff: UNIFIED_LOCKED_AERO.magnusCoeff,
    };
  }
  const base = PITCH_SPECS[state.presetId];
  return {
    cdProjected: base.cdProjected ?? 0.6,
    clAlphaPerRad: base.clAlphaPerRad ?? 1.4,
    magnusCoeff: base.magnusCoeff ?? 1.0,
  };
}

function buildActiveSpec(): PitchSpec {
  const base = PITCH_SPECS[state.presetId];
  const aero = getActiveAero();
  return {
    ...base,
    baseAttitude: state.baseAttitude,
    bankRightDeg: state.bankRightDeg,
    noseUpDeg: state.noseUpDeg,
    yawLeftDeg: state.yawLeftDeg,
    rpm: state.rpm,
    rotationSense: state.rotationSense,
    spinAxis: state.spinAxis,
    cdProjected: aero.cdProjected,
    clAlphaPerRad: aero.clAlphaPerRad,
    magnusCoeff: aero.magnusCoeff,
    envelope: {
      minFlightZ: 0.02,
      maxFlightZ: 6.0,
      maxAbsFlightY: 4.5,
      minElevationDeg: -30,
      maxElevationDeg: 45,
      maxAbsAzimuthDeg: 45,
    },
  };
}

function interpolateCrossing(frames: SimFrame[], targetX: number): { pos: V3; timeSec: number; speedMs: number } {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.y[0] <= targetX && b.y[0] >= targetX && b.y[0] > a.y[0]) {
      const u = (targetX - a.y[0]) / (b.y[0] - a.y[0]);
      const lerp = (p: number, q: number) => p + u * (q - p);
      return {
        pos: [targetX, lerp(a.y[1], b.y[1]), lerp(a.y[2], b.y[2])],
        timeSec: lerp(a.t, b.t),
        speedMs: Math.hypot(lerp(a.y[3], b.y[3]), lerp(a.y[4], b.y[4]), lerp(a.y[5], b.y[5])),
      };
    }
  }
  const last = frames[frames.length - 1];
  return {
    pos: [last.y[0], last.y[1], last.y[2]],
    timeSec: last.t,
    speedMs: Math.hypot(last.y[3], last.y[4], last.y[5]),
  };
}

function runLabSimulation(): LabSimOutput {
  const spec = buildActiveSpec();
  const aero = getActiveAero();
  const rel: V3 = [state.releasePos[0], state.releasePos[1], state.releasePos[2]];

  let frames: SimFrame[];
  let azDeg: number;
  let elDeg: number;
  let hitPos: V3;
  let hitTimeSec: number;
  let hitSpeedMs: number;

  if (state.controlMode === 'aim') {
    const solved = solvePitchTrajectoryForSpec(spec, state.speedKmh, state.targetX, state.targetY, {
      releasePos: rel,
      outputHz: 120,
      seed: 42,
    });
    frames = solved.frames;
    azDeg = solved.launchAzimuthDeg;
    elDeg = solved.launchElevationDeg;
    hitPos = solved.hitPlanePos;
    hitTimeSec = solved.hitPlaneTimeSec;
    hitSpeedMs = solved.hitPlaneSpeedMs;
    state.launchAzimuthDeg = Number(azDeg.toFixed(1));
    state.launchElevationDeg = Number(elDeg.toFixed(1));
  } else {
    azDeg = state.launchAzimuthDeg;
    elDeg = state.launchElevationDeg;
    const raw = buildPitchRawConfig(spec, state.speedKmh, azDeg, elDeg, rel, {
      fixedStepSec: 0.002,
      outputHz: 120,
      seed: 42,
    });
    const sim = runSimulation(configFromRaw(raw));
    frames = sim.frames;
    const cross = interpolateCrossing(frames, HIT_PLANE_X);
    hitPos = cross.pos;
    hitTimeSec = cross.timeSec;
    hitSpeedMs = cross.speedMs;
  }

  const v0 = state.speedKmh / 3.6;
  const azRad = deg2rad(azDeg);
  const elRad = deg2rad(elDeg);
  const vx0 = v0 * Math.cos(elRad) * Math.cos(azRad);
  const vy0 = v0 * Math.cos(elRad) * Math.sin(azRad);
  const vz0 = v0 * Math.sin(elRad);
  const tBallHit = (HIT_PLANE_X - rel[0]) / Math.max(1e-6, vx0);
  const ballisticHitPos: V3 = [
    HIT_PLANE_X,
    rel[1] + vy0 * tBallHit,
    rel[2] + vz0 * tBallHit - 0.5 * UNIFIED_LOCKED_AERO.gravityMs2 * tBallHit * tBallHit,
  ];
  const ballisticPts: V3[] = [];
  const maxT = Math.min(1.5, (PLATE_PLANE_X - rel[0]) / Math.max(1e-6, vx0));
  for (let i = 0; i <= 54; i++) {
    const t = (i / 54) * maxT;
    const bz = rel[2] + vz0 * t - 0.5 * UNIFIED_LOCKED_AERO.gravityMs2 * t * t;
    ballisticPts.push([rel[0] + vx0 * t, rel[1] + vy0 * t, Math.max(0, bz)]);
    if (bz <= 0) break;
  }

  const breakDxCm = (hitPos[1] - ballisticHitPos[1]) * 100;
  const breakDzCm = (hitPos[2] - ballisticHitPos[2]) * 100;
  const marginM = computeStrikeZoneMarginM(hitPos[1], hitPos[2]);

  return {
    frames,
    ballisticPts,
    hitPos,
    hitTimeSec,
    hitSpeedKmh: hitSpeedMs * 3.6,
    ballisticHitPos,
    breakCm: [breakDxCm, breakDzCm],
    breakMagCm: Math.hypot(breakDxCm, breakDzCm),
    launchAzDeg: azDeg,
    launchElDeg: elDeg,
    isStrike: marginM <= 0,
    marginCm: marginM * 100,
    activeAero: aero,
  };
}

function buildLabSpeedRibbon(): SpeedRibbonData<V3> {
  const spec = buildActiveSpec();
  const rel: V3 = [state.releasePos[0], state.releasePos[1], state.releasePos[2]];
  const preset = PITCH_SPECS[state.presetId];
  const minS = Math.min(preset.speedRangeKmh[0], Math.max(15, state.speedKmh - 10));
  const maxS = Math.max(preset.speedRangeKmh[1] + 3, Math.min(130, state.speedKmh + 8));
  const sampleCount = 16;
  const curvesRev: SpeedRibbonCurve<V3>[] = [];
  let prevAz: number | undefined;
  let prevEl: number | undefined;

  for (let idxStop = RIBBON_SPRING_STOPS.length - 1; idxStop >= 0; idxStop--) {
    const u = RIBBON_SPRING_STOPS[idxStop];
    const spd = Math.round(minS + (maxS - minS) * u);
    let frames: SimFrame[];
    let hitPos: V3;
    let hitTimeSec: number;

    if (state.controlMode === 'aim') {
      const solved = solvePitchTrajectoryForSpec(spec, spd, state.targetX, state.targetY, {
        releasePos: rel,
        previewMode: true,
        initialAzDeg: prevAz,
        initialElDeg: prevEl,
        seed: 42,
      });
      prevAz = solved.launchAzimuthDeg;
      prevEl = solved.launchElevationDeg;
      frames = solved.frames;
      hitPos = solved.hitPlanePos;
      hitTimeSec = solved.hitPlaneTimeSec;
    } else {
      const raw = buildPitchRawConfig(spec, spd, state.launchAzimuthDeg, state.launchElevationDeg, rel, {
        fixedStepSec: 0.008,
        outputHz: 24,
        pitchDistanceM: PLATE_PLANE_X,
        seed: 42,
      });
      const sim = runSimulation(configFromRaw(raw));
      frames = sim.frames;
      const cross = interpolateCrossing(frames, HIT_PLANE_X);
      hitPos = cross.pos;
      hitTimeSec = cross.timeSec;
    }

    const pts: V3[] = new Array(sampleCount);
    const maxT = Math.max(0.05, hitTimeSec);
    for (let i = 0; i < sampleCount; i++) {
      const t = (i / (sampleCount - 1)) * maxT;
      let idx = frames.length - 1;
      for (let f = 1; f < frames.length; f++) {
        if (frames[f].t >= t) {
          idx = f;
          break;
        }
      }
      const f0 = frames[Math.max(0, idx - 1)];
      const f1 = frames[idx];
      const dt = f1.t - f0.t;
      const a = dt > 1e-6 ? Math.max(0, Math.min(1, (t - f0.t) / dt)) : 0;
      pts[i] = [
        f0.y[0] + (f1.y[0] - f0.y[0]) * a,
        f0.y[1] + (f1.y[1] - f0.y[1]) * a,
        Math.max(0.01, f0.y[2] + (f1.y[2] - f0.y[2]) * a),
      ];
    }
    curvesRev.push({
      u,
      speedKmh: spd,
      points: pts,
      landing: [hitPos[0], hitPos[1], Math.max(0.01, hitPos[2])],
    });
  }

  curvesRev.reverse();
  return { curves: curvesRev };
}

function renderLockedAeroCards(aero: { cdProjected: number; clAlphaPerRad: number; magnusCoeff: number }): void {
  const items: [string, string][] = [
    ['空氣密度 ρ', `${UNIFIED_LOCKED_AERO.airDensityKgM3}`],
    ['質量 / 直徑', `${UNIFIED_LOCKED_AERO.capMassG}g · ${UNIFIED_LOCKED_AERO.capDiameterMm}mm`],
    ['阻力 cd', aero.cdProjected.toFixed(2)],
    ['升力 cl_α', aero.clAlphaPerRad.toFixed(2)],
    ['馬格努斯', aero.magnusCoeff.toFixed(3)],
    ['阻尼 / 失速', `${UNIFIED_LOCKED_AERO.spinDamping} · ${UNIFIED_LOCKED_AERO.stallAngleDeg}°`],
  ];
  lockedAeroGridEl.replaceChildren(
    ...items.map(([k, v]) => {
      const div = document.createElement('div');
      div.className = 'locked-item';
      const s = document.createElement('span');
      s.textContent = k;
      const b = document.createElement('strong');
      b.textContent = v;
      div.append(s, b);
      return div;
    }),
  );
}

function renderTelemetry(sim: LabSimOutput): void {
  const pills: { label: string; value: string; cls?: string }[] = [
    { label: '進壘時間', value: `${Math.round(sim.hitTimeSec * 1000)} ms`, cls: 'sky' },
    { label: '尾速', value: `${sim.hitSpeedKmh.toFixed(1)} km/h` },
    { label: '位移 (dx, dy)', value: `${sim.breakCm[0].toFixed(0)}, ${sim.breakCm[1].toFixed(0)} cm`, cls: 'gold' },
    { label: '總變化', value: `${sim.breakMagCm.toFixed(1)} cm`, cls: 'gold' },
    {
      label: '落點',
      value: `${sim.isStrike ? '好球' : '壞球'} ${sim.marginCm >= 0 ? '+' : ''}${sim.marginCm.toFixed(1)}cm`,
      cls: sim.isStrike ? 'green' : 'red',
    },
    { label: '出手 az / el', value: `${sim.launchAzDeg.toFixed(1)}° / ${sim.launchElDeg.toFixed(1)}°` },
  ];
  telemetryStripEl.replaceChildren(
    ...pills.map((p) => {
      const div = document.createElement('div');
      div.className = `tel-pill${p.cls ? ` ${p.cls}` : ''}`;
      const s = document.createElement('span');
      s.textContent = p.label;
      const b = document.createElement('strong');
      b.textContent = p.value;
      div.append(s, b);
      return div;
    }),
  );
}

// --- True 3D Software Projection (Sim FLU World: +X catcher, +Y right/1B, +Z up) ---
interface CamBasis {
  eye: V3;
  right: V3;
  up: V3;
  fwd: V3;
  focal: number;
  cx: number;
  cy: number;
}

function buildCamBasis(w: number, h: number): CamBasis {
  const cosP = Math.cos(orbit.pitch);
  const sinP = Math.sin(orbit.pitch);
  const cosY = Math.cos(orbit.yaw);
  const sinY = Math.sin(orbit.yaw);

  const eye: V3 = [
    orbit.target[0] + orbit.distance * cosP * cosY,
    orbit.target[1] + orbit.distance * cosP * sinY,
    orbit.target[2] + orbit.distance * sinP,
  ];
  const fx = orbit.target[0] - eye[0];
  const fy = orbit.target[1] - eye[1];
  const fz = orbit.target[2] - eye[2];
  const fLen = Math.hypot(fx, fy, fz) || 1;
  const fwd: V3 = [fx / fLen, fy / fLen, fz / fLen];

  // World up = (0, 0, 1); right = normalize(fwd x worldUp)
  const rx0 = fwd[1] * 1 - fwd[2] * 0;
  const ry0 = fwd[2] * 0 - fwd[0] * 1;
  const rz0 = 0;
  const rLen = Math.hypot(rx0, ry0, rz0) || 1;
  const right: V3 = [rx0 / rLen, ry0 / rLen, rz0 / rLen];

  // Camera up = right x fwd
  const up: V3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];

  const focal = (h * 0.5) / Math.tan(deg2rad(orbit.fovDeg * 0.5));
  return { eye, right, up, fwd, focal, cx: w * 0.5, cy: h * 0.5 };
}

function project3D(cam: CamBasis, p: V3): { sx: number; sy: number; depth: number; scale: number; ok: boolean } {
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  const depth = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (depth <= 0.08) return { sx: 0, sy: 0, depth, scale: 0, ok: false };
  const px = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const py = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const scale = cam.focal / depth;
  return {
    sx: cam.cx + px * scale,
    sy: cam.cy - py * scale,
    depth,
    scale,
    ok: true,
  };
}

function drawLine3D(cam: CamBasis, a: V3, b: V3, stroke: string, width: number, dash?: number[]): void {
  const pa = project3D(cam, a);
  const pb = project3D(cam, b);
  if (!pa.ok || !pb.ok) return;
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pa.sx, pa.sy);
  ctx.lineTo(pb.sx, pb.sy);
  ctx.stroke();
  ctx.restore();
}

function drawPoly3D(cam: CamBasis, pts: V3[], fill: string, stroke?: string, lineWidth = 1): void {
  const proj = pts.map((p) => project3D(cam, p));
  if (proj.some((p) => !p.ok)) return;
  ctx.beginPath();
  proj.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawArrow3D(cam: CamBasis, origin: V3, vec: V3, color: string, width = 2.2): void {
  const mag = Math.hypot(vec[0], vec[1], vec[2]);
  if (mag < 1e-4) return;
  const end: V3 = [origin[0] + vec[0], origin[1] + vec[1], origin[2] + vec[2]];
  const p0 = project3D(cam, origin);
  const p1 = project3D(cam, end);
  if (!p0.ok || !p1.ok) return;
  const ang = Math.atan2(p1.sy - p0.sy, p1.sx - p0.sx);
  const head = Math.max(5, Math.min(11, Math.hypot(p1.sx - p0.sx, p1.sy - p0.sy) * 0.25));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p0.sx, p0.sy);
  ctx.lineTo(p1.sx, p1.sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p1.sx, p1.sy);
  ctx.lineTo(p1.sx - head * Math.cos(ang - 0.42), p1.sy - head * Math.sin(ang - 0.42));
  ctx.lineTo(p1.sx - head * Math.cos(ang + 0.42), p1.sy - head * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpinningCap3D(cam: CamBasis, frame: SimFrame, dpr: number): void {
  const pos: V3 = [frame.y[0], frame.y[1], Math.max(0.015, frame.y[2])];
  const R = qToMatrix(frame.q);
  // Body axes in world FLU coordinates: bx (stripe reference), by, bz (cap face normal)
  const bx: V3 = [R[0][0], R[1][0], R[2][0]];
  const by: V3 = [R[0][1], R[1][1], R[2][1]];
  const bz: V3 = [R[0][2], R[1][2], R[2][2]];

  // Visual radius scaled ~4.5x real 15.5mm so 3D attitude & spin stripe are unmistakably readable
  const rad = 0.082;
  const halfH = rad * 0.46;
  const segs = 24;

  const topRing: V3[] = [];
  const botRing: V3[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a) * rad;
    const sa = Math.sin(a) * rad;
    const rx = ca * bx[0] + sa * by[0];
    const ry = ca * bx[1] + sa * by[1];
    const rz = ca * bx[2] + sa * by[2];
    topRing.push([pos[0] + rx + bz[0] * halfH, pos[1] + ry + bz[1] * halfH, pos[2] + rz + bz[2] * halfH]);
    botRing.push([pos[0] + rx - bz[0] * halfH, pos[1] + ry - bz[1] * halfH, pos[2] + rz - bz[2] * halfH]);
  }

  // Determine whether top face or cavity bottom faces the camera
  const toEye: V3 = [cam.eye[0] - pos[0], cam.eye[1] - pos[1], cam.eye[2] - pos[2]];
  const topVisible = toEye[0] * bz[0] + toEye[1] * bz[1] + toEye[2] * bz[2] >= 0;

  // Back face first
  drawPoly3D(cam, topVisible ? botRing : topRing, '#64748b', '#94a3b8', 1 * dpr);

  // Sidewall quads sorted by depth
  const quads: { pts: V3[]; depth: number; isStripe: boolean }[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const mid: V3 = [
      (topRing[i][0] + botRing[j][0]) * 0.5,
      (topRing[i][1] + botRing[j][1]) * 0.5,
      (topRing[i][2] + botRing[j][2]) * 0.5,
    ];
    const pMid = project3D(cam, mid);
    if (!pMid.ok) continue;
    quads.push({
      pts: [topRing[i], topRing[j], botRing[j], botRing[i]],
      depth: pMid.depth,
      isStripe: i === 0 || i === 1,
    });
  }
  quads.sort((a, b) => b.depth - a.depth);
  for (const q of quads) {
    drawPoly3D(cam, q.pts, q.isStripe ? '#0f172a' : '#cbd5e1', '#94a3b8', 0.6 * dpr);
  }

  // Front face
  drawPoly3D(
    cam,
    topVisible ? topRing : botRing,
    topVisible ? '#f8fafc' : '#94a3b8',
    '#e2e8f0',
    1.2 * dpr,
  );

  // Rotation orientation line across cap face (along +bx) so spin is clearly visible!
  const s0: V3 = [
    pos[0] + (topVisible ? halfH : -halfH) * bz[0],
    pos[1] + (topVisible ? halfH : -halfH) * bz[1],
    pos[2] + (topVisible ? halfH : -halfH) * bz[2],
  ];
  const s1: V3 = [s0[0] + bx[0] * rad * 0.92, s0[1] + bx[1] * rad * 0.92, s0[2] + bx[2] * rad * 0.92];
  drawLine3D(cam, s0, s1, '#0f172a', 2.2 * dpr);

  // Live 3D Velocity & Aerodynamic Force Vectors (matching cap-flight-sim!)
  if (showVectors) {
    const vScale = 0.055; // ~19 m/s -> ~1.05m yellow arrow
    drawArrow3D(cam, pos, [frame.y[3] * vScale, frame.y[4] * vScale, frame.y[5] * vScale], '#facc15', 2.2 * dpr);

    // Scale forces (typical cap aero force ~0.01..0.06 N -> 0.4..1.4 m arrows)
    const fScale = 24.0;
    const clampVec = (v: V3, maxLen: number): V3 => {
      const m = Math.hypot(v[0], v[1], v[2]);
      if (m <= maxLen || m < 1e-6) return v;
      const k = maxLen / m;
      return [v[0] * k, v[1] * k, v[2] * k];
    };
    const dragV = clampVec([frame.aero.drag[0] * fScale, frame.aero.drag[1] * fScale, frame.aero.drag[2] * fScale], 1.6);
    const liftV = clampVec([frame.aero.lift[0] * fScale, frame.aero.lift[1] * fScale, frame.aero.lift[2] * fScale], 1.6);
    const magV = clampVec(
      [frame.aero.magnus[0] * fScale, frame.aero.magnus[1] * fScale, frame.aero.magnus[2] * fScale],
      1.6,
    );
    drawArrow3D(cam, pos, dragV, '#f43f5e', 2.0 * dpr);
    drawArrow3D(cam, pos, liftV, '#4ade80', 2.0 * dpr);
    drawArrow3D(cam, pos, magV, '#c084fc', 2.0 * dpr);
  }
}

function sampleFrameAtProgress(sim: LabSimOutput, progress: number): { frame: SimFrame; timeSec: number } {
  const maxT = sim.frames[sim.frames.length - 1]?.t ?? sim.hitTimeSec;
  const endT = Math.min(maxT, sim.hitTimeSec * 1.15);
  const t = Math.max(0, Math.min(1, progress)) * endT;
  for (let i = 1; i < sim.frames.length; i++) {
    if (sim.frames[i].t >= t) return { frame: sim.frames[i], timeSec: t };
  }
  const last = sim.frames[sim.frames.length - 1];
  return { frame: last, timeSec: last.t };
}

function render3DScene(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = cv3d.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (cv3d.width !== w || cv3d.height !== h) {
    cv3d.width = w;
    cv3d.height = h;
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#14171f';
  ctx.fillRect(0, 0, w, h);

  if (!currentSim) return;

  const { frame: curFrame, timeSec } = sampleFrameAtProgress(currentSim, animProgress);
  valTime.textContent = `${Math.round(timeSec * 1000)} / ${Math.round(currentSim.hitTimeSec * 1000)} ms`;
  inScrub.value = String(animProgress);

  if (followCap) {
    orbit.target = [curFrame.y[0], curFrame.y[1], Math.max(0.15, curFrame.y[2])];
  }

  const cam = buildCamBasis(w, h);

  // 1. Ground plane grid & warm clay pitching lane (matching cap-flight-sim aesthetic!)
  drawPoly3D(
    cam,
    [
      [-0.6, -1.2, 0],
      [10.2, -1.2, 0],
      [10.2, 1.2, 0],
      [-0.6, 1.2, 0],
    ],
    'rgba(74, 62, 46, 0.56)',
  );

  for (let x = -2; x <= 12; x += 1) {
    const major = x === 0 || x === 9;
    drawLine3D(cam, [x, -5, 0], [x, 5, 0], major ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.12)', 1 * dpr);
  }
  for (let y = -5; y <= 5; y += 1) {
    const major = y === 0;
    drawLine3D(cam, [-2, y, 0], [12, y, 0], major ? 'rgba(244,196,28,0.24)' : 'rgba(148,163,184,0.12)', 1 * dpr);
  }

  // Pitcher rubber at X = 0
  drawPoly3D(
    cam,
    [
      [-0.08, -0.305, 0.004],
      [0.08, -0.305, 0.004],
      [0.08, 0.305, 0.004],
      [-0.08, 0.305, 0.004],
    ],
    '#f8fafc',
    '#cbd5e1',
    1 * dpr,
  );
  const pLabel = project3D(cam, [-0.35, 0, 0.06]);
  if (pLabel.ok) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `700 ${Math.round(14 * dpr)}px "Noto Sans TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('投手', pLabel.sx, pLabel.sy);
  }
  const dirLabel = project3D(cam, [1.2, -1.55, 0.04]);
  if (dirLabel.ok) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 ${Math.round(11 * dpr)}px "Noto Sans TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('捕手方向 →', dirLabel.sx, dirLabel.sy);
  }

  // Home plate pentagon at X = 9.22m
  const hw = PLATE_WIDTH * 0.5;
  drawPoly3D(
    cam,
    [
      [PLATE_PLANE_X, -hw, 0.004],
      [PLATE_PLANE_X, hw, 0.004],
      [PLATE_PLANE_X + 0.216, hw, 0.004],
      [PLATE_PLANE_X + 0.432, 0, 0.004],
      [PLATE_PLANE_X + 0.216, -hw, 0.004],
    ],
    '#f8fafc',
    '#94a3b8',
    1 * dpr,
  );

  // Translucent blue Catcher Plane at X = 9.22m (matching Screenshot #1!)
  drawPoly3D(
    cam,
    [
      [PLATE_PLANE_X, -0.82, 0],
      [PLATE_PLANE_X, 0.82, 0],
      [PLATE_PLANE_X, 0.82, 1.65],
      [PLATE_PLANE_X, -0.82, 1.65],
    ],
    'rgba(56, 118, 168, 0.22)',
    'rgba(100, 175, 230, 0.35)',
    1 * dpr,
  );
  const cLabel = project3D(cam, [PLATE_PLANE_X, 0, 1.78]);
  if (cLabel.ok) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 ${Math.round(12 * dpr)}px "Noto Sans TC", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`捕手面 X=${PLATE_PLANE_X.toFixed(2)}m`, cLabel.sx, cLabel.sy);
  }

  // Official 3x3 Strike Zone at Hit Plane X = 9.00m
  drawPoly3D(
    cam,
    [
      [HIT_PLANE_X, -hw, STRIKE_ZONE_LO],
      [HIT_PLANE_X, hw, STRIKE_ZONE_LO],
      [HIT_PLANE_X, hw, STRIKE_ZONE_HI],
      [HIT_PLANE_X, -hw, STRIKE_ZONE_HI],
    ],
    'rgba(15, 23, 42, 0.24)',
    'rgba(241, 245, 249, 0.85)',
    1.6 * dpr,
  );
  for (let i = 1; i <= 2; i++) {
    const gy = -hw + (PLATE_WIDTH * i) / 3;
    const gz = STRIKE_ZONE_LO + ((STRIKE_ZONE_HI - STRIKE_ZONE_LO) * i) / 3;
    drawLine3D(cam, [HIT_PLANE_X, gy, STRIKE_ZONE_LO], [HIT_PLANE_X, gy, STRIKE_ZONE_HI], 'rgba(203,213,225,0.4)', 1 * dpr);
    drawLine3D(cam, [HIT_PLANE_X, -hw, gz], [HIT_PLANE_X, hw, gz], 'rgba(203,213,225,0.4)', 1 * dpr);
  }

  // Pass line marker at X = 11.554m
  drawLine3D(cam, [PASS_LINE_SIM_X, -1.6, 0.005], [PASS_LINE_SIM_X, 1.6, 0.005], 'rgba(244,63,94,0.35)', 1.5 * dpr, [6 * dpr, 4 * dpr]);

  // 2. Ground shadow projection of real 6-DOF trajectory
  ctx.save();
  ctx.strokeStyle = 'rgba(244, 196, 28, 0.25)';
  ctx.lineWidth = 1.4 * dpr;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < currentSim.frames.length; i += 2) {
    const fr = currentSim.frames[i];
    const pr = project3D(cam, [fr.y[0], fr.y[1], 0.006]);
    if (!pr.ok) continue;
    if (!started) {
      ctx.moveTo(pr.sx, pr.sy);
      started = true;
    } else {
      ctx.lineTo(pr.sx, pr.sy);
    }
  }
  ctx.stroke();
  ctx.restore();

  // 3. Ballistic (no-aero) dashed reference curve
  ctx.save();
  ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.52)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  started = false;
  for (const pt of currentSim.ballisticPts) {
    const pr = project3D(cam, pt);
    if (!pr.ok) continue;
    if (!started) {
      ctx.moveTo(pr.sx, pr.sy);
      started = true;
    } else {
      ctx.lineTo(pr.sx, pr.sy);
    }
  }
  ctx.stroke();
  ctx.restore();

  // 3.5 Optional 3D Speed-Sweep Gradient Trajectory Ribbon (NORMAL blue -> BEST gold -> OVER red)
  if (showSpeedRibbon && currentRibbon) {
    drawSpeedRibbon3D(
      ctx,
      currentRibbon,
      (p) => project3D(cam, p as V3),
      dpr,
      {
        activeU: null,
        showIdleCenterCurve: false,
        showActiveCurve: false,
        showLandingCurve: true,
        surfaceAlphaScale: 1.15,
        subSteps: 2,
      },
    );
  }

  // 4. Actual 6-DOF 3D Trajectory curve (crisp bright white)
  ctx.save();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.1 * dpr;
  ctx.beginPath();
  started = false;
  for (const fr of currentSim.frames) {
    const pr = project3D(cam, [fr.y[0], fr.y[1], Math.max(0.01, fr.y[2])]);
    if (!pr.ok) continue;
    if (!started) {
      ctx.moveTo(pr.sx, pr.sy);
      started = true;
    } else {
      ctx.lineTo(pr.sx, pr.sy);
    }
  }
  ctx.stroke();
  ctx.restore();

  // Break vector at Hit Plane (ballistic -> real aero)
  drawArrow3D(
    cam,
    currentSim.ballisticHitPos,
    [
      0,
      currentSim.hitPos[1] - currentSim.ballisticHitPos[1],
      currentSim.hitPos[2] - currentSim.ballisticHitPos[2],
    ],
    '#fb923c',
    2.0 * dpr,
  );

  // Hit-plane landing marker ring
  const hitPr = project3D(cam, currentSim.hitPos);
  if (hitPr.ok) {
    ctx.strokeStyle = currentSim.isStrike ? '#4ade80' : '#f43f5e';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(hitPr.sx, hitPr.sy, Math.max(5 * dpr, 0.032 * hitPr.scale), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 5. Vertical drop stem under current bottle cap + True 3D Spinning Bottle Cap + Force Vectors
  drawLine3D(
    cam,
    [curFrame.y[0], curFrame.y[1], 0.005],
    [curFrame.y[0], curFrame.y[1], Math.max(0.015, curFrame.y[2])],
    'rgba(244,196,28,0.4)',
    1 * dpr,
    [3 * dpr, 3 * dpr],
  );
  drawSpinningCap3D(cam, curFrame, dpr);
}

function syncInputsFromState(): void {
  aeroProfileEl.value = state.aeroProfile;
  inSpeed.value = String(state.speedKmh);
  valSpeed.textContent = `${state.speedKmh} km/h`;
  inAttitude.value = state.baseAttitude;
  inSpinAxis.value = state.spinAxis;
  inRotSense.value = state.rotationSense;
  inRpm.value = String(state.rpm);
  valRpm.textContent = String(state.rpm);
  inBank.value = String(state.bankRightDeg);
  valBank.textContent = `${state.bankRightDeg}°`;
  inNose.value = String(state.noseUpDeg);
  valNose.textContent = `${state.noseUpDeg}°`;
  inYaw.value = String(state.yawLeftDeg);
  valYaw.textContent = `${state.yawLeftDeg}°`;

  inTx.value = state.targetX.toFixed(2);
  valTx.textContent = `${state.targetX.toFixed(2)}m`;
  inTy.value = state.targetY.toFixed(2);
  valTy.textContent = `${state.targetY.toFixed(2)}m`;
  inAz.value = state.launchAzimuthDeg.toFixed(1);
  valAz.textContent = `${state.launchAzimuthDeg.toFixed(1)}°`;
  inEl.value = state.launchElevationDeg.toFixed(1);
  valEl.textContent = `${state.launchElevationDeg.toFixed(1)}°`;

  inRx.value = state.releasePos[0].toFixed(2);
  valRx.textContent = `${state.releasePos[0].toFixed(2)}m`;
  inRy.value = state.releasePos[1].toFixed(2);
  valRy.textContent = `${state.releasePos[1].toFixed(2)}m`;
  inRz.value = state.releasePos[2].toFixed(2);
  valRz.textContent = `${state.releasePos[2].toFixed(2)}m`;

  modeAimBtn.classList.toggle('active', state.controlMode === 'aim');
  modeManualBtn.classList.toggle('active', state.controlMode === 'manual');
  aimControlsEl.hidden = state.controlMode !== 'aim';
  manualControlsEl.hidden = state.controlMode !== 'manual';

  for (const btn of presetButtons) {
    btn.classList.toggle('active', btn.dataset.preset === state.presetId);
  }
}

function recomputeAndRender(): void {
  currentSim = runLabSimulation();
  currentRibbon = showSpeedRibbon ? buildLabSpeedRibbon() : null;
  syncInputsFromState();
  renderLockedAeroCards(currentSim.activeAero);
  renderTelemetry(currentSim);
  render3DScene();
}

function loadPreset(id: PitchId): void {
  const spec = PITCH_SPECS[id];
  state.presetId = id;
  state.speedKmh = spec.defaultSpeedKmh;
  state.baseAttitude = spec.baseAttitude;
  state.bankRightDeg = spec.bankRightDeg;
  state.noseUpDeg = spec.noseUpDeg;
  state.yawLeftDeg = spec.yawLeftDeg;
  state.rpm = spec.rpm;
  state.rotationSense = spec.rotationSense;
  state.spinAxis = spec.spinAxis;
  state.targetX = 0;
  state.targetY = 0.72;
  state.releasePos = [...DEFAULT_RELEASE_POS];
  animProgress = 0;
  recomputeAndRender();
}

// --- Orbit Camera Mouse & Touch Interaction ---
let dragMode: 'none' | 'orbit' | 'pan' = 'none';
let dragLastX = 0;
let dragLastY = 0;

cv3d.addEventListener('contextmenu', (e) => e.preventDefault());

cv3d.addEventListener('pointerdown', (e) => {
  cv3d.setPointerCapture(e.pointerId);
  dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
  dragLastX = e.clientX;
  dragLastY = e.clientY;
  for (const b of camButtons) b.classList.remove('active');
});

cv3d.addEventListener('pointermove', (e) => {
  if (dragMode === 'none') return;
  const dx = e.clientX - dragLastX;
  const dy = e.clientY - dragLastY;
  dragLastX = e.clientX;
  dragLastY = e.clientY;

  if (dragMode === 'orbit') {
    orbit.yaw -= dx * 0.0075;
    orbit.pitch = Math.max(-0.25, Math.min(1.52, orbit.pitch + dy * 0.0065));
  } else if (dragMode === 'pan') {
    followCap = false;
    btnFollow.setAttribute('aria-pressed', 'false');
    const cam = buildCamBasis(cv3d.width, cv3d.height);
    const panScale = orbit.distance * 0.0014;
    orbit.target[0] -= (cam.right[0] * dx - cam.up[0] * dy) * panScale;
    orbit.target[1] -= (cam.right[1] * dx - cam.up[1] * dy) * panScale;
    orbit.target[2] = Math.max(0, orbit.target[2] - (cam.right[2] * dx - cam.up[2] * dy) * panScale);
  }
});

cv3d.addEventListener('pointerup', () => {
  dragMode = 'none';
});
cv3d.addEventListener('pointercancel', () => {
  dragMode = 'none';
});

cv3d.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.09 : 0.92;
    orbit.distance = Math.max(1.2, Math.min(24.0, orbit.distance * factor));
  },
  { passive: false },
);

// --- UI Bindings ---
for (const btn of presetButtons) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.preset as PitchId | undefined;
    if (id && PITCH_SPECS[id]) loadPreset(id);
  });
}

for (const btn of camButtons) {
  btn.addEventListener('click', () => {
    setCameraPreset(btn.dataset.cam ?? 'iso');
  });
}

btnFollow.addEventListener('click', () => {
  followCap = !followCap;
  btnFollow.setAttribute('aria-pressed', String(followCap));
  if (followCap) {
    orbit.distance = Math.min(orbit.distance, 3.2);
  }
});

btnVectors.addEventListener('click', () => {
  showVectors = !showVectors;
  btnVectors.setAttribute('aria-pressed', String(showVectors));
});

btnSpeedRibbon.addEventListener('click', () => {
  showSpeedRibbon = !showSpeedRibbon;
  btnSpeedRibbon.setAttribute('aria-pressed', String(showSpeedRibbon));
  currentRibbon = showSpeedRibbon ? buildLabSpeedRibbon() : null;
  render3DScene();
});

aeroProfileEl.addEventListener('change', () => {
  state.aeroProfile = aeroProfileEl.value === 'game_preset' ? 'game_preset' : 'unified';
  recomputeAndRender();
});

inSpeed.addEventListener('input', () => {
  state.speedKmh = Number(inSpeed.value);
  recomputeAndRender();
});
inAttitude.addEventListener('change', () => {
  state.baseAttitude = inAttitude.value === 'edge_on' ? 'edge_on' : 'flat';
  recomputeAndRender();
});
inSpinAxis.addEventListener('change', () => {
  state.spinAxis = inSpinAxis.value === 'world_y' ? 'world_y' : 'cap';
  recomputeAndRender();
});
inRotSense.addEventListener('change', () => {
  state.rotationSense = inRotSense.value === 'clockwise' ? 'clockwise' : 'counterclockwise';
  recomputeAndRender();
});
inRpm.addEventListener('input', () => {
  state.rpm = Number(inRpm.value);
  recomputeAndRender();
});
inBank.addEventListener('input', () => {
  state.bankRightDeg = Number(inBank.value);
  recomputeAndRender();
});
inNose.addEventListener('input', () => {
  state.noseUpDeg = Number(inNose.value);
  recomputeAndRender();
});
inYaw.addEventListener('input', () => {
  state.yawLeftDeg = Number(inYaw.value);
  recomputeAndRender();
});

modeAimBtn.addEventListener('click', () => {
  state.controlMode = 'aim';
  recomputeAndRender();
});
modeManualBtn.addEventListener('click', () => {
  state.controlMode = 'manual';
  recomputeAndRender();
});

inTx.addEventListener('input', () => {
  state.targetX = Number(inTx.value);
  recomputeAndRender();
});
inTy.addEventListener('input', () => {
  state.targetY = Number(inTy.value);
  recomputeAndRender();
});
inAz.addEventListener('input', () => {
  state.launchAzimuthDeg = Number(inAz.value);
  recomputeAndRender();
});
inEl.addEventListener('input', () => {
  state.launchElevationDeg = Number(inEl.value);
  recomputeAndRender();
});

inRx.addEventListener('input', () => {
  state.releasePos[0] = Number(inRx.value);
  recomputeAndRender();
});
inRy.addEventListener('input', () => {
  state.releasePos[1] = Number(inRy.value);
  recomputeAndRender();
});
inRz.addEventListener('input', () => {
  state.releasePos[2] = Number(inRz.value);
  recomputeAndRender();
});

btnReset.addEventListener('click', () => loadPreset(state.presetId));

btnCopyJson.addEventListener('click', async () => {
  const payload = {
    pitcherInputs: {
      speedKmh: state.speedKmh,
      baseAttitude: state.baseAttitude,
      bankRightDeg: state.bankRightDeg,
      noseUpDeg: state.noseUpDeg,
      yawLeftDeg: state.yawLeftDeg,
      rpm: state.rpm,
      spinAxis: state.spinAxis,
      rotationSense: state.rotationSense,
      releasePos: state.releasePos,
    },
    lockedAero: getActiveAero(),
    result: currentSim
      ? {
          hitTimeMs: Math.round(currentSim.hitTimeSec * 1000),
          hitSpeedKmh: Number(currentSim.hitSpeedKmh.toFixed(1)),
          breakDxCm: Number(currentSim.breakCm[0].toFixed(1)),
          breakDyCm: Number(currentSim.breakCm[1].toFixed(1)),
          breakTotalCm: Number(currentSim.breakMagCm.toFixed(1)),
        }
      : null,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    btnCopyJson.textContent = '已複製 ✓';
    window.setTimeout(() => {
      btnCopyJson.textContent = '複製 JSON';
    }, 1800);
  } catch {
    btnCopyJson.textContent = '失敗';
  }
});

btnPlay.addEventListener('click', () => {
  animPlaying = !animPlaying;
  if (animPlaying && animProgress >= 0.995) animProgress = 0;
  btnPlay.textContent = animPlaying ? '暫停' : '播放';
});

btnSlow.addEventListener('click', () => {
  animSlowMo = !animSlowMo;
  btnSlow.setAttribute('aria-pressed', String(animSlowMo));
});

btnLoop.addEventListener('click', () => {
  animLoop = !animLoop;
  btnLoop.setAttribute('aria-pressed', String(animLoop));
});

inScrub.addEventListener('input', () => {
  animPlaying = false;
  btnPlay.textContent = '播放';
  animProgress = Number(inScrub.value);
});

function tick(nowMs: number): void {
  const dt = lastRafMs ? Math.min(0.05, (nowMs - lastRafMs) / 1000) : 0;
  lastRafMs = nowMs;
  if (animPlaying && currentSim) {
    const duration = Math.max(0.25, currentSim.hitTimeSec * 1.15);
    const speedMult = animSlowMo ? 0.25 : 0.7;
    animProgress += (dt * speedMult) / duration;
    if (animProgress >= 1) {
      if (animLoop) {
        animProgress = 0;
      } else {
        animProgress = 1;
        animPlaying = false;
        btnPlay.textContent = '重播';
      }
    }
  }
  render3DScene();
  requestAnimationFrame(tick);
}

recomputeAndRender();
requestAnimationFrame(tick);

// Lightweight read-only WebSocket presence so /monitor shows live 3D Pitch Lab usage (zero PII)
(() => {
  try {
    const p = window.location.pathname;
    const base = p === '/capbaseball' || p.startsWith('/capbaseball/') ? '/capbaseball' : '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}${base}/ws`);
    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({ t: 'hi', n: 'LAB', v: 2 }));
        ws.send(JSON.stringify({ t: 'ac', a: 'pitch_lab' }));
      } catch {
        // ignore
      }
    });
    window.addEventListener('beforeunload', () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore offline/static preview errors
  }
})();
