import {
  createCatcherFielder,
  createOutfielders,
  createPitcherFielder,
  resetOutfielders,
  updateOutfielders,
  type FielderInterceptionTarget,
  type OutfielderActor,
} from './ai/cpu';
import {
  simulateBattedCap,
  type BattedCapResult,
  type FieldV3,
} from './physics/batted';
import { GameCamera } from './render/camera';
import { buildFenceDepthItems, drawGymBackground, type PassLineState } from './render/gymScene';
import { createTranslator } from './i18n/index';
import { PASS_LINE_Z } from './rules/field';
import {
  drawWorldEntities,
  getFlyCatchHandPos,
  loadSprites,
  type BatterAnim,
  type FielderAnim,
  type SpriteBank,
  type TeamColor,
} from './render/sprites';

type ScenarioId =
  | 'lf_fly'
  | 'rf_fly'
  | 'lf_ground'
  | 'rf_ground'
  | 'p_fly'
  | 'p_ground'
  | 'c_popup'
  | 'rf_bobble'
  | 'foul_pickup'
  | 'wp_right'
  | 'wp_left'
  | 'pb_d3s'
  | 'pitch_only'
  | 'bat_99_swing'
  | 'bat_18_swing'
  | 'bat_99_ready'
  | 'bat_18_ready'
  | 'rf_through'
  | 'foul_wall_1b'
  | 'foul_wall_3b'
  | 'bat_switch';

type ForcedPose = 'auto' | 'idle' | 'run' | 'run_front' | 'run_back' | 'catch_fly' | 'catch_ground' | 'catch_wp';
type CamOverride = 'auto' | 'home' | 'wild' | 'outfield';

interface FieldingFx {
  pos: FieldV3;
  kind: 'catch_pop' | 'dive_dust';
  elapsedSec: number;
  durationSec: number;
}

const canvas = document.getElementById('field-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stagePill = document.getElementById('stage-pill') as HTMLElement;
const telemetryOut = document.getElementById('telemetry-out') as HTMLElement;
const speedInput = document.getElementById('in-speed') as HTMLInputElement;
const speedVal = document.getElementById('val-speed') as HTMLElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnStep = document.getElementById('btn-step') as HTMLButtonElement;
const btnReplay = document.getElementById('btn-replay') as HTMLButtonElement;
const timelineOut = document.getElementById('timeline-out') as HTMLElement;
const cardEl = document.getElementById('card-preview') as HTMLElement;
const cardDelayInput = document.getElementById('in-card-delay') as HTMLInputElement;
const cardDelayVal = document.getElementById('val-card-delay') as HTMLElement;
const btnTeamYellow = document.getElementById('btn-team-yellow') as HTMLButtonElement;
const btnTeamBlack = document.getElementById('btn-team-black') as HTMLButtonElement;

canvas.width = 480;
canvas.height = 270;
ctx.imageSmoothingEnabled = false;

const tr = createTranslator('zh-TW');

const cam = new GameCamera();
cam.setViewport(canvas.width, canvas.height);

const outfielders = createOutfielders();
const pitcherFielder = createPitcherFielder();
const catcherFielder = createCatcherFielder();
const allFielders: OutfielderActor[] = [...outfielders, pitcherFielder, catcherFielder];

let bank: SpriteBank | null = null;
let pitchingTeam: TeamColor = 'yellow';
let battingTeam: TeamColor = 'black';
let batterHandedness: 'left' | 'right' = 'left';
let batterAnim: BatterAnim = 'ready';
let batterAnimTime = 0;
let batterSwinging = false;
let batterAlpha = 1.0;

let pitcherFrame = 0;
let pitcherPlaying = false;
let pitcherTimer = 0;

let timeSec = 0;
let playbackSpeed = 1.0;
let paused = false;
let forcedPose: ForcedPose = 'auto';
let camOverride: CamOverride = 'auto';
let lastScenario: ScenarioId = 'rf_ground';
let scenarioLabel = 'READY';

// Active batted ball simulation state
let activeBatted: BattedCapResult | null = null;
let battedTime = 0;
let interception: FielderInterceptionTarget | null = null;
let interceptKind: 'caught' | 'blocked' | 'bobbled' = 'caught';
let preCatchTriggered = false;
let interceptResolved = false;
let catchHoldTimer = 0;
let catchHoldPos: FieldV3 = [0, 0.4, -9.0];
let stoppedRetrieveActive = false;
let stoppedPickupDone = false;
let stoppedTarget: FieldV3 = [0, 0, 0];
let stoppedElapsed = 0;

// Active wild pitch / passed ball state
let wildActive = false;
let wildElapsed = 0;
let wildDuration = 1.5;
let wildPos: [number, number, number] = [0, 0.25, 0.4];
let wildVel: [number, number, number] = [1.35, -0.95, 2.75];
let wildBounces = 0;
let wildCrossed = false;
let wildCrossX = 0;

let capPos: FieldV3 = [0, 0.8, -9.2];
let capNormal: FieldV3 = [0, 1, 0];
let capTrail: FieldV3[] = [];
let capVisible = false;

let hitFx: { active: boolean; pos: FieldV3; kind: 'hit' | 'hr_burst'; elapsedSec: number } | null = null;
let fieldingFxList: FieldingFx[] = [];

// Timeline of the current scenario (relative seconds) so the order of animation / camera / card / handedness steps is visible
let labEvents: { t: number; text: string }[] = [];
let labT0 = 0;
let cardDelaySec = 0.9;
let cardPending: { title: string; sub: string } | null = null;
let cardHideAt = 0;
let switchFlow: { start: number; switched: boolean; resultLogged: boolean } | null = null;
let landingLogged = false;
let maxExtDist = 0;
const FOUL_EXT_LIMIT_M = 12.45; // MAX_FIELDER_RADIUS_M: fielders must stay inside this on the foul-side fence extension

function logEv(text: string): void {
  labEvents.push({ t: timeSec - labT0, text });
}
let bounceRings: { pos: FieldV3; ageSec: number; maxAgeSec: number; infield: boolean }[] = [];

function spawnFx(pos: FieldV3, kind: 'catch_pop' | 'dive_dust'): void {
  fieldingFxList.push({
    pos: [pos[0], pos[1], pos[2]],
    kind,
    elapsedSec: 0,
    durationSec: kind === 'catch_pop' ? 0.56 : 0.64,
  });
}

function clearDynamicPlay(): void {
  labEvents = [];
  labT0 = timeSec;
  cardPending = null;
  cardEl.hidden = true;
  switchFlow = null;
  landingLogged = false;
  maxExtDist = 0;
  activeBatted = null;
  battedTime = 0;
  interception = null;
  preCatchTriggered = false;
  interceptResolved = false;
  catchHoldTimer = 0;
  stoppedRetrieveActive = false;
  stoppedPickupDone = false;
  stoppedElapsed = 0;
  wildActive = false;
  wildElapsed = 0;
  wildCrossed = false;
  wildCrossX = 0;
  capVisible = false;
  capTrail = [];
  hitFx = null;
  fieldingFxList = [];
  bounceRings = [];
  pitcherPlaying = false;
  pitcherFrame = 0;
  pitcherTimer = 0;
  batterSwinging = false;
  batterAnim = 'ready';
  batterAnimTime = 0;
  batterAlpha = 1.0;
  resetOutfielders(allFielders);
  cam.setFollowTarget(null);
  cam.setWildPitchTarget(null);
}

function findActor(id: OutfielderActor['id']): OutfielderActor {
  return allFielders.find((f) => f.id === id) ?? outfielders[0];
}

function sampleBattedFrame(bat: BattedCapResult, t: number): FieldV3 {
  const frames = bat.frames;
  if (frames.length === 0) return [0, 0, 0];
  if (t <= frames[0].t) return frames[0].pos;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.pos;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t >= t) {
      const a = frames[i - 1];
      const b = frames[i];
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return [
        a.pos[0] + (b.pos[0] - a.pos[0]) * u,
        a.pos[1] + (b.pos[1] - a.pos[1]) * u,
        a.pos[2] + (b.pos[2] - a.pos[2]) * u,
      ];
    }
  }
  return last.pos;
}

function firstLandingTime(bat: BattedCapResult): number {
  for (let i = 1; i < bat.frames.length; i++) {
    if (bat.frames[i].pos[1] <= 0.04) return bat.frames[i].t;
  }
  return bat.flightTimeSec;
}

function launchFieldingScenario(
  id: ScenarioId,
  label: string,
  fielderId: OutfielderActor['id'],
  vel: [number, number, number],
  kind: 'caught' | 'blocked' | 'bobbled',
  catchTimeOverride?: number,
): void {
  lastScenario = id;
  scenarioLabel = label;
  forcedPose = 'auto';
  syncPoseButtons();
  clearDynamicPlay();

  const bat = simulateBattedCap({
    position: [0, 0.72, 0.0],
    velocity: vel,
    spinRpm: kind === 'blocked' ? -600 : 400,
    seed: 12345,
  });
  activeBatted = bat;
  interceptKind = kind;

  const landT = firstLandingTime(bat);
  const findDescendingCatchTime = (catchY: number): number => {
    let peakIdx = 0;
    let peakY = bat.frames[0]?.pos[1] ?? 0;
    for (let i = 1; i < bat.frames.length; i++) {
      if (bat.frames[i].t >= landT) break;
      if (bat.frames[i].pos[1] >= peakY) {
        peakY = bat.frames[i].pos[1];
        peakIdx = i;
      }
    }
    for (let i = Math.max(1, peakIdx); i < bat.frames.length; i++) {
      if (bat.frames[i].t >= landT) break;
      if (bat.frames[i].pos[1] <= catchY) {
        return Math.max(0.35, bat.frames[i].t);
      }
    }
    return Math.max(0.45, landT - 0.12);
  };
  const targetT =
    catchTimeOverride ??
    (kind === 'blocked'
      ? Math.min(bat.flightTimeSec * 0.65, 0.85)
      : findDescendingCatchTime(kind === 'caught' ? 1.46 : 1.15));

  const pt = sampleBattedFrame(bat, targetT);
  interception = {
    fielderId,
    targetPos: [pt[0], kind === 'caught' ? Math.max(1.2, pt[1]) : Math.max(0.05, pt[1]), pt[2]],
    targetTimeSec: targetT,
    isBlock: kind === 'blocked',
  };

  batterAnim = 'swing_contact';
  batterAnimTime = 0;
  batterSwinging = true;
  hitFx = { active: true, pos: [0, 0.75, 0], kind: 'hit', elapsedSec: 0 };
  capVisible = true;
  capPos = [0, 0.72, 0];
  logEv(`擊球（${kind === 'caught' ? '接殺' : kind === 'blocked' ? '擋下' : '漏接'}預定 ${targetT.toFixed(2)}s）`);
}

/** Batted ball with no planned interception: the nearest fielder chases it (foul balls, grounders that get through). */
function launchFreeBall(id: ScenarioId, label: string, vel: [number, number, number], seed: number): void {
  lastScenario = id;
  scenarioLabel = label;
  forcedPose = 'auto';
  syncPoseButtons();
  clearDynamicPlay();
  activeBatted = simulateBattedCap({ position: [0, 0.68, -0.2], velocity: vel, spinRpm: 320, seed });
  interception = null;
  batterAnim = 'swing_contact';
  batterAnimTime = 0;
  batterSwinging = true;
  hitFx = { active: true, pos: [0, 0.72, 0], kind: 'hit', elapsedSec: 0 };
  capVisible = true;
  capPos = [0, 0.68, -0.2];
  logEv('擊球（無人可處理，最近守備員追球）');
}

function launchWildScenario(id: ScenarioId, label: string, sideDir: 1 | -1, isD3s: boolean): void {
  lastScenario = id;
  scenarioLabel = label;
  forcedPose = 'auto';
  syncPoseButtons();
  clearDynamicPlay();

  wildActive = true;
  wildElapsed = 0;
  wildDuration = isD3s ? 1.60 : 1.48;
  wildBounces = 0;
  wildCrossed = false;
  wildCrossX = 0;
  wildPos = [sideDir * 0.32, isD3s ? 0.16 : 0.38, 0.55];
  wildVel = [sideDir * 1.15, isD3s ? 1.45 : -0.95, isD3s ? 3.85 : 3.55];

  catcherFielder.pos[0] = sideDir * 0.25;
  catcherFielder.pos[1] = 0;
  catcherFielder.pos[2] = 0.95;
  catcherFielder.anim = 'catch_wp';
  catcherFielder.animTime = 0;
  catcherFielder.diveTimer = wildDuration;
  // Rear-view center kneel-block sprite: keep flipX false so back number #99 never mirrors backwards
  catcherFielder.flipX = false;

  capVisible = true;
  capPos = [...wildPos];
  spawnFx([catcherFielder.pos[0], 0.02, catcherFielder.pos[2]], 'dive_dust');
  logEv('暴投進壘，捕手開始撲擋、鏡頭拉遠');
  cardPending = isD3s
    ? { title: tr('callUncaught3rd'), sub: tr('callDropped3rd') }
    : { title: tr('callWildPitch'), sub: tr('callWildPitchSub') };
  if (camOverride === 'auto') {
    cam.setWildPitchTarget([catcherFielder.pos[0] + sideDir * 0.45, 0.35, 1.65]);
  }
}

function triggerScenario(id: ScenarioId): void {
  paused = false;
  updatePauseBtn();

  switch (id) {
    case 'lf_fly':
      launchFieldingScenario(id, 'LF 高飛球接殺 (#99)', 'LF', [-5.4, 8.8, -11.4], 'caught');
      break;
    case 'rf_fly':
      launchFieldingScenario(id, 'RF 高飛球接殺 (#99)', 'RF', [5.6, 8.8, -11.2], 'caught');
      break;
    case 'lf_ground':
      launchFieldingScenario(id, 'LF 滾地球擋球 (#99)', 'LF', [-6.2, 1.2, -13.2], 'blocked', 0.88);
      break;
    case 'rf_ground':
      launchFieldingScenario(id, 'RF 滾地球擋球 (#99)', 'RF', [6.2, 1.2, -13.2], 'blocked', 0.88);
      break;
    case 'p_fly':
      launchFieldingScenario(id, 'P 投手高飛球 (#18)', 'P', [0.6, 8.4, -7.8], 'caught');
      break;
    case 'p_ground':
      launchFieldingScenario(id, 'P 投手強襲滾地 (#18)', 'P', [-1.2, 0.9, -11.8], 'blocked', 0.72);
      break;
    case 'c_popup':
      launchFieldingScenario(id, 'C 捕手本壘小飛球 (#99)', 'C', [1.1, 7.2, -1.8], 'caught');
      break;
    case 'rf_bobble':
      launchFieldingScenario(id, 'RF 外野失誤漏球', 'RF', [5.4, 2.2, -12.6], 'bobbled', 0.86);
      break;
    case 'foul_pickup': {
      lastScenario = id;
      scenarioLabel = '界外／滾地停球撿球 (最近守備員衝刺撿球)';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      const bat = simulateBattedCap({
        position: [0, 0.68, -0.2],
        velocity: [-4.8, 2.4, -3.2],
        spinRpm: 320,
        seed: 777,
      });
      activeBatted = bat;
      interception = null;
      batterAnim = 'swing_contact';
      batterAnimTime = 0;
      batterSwinging = true;
      hitFx = { active: true, pos: [0, 0.72, 0], kind: 'hit', elapsedSec: 0 };
      capVisible = true;
      capPos = [0, 0.68, -0.2];
      break;
    }
    case 'rf_through':
      launchFreeBall(id, 'RF 外野滾地穿越（綠圈：處理不到）', [5.2, 1.0, -12.5], 4242);
      break;
    case 'foul_wall_1b':
      launchFreeBall(id, '界外球深入一壘側牆邊（檢查守備員不穿牆）', [17, 5, -3.5], 901);
      break;
    case 'foul_wall_3b':
      launchFreeBall(id, '界外球深入三壘側牆邊（檢查守備員不穿牆）', [-17, 5, -3.5], 902);
      break;
    case 'bat_switch':
      lastScenario = id;
      scenarioLabel = '連續兩位打者：#99 左打 → #18 右打（換手等結果動畫後）';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      batterHandedness = 'left';
      batterAnim = 'load';
      batterAnimTime = 0;
      batterSwinging = true;
      switchFlow = { start: timeSec, switched: false, resultLogged: false };
      logEv('#99 左打揮棒');
      break;
    case 'wp_right':
      launchWildScenario(id, '暴投往右 → 鏡頭拉遠＋捕手右撲', 1, false);
      break;
    case 'wp_left':
      launchWildScenario(id, '暴投往左 → 鏡頭拉遠＋捕手左撲', -1, false);
      break;
    case 'pb_d3s':
      launchWildScenario(id, '捕逸不死三振 → 鏡頭拉遠＋捕手撲擋', 1, true);
      break;
    case 'pitch_only':
      lastScenario = id;
      scenarioLabel = '投手投球動作 (#18)';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      pitcherPlaying = true;
      pitcherTimer = 0;
      pitcherFrame = 0;
      break;
    case 'bat_99_swing':
      lastScenario = id;
      scenarioLabel = '#99 NastYboY 左打揮棒';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      batterHandedness = 'left';
      batterAnim = 'load';
      batterAnimTime = 0;
      batterSwinging = true;
      break;
    case 'bat_18_swing':
      lastScenario = id;
      scenarioLabel = '#18 Skywalker 右打揮棒';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      batterHandedness = 'right';
      batterAnim = 'load';
      batterAnimTime = 0;
      batterSwinging = true;
      break;
    case 'bat_99_ready':
      lastScenario = id;
      scenarioLabel = '#99 NastYboY 左打待機';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      batterHandedness = 'left';
      break;
    case 'bat_18_ready':
      lastScenario = id;
      scenarioLabel = '#18 Skywalker 右打待機';
      forcedPose = 'auto';
      syncPoseButtons();
      clearDynamicPlay();
      batterHandedness = 'right';
      break;
  }

  document.querySelectorAll<HTMLButtonElement>('.sc-btn[data-sc]').forEach((b) => {
    b.classList.toggle('active', b.dataset.sc === id);
  });
}

function applyCameraOverride(): void {
  if (camOverride === 'home') {
    cam.setFollowTarget(null);
    cam.setWildPitchTarget(null);
  } else if (camOverride === 'wild') {
    cam.setFollowTarget(null);
    cam.setWildPitchTarget([0.2, 0.35, 1.05]);
  } else if (camOverride === 'outfield') {
    cam.setWildPitchTarget(null);
    cam.setFollowTarget([0, 0.6, -9.8]);
  }
}

function extDist(f: OutfielderActor): number {
  const x = f.pos[0];
  const z = f.pos[2];
  return z < 0 && Math.abs(x) > -z ? (Math.abs(x) - z) * Math.SQRT1_2 : 0;
}

function stepSim(dt: number): void {
  timeSec += dt;

  if (cardPending && timeSec - labT0 >= cardDelaySec) {
    cardEl.innerHTML = `<b>${cardPending.title}</b><small>${cardPending.sub}</small>`;
    cardEl.hidden = false;
    cardHideAt = timeSec + 1.8;
    cardPending = null;
    logEv('字卡顯示');
  }
  if (!cardEl.hidden && timeSec >= cardHideAt) cardEl.hidden = true;

  if (switchFlow) {
    const el = timeSec - switchFlow.start;
    if (!switchFlow.resultLogged && el >= 0.6) {
      switchFlow.resultLogged = true;
      logEv('結果動畫開始（打者仍是左打）');
    }
    if (!switchFlow.switched && el >= 2.0) {
      switchFlow.switched = true;
      batterHandedness = 'right';
      batterAnim = 'ready';
      batterSwinging = false;
      logEv('結果動畫結束 → 換成 #18 右打');
    }
  }
  for (const f of allFielders) maxExtDist = Math.max(maxExtDist, extDist(f));

  // Forced pose showcase mode (instant side-by-side proportion check!)
  if (forcedPose !== 'auto') {
    resetOutfielders(allFielders);
    const showCatcher = forcedPose === 'catch_wp';
    for (const f of allFielders) {
      f.anim = forcedPose as FielderAnim;
      f.animTime = timeSec;
      if (f.id === 'C' && showCatcher) {
        f.pos = [0.25, 0, 1.05];
        f.flipX = false;
      }
    }
    batterAlpha = 1.0;
    if (camOverride === 'auto') {
      if (showCatcher) {
        cam.setFollowTarget(null);
        cam.setWildPitchTarget([0.25, 0.35, 1.05]);
      } else {
        cam.setWildPitchTarget(null);
        cam.setFollowTarget([0, 0.4, -9.6]);
      }
    } else {
      applyCameraOverride();
    }
    cam.update(dt);
    return;
  }

  // Pitcher animation
  if (pitcherPlaying && bank) {
    pitcherTimer += dt;
    const f = Math.floor(pitcherTimer * bank.pitcherMeta.fps);
    if (f >= bank.pitcherMeta.frames) {
      pitcherFrame = 0;
      pitcherPlaying = false;
    } else {
      pitcherFrame = f;
    }
  }

  // Batter swing state machine (exact game timing)
  batterAnimTime += dt;
  if (batterSwinging) {
    if (batterAnim === 'load' && batterAnimTime >= 0.08) {
      batterAnim = 'swing_early';
      batterAnimTime = 0;
    } else if (batterAnim === 'swing_early' && batterAnimTime >= 0.06) {
      batterAnim = 'swing_contact';
      batterAnimTime = 0;
    } else if (batterAnim === 'swing_contact' && batterAnimTime >= 0.08) {
      batterAnim = 'follow_through';
      batterAnimTime = 0;
    } else if (batterAnim === 'follow_through' && batterAnimTime >= 0.72) {
      batterAnim = 'ready';
      batterAnimTime = 0;
      batterSwinging = false;
    }
  }

  // Hit FX tick
  if (hitFx && hitFx.active) {
    hitFx.elapsedSec += dt;
    if (hitFx.elapsedSec > 0.38) hitFx.active = false;
  }

  // Fielding PixelFX tick
  if (fieldingFxList.length > 0) {
    for (const fx of fieldingFxList) fx.elapsedSec += dt;
    fieldingFxList = fieldingFxList.filter((fx) => fx.elapsedSec < fx.durationSec);
  }

  // Bounce rings tick
  if (bounceRings.length > 0) {
    for (const r of bounceRings) r.ageSec += dt;
    bounceRings = bounceRings.filter((r) => r.ageSec < r.maxAgeSec);
  }

  // Active batted ball simulation
  if (activeBatted) {
    battedTime += dt;
    const isPlannedFlyCatch = Boolean(interception && !interception.isBlock && interceptKind === 'caught');
    const sampleT = isPlannedFlyCatch ? Math.min(battedTime, interception!.targetTimeSec) : battedTime;
    const rawPos = sampleBattedFrame(activeBatted, sampleT);
    capPos = isPlannedFlyCatch ? [rawPos[0], Math.max(0.85, rawPos[1]), rawPos[2]] : rawPos;
    const spin = battedTime * 16;
    capNormal = [Math.cos(spin) * 0.7, 0.7, Math.sin(spin) * 0.7];
    capTrail.push(capPos);
    if (capTrail.length > 10) capTrail.shift();

    if (camOverride === 'auto') {
      cam.setFollowTarget(capPos);
    }

    if (!landingLogged && battedTime > 0.25 && capPos[1] <= 0.04) {
      landingLogged = true;
      logEv('球落地');
    }
    const landPt = activeBatted.firstLandingPos ?? activeBatted.stoppedPos;
    const landingTarget: FieldV3 = [landPt[0], 0, landPt[2]];
    const finalTarget: FieldV3 = activeBatted.stoppedPos;
    const airborne = battedTime < firstLandingTime(activeBatted);

    const pickedInFlight = updateOutfielders(
      allFielders,
      dt,
      stoppedPickupDone ? null : capPos,
      landingTarget,
      airborne,
      (interceptResolved && interceptKind !== 'bobbled') || stoppedPickupDone,
      battedTime,
      interception,
      finalTarget,
    );
    if (pickedInFlight && !interception && !stoppedPickupDone) {
      stoppedPickupDone = true;
      capVisible = false;
      spawnFx([capPos[0], 0.02, capPos[2]], 'dive_dust');
      logEv('守備員追上並撿球');
    }

    // Pre-catch anticipation 0.26s before contact
    if (
      interception &&
      !preCatchTriggered &&
      !interceptResolved &&
      interception.targetTimeSec - battedTime <= 0.26 &&
      interception.targetTimeSec - battedTime > 0
    ) {
      preCatchTriggered = true;
      const f = findActor(interception.fielderId);
      const isFly = !interception.isBlock && (airborne || interception.targetPos[1] >= 0.45);
      f.anim = isFly ? 'catch_fly' : 'catch_ground';
      f.animTime = 0;
      f.diveTimer = 1.25;
      f.flipX =
        Math.abs(interception.targetPos[0] - f.homePos[0]) > 0.25
          ? interception.targetPos[0] < f.homePos[0]
          : f.pos[0] > 0.15;
    }

    if (preCatchTriggered && interception && !interceptResolved) {
      const f = findActor(interception.fielderId);
      const rem = Math.max(dt, interception.targetTimeSec - battedTime);
      const blend = Math.min(1, dt / rem);
      f.pos[0] += (interception.targetPos[0] - f.pos[0]) * blend;
      f.pos[2] += (interception.targetPos[2] - f.pos[2]) * blend;
    }

    if (interception && !interceptResolved && battedTime >= interception.targetTimeSec) {
      interceptResolved = true;
      logEv(`守備員${interceptKind === 'caught' ? '接殺' : interceptKind === 'blocked' ? '擋下' : '漏接'}（${interception.fielderId}）`);
      const f = findActor(interception.fielderId);
      const hitP = interception.targetPos;
      const isFly = !interception.isBlock && (airborne || hitP[1] >= 0.45);
      f.pos[0] = hitP[0];
      f.pos[2] = hitP[2];
      if (!preCatchTriggered) {
        f.anim = isFly ? 'catch_fly' : 'catch_ground';
        f.animTime = 0;
      }
      f.diveTimer = Math.max(f.diveTimer, 0.98);
      if (interceptKind === 'bobbled') {
        spawnFx([hitP[0], 0.02, hitP[2]], 'dive_dust');
      } else {
        spawnFx(
          isFly
            ? getFlyCatchHandPos(f)
            : [hitP[0], Math.max(0.32, Math.min(0.75, hitP[1])), hitP[2] + 0.06],
          'catch_pop',
        );
        if (!isFly) spawnFx([hitP[0], 0.02, hitP[2]], 'dive_dust');
        capVisible = false;
        capTrail = [];
        activeBatted = null;
        catchHoldPos = [hitP[0], Math.max(0.35, hitP[1] * 0.5), hitP[2]];
        catchHoldTimer = 1.05;
      }
    } else if (battedTime >= activeBatted.flightTimeSec) {
      if (!interception && !stoppedPickupDone) {
        stoppedRetrieveActive = true;
        stoppedTarget = [finalTarget[0], Math.max(0.02, finalTarget[1]), finalTarget[2]];
        stoppedElapsed = battedTime;
        activeBatted = null;
        capVisible = true;
        capPos = [...stoppedTarget];
        catchHoldTimer = 2.2;
        catchHoldPos = [stoppedTarget[0], 0.35, stoppedTarget[2]];
      } else {
        activeBatted = null;
        capVisible = false;
        catchHoldTimer = 0.6;
        catchHoldPos = [capPos[0], 0.35, capPos[2]];
      }
    }
  } else if (catchHoldTimer > 0) {
    catchHoldTimer = Math.max(0, catchHoldTimer - dt);
    if (stoppedRetrieveActive) {
      stoppedElapsed += dt;
      const picked = updateOutfielders(
        allFielders,
        dt,
        stoppedPickupDone ? null : stoppedTarget,
        stoppedTarget,
        false,
        stoppedPickupDone,
        stoppedElapsed,
        null,
        stoppedTarget,
      );
      if (picked && !stoppedPickupDone) {
        stoppedPickupDone = true;
        capVisible = false;
        spawnFx([stoppedTarget[0], 0.02, stoppedTarget[2]], 'dive_dust');
        logEv('球停下後守備員撿起');
        catchHoldTimer = Math.max(catchHoldTimer, 0.72);
      }
    } else {
      for (const f of allFielders) {
        f.animTime += dt;
        if (f.diveTimer > 0) f.diveTimer = Math.max(0, f.diveTimer - dt);
      }
    }
    if (catchHoldTimer <= 0) {
      stoppedRetrieveActive = false;
    }
    if (camOverride === 'auto') {
      cam.setFollowTarget(catchHoldTimer > 0 ? catchHoldPos : null);
    }
  } else if (wildActive) {
    wildElapsed += dt;
    wildVel[1] -= 9.81 * dt;
    wildPos[0] += wildVel[0] * dt;
    wildPos[1] += wildVel[1] * dt;
    wildPos[2] = Math.min(3.75, wildPos[2] + wildVel[2] * dt);

    if (!wildCrossed && wildPos[2] >= PASS_LINE_Z) {
      wildCrossed = true;
      wildCrossX = wildPos[0];
      logEv('瓶蓋越過捕逸線');
      spawnFx([wildCrossX, 0.04, PASS_LINE_Z], 'catch_pop');
      spawnFx([wildCrossX, 0.02, PASS_LINE_Z], 'dive_dust');
    }

    if (wildPos[1] <= 0.03) {
      wildPos[1] = 0.03;
      if (wildVel[1] < -0.35) {
        wildVel[1] = Math.abs(wildVel[1]) * 0.44;
        wildVel[0] *= 0.88;
        wildVel[2] *= 0.92;
        if (wildBounces < 3) {
          wildBounces += 1;
          bounceRings.push({ pos: [wildPos[0], 0.015, wildPos[2]], ageSec: 0, maxAgeSec: 0.48, infield: true });
        }
      } else {
        wildVel[1] = 0;
        const rollDrag = Math.exp(-dt * 1.15);
        wildVel[0] *= rollDrag;
        wildVel[2] *= rollDrag;
        if (wildPos[2] < PASS_LINE_Z + 0.65 && wildVel[2] < 1.55) {
          wildVel[2] = 1.55;
        }
      }
    }

    catcherFielder.animTime += dt;
    const tx = Math.max(-2.2, Math.min(2.2, wildPos[0] * 0.78));
    const tz = Math.max(0.75, Math.min(1.55, wildPos[2] + 0.25));
    const a = Math.min(1, dt * 6.0);
    catcherFielder.pos[0] += (tx - catcherFielder.pos[0]) * a;
    catcherFielder.pos[2] += (tz - catcherFielder.pos[2]) * a;

    capPos = [wildPos[0], wildPos[1], wildPos[2]];
    const spin = wildElapsed * 14;
    capNormal = [Math.cos(spin) * 0.7, 0.7, Math.sin(spin) * 0.7];
    capTrail.push(capPos);
    if (capTrail.length > 8) capTrail.shift();

    if (camOverride === 'auto') {
      cam.setWildPitchTarget([
        catcherFielder.pos[0] * 0.65 + wildPos[0] * 0.35,
        Math.max(0.25, wildPos[1]),
        Math.max(0.7, catcherFielder.pos[2]),
      ]);
    }
    if (wildElapsed >= wildDuration) {
      wildActive = false;
      capVisible = false;
      logEv('撲擋演出結束，鏡頭回位');
      if (camOverride === 'auto') cam.setWildPitchTarget(null);
      resetOutfielders(allFielders);
    }
  } else {
    updateOutfielders(allFielders, dt, null, null, false, false);
  }

  batterAlpha = 1.0;

  if (camOverride !== 'auto') applyCameraOverride();
  cam.update(dt);
}

/** Red = the fielder handles the landed ball, green = he cannot (mirrors getFieldingRing in main.ts). */
function labFieldingRing(): { pos: FieldV3; handled: boolean } | null {
  let pos: FieldV3 | null = null;
  let handled = false;
  if (activeBatted && capVisible && !stoppedPickupDone) {
    if (battedTime >= firstLandingTime(activeBatted) && capPos[1] <= 0.12) {
      pos = capPos;
      handled = interception !== null && interceptKind !== 'bobbled';
    }
  } else if (stoppedRetrieveActive && !stoppedPickupDone) {
    pos = stoppedTarget;
  }
  if (!pos) return null;
  const p = pos;
  return allFielders.some((f) => Math.hypot(f.pos[0] - p[0], f.pos[2] - p[2]) <= 3.2)
    ? { pos: [p[0], 0.015, p[2]], handled }
    : null;
}

function render(): void {
  if (!bank) return;
  const pw = canvas.width;
  const ph = canvas.height;
  cam.setViewport(pw, ph);
  const passLineState: PassLineState | undefined =
    wildActive || camOverride === 'wild'
      ? {
          highlight: wildActive ? 1.0 : 0.8,
          crossed: wildCrossed,
          crossX: wildCrossX,
        }
      : undefined;
  drawGymBackground(ctx, cam, pw, ph, timeSec, passLineState);
  const fenceItems = buildFenceDepthItems(ctx, cam, undefined, 0);

  const isCatchAnim = (a: string): boolean =>
    a === 'dive' || a === 'catch_fly' || a === 'catch_ground' || a === 'catch_wp';
  const pitcherActive =
    forcedPose !== 'auto' ||
    (activeBatted !== null && battedTime >= 0.25) ||
    catchHoldTimer > 0 ||
    Math.hypot(pitcherFielder.pos[0] - pitcherFielder.homePos[0], pitcherFielder.pos[2] - pitcherFielder.homePos[2]) >
      0.12 ||
    isCatchAnim(pitcherFielder.anim);

  const catcherVisible =
    forcedPose === 'catch_wp' ||
    wildActive ||
    Math.hypot(catcherFielder.pos[0] - catcherFielder.homePos[0], catcherFielder.pos[2] - catcherFielder.homePos[2]) >
      0.18 ||
    isCatchAnim(catcherFielder.anim);

  const visibleFielders = [...outfielders, ...(catcherVisible ? [catcherFielder] : [])];

  drawWorldEntities(ctx, {
    bank,
    cam,
    timeSec,
    pitchingTeam,
    battingTeam,
    pitcherFrame,
    pitcherFielder: {
      active: pitcherActive,
      pos: pitcherFielder.pos,
      anim: pitcherFielder.anim,
      animTime: pitcherFielder.animTime,
      flipX: pitcherFielder.flipX,
    },
    fielders: visibleFielders.map((f) => ({
      pos: f.pos,
      anim: f.anim,
      animTime: f.animTime,
      flipX: f.flipX,
    })),
    batter: {
      handedness: batterHandedness,
      anim: batterAnim,
      animTime: batterAnimTime,
      alpha: batterAlpha,
    },
    cap: {
      pos: capPos,
      normalField: capNormal,
      teamColor: pitchingTeam,
      trail: capTrail,
      visible: capVisible,
      isFlyBall: activeBatted !== null,
    },
    hitFx,
    fieldingFx: fieldingFxList,
    fenceItems,
    battedEffects: {
      fieldingRing: labFieldingRing(),
      bounceRings,
      fenceImpact: null,
      hrBurst: null,
    },
  });

  const eye = cam.getEyePos();
  stagePill.textContent = `${scenarioLabel}  ·  ${paused ? 'PAUSED' : `${playbackSpeed.toFixed(2)}x`}`;
  telemetryOut.textContent =
    `情境: ${scenarioLabel}\n` +
    `鏡頭: (${eye[0].toFixed(2)}, ${eye[1].toFixed(2)}, ${eye[2].toFixed(2)})\n` +
    `LF: ${outfielders[0].anim} (${outfielders[0].animTime.toFixed(2)}s) flip=${outfielders[0].flipX}\n` +
    `RF: ${outfielders[1].anim} (${outfielders[1].animTime.toFixed(2)}s) flip=${outfielders[1].flipX}\n` +
    `P : ${pitcherFielder.anim} (${pitcherFielder.animTime.toFixed(2)}s) field=${pitcherActive}\n` +
    `C : ${catcherFielder.anim} (${catcherFielder.animTime.toFixed(2)}s) vis=${catcherVisible}\n` +
    `AB: ${batterHandedness === 'left' ? '#99 LHB' : '#18 RHB'} · ${batterAnim} (α=${batterAlpha.toFixed(2)})\n` +
    `FX: ${fieldingFxList.map((x) => x.kind).join(', ') || 'none'}\n` +
    `界外延伸線距離最大: ${maxExtDist.toFixed(2)} m（上限 ${FOUL_EXT_LIMIT_M}）${maxExtDist > FOUL_EXT_LIMIT_M + 0.01 ? '  穿牆!' : ''}`;
  timelineOut.textContent =
    labEvents
      .slice(-14)
      .map((e) => `+${e.t.toFixed(2)}s  ${e.text}`)
      .join('\n') || '—';
}

function updatePauseBtn(): void {
  btnPause.textContent = paused ? '繼續 (Space)' : '暫停 (Space)';
}

function syncPoseButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.pose-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pose === forcedPose);
  });
}

// Wire controls
document.querySelectorAll<HTMLButtonElement>('.sc-btn[data-sc]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.sc as ScenarioId;
    if (id) {
      triggerScenario(id);
      saveHash();
    }
  });
});

document.querySelectorAll<HTMLButtonElement>('.pose-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    forcedPose = (btn.dataset.pose as ForcedPose) || 'auto';
    scenarioLabel = forcedPose === 'auto' ? '正常模擬' : `原地比例對照: ${forcedPose}`;
    clearDynamicPlay();
    syncPoseButtons();
    saveHash();
  });
});

document.querySelectorAll<HTMLButtonElement>('.cam-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    camOverride = (btn.dataset.cam as CamOverride) || 'auto';
    document.querySelectorAll<HTMLButtonElement>('.cam-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.cam === camOverride);
    });
    saveHash();
    if (camOverride === 'auto' && !activeBatted && !wildActive && catchHoldTimer <= 0) {
      cam.setFollowTarget(null);
      cam.setWildPitchTarget(null);
    } else {
      applyCameraOverride();
    }
  });
});

btnTeamYellow.addEventListener('click', () => {
  pitchingTeam = 'yellow';
  battingTeam = 'black';
  btnTeamYellow.classList.add('active');
  btnTeamBlack.classList.remove('active');
  saveHash();
});

btnTeamBlack.addEventListener('click', () => {
  pitchingTeam = 'black';
  battingTeam = 'yellow';
  btnTeamBlack.classList.add('active');
  btnTeamYellow.classList.remove('active');
  saveHash();
});

function saveHash(): void {
  const p = new URLSearchParams({
    sc: lastScenario,
    cam: camOverride,
    speed: playbackSpeed.toFixed(2),
    team: pitchingTeam,
    pose: forcedPose,
    card: cardDelaySec.toFixed(1),
  });
  try {
    history.replaceState(null, '', `#${p.toString()}`);
  } catch {
    // ignore (sandboxed iframe)
  }
}

function setSpeed(v: number): void {
  playbackSpeed = Math.max(0.1, Math.min(1.0, v));
  speedInput.value = playbackSpeed.toFixed(2);
  speedVal.textContent = `${playbackSpeed.toFixed(2)}x`;
  saveHash();
  document.querySelectorAll<HTMLButtonElement>('.sp-btn').forEach((b) => {
    b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - playbackSpeed) < 0.03);
  });
}

speedInput.addEventListener('input', () => setSpeed(Number(speedInput.value)));
document.querySelectorAll<HTMLButtonElement>('.sp-btn').forEach((btn) => {
  btn.addEventListener('click', () => setSpeed(Number(btn.dataset.speed)));
});

cardDelayInput.addEventListener('input', () => {
  cardDelaySec = Number(cardDelayInput.value);
  cardDelayVal.textContent = `${cardDelaySec.toFixed(2)}s`;
  saveHash();
});

btnPause.addEventListener('click', () => {
  paused = !paused;
  updatePauseBtn();
});

btnStep.addEventListener('click', () => {
  paused = true;
  updatePauseBtn();
  stepSim(1 / 30);
  render();
});

btnReplay.addEventListener('click', () => triggerScenario(lastScenario));

function applyHash(): ScenarioId {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const want = p.get('sc');
  if (want) lastScenario = want as ScenarioId; // keep saveHash() from overwriting it while the other options are applied
  if (p.get('team') === 'black') btnTeamBlack.click();
  const cam_ = p.get('cam');
  if (cam_) document.querySelector<HTMLButtonElement>(`.cam-btn[data-cam="${cam_}"]`)?.click();
  const sp = Number(p.get('speed'));
  if (sp > 0) setSpeed(sp);
  const cd = Number(p.get('card'));
  if (p.has('card') && Number.isFinite(cd)) {
    cardDelayInput.value = String(cd);
    cardDelayInput.dispatchEvent(new Event('input'));
  }
  const pose = p.get('pose');
  if (pose && pose !== 'auto') document.querySelector<HTMLButtonElement>(`.pose-btn[data-pose="${pose}"]`)?.click();
  const sc = p.get('sc');
  return (sc && document.querySelector(`.sc-btn[data-sc="${sc}"]`) ? sc : 'rf_ground') as ScenarioId;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    updatePauseBtn();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    paused = true;
    updatePauseBtn();
    stepSim(1 / 30);
    render();
  } else if (e.key === 'r' || e.key === 'R') {
    triggerScenario(lastScenario);
  }
});

let lastTs = performance.now();
function loop(ts: number): void {
  const rawDt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
  lastTs = ts;
  if (!paused) {
    stepSim(rawDt * playbackSpeed);
  }
  render();
  requestAnimationFrame(loop);
}

loadSprites().then((loaded) => {
  bank = loaded;
  const initial = applyHash();
  if (forcedPose === 'auto') triggerScenario(initial);
  requestAnimationFrame(loop);
});
