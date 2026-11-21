import {
  checkCatcherCatch,
  chooseCpuPitch,
  createOutfielders,
  evaluateCpuSwing,
  resetOutfielders,
  updateOutfielders,
  type CpuSwingPlan,
} from './ai/cpu';
import { sfx } from './audio/sfx';
import {
  createTranslator,
  getActiveLocale,
  loadLocalePref,
  localizeServerCallout,
  saveLocalePref,
  type DictKey,
  type Locale,
  type LocalePref,
} from './i18n/index';
import {
  OnlineClient,
  loadSession,
  saveSession,
  type LiveRoomInfo,
  type OnlineMode,
  type OnlineSide,
  type PitchLaunchMsg,
  type PitchResultMsg,
  type ServerMessage,
  type TurnState,
} from './net/client';
import {
  simulateBattedCap,
  simToField,
  type BattedCapResult,
  type FieldV3,
} from './physics/batted';
import { evaluateSwingResolution, type CatchInfo } from './physics/contact';
import {
  PITCH_IDS,
  PITCH_SPECS,
  solvePitchTrajectory,
  type PitchId,
  type PitchTrajectoryResult,
} from './physics/pitches';
import { GameCamera } from './render/camera';
import { simNormalToField } from './render/cap3d';
import { buildFenceDepthItems, drawGymBackground } from './render/gymScene';
import {
  drawStrikeZoneAndOverlay,
  HIT_PLANE_Z,
  type AbsReplayState,
  type OverlayState,
} from './render/overlay';
import {
  drawWorldEntities,
  loadSprites,
  type BatterAnim,
  type SpriteBank,
  type TeamColor,
} from './render/sprites';
import {
  FENCE_DIST,
  FENCE_HEIGHT,
  isInfield,
  PLATE_WIDTH,
} from './rules/field';
import { evaluateUmpirePitchCall, judgeBattedCap, judgePitch } from './rules/judge';
import {
  applyAbsChallenge,
  applyBattedOutcome,
  applyDerbySwingResult,
  applyIntentionalWalk,
  applyPitchClockViolation,
  applyPitchResult,
  canIntentionalWalk,
  captureAbsPreSnapshot,
  createMatch,
  getCurrentBatter,
  getFieldingTeam,
  getPitchClockSeconds,
  recordChallengeableCall,
  type GameMode,
  type MatchState,
  type PlayerSlot,
} from './rules/match';
import './styles.css';

declare const __BUILD__: string;
const CLIENT_BUILD_VERSION = typeof __BUILD__ !== 'undefined' ? __BUILD__ : '';

// --- DOM Elements ---
const appViewport = document.getElementById('app') as HTMLElement;
const pixelCanvas = document.getElementById('pixel-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const pixelCtx = pixelCanvas.getContext('2d')!;
const overlayCtx = overlayCanvas.getContext('2d')!;

const titleScreen = document.getElementById('title-screen') as HTMLElement;
const lobbyHub = document.getElementById('lobby-hub') as HTMLElement;
const queuePanel = document.getElementById('queue-panel') as HTMLElement;
const queueStatusText = document.getElementById('queue-status-text') as HTMLElement;

const hudTopRegion = document.getElementById('hud-top-region') as HTMLElement;
const scoreboardEl = document.getElementById('scoreboard') as HTMLElement;
const sbNormalRow = document.getElementById('sb-normal-row') as HTMLElement;
const sbDerbyRow = document.getElementById('sb-derby-row') as HTMLElement;
const sbDerbyText = document.getElementById('sb-derby-text') as HTMLElement;
const sbPitcherEl = document.getElementById('sb-pitcher') as HTMLElement;
const sbPitchClockEl = document.getElementById('sb-pitch-clock') as HTMLElement;
const sbBsEl = document.getElementById('sb-bs') as HTMLElement;

const updateBanner = document.getElementById('update-banner') as HTMLElement;
const btnUpdateRefresh = document.getElementById('btn-update-refresh') as HTMLButtonElement;
const btnUpdateDismiss = document.getElementById('btn-update-dismiss') as HTMLButtonElement;

const pitcherDock = document.getElementById('pitcher-dock') as HTMLElement;
const zoneTopHud = document.getElementById('zone-top-hud') as HTMLElement;
const swingFeedbackCard = document.getElementById('swing-feedback-card') as HTMLElement;
const sfHeadEl = document.getElementById('sf-head') as HTMLElement;
const sfGradeEl = document.getElementById('sf-grade') as HTMLElement;
const sfMetricsEl = document.getElementById('sf-metrics') as HTMLElement;
const btnAbsChallenge = document.getElementById('btn-abs-challenge') as HTMLButtonElement;
const absTimerFillEl = document.getElementById('abs-timer-fill') as HTMLElement;

const btnMenu = document.getElementById('btn-menu') as HTMLButtonElement;
const btnMenuBack = document.getElementById('btn-menu-back') as HTMLButtonElement;
const btnMenuTitle = document.getElementById('btn-menu-title') as HTMLButtonElement;
const btnResign = document.getElementById('btn-resign') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const btnRules = document.getElementById('btn-rules') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnNickChip = document.getElementById('btn-nick-chip') as HTMLButtonElement;
const nickChipLabel = document.getElementById('nick-chip-label') as HTMLElement;
const netSpeedPill = document.getElementById('net-speed-pill') as HTMLElement;
const netSpeedText = document.getElementById('net-speed-text') as HTMLElement;
const topOnlinePill = document.getElementById('top-online-pill') as HTMLElement;
const sbTelemetryEl = document.getElementById('sb-telemetry') as HTMLElement;

const awayNameEl = document.getElementById('away-name') as HTMLElement;
const homeNameEl = document.getElementById('home-name') as HTMLElement;
const awayScoreEl = document.getElementById('away-score') as HTMLElement;
const homeScoreEl = document.getElementById('home-score') as HTMLElement;
const sbInningEl = document.getElementById('sb-inning') as HTMLElement;
const sbBatterEl = document.getElementById('sb-batter') as HTMLElement;

const pitchSelectedNameEl = document.getElementById('pitch-selected-name') as HTMLElement;
const springMeterEl = document.getElementById('spring-meter') as HTMLElement;
const springTitleEl = document.getElementById('spring-title') as HTMLElement;
const springChamberEl = document.getElementById('spring-chamber') as HTMLElement;
const springReadoutEl = document.getElementById('spring-readout') as HTMLElement;
const springCompressFillEl = document.getElementById('spring-compress-fill') as unknown as SVGRectElement;
const springCoilPathEl = document.getElementById('spring-coil-path') as unknown as SVGPathElement;
const springPlungerEl = document.getElementById('spring-plunger') as unknown as SVGRectElement;
const springPeakTrailEl = document.getElementById('spring-peak-trail') as HTMLElement;
const springNeedleEl = document.getElementById('spring-needle') as HTMLElement;

const btnThrow = document.getElementById('btn-throw') as HTMLButtonElement;
const btnIbb = document.getElementById('btn-ibb') as HTMLButtonElement;
const pitchButtonsWrap = document.getElementById('pitch-buttons') as HTMLElement;
const menuBatRow = document.getElementById('menu-bat-row') as HTMLElement;
const btnHand = document.getElementById('btn-hand') as HTMLButtonElement;
const btnSwingType = document.getElementById('btn-swing-type') as HTMLButtonElement;

const btnHubPlay = document.getElementById('btn-hub-play') as HTMLButtonElement;
const btnHubFriend = document.getElementById('btn-hub-friend') as HTMLButtonElement;
const btnHubWatch = document.getElementById('btn-hub-watch') as HTMLButtonElement;
const btnQueueCancel = document.getElementById('btn-queue-cancel') as HTMLButtonElement;
const btnQueueCpu = document.getElementById('btn-queue-cpu') as HTMLButtonElement;

const menuDialog = document.getElementById('menu-dialog') as HTMLDialogElement;
const menuOnlineTimerEl = document.getElementById('menu-online-timer') as HTMLElement;
const cpuDialog = document.getElementById('cpu-dialog') as HTMLDialogElement;
const friendDialog = document.getElementById('friend-dialog') as HTMLDialogElement;
const watchDialog = document.getElementById('watch-dialog') as HTMLDialogElement;
const rulesDialog = document.getElementById('rules-dialog') as HTMLDialogElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const resultDialog = document.getElementById('result-dialog') as HTMLDialogElement;
const resultBody = document.getElementById('result-body') as HTMLElement;

const friendStatusMsg = document.getElementById('friend-status-msg') as HTMLElement;
const btnRoomCreate = document.getElementById('btn-room-create') as HTMLButtonElement;
const roomCreatedBox = document.getElementById('room-created-box') as HTMLElement;
const roomCodeDisplay = document.getElementById('room-code-display') as HTMLElement;
const btnCopyCode = document.getElementById('btn-copy-code') as HTMLButtonElement;
const btnCopyLink = document.getElementById('btn-copy-link') as HTMLButtonElement;
const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
const btnRoomJoin = document.getElementById('btn-room-join') as HTMLButtonElement;

const watchListEl = document.getElementById('watch-list') as HTMLElement;
const btnWatchRefresh = document.getElementById('btn-watch-refresh') as HTMLButtonElement;

const onlineNameInput = document.getElementById('online-name') as HTMLInputElement;
const setLanguage = document.getElementById('set-language') as HTMLSelectElement;
const setTouchSwing = document.getElementById('set-touch-swing') as HTMLSelectElement;
const setDifficulty = document.getElementById('set-difficulty') as HTMLSelectElement;
const setGuideRing = document.getElementById('set-guide-ring') as HTMLInputElement;
const setBreakPreview = document.getElementById('set-break-preview') as HTMLInputElement;
const setSound = document.getElementById('set-sound') as HTMLInputElement;

// --- i18n & Touch Batting Preferences ---
type TouchSwingMode = 'drag_release' | 'instant_tap';
const TOUCH_SWING_KEY = 'capbaseball_touch_swing_v1';

let localePref: LocalePref = loadLocalePref();
let locale: Locale = getActiveLocale(localePref);
let t = createTranslator(locale);
let touchSwingMode: TouchSwingMode = (() => {
  try {
    const v = localStorage.getItem(TOUCH_SWING_KEY);
    if (v === 'drag_release' || v === 'instant_tap') return v;
  } catch {
    // ignore storage errors
  }
  return 'drag_release';
})();

function getLocalizedPitchName(pitchId: PitchId): string {
  const map: Record<PitchId, DictKey> = {
    straight: 'pitchStraight',
    cutter: 'pitchCutter',
    fork: 'pitchFork',
    changeup: 'pitchChangeup',
  };
  return t(map[pitchId]);
}

function applyLocaleToDom(): void {
  document.documentElement.lang = locale;
  setLanguage.value = localePref;
  setTouchSwing.value = touchSwingMode;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as DictKey | undefined;
    if (key) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder as DictKey | undefined;
    if (key) el.placeholder = t(key);
  }
  btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');
  btnSwingType.textContent = powerSwing ? t('btnPower') : t('btnNormal');
  btnSound.textContent = sfx.isMuted() ? t('btnMute') : t('btnSfx');
  pitchSelectedNameEl.textContent = getLocalizedPitchName(selectedPitch);
  if (phase === 'idle') {
    btnThrow.textContent = isPlayCallActive() ? t('btnWait') : t('btnHoldToPitch');
  }
  renderSpringMeterUi();
}

// --- Lineups ---
const AWAY_LINEUP: PlayerSlot[] = [
  { id: 'away-1', name: 'NastYboY #99', position: 'LF' },
  { id: 'away-2', name: 'NastYboY #99', position: 'RF' },
  { id: 'away-3', name: 'NastYboY #99', position: 'DH' },
  { id: 'away-4', name: 'NastYboY #99', position: 'C' },
  { id: 'away-5', name: 'skywalker #18', position: 'P' },
];

const HOME_LINEUP: PlayerSlot[] = [
  { id: 'home-1', name: 'NastYboY #99', position: 'LF' },
  { id: 'home-2', name: 'NastYboY #99', position: 'RF' },
  { id: 'home-3', name: 'NastYboY #99', position: 'DH' },
  { id: 'home-4', name: 'NastYboY #99', position: 'C' },
  { id: 'home-5', name: 'skywalker #18', position: 'P' },
];

// --- Game State ---
type PlayPhase =
  | 'idle'
  | 'pitch_meter'
  | 'windup'
  | 'pitch_flight'
  | 'awaiting_result'
  | 'batted_flight'
  | 'result';
type Role = 'pitcher' | 'batter' | 'spectate';

const onlineClient = new OnlineClient();
let isOnline = false;
let spectating = false;
const onlineModeChoice: OnlineMode = 'quick3';
let onlineSide: OnlineSide | null = null;
let onlineRoomCode: string | null = null;
let onlinePitchSeq = 1;
let onlineTurnState: TurnState = 'awaiting_pitch';
let onlineWaitingQueue = false;
let queueElapsedSec = 0;
let pendingOnlineResult: PitchResultMsg | null = null;
let queuedOnlinePitchResult: PitchResultMsg | null = null;
let onlineNoSwingSentForSeq = 0;

let match: MatchState = createMatch('quick3', {
  awayName: '中正黑',
  homeName: '中正黃',
  awayLineup: AWAY_LINEUP,
  homeLineup: HOME_LINEUP,
});
let onTitleScreen = true;
let phase: PlayPhase = 'idle';
let difficulty = 3;
let showGuideRing = true;
let showBreakPreview = true;
let strikeZoneAlpha = 1;

let selectedPitch: PitchId = 'straight';
let speedKmh = PITCH_SPECS.straight.defaultSpeedKmh;
let pitchTarget = { x: 0, y: 0.72 };
let breakDeltaField: { dx: number; dy: number } | null = null;
let previewPoints: FieldV3[] = [];

let batCursor = { x: 0, y: 0.72 };
let batterHandedness: 'left' | 'right' = 'left';
let powerSwing = false;

type SpringZone = 'NORMAL' | 'BEST' | 'OVER';
type SpringStage = 'idle' | 'charging' | 'rebounding' | 'locked';
const SPRING_BEST_START = 0.62;
const SPRING_OVER_START = 0.82;
const SPRING_BEST_CENTER = 0.72;

const springMeter = {
  stage: 'idle' as SpringStage,
  charge: 0,       // 0..1 compression while holding
  overOsc: 0,      // oscillation phase when held at max compression
  pos: 0,          // 0..1 current needle position along NORMAL -> BEST -> OVER
  peak: 0,         // 0..1 apex position reached after releasing the spring
  reboundTime: 0,
  reboundDur: 0.4,
  lockTimer: 0,
};
let pitcherFrame = 0;
let windupTime = 0;
let pitchFlightTime = 0;
let activePitch: PitchTrajectoryResult | null = null;
let cpuSwingPlan: CpuSwingPlan | null = null;
let cpuAutoPitchTimer = 0;

let batterAnim: BatterAnim = 'ready';
let batterAnimTime = 0;
let batterSwungThisPitch = false;
let swingChecked = false;

let activeBatted: BattedCapResult | null = null;
let activeCatchInfo: CatchInfo | null = null;
let bobbledTriggered = false;
let battedFlightTime = 0;
let battedCaughtInAir = false;
let battedBouncesPlayed = 0;
let battedFencePlayed = false;
let battedHrBurstPlayed = false;

interface BounceRing {
  pos: FieldV3;
  ageSec: number;
  maxAgeSec: number;
  infield: boolean;
}
let bounceRings: BounceRing[] = [];
let fenceImpact: { pos: FieldV3; ageSec: number; maxAgeSec: number } | null = null;
let hrBurst: { pos: FieldV3; ageSec: number; maxAgeSec: number } | null = null;
let fenceFlashAngle: number | undefined = undefined;
let fenceFlashAlpha = 0;
let totalBounceEvents = 0;
let totalFenceHits = 0;
let totalHrBursts = 0;

let absPromptTimer = 0;
let absPromptMaxTimer = 2.5;
let absReplay: AbsReplayState | null = null;
const ONLINE_MENU_TIMEOUT_SEC = 20;
let onlineMenuTimerSec = 0;
let pitchClockSec = 15;
let pitchClockLastWhole = 15;
let detectedServerVersion: string | null = null;
let updateBannerDismissed = false;

function isOnlineMenuTimerActive(): boolean {
  return isOnline && !spectating && !onTitleScreen && !match.isGameOver;
}

function updateOnlineMenuTimerUi(): void {
  const show = isOnlineMenuTimerActive() && menuDialog.open && onlineMenuTimerSec > 0;
  menuOnlineTimerEl.hidden = !show;
  if (!show) return;
  const whole = Math.max(1, Math.ceil(onlineMenuTimerSec));
  menuOnlineTimerEl.textContent = `${t('onlineMenuTimerPrefix')} ${whole}${t('onlineMenuTimerSuffix')}`;
  menuOnlineTimerEl.dataset.urgent = String(whole <= 5);
}

const IS_DEV_MODE = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

function handleServerVersion(serverVer: string | null | undefined): void {
  if (!serverVer || !CLIENT_BUILD_VERSION) return;
  if (IS_DEV_MODE) return;
  if (serverVer !== CLIENT_BUILD_VERSION) {
    detectedServerVersion = serverVer;
    if (!updateBannerDismissed) {
      updateBanner.hidden = false;
    }
  }
}

async function pollHealthVersion(): Promise<void> {
  if (IS_DEV_MODE || !CLIENT_BUILD_VERSION || detectedServerVersion) return;
  if (document.visibilityState === 'hidden') return;
  try {
    const res = await fetch('./health', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string | null };
    handleServerVersion(data.version);
  } catch {
    // ignore transient offline errors
  }
}

function isPitchClockEnabled(): boolean {
  if (onTitleScreen || match.isGameOver) return false;
  if (isOnline || spectating) return true;
  return match.mode === 'quick3' || match.mode === 'official6' || match.mode === 'hotseat2p';
}

function updatePitchClockUi(running: boolean): void {
  const enabled = isPitchClockEnabled();
  sbPitchClockEl.hidden = !enabled;
  if (!enabled) return;
  const whole = Math.max(0, Math.ceil(pitchClockSec));
  sbPitchClockEl.textContent = String(whole);
  sbPitchClockEl.dataset.urgent = String(running && whole <= 5);
  sbPitchClockEl.dataset.paused = String(!running);
}

function resetPitchClock(): void {
  pitchClockSec = getPitchClockSeconds(match);
  pitchClockLastWhole = Math.ceil(pitchClockSec);
  updatePitchClockUi(false);
}

btnUpdateRefresh.addEventListener('click', () => {
  window.location.reload();
});
btnUpdateDismiss.addEventListener('click', () => {
  updateBannerDismissed = true;
  updateBanner.hidden = true;
});

let capPos: FieldV3 = [0, 1.18, -8.87];
let capNormalField: FieldV3 = [0, 1, 0];
let capTrail: FieldV3[] = [];
let capVisible = false;

let hitFx: { active: boolean; pos: FieldV3; kind: 'hit' | 'hr_burst'; elapsedSec: number } | null = null;
let swingFeedbackCardState: { grade: string; metrics: string; color: string; ttl: number } | null = null;
let lastSwingTimingNote: string | null = null;
let lastContactMetrics: string | null = null;
let callout: OverlayState['callout'] = null;
let resultDelayTimer = 0;
let lastCallLabel = 'READY';
let lastPitchTelemetry = 'READY';
let pendingPitchTelemetry = '';

const outfielders = createOutfielders();
const cam = new GameCamera();
let sprites: SpriteBank = {
  ready: false,
  pitcherYellow: null,
  pitcherBlack: null,
  pitcherMeta: { frames: 60, fps: 24, w: 113, h: 113, baseline_y: 112, release_frame: 30, idle_frame: 0 },
  fielderYellow: null,
  fielderBlack: null,
  fielderAtlas: null,
  batterRealHome: null,
  batterRealAway: null,
  batterRealMeta: {
    frames: 10,
    w: 148,
    h: 114,
    baseline_y: 112,
    anchor_x: 62,
    natural_handedness: 'left',
    anims: {
      ready: [0, 1, 2, 1],
      load: [3],
      swing_early: [4],
      swing_contact: [4, 5],
      follow_through: [6, 7, 8, 9],
    },
  },
  fxHitImg: null,
  fxHitAtlas: null,
};

const keysPressed = new Set<string>();

// --- Helpers ---
function getCurrentRole(): Role {
  if (onTitleScreen || spectating) return 'spectate';
  if (isOnline && onlineSide) {
    const pitchingSide: OnlineSide = match.half === 'top' ? 'home' : 'away';
    return onlineSide === pitchingSide ? 'pitcher' : 'batter';
  }
  if (match.mode === 'practice_pitch') return 'pitcher';
  if (match.mode === 'practice_bat') return 'batter';
  if (match.mode === 'hotseat2p') {
    return phase === 'windup' || phase === 'pitch_flight' ? 'batter' : 'pitcher';
  }
  return match.half === 'top' ? 'pitcher' : 'batter';
}

function getPitchingTeamColor(): TeamColor {
  return match.half === 'top' ? 'yellow' : 'black';
}

function getBattingTeamColor(): TeamColor {
  return match.half === 'top' ? 'black' : 'yellow';
}

function evaluateSpring(
  rawValue: number,
  pitchId: PitchId,
): { zone: SpringZone; speedKmh: number; maxScatterM: number } {
  const v = Math.max(0, Math.min(1, rawValue));
  const spec = PITCH_SPECS[pitchId];
  const [minS, maxS] = spec.speedRangeKmh;
  const defS = spec.defaultSpeedKmh;

  if (v <= SPRING_BEST_START) {
    const t = v / SPRING_BEST_START;
    return {
      zone: 'NORMAL',
      speedKmh: Math.round(minS + (defS - minS) * t),
      maxScatterM: 0.036 - 0.018 * t,
    };
  }
  if (v <= SPRING_OVER_START) {
    const t = (v - SPRING_BEST_START) / (SPRING_OVER_START - SPRING_BEST_START);
    const distFromCenter = Math.abs(v - SPRING_BEST_CENTER) / 0.1;
    return {
      zone: 'BEST',
      speedKmh: Math.round(defS + (maxS - defS) * t),
      maxScatterM: distFromCenter * 0.01,
    };
  }
  const t = (v - SPRING_OVER_START) / (1 - SPRING_OVER_START);
  return {
    zone: 'OVER',
    speedKmh: Math.round(maxS + 3 * t),
    maxScatterM: 0.075 + 0.165 * t * t,
  };
}

function buildSpringCoilPath(startX: number, endX: number, coils = 10): string {
  const span = Math.max(5, endX - startX);
  const stepX = span / (coils * 2);
  let d = `M ${startX.toFixed(1)} 14`;
  for (let i = 1; i < coils * 2; i++) {
    const x = startX + stepX * i;
    const y = i % 2 === 1 ? 5 : 23;
    d += ` L ${x.toFixed(1)} ${y}`;
  }
  d += ` L ${endX.toFixed(1)} 14`;
  return d;
}

function renderSpringMeterUi(): void {
  const stage = springMeter.stage;
  springMeterEl.dataset.stage = stage;

  const restPlungerX = 32;
  let plungerX = restPlungerX;
  let coilColor = '#ffffff';
  let plungerColor = '#ffffff';
  let fillWidth = 0;
  let fillColor = 'rgba(7, 11, 20, 0.32)';
  let coils = 8;

  if (stage === 'idle') {
    springMeterEl.dataset.zone = 'IDLE';
    springTitleEl.textContent = t('springTitle');
    const [minS, maxS] = PITCH_SPECS[selectedPitch].speedRangeKmh;
    springReadoutEl.textContent = `${minS}–${maxS} km/h`;
    springNeedleEl.style.left = `${(restPlungerX / 2).toFixed(1)}%`;
    springPeakTrailEl.style.width = '0%';
  } else if (stage === 'charging') {
    const c = Math.max(0, Math.min(1, springMeter.charge));
    // Compress plunger tightly leftward (32 -> 9) directly on the left end of the NORMAL-BEST-OVER track
    plungerX = restPlungerX - c * 23;
    fillWidth = Math.max(0, plungerX - 4);
    const estPeak = Math.max(0.1, Math.min(1, 0.1 + 0.9 * Math.pow(c, 0.95)));
    coilColor = estPeak > SPRING_OVER_START ? '#fda4af' : estPeak > SPRING_BEST_START ? '#ffe066' : '#e0f2fe';
    plungerColor = estPeak > SPRING_OVER_START ? '#fda4af' : estPeak > SPRING_BEST_START ? '#ffe066' : '#ffffff';
    fillColor = 'rgba(7, 11, 20, 0.48)';
    springMeterEl.dataset.zone = estPeak > SPRING_OVER_START ? 'OVER' : 'IDLE';
    springTitleEl.textContent = t('springCharging');
    springReadoutEl.textContent = `${Math.round(c * 100)}%`;
    springNeedleEl.style.left = `${(plungerX / 2).toFixed(1)}%`;
    springPeakTrailEl.style.width = '0%';
  } else {
    // Rebounding or Locked at Apex: spring stretches right across the NORMAL - BEST - OVER spectrum!
    const p = Math.max(0, Math.min(1, springMeter.pos));
    const evalRes = evaluateSpring(p, selectedPitch);
    springMeterEl.dataset.zone = evalRes.zone;
    plungerX = Math.max(10, Math.min(193, p * 193));
    coils = Math.max(8, Math.round(7 + p * 8));
    fillWidth = Math.max(0, plungerX - 4);
    fillColor = 'rgba(7, 11, 20, 0.22)';

    if (stage === 'rebounding') {
      springTitleEl.textContent = t('springRebounding');
      springReadoutEl.textContent = `${evalRes.speedKmh} km/h`;
    } else {
      const zoneLbl =
        evalRes.zone === 'BEST'
          ? t('springBest')
          : evalRes.zone === 'OVER'
            ? t('springOver')
            : t('springNormal');
      springTitleEl.textContent = zoneLbl;
      springReadoutEl.textContent = `${evalRes.speedKmh} km/h`;
    }

    coilColor = evalRes.zone === 'BEST' ? '#ffe066' : evalRes.zone === 'OVER' ? '#fecdd3' : '#ffffff';
    plungerColor = evalRes.zone === 'BEST' ? '#ffe066' : evalRes.zone === 'OVER' ? '#fda4af' : '#ffffff';
    springNeedleEl.style.left = `${(p * 100).toFixed(1)}%`;
    springPeakTrailEl.style.width = `${(p * 100).toFixed(1)}%`;
  }

  springPlungerEl.setAttribute('x', plungerX.toFixed(1));
  springCoilPathEl.setAttribute('d', buildSpringCoilPath(4, plungerX, coils));
  springCoilPathEl.setAttribute('stroke', coilColor);
  springPlungerEl.setAttribute('fill', plungerColor);
  springCompressFillEl.setAttribute('width', fillWidth.toFixed(1));
  springCompressFillEl.setAttribute('fill', fillColor);
}

function updateBreakPreview(): void {
  if (!showBreakPreview) {
    breakDeltaField = null;
    previewPoints = [];
    return;
  }
  const res = solvePitchTrajectory(selectedPitch, speedKmh, pitchTarget.x, pitchTarget.y, {
    outputHz: 45,
    seed: 1,
  });
  breakDeltaField = { dx: res.breakDelta[1], dy: res.breakDelta[2] };

  // Sample ~22 evenly spaced points from release to hit plane for full 3D trajectory preview
  const targetCount = 22;
  const maxT = Math.max(0.05, res.hitPlaneTimeSec);
  const pts: FieldV3[] = [];
  for (let i = 0; i < targetCount; i++) {
    const t = (i / (targetCount - 1)) * maxT;
    const f = res.sampleAt(t);
    pts.push(simToField([f.y[0], f.y[1], f.y[2]]));
  }
  previewPoints = pts;
}

function selectPitch(id: PitchId): void {
  selectedPitch = id;
  const spec = PITCH_SPECS[id];
  const [minS, maxS] = spec.speedRangeKmh;
  speedKmh = Math.max(minS, Math.min(maxS, spec.defaultSpeedKmh));
  pitchSelectedNameEl.textContent = getLocalizedPitchName(id);

  for (const btn of pitchButtonsWrap.querySelectorAll<HTMLButtonElement>('.pitch-btn')) {
    btn.classList.toggle('active', btn.dataset.pitch === id);
  }
  renderSpringMeterUi();
  updateBreakPreview();
}

function isGamePaused(): boolean {
  return !isOnline && !onTitleScreen && (menuDialog.open || rulesDialog.open || settingsDialog.open);
}

function isPlayCallActive(): boolean {
  return swingFeedbackCardState !== null || isAbsChallengeAvailable() || Boolean(absReplay && absReplay.active);
}

function startAbsPromptWindow(): void {
  const ttl = swingFeedbackCardState ? Math.max(2.2, swingFeedbackCardState.ttl) : 2.5;
  absPromptMaxTimer = ttl;
  absPromptTimer = ttl;
  btnAbsChallenge.style.opacity = '1';
}

function showUnifiedPlayCall(
  grade: string,
  detail: string,
  color: string,
  ttl = 2.8,
  header = 'PLAY CALL',
): void {
  const loc = localizeServerCallout(locale, grade, detail);
  const locHeader =
    header === 'PLAY CALL'
      ? t('playCallHead')
      : header === 'AUTO CPU'
        ? t('autoCpuHead')
        : header;
  callout = { title: loc.title, subtitle: loc.subtitle, color, ttl, maxTtl: ttl };
  lastCallLabel = loc.subtitle ? `${loc.title} ${loc.subtitle}` : loc.title;
  swingFeedbackCardState = { grade: loc.title, metrics: loc.subtitle, color, ttl };
  sfHeadEl.textContent = locHeader;
  sfGradeEl.textContent = loc.title;
  sfGradeEl.style.color = color;
  sfMetricsEl.textContent = loc.subtitle;
  swingFeedbackCard.style.borderLeftColor = color;
  swingFeedbackCard.style.opacity = '1';
  swingFeedbackCard.hidden = false;
}

function showCallout(title: string, subtitle: string, color: string, ttl = 2.6): void {
  showUnifiedPlayCall(title, subtitle, color, Math.max(2.2, ttl), 'PLAY CALL');
}

function showSwingFeedback(grade: string, metrics: string, color: string): void {
  showUnifiedPlayCall(grade, metrics, color, 2.8, 'PLAY CALL');
}

function isAbsChallengeEligibleForPlayer(): boolean {
  if (onTitleScreen || spectating || match.isGameOver) return false;
  if (!match.lastChallenge || match.lastChallenge.challenged) return false;
  const side = match.lastChallenge.eligibleSide;
  if (match.absChallenges[side] <= 0) return false;
  if (isOnline) {
    return onlineSide === side && onlineTurnState === 'awaiting_pitch';
  }
  if (match.mode === 'hotseat2p') return true;
  if (match.mode === 'practice_bat') return side === 'home';
  if (match.mode === 'practice_pitch') return side === 'home';
  return side === 'home';
}

function isAbsChallengeAvailable(): boolean {
  return absPromptTimer > 0 && isAbsChallengeEligibleForPlayer();
}

function triggerAbsChallenge(): void {
  if (!isAbsChallengeAvailable() || !match.lastChallenge) return;
  const lc = match.lastChallenge;
  absPromptTimer = 0;
  btnAbsChallenge.hidden = true;

  if (isOnline) {
    onlineClient.sendAbsChallenge(lc.pitchSeq);
    return;
  }

  const res = applyAbsChallenge(match, lc.eligibleSide);
  if (!res.ok) return;
  callout = null;
  absReplay = {
    active: true,
    plateX: res.plateX,
    plateY: res.plateY,
    trueCall: res.trueCall,
    umpireCall: res.umpireCall,
    overturned: res.overturned,
    marginCm: res.marginCm,
    elapsedSec: 0,
    durationSec: 2.2,
  };
  sfx.playUmpireTone(res.overturned ? 'ball' : 'strike');
  if (match.isGameOver) {
    showGameOverModal();
  }
  updateHudAndDocks();
}

function updateHudAndDocks(): void {
  appViewport.classList.toggle('in-game', !onTitleScreen);
  awayNameEl.textContent = match.away.name;
  homeNameEl.textContent = match.home.name;
  awayScoreEl.textContent = String(match.away.totalRuns);
  homeScoreEl.textContent = String(match.home.totalRuns);
  sbInningEl.textContent = `${match.half === 'top' ? '▲' : '▼'}${match.inning}`;
  sbBsEl.textContent = `${match.balls}-${match.strikes}`;

  const batter = getCurrentBatter(match);
  const fielding = getFieldingTeam(match);
  const pitcherSlot = fielding.lineup.find((p) => p.position === 'P') ?? fielding.lineup[0];
  sbBatterEl.textContent = batter.name;
  sbPitcherEl.textContent = `${pitcherSlot?.name ?? '--'} · P:${fielding.pitchesThrown}`;

  sbTelemetryEl.hidden = onTitleScreen;
  sbTelemetryEl.textContent = spectating
    ? `WATCH ${onlineRoomCode ?? ''} · ${lastPitchTelemetry}`
    : lastPitchTelemetry;

  if (match.derby.active) {
    sbNormalRow.hidden = true;
    sbDerbyRow.hidden = false;
    const left = match.derby.half === 'away' ? match.derby.awayPitchesLeft : match.derby.homePitchesLeft;
    sbDerbyText.textContent = `${left} LEFT · 中正黑 ${match.derby.awayHR} - ${match.derby.homeHR} 中正黃`;
  } else {
    sbNormalRow.hidden = false;
    sbDerbyRow.hidden = true;
  }

  for (let i = 0; i < 3; i++) {
    document.getElementById(`base-${i + 1}`)?.classList.toggle('on', match.bases[i] !== null);
  }
  for (let i = 1; i <= 2; i++) {
    document.getElementById(`o${i}`)?.classList.toggle('on', match.outs >= i);
  }
  const absSide = isOnline && onlineSide ? onlineSide : 'home';
  const absLeft = match.absChallenges[absSide];
  for (let i = 1; i <= 2; i++) {
    document.getElementById(`abs-${i}`)?.classList.toggle('on', absLeft >= i);
  }

  const role = getCurrentRole();
  const canPitchUi =
    !onTitleScreen &&
    !spectating &&
    !match.isGameOver &&
    role === 'pitcher' &&
    (phase === 'idle' || phase === 'pitch_meter') &&
    (!isOnline || onlineTurnState === 'awaiting_pitch');
  const canBatUi =
    !onTitleScreen &&
    !spectating &&
    !match.isGameOver &&
    role === 'batter' &&
    (phase === 'idle' || phase === 'windup' || phase === 'pitch_flight');
  pitcherDock.hidden = !canPitchUi;
  menuBatRow.hidden = !canBatUi;
  const playCallBlocking = isPlayCallActive();
  btnThrow.disabled = playCallBlocking && phase === 'idle';
  if (phase === 'idle') {
    btnThrow.textContent = playCallBlocking ? t('btnWait') : t('btnHoldToPitch');
  }
  btnIbb.disabled = !canIntentionalWalk(match) || phase !== 'idle' || playCallBlocking;
  btnResign.hidden = !isOnline || spectating || onTitleScreen || match.isGameOver;
  btnMenuBack.hidden = onTitleScreen;
  btnMenuTitle.hidden = onTitleScreen;
  btnMenu.hidden = false;
  btnAbsChallenge.hidden = !isAbsChallengeAvailable();
  updateSafeCameraFraming(false);
}

let cachedPortraitDockHeight = 168;

function updateSafeCameraFraming(immediate: boolean): void {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const hudRect = hudTopRegion.getBoundingClientRect();
  if (vh > vw && !onTitleScreen) {
    const topSafe = Math.max(84, hudRect.bottom + 8);
    const isPitchingRole = getCurrentRole() === 'pitcher' && !spectating;
    if (!pitcherDock.hidden && pitcherDock.offsetHeight > 0) {
      cachedPortraitDockHeight = pitcherDock.offsetHeight;
    }
    const bottomReserve = isPitchingRole ? cachedPortraitDockHeight + 16 : 16;
    const bottomSafe = Math.max(topSafe + 170, vh - bottomReserve);
    // Keep camera horizon (just below STRIKE_ZONE_HI) in the upper-middle of the unobstructed safe band
    // so Play Call / ABS stay below the Top HUD and Strike Zone bottom stays well above Pitcher Dock.
    const ratio = isPitchingRole
      ? (topSafe + (bottomSafe - topSafe) * 0.34) / vh
      : Math.min(0.5, (topSafe + (bottomSafe - topSafe) * 0.44) / vh);
    cam.setTargetCenterYRatio(ratio, immediate);
    // Pin Play Call + ABS cleanly in screen-space below Top HUD (decoupled from 3D camera motion)
    zoneTopHud.style.top = `${Math.round(hudRect.bottom + 10)}px`;
  } else {
    cam.setTargetCenterYRatio(0.5, immediate);
    // Pin Play Call + ABS in upper-center screen-space above the home-plate strike zone (decoupled from 3D camera)
    const pinnedTop = vh < 500
      ? Math.max(8, Math.round(vh * 0.04))
      : Math.max(Math.round(hudRect.bottom + 8), Math.round(vh * 0.21));
    zoneTopHud.style.top = `${pinnedTop}px`;
  }
}

function startMode(mode: GameMode): void {
  sfx.unlock();
  isOnline = false;
  spectating = false;
  onlineSide = null;
  onlineRoomCode = null;
  onlineTurnState = 'awaiting_pitch';
  pendingOnlineResult = null;
  queuedOnlinePitchResult = null;
  saveSession(null);

  match = createMatch(mode, {
    awayName: '中正黑',
    homeName: '中正黃',
    awayLineup: AWAY_LINEUP,
    homeLineup: HOME_LINEUP,
  });
  if (mode === 'practice_bat') {
    match.half = 'bottom';
  }
  onTitleScreen = false;
  titleScreen.hidden = true;
  scoreboardEl.hidden = false;
  if (cpuDialog.open) cpuDialog.close();

  phase = 'idle';
  pitcherFrame = 0;
  batterAnim = 'ready';
  batterAnimTime = 0;
  capVisible = false;
  capTrail = [];
  hitFx = null;
  callout = null;
  swingFeedbackCardState = null;
  swingFeedbackCard.hidden = true;
  absPromptTimer = 0;
  absReplay = null;
  bounceRings = [];
  fenceImpact = null;
  hrBurst = null;
  fenceFlashAlpha = 0;
  resetSpringMeter();
  pendingPitchTelemetry = '';
  lastPitchTelemetry = 'READY';
  cam.resetImmediate();
  resetOutfielders(outfielders);
  selectPitch('straight');
  resetPitchClock();
  updateHudAndDocks();
  updateSafeCameraFraming(true);

  if (getCurrentRole() === 'batter') {
    cpuAutoPitchTimer = 0.75;
  }
}

function returnToTitle(): void {
  if (spectating) {
    onlineClient.unwatchRoom();
  }
  if (isOnline) {
    onlineClient.disconnect();
  }
  isOnline = false;
  spectating = false;
  onlineSide = null;
  onlineRoomCode = null;
  onlineWaitingQueue = false;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  pendingOnlineResult = null;
  onTitleScreen = true;
  phase = 'idle';
  titleScreen.hidden = false;
  scoreboardEl.hidden = true;
  pitcherDock.hidden = true;
  menuBatRow.hidden = true;
  swingFeedbackCard.hidden = true;
  btnAbsChallenge.hidden = true;
  resetSpringMeter();
  absPromptTimer = 0;
  absReplay = null;
  capVisible = false;
  cam.resetImmediate();
  updateHudAndDocks();
  updateSafeCameraFraming(true);
}

function launchPitch(
  pitchId: PitchId,
  spdKmh: number,
  targetX: number,
  targetY: number,
  errorX = 0,
  errorY = 0,
  seed?: number,
): void {
  const spec = PITCH_SPECS[pitchId];
  activePitch = solvePitchTrajectory(pitchId, spdKmh, targetX, targetY, {
    errorY: errorX,
    errorZ: errorY,
    outputHz: 120,
    seed,
  });

  if (isOnline || spectating) {
    cpuSwingPlan = null;
  } else if (match.mode !== 'hotseat2p' && getCurrentRole() === 'batter') {
    cpuSwingPlan = null;
  } else if (match.mode === 'practice_pitch' || (match.mode !== 'hotseat2p' && getCurrentRole() === 'pitcher')) {
    cpuSwingPlan = evaluateCpuSwing(activePitch, difficulty);
  } else {
    cpuSwingPlan = null;
  }

  const breakCm = Math.round(Math.hypot(activePitch.breakDelta[1], activePitch.breakDelta[2]) * 100);
  // Hold pitch telemetry until the cap reaches the plate/contact (no mid-flight spoiler!)
  pendingPitchTelemetry = `${spec.code} ${Math.round(spdKmh)} km/h · BRK ${breakCm}cm`;
  lastPitchTelemetry = t('telInFlight');

  queuedOnlinePitchResult = null;
  phase = 'windup';
  windupTime = 0;
  pitchFlightTime = 0;
  pitcherFrame = 8;
  batterAnim = 'ready';
  batterAnimTime = 0;
  batterSwungThisPitch = false;
  swingChecked = false;
  lastSwingTimingNote = null;
  lastContactMetrics = null;
  onlineNoSwingSentForSeq = 0;
  capVisible = false;
  capTrail = [];
  resetSpringMeter();
  absPromptTimer = 0;
  absReplay = null;
  updateHudAndDocks();
}

function resetSpringMeter(): void {
  springMeter.stage = 'idle';
  springMeter.charge = 0;
  springMeter.overOsc = 0;
  springMeter.pos = 0;
  springMeter.peak = 0;
  springMeter.reboundTime = 0;
  springMeter.lockTimer = 0;
  btnThrow.textContent = 'HOLD TO PITCH';
  btnThrow.classList.remove('charging');
  renderSpringMeterUi();
}

function startSpringCharge(): void {
  if (spectating || onTitleScreen || match.isGameOver || isGamePaused()) return;
  if (getCurrentRole() !== 'pitcher') return;
  if (isOnline && onlineTurnState !== 'awaiting_pitch') return;
  if (isPlayCallActive()) return;
  if (phase !== 'idle' || springMeter.stage !== 'idle') return;
  sfx.unlock();
  springMeter.stage = 'charging';
  springMeter.charge = 0.04;
  springMeter.overOsc = 0;
  springMeter.pos = 0;
  springMeter.peak = 0;
  springMeter.reboundTime = 0;
  springMeter.lockTimer = 0;
  phase = 'pitch_meter';
  btnThrow.textContent = 'RELEASE!';
  btnThrow.classList.add('charging');
  renderSpringMeterUi();
}

function cancelSpringCharge(): void {
  if (springMeter.stage !== 'charging') return;
  if (phase === 'pitch_meter') phase = 'idle';
  resetSpringMeter();
}

function commitSpringPitch(peakVal: number): void {
  if (spectating || onTitleScreen || match.isGameOver || isGamePaused()) return;
  if (isOnline && onlineTurnState !== 'awaiting_pitch') return;
  if (isPlayCallActive()) return;
  if (phase !== 'idle' && phase !== 'pitch_meter') return;

  const evalRes = evaluateSpring(peakVal, selectedPitch);
  speedKmh = evalRes.speedKmh;

  const mag =
    evalRes.maxScatterM < 0.002
      ? 0
      : (0.35 + Math.random() * 0.65) * evalRes.maxScatterM;
  const ang = Math.random() * Math.PI * 2;
  const errX = Math.cos(ang) * mag;
  const errY = Math.sin(ang) * mag * 0.85;

  if (isOnline) {
    resetSpringMeter();
    phase = 'awaiting_result';
    lastPitchTelemetry = 'PITCHING...';
    onlineClient.submitPitch({
      pitchSeq: onlinePitchSeq,
      pitchId: selectedPitch,
      speedKmh,
      targetX: pitchTarget.x,
      targetY: pitchTarget.y,
      errorX: errX,
      errorY: errY,
    });
    updateHudAndDocks();
  } else {
    launchPitch(selectedPitch, speedKmh, pitchTarget.x, pitchTarget.y, errX, errY);
  }
}

function releaseSpringThrow(overridePeak?: number): void {
  if (spectating || onTitleScreen || match.isGameOver) return;
  if (isOnline && onlineTurnState !== 'awaiting_pitch') return;
  if (overridePeak !== undefined) {
    commitSpringPitch(overridePeak);
    return;
  }
  if (springMeter.stage !== 'charging') return;

  // Release compressed spring: launch needle forward toward its apex on NORMAL - BEST - OVER!
  const c = Math.max(0, Math.min(1, springMeter.charge));
  springMeter.peak = Math.max(0.1, Math.min(1, 0.1 + 0.9 * Math.pow(c, 0.95)));
  springMeter.pos = 0;
  springMeter.reboundTime = 0;
  springMeter.reboundDur = 0.28 + 0.24 * springMeter.peak;
  springMeter.lockTimer = 0.36;
  springMeter.stage = 'rebounding';
  btnThrow.textContent = 'LAUNCHING...';
  btnThrow.classList.remove('charging');
  renderSpringMeterUi();
}

function triggerSwing(): void {
  if (spectating || batterSwungThisPitch || match.isGameOver) return;
  if (phase !== 'windup' && phase !== 'pitch_flight') return;
  sfx.unlock();
  batterSwungThisPitch = true;
  batterAnim = 'load';
  batterAnimTime = 0;
}

function resolveContact(dtTiming: number): void {
  if (!activePitch) return;
  const resolution = evaluateSwingResolution({
    trajectory: activePitch,
    flightTimeSec: activePitch.hitPlaneTimeSec + dtTiming,
    batX: batCursor.x,
    batY: batCursor.y,
    swingMode: powerSwing ? 'power' : 'normal',
    batterSide: batterHandedness === 'right' ? 'R' : 'L',
    seed: Math.floor(Math.random() * 10000) + 1,
    outfielders,
  });

  if (!resolution.contact) {
    lastSwingTimingNote = resolution.detail || 'SWINGING STRIKE';
    showSwingFeedback(lastSwingTimingNote, 'STRIKE', '#f4c41c');
    return;
  }

  if (pendingPitchTelemetry) {
    lastPitchTelemetry = pendingPitchTelemetry;
    pendingPitchTelemetry = '';
  }

  activeBatted = resolution.battedResult;
  activeCatchInfo = resolution.catchInfo;
  bobbledTriggered = false;
  const grade = resolution.outcome === 'FOUL' ? resolution.label : resolution.quality.toUpperCase();
  const ev = Math.round(resolution.exitSpeedKmh);
  const [bvx, bvy, bvz] = resolution.battedParams.velocity;
  const la = Math.round((Math.atan2(bvy, Math.hypot(bvx, bvz)) * 180) / Math.PI);
  lastSwingTimingNote = resolution.outcome === 'FOUL' ? resolution.label : null;
  lastContactMetrics = `EV ${ev} km/h · LA ${la}°`;
  showSwingFeedback(
    grade,
    resolution.outcome === 'FOUL' ? `${resolution.feedback} · EV ${ev} km/h` : lastContactMetrics,
    resolution.color,
  );

  sfx.playBatCrack(
    activeBatted.overFence
      ? 'hr'
      : resolution.rawQuality > 0.75
        ? 'perfect'
        : resolution.rawQuality > 0.4
          ? 'good'
          : 'weak',
  );
  cam.addShake(activeBatted.overFence ? 0.08 : 0.035, 0.22);
  hitFx = {
    active: true,
    pos: [resolution.hitField[0], resolution.hitField[1], HIT_PLANE_Z],
    kind: activeBatted.overFence ? 'hr_burst' : 'hit',
    elapsedSec: 0,
  };

  phase = 'batted_flight';
  battedFlightTime = 0;
  battedCaughtInAir = false;
  battedBouncesPlayed = 0;
  battedFencePlayed = false;
  battedHrBurstPlayed = false;
  bounceRings = [];
  fenceImpact = null;
  hrBurst = null;
  fenceFlashAlpha = 0;
  capTrail = [];
  updateHudAndDocks();
}

function finishPitchWithoutContact(): void {
  if (!activePitch) return;
  if (pendingPitchTelemetry) {
    lastPitchTelemetry = pendingPitchTelemetry;
    pendingPitchTelemetry = '';
  }
  const plateField = simToField(activePitch.plateCrossPos);
  const caughtByCatcher = checkCatcherCatch(plateField[0], plateField[1], activePitch.reachesPassLine);

  const prevInning = match.inning;
  const prevHalf = match.half;

  if (!batterSwungThisPitch) {
    const preSnap = captureAbsPreSnapshot(match);
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const umpireEval = evaluateUmpirePitchCall(plateField[0], plateField[1], seed);
    const res = judgePitch({
      plateX: plateField[0],
      plateY: plateField[1],
      swung: false,
      contacted: false,
      caughtByCatcher,
      reachesPassLine: activePitch.reachesPassLine,
      currentStrikes: match.strikes,
      runnersOnBase: match.bases.some((b) => b !== null),
      forceCall: umpireEval.umpireCall,
    });

    applyPitchResult(match, {
      plateX: plateField[0],
      plateY: plateField[1],
      swung: false,
      contacted: false,
      caughtByCatcher,
      reachesPassLine: activePitch.reachesPassLine,
      forceCall: umpireEval.umpireCall,
    });

    recordChallengeableCall(match, {
      pitchSeq: match.stats.totalPitches,
      plateX: plateField[0],
      plateY: plateField[1],
      trueCall: umpireEval.trueCall,
      umpireCall: umpireEval.umpireCall,
      marginM: umpireEval.marginM,
      preSnapshot: preSnap,
      caughtByCatcher,
      reachesPassLine: activePitch.reachesPassLine,
    });

    if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
      showCallout('UNCAUGHT 3RD', 'DROPPED 3RD · BATTER TO 1B', '#f97316', 1.7);
      sfx.playUmpireTone('out');
    } else if (res.isWildPitch) {
      showCallout('WILD PITCH', 'WILD PITCH · RUNNERS ADVANCE', '#f97316', 1.5);
      sfx.playUmpireTone('ball');
    } else if (res.isStrike) {
      const isK = match.strikes === 0 && match.lastEvent.includes('strikes out');
      showCallout(isK ? 'STRIKE OUT!' : 'STRIKE', isK ? 'CALLED STRIKE THREE' : 'CALLED STRIKE', '#f4c41c', 1.25);
      sfx.playUmpireTone(isK ? 'out' : 'strike');
    } else {
      const isBB = match.balls === 0 && match.lastEvent.includes('walks');
      showCallout(isBB ? 'WALK (BB)' : 'BALL', isBB ? 'BASE ON BALLS' : 'OUTSIDE ZONE', '#4ade80', 1.25);
      sfx.playUmpireTone('ball');
    }

    if (isAbsChallengeEligibleForPlayer()) {
      startAbsPromptWindow();
    }
  } else {
    match.lastChallenge = null;
    const res = judgePitch({
      plateX: plateField[0],
      plateY: plateField[1],
      swung: true,
      contacted: false,
      caughtByCatcher,
      reachesPassLine: activePitch.reachesPassLine,
      currentStrikes: match.strikes,
      runnersOnBase: match.bases.some((b) => b !== null),
    });

    applyPitchResult(match, {
      plateX: plateField[0],
      plateY: plateField[1],
      swung: true,
      contacted: false,
      caughtByCatcher,
      reachesPassLine: activePitch.reachesPassLine,
    });

    if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
      showCallout('UNCAUGHT 3RD', 'DROPPED 3RD · BATTER TO 1B', '#f97316', 1.7);
      sfx.playUmpireTone('out');
    } else if (res.isWildPitch) {
      showCallout('WILD PITCH', 'WILD PITCH · RUNNERS ADVANCE', '#f97316', 1.5);
      sfx.playUmpireTone('ball');
    } else {
      const isK = match.strikes === 0 && match.lastEvent.includes('strikes out');
      const timingTitle = lastSwingTimingNote || 'SWINGING STRIKE';
      showCallout(timingTitle, isK ? 'STRIKE OUT!' : 'STRIKE', '#f4c41c', 2.4);
      sfx.playUmpireTone(isK ? 'out' : 'strike');
    }
  }

  if (match.inning !== prevInning || match.half !== prevHalf) {
    showCallout('INNING CHANGE', `${match.half === 'top' ? 'TOP' : 'BOT'} ${match.inning}`, '#38bdf8', 1.7);
    sfx.playInningChange();
  }

  enterResultPause();
}

function finishBattedPlay(): void {
  if (!activeBatted) return;

  if ((isOnline || spectating) && pendingOnlineResult) {
    const msg = pendingOnlineResult;
    pendingOnlineResult = null;
    match = msg.match;
    onlinePitchSeq = msg.nextPitchSeq;
    onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
    showCallout(msg.callout.title, msg.callout.subtitle, msg.callout.color, msg.callout.ttl);
    const outcome = msg.resolution?.outcome ?? 'OUT';
    if (outcome === 'HR') sfx.playHomeRunFanfare();
    else if (outcome === 'OUT') sfx.playUmpireTone('out');
    else if (outcome === 'FOUL') sfx.playUmpireTone('strike');
    else sfx.playUmpireTone('ball');
    if (msg.inningChanged) {
      showCallout('INNING CHANGE', `${match.half === 'top' ? 'TOP' : 'BOT'} ${match.inning}`, '#38bdf8', 1.7);
      sfx.playInningChange();
    }
    enterResultPause();
    return;
  }

  const prevInning = match.inning;
  const prevHalf = match.half;

  let outcome: ReturnType<typeof judgeBattedCap>;
  if (match.derby.active) {
    outcome = judgeBattedCap(activeBatted, { caughtInAir: battedCaughtInAir });
    applyDerbySwingResult(match, outcome === 'HR');
  } else {
    outcome = applyBattedOutcome(match, activeBatted, { caughtInAir: battedCaughtInAir });
  }

  const isBobbleHit = Boolean(activeCatchInfo?.bobbled && (outcome === '1B' || outcome === '2B' || outcome === '3B'));

  if (outcome === 'HR') {
    showCallout('HOME RUN!', `${activeBatted.maxDistanceM.toFixed(1)}m · ${lastContactMetrics ?? 'OVER WALL'}`, '#f4c41c', 3.0);
    sfx.playHomeRunFanfare();
  } else if (outcome === '3B') {
    showCallout('TRIPLE!', isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : `${lastContactMetrics ?? 'OFF WALL · 3B'}`, '#38bdf8', 2.6);
    sfx.playUmpireTone('ball');
  } else if (outcome === '2B') {
    showCallout('DOUBLE!', isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : `${lastContactMetrics ?? 'OFF WALL · 2B'}`, '#4ade80', 2.5);
    sfx.playUmpireTone('ball');
  } else if (outcome === '1B') {
    showCallout('SINGLE!', isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : `${lastContactMetrics ?? 'BASE HIT · 1B'}`, '#a3e635', 2.4);
    sfx.playUmpireTone('ball');
  } else if (outcome === 'FOUL') {
    const foulTitle = lastSwingTimingNote ?? 'FOUL';
    showCallout(foulTitle, lastContactMetrics ? `FOUL · ${lastContactMetrics}` : 'FOUL BALL', '#fb923c', 2.4);
    sfx.playUmpireTone('strike');
  } else {
    showCallout('OUT!', battedCaughtInAir ? 'OUTFIELD CATCH!' : 'INFIELD OUT!', '#f43f5e', 2.4);
    sfx.playUmpireTone('out');
  }

  if (match.inning !== prevInning || match.half !== prevHalf) {
    showCallout('INNING CHANGE', `${match.half === 'top' ? 'TOP' : 'BOT'} ${match.inning}`, '#38bdf8', 2.4);
    sfx.playInningChange();
  }

  enterResultPause();
}

function showGameOverModal(): void {
  const winLabel =
    match.winner === 'home'
      ? `${match.home.name} ${t('winsSuffix')}`
      : match.winner === 'away'
        ? `${match.away.name} ${t('winsSuffix')}`
        : t('tieGame');

  // Safe DOM construction (zero innerHTML XSS exposure)
  resultBody.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'result-summary';

  const winnerEl = document.createElement('div');
  winnerEl.className = 'result-winner';
  winnerEl.textContent = winLabel;
  wrap.appendChild(winnerEl);

  const linesEl = document.createElement('div');
  linesEl.className = 'result-lines';
  for (const team of [match.away, match.home]) {
    const box = document.createElement('div');
    box.className = 'result-team-box';
    const nameEl = document.createElement('strong');
    nameEl.textContent = team.name;
    const statsEl = document.createElement('span');
    statsEl.textContent = `${team.totalRuns} R · ${team.hits} H`;
    box.append(nameEl, statsEl);
    linesEl.appendChild(box);
  }
  wrap.appendChild(linesEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'result-meta';
  metaEl.textContent = `${t('statsPitches')}: ${match.stats.totalPitches} · ${t('statsHr')}: ${match.stats.homeRuns}`;
  wrap.appendChild(metaEl);

  resultBody.appendChild(wrap);
  if (!resultDialog.open) resultDialog.showModal();
}

function enterResultPause(): void {
  phase = 'result';
  resultDelayTimer = 1.25;
  cam.setFollowTarget(null);
  if (match.isGameOver && isOnline) {
    saveSession(null);
  }
  updateHudAndDocks();

  if (match.isGameOver) {
    showGameOverModal();
  }
}

// --- Canvas Resize ---
function resizeCanvases(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isPort = h > w;
  const aspect = w / Math.max(1, h);

  let bufW: number;
  let bufH: number;
  if (isPort) {
    bufW = 270;
    bufH = Math.max(320, Math.round(270 / aspect));
  } else {
    bufH = 270;
    bufW = Math.max(360, Math.round(270 * aspect));
  }

  let resized = false;
  if (pixelCanvas.width !== bufW || pixelCanvas.height !== bufH) {
    pixelCanvas.width = bufW;
    pixelCanvas.height = bufH;
    resized = true;
  }
  pixelCtx.imageSmoothingEnabled = false;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ovW = Math.round(w * dpr);
  const ovH = Math.round(h * dpr);
  if (overlayCanvas.width !== ovW || overlayCanvas.height !== ovH) {
    overlayCanvas.width = ovW;
    overlayCanvas.height = ovH;
    resized = true;
  }
  if (resized) {
    updateSafeCameraFraming(true);
  }
}

// --- Pointer & Keyboard Controls ---
function updateAimFromClient(clientX: number, clientY: number): void {
  const rect = overlayCanvas.getBoundingClientRect();
  const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * cam.width;
  const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * cam.height;
  const hit = cam.screenToPlaneZ(sx, sy, HIT_PLANE_Z);
  if (!hit) return;

  const role = getCurrentRole();
  const maxX = PLATE_WIDTH * 1.45;
  const x = Math.max(-maxX, Math.min(maxX, hit[0]));
  const y = Math.max(0.18, Math.min(1.38, hit[1]));

  if (role === 'pitcher' && (phase === 'idle' || phase === 'pitch_meter')) {
    pitchTarget = { x, y };
    updateBreakPreview();
  } else if (role === 'batter') {
    batCursor = { x, y };
  }
}

let pointerDownOnCanvas = false;
let activeBatTouchId: number | null = null;

overlayCanvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  pointerDownOnCanvas = true;
  updateAimFromClient(e.clientX, e.clientY);
  if (getCurrentRole() === 'batter') {
    if (e.pointerType === 'mouse' || touchSwingMode === 'instant_tap') {
      if (phase === 'windup' || phase === 'pitch_flight') {
        triggerSwing();
      }
    } else {
      // Mobile drag-and-release mode: hold & drag moves bat, release swings (quick tap also swings cleanly!)
      activeBatTouchId = e.pointerId;
    }
  }
});
window.addEventListener('pointermove', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    updateAimFromClient(e.clientX, e.clientY);
  } else if (pointerDownOnCanvas || (getCurrentRole() === 'batter' && e.pointerType === 'mouse')) {
    updateAimFromClient(e.clientX, e.clientY);
  }
});
window.addEventListener('pointerup', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    updateAimFromClient(e.clientX, e.clientY);
    activeBatTouchId = null;
    if (getCurrentRole() === 'batter' && (phase === 'windup' || phase === 'pitch_flight')) {
      triggerSwing();
    }
  }
  pointerDownOnCanvas = false;
});
window.addEventListener('pointercancel', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    activeBatTouchId = null;
  }
  pointerDownOnCanvas = false;
});

function navigateBack(): boolean {
  for (const dlg of [resultDialog, settingsDialog, rulesDialog, watchDialog, friendDialog, cpuDialog, menuDialog]) {
    if (dlg.open) {
      dlg.close();
      return true;
    }
  }
  if (onTitleScreen && onlineWaitingQueue) {
    onlineWaitingQueue = false;
    queueElapsedSec = 0;
    lobbyHub.hidden = false;
    queuePanel.hidden = true;
    if (onlineClient.connected) onlineClient.unqueue();
    updateHudAndDocks();
    return true;
  }
  if (!onTitleScreen) {
    menuDialog.showModal();
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  const targetTag = (e.target as HTMLElement | null)?.tagName ?? '';
  const inFormField = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';

  if (e.code === 'Escape' || (e.code === 'Backspace' && !inFormField)) {
    if (navigateBack()) {
      e.preventDefault();
      return;
    }
  }

  if (
    inFormField ||
    menuDialog.open ||
    cpuDialog.open ||
    friendDialog.open ||
    watchDialog.open ||
    rulesDialog.open ||
    settingsDialog.open ||
    resultDialog.open
  ) {
    return;
  }
  keysPressed.add(e.code);

  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    const role = getCurrentRole();
    if (role === 'pitcher') {
      startSpringCharge();
    } else if (role === 'batter') {
      triggerSwing();
    }
  } else if (e.code === 'KeyC') {
    triggerAbsChallenge();
  } else if (e.code >= 'Digit1' && e.code <= 'Digit4' && getCurrentRole() === 'pitcher') {
    const idx = Number(e.code.replace('Digit', '')) - 1;
    if (PITCH_IDS[idx]) selectPitch(PITCH_IDS[idx]);
  }
});
window.addEventListener('keyup', (e) => {
  keysPressed.delete(e.code);
  if (e.code === 'Space' && springMeter.stage === 'charging') {
    e.preventDefault();
    releaseSpringThrow();
  }
});
window.addEventListener('blur', () => {
  keysPressed.clear();
  cancelSpringCharge();
});

// --- UI Event Bindings ---
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mode as GameMode;
    startMode(m);
  });
}

for (const btn of pitchButtonsWrap.querySelectorAll<HTMLButtonElement>('.pitch-btn')) {
  btn.addEventListener('click', () => {
    const pid = btn.dataset.pitch as PitchId;
    selectPitch(pid);
  });
}

// Continuous Spring Pitch Launcher hold & release on both Pitch Button and Spring Chamber
function bindSpringControl(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without active pointerId
    }
    startSpringCharge();
  });
  el.addEventListener('pointerup', (e) => {
    if (springMeter.stage !== 'charging') return;
    e.preventDefault();
    releaseSpringThrow();
  });
  el.addEventListener('pointercancel', () => {
    cancelSpringCharge();
  });
}
bindSpringControl(btnThrow);
bindSpringControl(springChamberEl);

btnIbb.addEventListener('click', () => {
  if (spectating) return;
  if (isOnline) {
    if (onlineTurnState === 'awaiting_pitch' && canIntentionalWalk(match)) {
      onlineClient.sendIbb(onlinePitchSeq);
    }
    return;
  }
  if (applyIntentionalWalk(match)) {
    showCallout('INTENTIONAL WALK', 'INTENTIONAL WALK (5.01D)', '#38bdf8', 1.4);
    sfx.playUmpireTone('ball');
    updateHudAndDocks();
  }
});

btnHand.addEventListener('click', () => {
  batterHandedness = batterHandedness === 'right' ? 'left' : 'right';
  btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');
  if (isOnline && getCurrentRole() === 'batter') {
    onlineClient.setBatterSide(batterHandedness === 'right' ? 'R' : 'L');
  }
});

btnSwingType.addEventListener('click', () => {
  powerSwing = !powerSwing;
  btnSwingType.setAttribute('aria-pressed', String(powerSwing));
  btnSwingType.textContent = powerSwing ? t('btnPower') : t('btnNormal');
});

btnAbsChallenge.addEventListener('click', () => triggerAbsChallenge());

btnSound.addEventListener('click', () => {
  sfx.unlock();
  const nextMuted = !sfx.isMuted();
  sfx.setMuted(nextMuted);
  setSound.checked = !nextMuted;
  btnSound.textContent = nextMuted ? t('btnMute') : t('btnSfx');
  btnSound.setAttribute('aria-pressed', String(nextMuted));
});

btnMenu.addEventListener('click', () => {
  if (onTitleScreen && onlineWaitingQueue) {
    navigateBack();
    return;
  }
  cancelSpringCharge();
  if (isOnlineMenuTimerActive()) {
    onlineMenuTimerSec = ONLINE_MENU_TIMEOUT_SEC;
  } else {
    onlineMenuTimerSec = 0;
  }
  if (!menuDialog.open) menuDialog.showModal();
  updateOnlineMenuTimerUi();
});
btnMenuBack.addEventListener('click', () => {
  if (menuDialog.open) menuDialog.close();
});
btnMenuTitle.addEventListener('click', () => {
  if (menuDialog.open) menuDialog.close();
  returnToTitle();
});
btnResign.addEventListener('click', () => {
  if (menuDialog.open) menuDialog.close();
  if (isOnline && !spectating && !match.isGameOver) {
    onlineClient.resign();
  }
});
btnRules.addEventListener('click', () => {
  if (menuDialog.open) menuDialog.close();
  rulesDialog.showModal();
});
btnSettings.addEventListener('click', () => {
  if (menuDialog.open) menuDialog.close();
  settingsDialog.showModal();
});
btnNickChip.addEventListener('click', () => {
  settingsDialog.showModal();
  onlineNameInput.focus();
});

// --- Online UI, Lobby Hub, Load/Stability Auto-CPU Failover & Spectating ---
const savedNickRaw = localStorage.getItem('capbaseball_nick');
const savedNick = savedNickRaw && savedNickRaw !== '瓶蓋玩家' ? savedNickRaw : null;
if (savedNick) {
  onlineNameInput.value = savedNick;
  nickChipLabel.textContent = savedNick;
}
onlineNameInput.addEventListener('change', () => {
  const n = onlineNameInput.value.trim().slice(0, 16) || 'PLAYER';
  localStorage.setItem('capbaseball_nick', n);
  nickChipLabel.textContent = n;
});

function getOnlinePlayerName(): string {
  const n = onlineNameInput.value.trim().slice(0, 16);
  if (n && n !== '瓶蓋玩家') {
    localStorage.setItem('capbaseball_nick', n);
    nickChipLabel.textContent = n;
    return n;
  }
  return 'PLAYER';
}

function cancelQueueToCpu(): void {
  onlineWaitingQueue = false;
  queueElapsedSec = 0;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  if (onlineClient.connected) onlineClient.unqueue();
  updateHudAndDocks();
  if (!cpuDialog.open) cpuDialog.showModal();
}

function autoFallbackToCpu(title: string, detail: string): void {
  onlineWaitingQueue = false;
  queueElapsedSec = 0;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  if (onlineClient.connected) onlineClient.unqueue();
  if (friendDialog.open) friendDialog.close();
  startMode('quick3');
  showUnifiedPlayCall(title, detail, '#f97316', 3.4, 'AUTO CPU');
}

onlineClient.onNetUpdate((m) => {
  if (!m.connected) {
    netSpeedPill.dataset.quality = 'offline';
    netSpeedText.textContent = 'LOCAL';
    netSpeedPill.title = 'Offline / Local Mode';
  } else if (m.serverLoad !== 'green') {
    netSpeedPill.dataset.quality = 'busy';
    netSpeedText.textContent = `BUSY ${m.rttMs || '--'}ms`;
    netSpeedPill.title = `Server load: ${m.serverLoad.toUpperCase()} (${m.serverLagMs}ms lag) · RTT ${m.rttMs}ms`;
  } else {
    netSpeedPill.dataset.quality = m.quality;
    netSpeedText.textContent = m.rttMs > 0 ? `${m.rttMs}ms` : 'SYNC';
    netSpeedPill.title = `RTT ${m.rttMs}ms · Jitter ${m.jitterMs}ms · Server GREEN`;
  }

  // If queuing and connection drops/becomes unstable OR server becomes busy -> auto-match CPU!
  if (onTitleScreen && onlineWaitingQueue) {
    if (!m.connected || m.quality === 'poor') {
      autoFallbackToCpu('UNSTABLE NET', 'AUTO-MATCHED VS CPU');
    } else if (m.serverLoad !== 'green') {
      autoFallbackToCpu('SERVER BUSY', 'AUTO-MATCHED VS CPU');
    }
  }
});

btnHubPlay.addEventListener('click', async () => {
  sfx.unlock();

  // Pre-check server green-zone load & network stability before queuing
  if (onlineClient.connected && onlineClient.isServerBusy) {
    autoFallbackToCpu('SERVER BUSY', 'AUTO-MATCHED VS CPU');
    return;
  }
  if (onlineClient.connected && onlineClient.isUnstable) {
    autoFallbackToCpu('UNSTABLE NET', 'AUTO-MATCHED VS CPU');
    return;
  }

  lobbyHub.hidden = true;
  queuePanel.hidden = false;
  onlineWaitingQueue = true;
  queueElapsedSec = 0;
  queueStatusText.textContent = 'FINDING OPPONENT 0:00...';
  updateHudAndDocks();
  try {
    await onlineClient.connect(getOnlinePlayerName(), 4500);
    if (onlineClient.isServerBusy) {
      autoFallbackToCpu('SERVER BUSY', 'AUTO-MATCHED VS CPU');
      return;
    }
    if (onlineClient.isUnstable) {
      autoFallbackToCpu('UNSTABLE NET', 'AUTO-MATCHED VS CPU');
      return;
    }
    onlineClient.queue(onlineModeChoice, getOnlinePlayerName());
  } catch {
    autoFallbackToCpu('UNSTABLE NET', 'AUTO-MATCHED VS CPU');
  }
});

btnQueueCancel.addEventListener('click', () => {
  onlineWaitingQueue = false;
  queueElapsedSec = 0;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  if (onlineClient.connected) onlineClient.unqueue();
  updateHudAndDocks();
});

btnQueueCpu.addEventListener('click', () => cancelQueueToCpu());

btnHubFriend.addEventListener('click', async () => {
  sfx.unlock();
  roomCreatedBox.hidden = true;
  friendStatusMsg.textContent = 'CONNECTING TO SERVER...';
  if (!friendDialog.open) friendDialog.showModal();
  try {
    await onlineClient.connect(getOnlinePlayerName());
    friendStatusMsg.textContent = 'CONNECTED · CREATE OR JOIN A ROOM';
  } catch {
    friendStatusMsg.textContent = 'UNABLE TO REACH SERVER';
  }
});

function setWatchMessage(text: string): void {
  watchListEl.replaceChildren();
  const p = document.createElement('p');
  p.className = 'watch-empty';
  p.textContent = text;
  watchListEl.appendChild(p);
}

btnHubWatch.addEventListener('click', async () => {
  sfx.unlock();
  setWatchMessage('LOADING LIVE MATCHES...');
  if (!watchDialog.open) watchDialog.showModal();
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.listRooms();
  } catch {
    setWatchMessage('UNABLE TO REACH SERVER');
  }
});

btnWatchRefresh.addEventListener('click', async () => {
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.listRooms();
  } catch {
    setWatchMessage('UNABLE TO REACH SERVER');
  }
});

btnRoomCreate.addEventListener('click', async () => {
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.createRoom(onlineModeChoice, getOnlinePlayerName());
    friendStatusMsg.textContent = 'CREATING ROOM...';
  } catch {
    friendStatusMsg.textContent = 'CONNECTION FAILED';
  }
});

btnRoomJoin.addEventListener('click', async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    friendStatusMsg.textContent = 'ENTER A 4-CHAR ROOM CODE';
    return;
  }
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.joinRoom(code, getOnlinePlayerName());
    friendStatusMsg.textContent = `JOINING ROOM ${code}...`;
  } catch {
    friendStatusMsg.textContent = 'CONNECTION FAILED';
  }
});

btnCopyCode.addEventListener('click', () => {
  const code = roomCodeDisplay.textContent?.trim() || '';
  if (code) {
    void navigator.clipboard?.writeText(code);
    friendStatusMsg.textContent = `COPIED CODE ${code}`;
  }
});

btnCopyLink.addEventListener('click', () => {
  const code = roomCodeDisplay.textContent?.trim() || '';
  if (code) {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    void navigator.clipboard?.writeText(url);
    friendStatusMsg.textContent = 'INVITE LINK COPIED';
  }
});

function renderWatchRooms(rooms: LiveRoomInfo[]): void {
  watchListEl.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'watch-empty';
    empty.textContent = 'NO LIVE MATCHES RIGHT NOW';
    watchListEl.appendChild(empty);
    return;
  }
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'watch-item';
    const inningTxt = r.isDerby ? 'HR DERBY' : `${r.half === 'top' ? 'TOP' : 'BOT'} ${r.inning}`;
    const infoSpan = document.createElement('span');
    infoSpan.textContent = `${r.awayName} ${r.awayScore}-${r.homeScore} ${r.homeName} · ${inningTxt} · ${r.spectators} LIVE`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'act-btn primary';
    btn.textContent = 'WATCH';
    btn.addEventListener('click', () => {
      onlineClient.watchRoom(r.code);
    });
    row.append(infoSpan, btn);
    watchListEl.appendChild(row);
  }
}

function enterOnlineMatch(
  msg: Extract<ServerMessage, { type: 'match_start' | 'state_sync' }>,
): void {
  isOnline = true;
  spectating = false;
  onlineWaitingQueue = false;
  queueElapsedSec = 0;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  onlineSide = msg.side;
  onlineRoomCode = msg.code;
  onlinePitchSeq = msg.pitchSeq;
  onlineTurnState = msg.turnState;
  pendingOnlineResult = null;
  queuedOnlinePitchResult = null;
  match = msg.match;
  batterHandedness = msg.batterSide === 'L' ? 'left' : 'right';
  btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');

  onTitleScreen = false;
  titleScreen.hidden = true;
  scoreboardEl.hidden = false;
  if (friendDialog.open) friendDialog.close();
  if (watchDialog.open) watchDialog.close();
  if (resultDialog.open) resultDialog.close();

  phase = match.isGameOver ? 'result' : 'idle';
  pitcherFrame = 0;
  batterAnim = 'ready';
  batterAnimTime = 0;
  capVisible = false;
  capTrail = [];
  hitFx = null;
  callout = null;
  swingFeedbackCardState = null;
  swingFeedbackCard.hidden = true;
  absPromptTimer = 0;
  absReplay = null;
  cam.resetImmediate();
  resetOutfielders(outfielders);
  selectPitch('straight');
  pendingPitchTelemetry = '';
  lastPitchTelemetry = getCurrentRole() === 'pitcher' ? t('telYourPitch') : t('telWaitingPitch');
  resetPitchClock();
  updateHudAndDocks();
  updateSafeCameraFraming(true);
  if (match.isGameOver) {
    saveSession(null);
    showGameOverModal();
  }
}

function enterSpectateMatch(msg: Extract<ServerMessage, { type: 'spectate_sync' }>): void {
  isOnline = true;
  spectating = true;
  onlineWaitingQueue = false;
  onlineSide = null;
  onlineRoomCode = msg.code;
  onlinePitchSeq = msg.pitchSeq;
  onlineTurnState = msg.turnState;
  pendingOnlineResult = null;
  queuedOnlinePitchResult = null;
  match = msg.match;
  batterHandedness = msg.batterSide === 'L' ? 'left' : 'right';
  btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');

  onTitleScreen = false;
  titleScreen.hidden = true;
  scoreboardEl.hidden = false;
  if (watchDialog.open) watchDialog.close();
  if (resultDialog.open) resultDialog.close();

  phase = match.isGameOver ? 'result' : 'idle';
  pitcherFrame = 0;
  batterAnim = 'ready';
  batterAnimTime = 0;
  capVisible = false;
  capTrail = [];
  hitFx = null;
  callout = null;
  absPromptTimer = 0;
  absReplay = null;
  cam.resetImmediate();
  resetOutfielders(outfielders);
  lastPitchTelemetry = t('telLiveSpectate');
  if (msg.activePitch) {
    const p = msg.activePitch;
    launchPitch(p.pitchId, p.speedKmh, p.targetX, p.targetY, p.errorX, p.errorY, p.seed);
  }
  updateHudAndDocks();
  updateSafeCameraFraming(true);
  if (match.isGameOver) {
    showGameOverModal();
  }
}

function applyOnlinePitchResult(msg: PitchResultMsg): void {
  lastPitchTelemetry = msg.telemetry;

  if (msg.ibb || msg.clockViolation) {
    match = msg.match;
    onlinePitchSeq = msg.nextPitchSeq;
    onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
    resetSpringMeter();
    showCallout(msg.callout.title, msg.callout.subtitle, msg.callout.color, msg.callout.ttl);
    sfx.playUmpireTone('ball');
    enterResultPause();
    return;
  }

  if (msg.resolution && msg.resolution.contact) {
    // Defer applying msg.match until finishBattedPlay() so:
    // 1) match.isGameOver does NOT freeze batted_flight before finishBattedPlay -> showGameOverModal
    // 2) match.half / scoreboard runs don't spoil or swap team colors mid-flight!
    const res = msg.resolution;
    pendingOnlineResult = msg;
    activeBatted = simulateBattedCap(res.battedParams);
    activeCatchInfo = (res.catchInfo as CatchInfo | undefined) ?? null;
    bobbledTriggered = false;
    const ev = Math.round(res.exitSpeedKmh);
    const [bvx, bvy, bvz] = res.battedParams.velocity;
    const la = Math.round((Math.atan2(bvy, Math.hypot(bvx, bvz)) * 180) / Math.PI);
    showSwingFeedback(res.quality.toUpperCase(), `EV ${ev} km/h · LA ${la}°`, res.color);

    if (getCurrentRole() === 'pitcher' || spectating) {
      batterAnim = 'swing_contact';
      batterAnimTime = 0;
      batterSwungThisPitch = true;
    }
    sfx.playBatCrack(
      activeBatted.overFence
        ? 'hr'
        : res.quality === 'perfect'
          ? 'perfect'
          : res.quality === 'good'
            ? 'good'
            : 'weak',
    );
    cam.addShake(activeBatted.overFence ? 0.08 : 0.035, 0.22);
    hitFx = {
      active: true,
      pos: [res.hitField[0], res.hitField[1], HIT_PLANE_Z],
      kind: activeBatted.overFence ? 'hr_burst' : 'hit',
      elapsedSec: 0,
    };
    phase = 'batted_flight';
    battedFlightTime = 0;
    battedCaughtInAir = false;
    battedBouncesPlayed = 0;
    battedFencePlayed = false;
    battedHrBurstPlayed = false;
    bounceRings = [];
    fenceImpact = null;
    hrBurst = null;
    fenceFlashAlpha = 0;
    capTrail = [];
    updateHudAndDocks();
    return;
  }

  // No contact (strike / ball / uncaught 3rd / wild pitch)
  match = msg.match;
  onlinePitchSeq = msg.nextPitchSeq;
  onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
  if ((getCurrentRole() === 'pitcher' || spectating) && msg.swung) {
    batterAnim = 'follow_through';
    batterAnimTime = 0;
    batterSwungThisPitch = true;
  }
  showCallout(msg.callout.title, msg.callout.subtitle, msg.callout.color, msg.callout.ttl);
  if (msg.outcome === 'BALL') {
    sfx.playUmpireTone('ball');
  } else if (msg.outcome === 'UNCAUGHT_THIRD_STRIKE') {
    sfx.playUmpireTone('out');
  } else {
    sfx.playUmpireTone('strike');
  }
  if (msg.inningChanged) {
    showCallout('INNING CHANGE', `${match.half === 'top' ? t('callTop') : t('callBot')} ${match.inning}`, '#38bdf8', 1.7);
    sfx.playInningChange();
  }
  if (!msg.swung && match.lastChallenge && !match.lastChallenge.challenged) {
    if (!spectating && onlineSide === match.lastChallenge.eligibleSide && match.absChallenges[onlineSide] > 0) {
      startAbsPromptWindow();
    }
  }
  enterResultPause();
}

onlineClient.onMessage((msg) => {
  switch (msg.type) {
    case 'welcome': {
      topOnlinePill.textContent = `${t('livePrefix')} ${msg.stats.online}`;
      handleServerVersion(msg.version);
      break;
    }
    case 'stats': {
      topOnlinePill.textContent = `${t('livePrefix')} ${msg.stats.online}`;
      break;
    }
    case 'room_created': {
      saveSession({ code: msg.code, token: msg.token });
      roomCodeDisplay.textContent = msg.code;
      roomCreatedBox.hidden = false;
      if (!friendDialog.open) friendDialog.showModal(); // also after resuming a waiting room
      friendStatusMsg.textContent = `ROOM ${msg.code} READY · WAITING FOR FRIEND...`;
      break;
    }
    case 'room_joined': {
      saveSession({ code: msg.code, token: msg.token });
      friendStatusMsg.textContent = `JOINED ROOM ${msg.code}`;
      break;
    }
    case 'match_start': {
      saveSession({ code: msg.code, token: msg.token });
      enterOnlineMatch(msg);
      break;
    }
    case 'state_sync': {
      enterOnlineMatch(msg);
      if (msg.activePitch) {
        const p = msg.activePitch;
        onlineTurnState = 'awaiting_swing';
        launchPitch(p.pitchId, p.speedKmh, p.targetX, p.targetY, p.errorX, p.errorY, p.seed);
      }
      break;
    }
    case 'room_list': {
      renderWatchRooms(msg.rooms);
      break;
    }
    case 'spectate_sync': {
      enterSpectateMatch(msg);
      break;
    }
    case 'unwatched': {
      spectating = false;
      break;
    }
    case 'batter_side': {
      batterHandedness = msg.side === 'L' ? 'left' : 'right';
      btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');
      break;
    }
    case 'pitch_launch': {
      const p: PitchLaunchMsg = msg;
      onlinePitchSeq = p.pitchSeq;
      onlineTurnState = 'awaiting_swing';
      batterHandedness = p.batterSide === 'L' ? 'left' : 'right';
      btnHand.textContent = batterHandedness === 'right' ? t('btnRhb') : t('btnLhb');
      launchPitch(p.pitchId, p.speedKmh, p.targetX, p.targetY, p.errorX, p.errorY, p.seed);
      break;
    }
    case 'pitch_result': {
      if (msg.ibb || msg.clockViolation) {
        queuedOnlinePitchResult = null;
        applyOnlinePitchResult(msg);
      } else if (phase === 'windup' || phase === 'pitch_flight') {
        // Queue until local pitch visually arrives at contact/plate so pitcher sees pitch + batter swing in order!
        queuedOnlinePitchResult = msg;
      } else if (
        phase === 'awaiting_result' &&
        (getCurrentRole() === 'pitcher' || spectating) &&
        msg.swung &&
        !batterSwungThisPitch
      ) {
        // Play visible swing buildup (load -> swing_early -> swing_contact) before launching batted_flight!
        queuedOnlinePitchResult = msg;
        batterSwungThisPitch = true;
        batterAnim = 'load';
        batterAnimTime = 0;
      } else {
        queuedOnlinePitchResult = null;
        applyOnlinePitchResult(msg);
      }
      break;
    }
    case 'abs_result': {
      match = msg.match;
      onlinePitchSeq = msg.pitchSeq;
      onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
      absPromptTimer = 0;
      callout = null;
      absReplay = {
        active: true,
        plateX: msg.plateX,
        plateY: msg.plateY,
        trueCall: msg.trueCall,
        umpireCall: msg.umpireCall,
        overturned: msg.overturned,
        marginCm: msg.marginCm,
        elapsedSec: 0,
        durationSec: 2.2,
      };
      sfx.playUmpireTone(msg.overturned ? 'ball' : 'strike');
      if (match.isGameOver) saveSession(null);
      else resetPitchClock();
      updateHudAndDocks();
      if (match.isGameOver) showGameOverModal();
      break;
    }
    case 'opponent_disconnected': {
      showCallout(t('callOpponentOffline'), `${t('callWaitingReconnect')} (${msg.graceSec}s)...`, '#f97316', 3.0);
      break;
    }
    case 'opponent_reconnected': {
      showCallout(t('callReconnected'), t('callPlayBall'), '#4ade80', 1.4);
      break;
    }
    case 'match_over': {
      queuedOnlinePitchResult = null;
      pendingOnlineResult = null;
      match = msg.match;
      onlineTurnState = 'game_over';
      phase = 'result';
      cam.setFollowTarget(null);
      saveSession(null);
      updateHudAndDocks();
      showGameOverModal();
      break;
    }
    case 'rematch_requested': {
      showCallout(t('rematchReqTitle'), t('rematchReqSub'), '#f4c41c', 2.0);
      break;
    }
    case 'notice': {
      if (msg.kind === 'draining') {
        showCallout(t('callMaintenance'), t('callMaintenanceSub'), '#38bdf8', 3.0);
      }
      break;
    }
    case 'error': {
      friendStatusMsg.textContent = msg.message;
      if (msg.code === 'server_busy') {
        autoFallbackToCpu('SERVER BUSY', 'AUTO-MATCHED VS CPU');
      } else if (msg.code === 'reconnect_failed') {
        saveSession(null);
      } else if (msg.code === 'opponent_left') {
        showCallout(t('callOpponentLeft'), msg.message.toUpperCase(), '#f97316', 2.2);
        saveSession(null);
      }
      break;
    }
  }
});

setLanguage.addEventListener('change', () => {
  const v = setLanguage.value;
  if (v === 'auto' || v === 'zh-TW' || v === 'ja' || v === 'en') {
    localePref = v;
    saveLocalePref(localePref);
    locale = getActiveLocale(localePref);
    t = createTranslator(locale);
    applyLocaleToDom();
  }
});
setTouchSwing.addEventListener('change', () => {
  const v = setTouchSwing.value;
  if (v === 'drag_release' || v === 'instant_tap') {
    touchSwingMode = v;
    try {
      localStorage.setItem(TOUCH_SWING_KEY, v);
    } catch {
      // ignore
    }
  }
});
setDifficulty.addEventListener('change', () => {
  difficulty = Number(setDifficulty.value) || 3;
});
setGuideRing.addEventListener('change', () => {
  showGuideRing = setGuideRing.checked;
});
setBreakPreview.addEventListener('change', () => {
  showBreakPreview = setBreakPreview.checked;
  updateBreakPreview();
  updateHudAndDocks();
});
setSound.addEventListener('change', () => {
  const muted = !setSound.checked;
  sfx.setMuted(muted);
  btnSound.textContent = muted ? t('btnMute') : t('btnSfx');
  btnSound.setAttribute('aria-pressed', String(muted));
});

// Dialog close & Safari closedby="any" fallback (modern-web-guidance 'dialog')
for (const dlg of [menuDialog, cpuDialog, friendDialog, watchDialog, rulesDialog, settingsDialog, resultDialog]) {
  dlg.addEventListener('close', () => {
    const val = dlg.returnValue;
    dlg.returnValue = '';
    if (dlg === resultDialog) {
      if (val === 'rematch') {
        if (isOnline && !spectating) {
          onlineClient.rematch();
          showCallout('REMATCH SENT', 'WAITING FOR OPPONENT...', '#f4c41c', 2.0);
        } else {
          startMode(match.mode);
        }
      } else if (val === 'menu') {
        returnToTitle();
      }
    }
  });
}

if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e: PointerEvent, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

// --- Main Simulation & Render Loop ---
let lastTime = performance.now();

function step(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  const timeSec = now / 1000;

  resizeCanvases();

  // Matchmaking 10s fallback timer
  if (onTitleScreen && onlineWaitingQueue) {
    queueElapsedSec += dt;
    const secs = Math.floor(queueElapsedSec);
    queueStatusText.textContent = `FINDING OPPONENT 0:${String(secs).padStart(2, '0')}...`;
    if (queueElapsedSec >= 10) {
      cancelQueueToCpu();
    }
  }

  // Smooth strike zone fade (fades to 0 as soon as pitch_flight begins)
  const targetSzAlpha =
    !onTitleScreen && (phase === 'idle' || phase === 'pitch_meter' || phase === 'windup') ? 1 : 0;
  strikeZoneAlpha += (targetSzAlpha - strikeZoneAlpha) * Math.min(1, dt * 14);

  const paused = isGamePaused();

  if (!paused) {
    // Online mode menu pause countdown: force-close menu/rules/settings when timer hits 0 so match resumes
    if (isOnlineMenuTimerActive() && (menuDialog.open || rulesDialog.open || settingsDialog.open)) {
      if (onlineMenuTimerSec <= 0) {
        onlineMenuTimerSec = ONLINE_MENU_TIMEOUT_SEC;
      }
      onlineMenuTimerSec = Math.max(0, onlineMenuTimerSec - dt);
      updateOnlineMenuTimerUi();
      if (onlineMenuTimerSec <= 0) {
        if (rulesDialog.open) rulesDialog.close();
        if (settingsDialog.open) settingsDialog.close();
        if (menuDialog.open) menuDialog.close();
        menuOnlineTimerEl.hidden = true;
        showCallout(t('callMenuTimeout'), t('callResumingMatch'), '#f97316', 2.0);
      }
    } else if (onlineMenuTimerSec > 0) {
      onlineMenuTimerSec = 0;
      menuOnlineTimerEl.hidden = true;
    }

    // ABS prompt & replay decay (synchronized with Play Call card fade-out)
    if (absPromptTimer > 0) {
      absPromptTimer = Math.max(0, absPromptTimer - dt);
      if (absPromptTimer === 0) {
        btnAbsChallenge.hidden = true;
        btnAbsChallenge.style.opacity = '1';
        updateHudAndDocks();
      } else if (absPromptTimer < 0.4) {
        btnAbsChallenge.style.opacity = String(absPromptTimer / 0.4);
      } else {
        btnAbsChallenge.style.opacity = '1';
      }
    }
    if (absReplay && absReplay.active) {
      absReplay.elapsedSec += dt;
      if (absReplay.elapsedSec >= absReplay.durationSec) {
        absReplay = null;
        updateHudAndDocks();
      }
    }

    // Decay batted-ball visual effects
    bounceRings = bounceRings.filter((r) => {
      r.ageSec += dt;
      return r.ageSec < r.maxAgeSec;
    });
    if (fenceImpact) {
      fenceImpact.ageSec += dt;
      if (fenceImpact.ageSec >= fenceImpact.maxAgeSec) fenceImpact = null;
    }
    if (hrBurst) {
      hrBurst.ageSec += dt;
      if (hrBurst.ageSec >= hrBurst.maxAgeSec) hrBurst = null;
    }
    if (fenceFlashAlpha > 0) {
      fenceFlashAlpha = Math.max(0, fenceFlashAlpha - dt * 2.2);
      if (fenceFlashAlpha === 0) fenceFlashAngle = undefined;
    }

    // Keyboard cursor movement
    const moveSpd = 0.85 * dt;
    let kx = 0;
    let ky = 0;
    if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) kx -= 1;
    if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) kx += 1;
    if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) ky += 1;
    if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) ky -= 1;
    if (kx !== 0 || ky !== 0) {
      if (getCurrentRole() === 'batter') {
        batCursor.x = Math.max(-0.35, Math.min(0.35, batCursor.x + kx * moveSpd));
        batCursor.y = Math.max(0.22, Math.min(1.25, batCursor.y + ky * moveSpd));
      } else if (getCurrentRole() === 'pitcher' && phase === 'idle') {
        pitchTarget.x = Math.max(-0.35, Math.min(0.35, pitchTarget.x + kx * moveSpd));
        pitchTarget.y = Math.max(0.22, Math.min(1.25, pitchTarget.y + ky * moveSpd));
        updateBreakPreview();
      }
    }

    // Decay UI callout & swing feedback card
    if (callout) {
      callout.ttl -= dt;
      if (callout.ttl <= 0) callout = null;
    }
    if (swingFeedbackCardState) {
      swingFeedbackCardState.ttl -= dt;
      if (swingFeedbackCardState.ttl <= 0) {
        swingFeedbackCardState = null;
        swingFeedbackCard.hidden = true;
        if (absPromptTimer > 0) {
          absPromptTimer = 0;
          btnAbsChallenge.hidden = true;
          btnAbsChallenge.style.opacity = '1';
        }
        updateHudAndDocks();
      } else if (swingFeedbackCardState.ttl < 0.4) {
        swingFeedbackCard.style.opacity = String(swingFeedbackCardState.ttl / 0.4);
      } else {
        swingFeedbackCard.style.opacity = '1';
      }
    }
    if (hitFx && hitFx.active) {
      hitFx.elapsedSec += dt;
      if (hitFx.elapsedSec > 0.45) hitFx.active = false;
    }

    // Pitch Clock tick (15s bases empty / 20s runners on base; paused during Play Call, ABS, or Menu pause)
    if (isPitchClockEnabled()) {
      const clockPhaseActive =
        phase === 'idle' || (phase === 'pitch_meter' && springMeter.stage === 'charging');
      const clockRunning =
        clockPhaseActive &&
        !isPlayCallActive() &&
        (!isOnline || onlineTurnState === 'awaiting_pitch');
      if (clockRunning) {
        pitchClockSec = Math.max(0, pitchClockSec - dt);
        const whole = Math.ceil(pitchClockSec);
        if (whole < pitchClockLastWhole) {
          pitchClockLastWhole = whole;
          if (whole > 0 && whole <= 5) {
            sfx.playClockTick(whole <= 2);
          }
        }
        if (pitchClockSec <= 0 && !isOnline && !spectating) {
          resetSpringMeter();
          const res = applyPitchClockViolation(match);
          if (res.applied) {
            sfx.playUmpireTone('ball');
            showCallout('PITCH CLOCK', res.walked ? 'WALK (BB)' : 'AUTO BALL', '#f97316', 2.2);
            enterResultPause();
          }
        }
      }
      updatePitchClockUi(clockRunning);
    } else {
      updatePitchClockUi(false);
    }

    // Phase updates (always allow in-flight batted_flight and result to finish even if match.isGameOver!)
    if (!onTitleScreen && (!match.isGameOver || phase === 'batted_flight' || phase === 'result')) {
      if (phase === 'idle') {
        batterAnimTime += dt;
        if (!isOnline && !spectating && getCurrentRole() === 'batter' && match.mode !== 'hotseat2p') {
          if (!isPlayCallActive()) {
            cpuAutoPitchTimer -= dt;
            if (cpuAutoPitchTimer <= 0) {
              const choice = chooseCpuPitch(difficulty, match.balls, match.strikes);
              launchPitch(choice.pitchId, choice.speedKmh, choice.targetX, choice.targetY, choice.scatterX, choice.scatterY);
            }
          }
        }
      } else if (phase === 'pitch_meter') {
      batterAnimTime += dt;
      if (springMeter.stage === 'charging') {
        if (springMeter.charge < 0.995) {
          // Smooth continuous spring compression (~1.14s from 0 -> 100%)
          springMeter.charge = Math.min(1, springMeter.charge + dt * 0.88);
        } else {
          // Tight tremor when held at maximum compression
          springMeter.overOsc += dt * 26;
          springMeter.charge = 0.96 + Math.sin(springMeter.overOsc) * 0.04;
        }
        renderSpringMeterUi();
      } else if (springMeter.stage === 'rebounding') {
        springMeter.reboundTime += dt;
        const u = Math.max(0, Math.min(1, springMeter.reboundTime / Math.max(0.05, springMeter.reboundDur)));
        // Fast spring launch decelerating smoothly to the exact apex (highest point)
        springMeter.pos = springMeter.peak * (1 - Math.pow(1 - u, 3));
        renderSpringMeterUi();
        if (u >= 1) {
          springMeter.pos = springMeter.peak;
          springMeter.stage = 'locked';
          renderSpringMeterUi();
        }
      } else if (springMeter.stage === 'locked') {
        springMeter.lockTimer -= dt;
        if (springMeter.lockTimer <= 0) {
          commitSpringPitch(springMeter.peak);
        }
      }
    } else if (phase === 'windup') {
      batterAnimTime += dt;
      windupTime += dt;
      pitcherFrame = 8 + windupTime * 28;
      if (pitcherFrame >= sprites.pitcherMeta.release_frame) {
        phase = 'pitch_flight';
        pitchFlightTime = 0;
        capVisible = true;
        sfx.playPitchWhoosh();
        updateHudAndDocks();
      }
    } else if (phase === 'pitch_flight' && activePitch) {
      windupTime += dt;
      pitcherFrame = Math.min(59, 8 + windupTime * 28);
      pitchFlightTime += dt;

      const f = activePitch.sampleAt(pitchFlightTime);
      capPos = simToField([f.y[0], f.y[1], f.y[2]]);
      capNormalField = simNormalToField(f.normalWorld);
      capTrail.push(capPos);
      if (capTrail.length > 8) capTrail.shift();

      if (cpuSwingPlan && cpuSwingPlan.shouldSwing && !batterSwungThisPitch && pitchFlightTime >= cpuSwingPlan.swingTimeSec) {
        batCursor = { x: cpuSwingPlan.aimX, y: cpuSwingPlan.aimY };
        triggerSwing();
      }

      // Online pitcher/spectator: start visible batter swing buildup 110ms before queued contact/plate time
      let queuedContactT = activePitch.flightTimeSec;
      if ((isOnline || spectating) && queuedOnlinePitchResult) {
        const q = queuedOnlinePitchResult;
        queuedContactT =
          q.resolution && q.resolution.contact
            ? Math.max(0.12, Math.min(activePitch.flightTimeSec, activePitch.hitPlaneTimeSec + (q.resolution.dtTiming ?? 0)))
            : activePitch.flightTimeSec;
        if (
          (getCurrentRole() === 'pitcher' || spectating) &&
          q.swung &&
          !batterSwungThisPitch &&
          pitchFlightTime >= Math.max(0.02, queuedContactT - 0.11)
        ) {
          batterSwungThisPitch = true;
          batterAnim = 'load';
          batterAnimTime = 0;
        }
      }

      if (batterSwungThisPitch) {
        batterAnimTime += dt;
        if (batterAnim === 'load' && batterAnimTime >= 0.06) {
          batterAnim = 'swing_early';
          batterAnimTime = 0;
        } else if (batterAnim === 'swing_early' && batterAnimTime >= 0.05) {
          batterAnim = 'swing_contact';
          batterAnimTime = 0;
          if (!swingChecked) {
            swingChecked = true;
            if (isOnline && !spectating) {
              if (getCurrentRole() === 'batter') {
                onlineNoSwingSentForSeq = onlinePitchSeq;
                onlineClient.sendSwingInput({
                  pitchSeq: onlinePitchSeq,
                  flightTimeSec: pitchFlightTime,
                  batX: batCursor.x,
                  batY: batCursor.y,
                  swingMode: powerSwing ? 'power' : 'normal',
                  batterSide: batterHandedness === 'right' ? 'R' : 'L',
                });
                phase = 'awaiting_result';
                updateHudAndDocks();
              }
            } else if (!isOnline) {
              resolveContact(pitchFlightTime - activePitch.hitPlaneTimeSec);
            }
          }
        } else if (batterAnim === 'swing_contact' && batterAnimTime >= 0.07) {
          batterAnim = 'follow_through';
          batterAnimTime = 0;
        }
      } else {
        batterAnimTime += dt;
      }

      // Consume queued online pitch_result at contact/plate arrival (after batter swing is visibly underway!)
      if (phase === 'pitch_flight' && (isOnline || spectating) && queuedOnlinePitchResult && pitchFlightTime >= queuedContactT) {
        const q = queuedOnlinePitchResult;
        if (
          (getCurrentRole() === 'pitcher' || spectating) &&
          q.swung &&
          batterAnim !== 'swing_contact' &&
          batterAnim !== 'follow_through'
        ) {
          if (!batterSwungThisPitch) {
            batterSwungThisPitch = true;
            batterAnim = 'load';
            batterAnimTime = 0;
          }
          phase = 'awaiting_result';
          updateHudAndDocks();
        } else {
          queuedOnlinePitchResult = null;
          applyOnlinePitchResult(q);
        }
      } else if (phase === 'pitch_flight' && pitchFlightTime >= activePitch.flightTimeSec) {
        if (isOnline || spectating) {
          if (isOnline && !spectating && getCurrentRole() === 'batter' && onlineNoSwingSentForSeq !== onlinePitchSeq) {
            onlineNoSwingSentForSeq = onlinePitchSeq;
            onlineClient.sendNoSwing(onlinePitchSeq);
          }
          phase = 'awaiting_result';
          updateHudAndDocks();
        } else {
          finishPitchWithoutContact();
        }
      }
    } else if (phase === 'awaiting_result') {
      batterAnimTime += dt;
      if (batterSwungThisPitch) {
        if (batterAnim === 'load' && batterAnimTime >= 0.06) {
          batterAnim = 'swing_early';
          batterAnimTime = 0;
        } else if (batterAnim === 'swing_early' && batterAnimTime >= 0.05) {
          batterAnim = 'swing_contact';
          batterAnimTime = 0;
          if (queuedOnlinePitchResult) {
            const q = queuedOnlinePitchResult;
            queuedOnlinePitchResult = null;
            applyOnlinePitchResult(q);
          }
        } else if (batterAnim === 'swing_contact' && batterAnimTime >= 0.07) {
          batterAnim = 'follow_through';
          batterAnimTime = 0;
        }
      }
      if (phase === 'awaiting_result' && queuedOnlinePitchResult && !queuedOnlinePitchResult.swung) {
        const q = queuedOnlinePitchResult;
        queuedOnlinePitchResult = null;
        applyOnlinePitchResult(q);
      }
    } else if (phase === 'batted_flight' && activeBatted) {
      battedFlightTime += dt;
      batterAnimTime += dt;
      if (batterAnim === 'swing_contact' && batterAnimTime >= 0.07) {
        batterAnim = 'follow_through';
        batterAnimTime = 0;
      }

      const frames = activeBatted.frames;
      let cur = frames[frames.length - 1];
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].t >= battedFlightTime) {
          cur = frames[i];
          break;
        }
      }
      capPos = cur.pos;
      capTrail.push(capPos);
      if (capTrail.length > 10) capTrail.shift();

      const spinA = battedFlightTime * 24;
      capNormalField = [Math.sin(spinA) * 0.4, Math.cos(spinA * 0.7), 0.3];

      // Hold home-plate broadcast view for 180ms so pitcher/spectator clearly sees batter swing & contact before chase cam pans
      if (battedFlightTime >= 0.18) {
        cam.setFollowTarget(capPos);
      }

      const radialDist = Math.hypot(capPos[0], capPos[2]);

      // Floor bounce ripple ring
      if (capPos[1] <= 0.035 && battedBouncesPlayed < activeBatted.bounces) {
        battedBouncesPlayed += 1;
        totalBounceEvents += 1;
        sfx.playFloorBounce();
        bounceRings.push({
          pos: [capPos[0], 0.015, capPos[2]],
          ageSec: 0,
          maxAgeSec: 0.75,
          infield: isInfield(capPos[0], capPos[2]),
        });
      }

      // Fence impact shockwave + flash + concise callout
      if (!battedFencePlayed && activeBatted.hitFence && radialDist >= FENCE_DIST - 0.35) {
        battedFencePlayed = true;
        totalFenceHits += 1;
        sfx.playFenceHit();
        fenceFlashAngle = Math.atan2(capPos[0], -capPos[2]);
        fenceFlashAlpha = 1.0;
        fenceImpact = { pos: [...capPos], ageSec: 0, maxAgeSec: 0.5 };
        const tag = activeBatted.bouncesBeforeFence === 0 ? 'OFF THE WALL · 3B' : 'BOUNCE OFF WALL · 2B';
        showCallout(tag, '', '#38bdf8', 1.1);
      }

      // Over-fence HR clearance burst + HR pixel FX + screen shake
      if (!battedHrBurstPlayed && activeBatted.overFence && radialDist >= FENCE_DIST - 0.1 && capPos[1] > FENCE_HEIGHT) {
        battedHrBurstPlayed = true;
        totalHrBursts += 1;
        const burstPos: FieldV3 = [capPos[0], FENCE_HEIGHT + 0.15, capPos[2]];
        hrBurst = { pos: burstPos, ageSec: 0, maxAgeSec: 0.65 };
        hitFx = { active: true, pos: burstPos, kind: 'hr_burst', elapsedSec: 0 };
        cam.addShake(0.09, 0.35);
      }

      const landedBefore = activeBatted.firstLandingPos !== null && battedFlightTime > 0.25 && capPos[1] <= 0.04;
      const airborne = !landedBefore && battedBouncesPlayed === 0;
      const landingTarget = activeBatted.firstLandingPos ?? activeBatted.stoppedPos;
      updateOutfielders(outfielders, dt, capPos, landingTarget, airborne, battedCaughtInAir, battedFlightTime);

      if (
        activeCatchInfo?.caught &&
        !battedCaughtInAir &&
        activeCatchInfo.catchTimeSec !== null &&
        battedFlightTime >= activeCatchInfo.catchTimeSec
      ) {
        const fIdx = activeCatchInfo.fielderIndex ?? (activeCatchInfo.fielderId === 'RF' ? 1 : 0);
        const f = outfielders[fIdx];
        if (f) {
          f.anim = 'dive';
          f.animTime = 0;
          f.diveTimer = 0.6;
          f.flipX = capPos[0] < f.pos[0];
        }
        battedCaughtInAir = true;
        sfx.playCatchPop();
        finishBattedPlay();
      } else if (
        activeCatchInfo?.bobbled &&
        !bobbledTriggered &&
        activeCatchInfo.catchTimeSec !== null &&
        battedFlightTime >= activeCatchInfo.catchTimeSec
      ) {
        bobbledTriggered = true;
        const fIdx = activeCatchInfo.fielderIndex ?? (activeCatchInfo.fielderId === 'RF' ? 1 : 0);
        const f = outfielders[fIdx];
        if (f) {
          f.anim = 'dive';
          f.animTime = 0;
          f.diveTimer = 0.6;
          f.flipX = capPos[0] < f.pos[0];
        }
        showSwingFeedback('BOBBLE!', 'FIELDER DROPPED IT · HIT!', '#4ade80');
      } else if (battedFlightTime >= activeBatted.flightTimeSec) {
        finishBattedPlay();
      }
      } else if (phase === 'result') {
        batterAnimTime += dt;
        if (batterSwungThisPitch) {
          if (batterAnim === 'load' && batterAnimTime >= 0.06) {
            batterAnim = 'swing_early';
            batterAnimTime = 0;
          } else if (batterAnim === 'swing_early' && batterAnimTime >= 0.05) {
            batterAnim = 'swing_contact';
            batterAnimTime = 0;
          } else if (batterAnim === 'swing_contact' && batterAnimTime >= 0.07) {
            batterAnim = 'follow_through';
            batterAnimTime = 0;
          }
        }
        resultDelayTimer -= dt;
        if (resultDelayTimer <= 0) {
          phase = 'idle';
          pitcherFrame = 0;
          batterAnim = 'ready';
          batterAnimTime = 0;
          capVisible = false;
          capTrail = [];
          resetOutfielders(outfielders);
          if (isOnline && !spectating) {
            lastPitchTelemetry =
              getCurrentRole() === 'pitcher' ? t('telYourPitch') : t('telWaitingPitch');
          }
          resetPitchClock();
          updateHudAndDocks();
          if (!isOnline && !spectating && getCurrentRole() === 'batter' && match.mode !== 'hotseat2p') {
            cpuAutoPitchTimer = 0.75;
          }
        }
      }
    } else {
      batterAnimTime += dt;
      updateOutfielders(outfielders, dt, null, null, false, false);
    }

    cam.update(dt);
  }

  // --- Render Pixel Buffer (True 3D Depth-Sorted Fence, Fielders & Batted Cap) ---
  const pw = pixelCanvas.width;
  const ph = pixelCanvas.height;
  cam.setViewport(pw, ph);
  drawGymBackground(pixelCtx, cam, pw, ph, timeSec);
  const fenceItems = buildFenceDepthItems(pixelCtx, cam, fenceFlashAngle, fenceFlashAlpha);
  drawWorldEntities(pixelCtx, {
    bank: sprites,
    cam,
    timeSec,
    pitchingTeam: getPitchingTeamColor(),
    battingTeam: getBattingTeamColor(),
    pitcherFrame,
    fielders: outfielders.map((f) => ({
      pos: f.pos,
      anim: f.anim,
      animTime: f.animTime,
      flipX: f.flipX,
    })),
    batter: {
      handedness: batterHandedness,
      anim: batterAnim,
      animTime: batterAnimTime,
      alpha: 1.0,
    },
    cap: {
      pos: capPos,
      normalField: capNormalField,
      teamColor: getPitchingTeamColor(),
      trail: capTrail,
      // Pitched cap renders razor-sharp on overlayCanvas; batted cap depth-sorts in world entities!
      visible: capVisible && phase === 'batted_flight',
      isFlyBall: phase === 'batted_flight',
    },
    hitFx,
    fenceItems,
    battedEffects: {
      bounceRings,
      fenceImpact,
      hrBurst,
    },
  });

  // --- Render Crisp High-DPI Overlay ---
  const ow = overlayCanvas.width;
  const oh = overlayCanvas.height;
  overlayCtx.clearRect(0, 0, ow, oh);
  cam.setViewport(ow, oh);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const guideProgress =
    phase === 'pitch_flight' && activePitch
      ? pitchFlightTime / Math.max(0.1, activePitch.hitPlaneTimeSec)
      : null;

  // Play Call + ABS Stack is pinned in screen-space HUD (decoupled from 3D camera motion); update ABS timer bar
  if (!btnAbsChallenge.hidden && absPromptTimer > 0) {
    const pct = Math.max(0, Math.min(100, (absPromptTimer / Math.max(0.1, absPromptMaxTimer)) * 100));
    absTimerFillEl.style.width = `${pct.toFixed(1)}%`;
  }

  drawStrikeZoneAndOverlay(overlayCtx, cam, ow, oh, {
    showStrikeZone: !onTitleScreen && strikeZoneAlpha > 0.01,
    strikeZoneAlpha: onTitleScreen ? 0 : strikeZoneAlpha,
    role: getCurrentRole(),
    phase: phase === 'awaiting_result' ? 'pitch_flight' : phase,
    dpr,
    pitchTarget,
    breakDeltaField,
    previewPoints,
    showBreakPreview,
    batCursor,
    powerSwing,
    showGuideRing,
    guideProgress,
    cap: {
      visible: capVisible && phase === 'pitch_flight',
      worldPos: capPos,
      normalWorld: capNormalField,
      trail: capTrail,
      pitchId: activePitch?.pitchId ?? selectedPitch,
      teamColor: getPitchingTeamColor(),
      isFlyBall: false,
      timeSec,
    },
    absReplay,
    callout,
  });

  requestAnimationFrame(step);
}

// --- Debug Handle for Automated Verification ---
(window as unknown as Record<string, unknown>).__CAP_GAME__ = {
  getState: () => ({
    onTitleScreen,
    paused: isGamePaused(),
    playCallActive: isPlayCallActive(),
    mode: match.mode,
    phase,
    role: getCurrentRole(),
    spectating,
    inning: match.inning,
    half: match.half,
    score: { away: match.away.totalRuns, home: match.home.totalRuns },
    bso: { balls: match.balls, strikes: match.strikes, outs: match.outs },
    outs: match.outs,
    bases: [...match.bases],
    selectedPitch,
    speedKmh,
    springStage: springMeter.stage,
    springCharge: springMeter.charge,
    springPos: springMeter.pos,
    springPeak: springMeter.peak,
    springZone: evaluateSpring(springMeter.stage === 'idle' ? 0 : springMeter.pos, selectedPitch).zone,
    targetAim: { ...pitchTarget },
    lastCall: lastCallLabel,
    lastPitchTelemetry,
    stats: { ...match.stats },
    isGameOver: match.isGameOver,
    onlineConnected: onlineClient.connected,
    isOnline,
    roomCode: onlineRoomCode,
    mySide: onlineSide,
    pitchSeq: onlinePitchSeq,
    turnState: onlineTurnState,
    rttMs: onlineClient.rttMs,
    netMetrics: onlineClient.getNetMetrics(),
    playCall: {
      visible: !swingFeedbackCard.hidden,
      grade: sfGradeEl.textContent,
      detail: sfMetricsEl.textContent,
    },
    absAvailable: isAbsChallengeAvailable(),
    absChallenges: { ...match.absChallenges },
    pitchClockSec: Number(pitchClockSec.toFixed(2)),
    pitchClockEnabled: isPitchClockEnabled(),
    buildVersion: CLIENT_BUILD_VERSION,
    detectedServerVersion,
    updateBannerVisible: !updateBanner.hidden,
    derby: { ...match.derby },
    strikeZoneAlpha,
    battedEvents: {
      bounceCount: totalBounceEvents,
      fenceHitTriggered: totalFenceHits > 0,
      hrBurstTriggered: totalHrBursts > 0,
    },
  }),
  startMode,
  startSpringCharge,
  releaseSpringThrow,
  throwPitch: (springVal = SPRING_BEST_CENTER) => releaseSpringThrow(springVal),
  swing: () => triggerSwing(),
  challengeAbs: () => triggerAbsChallenge(),
  setAim: (x: number, y: number) => {
    pitchTarget = { x, y };
    batCursor = { x, y };
    updateBreakPreview();
  },
  selectPitch,
  setSpeed: (kmh: number) => {
    speedKmh = kmh;
    updateBreakPreview();
  },
  openRules: () => rulesDialog.showModal(),
  openSettings: () => settingsDialog.showModal(),
  navigateBack,
  returnToTitle,
  _judgeBattedCap: judgeBattedCap,
};

// --- Boot ---
selectPitch('straight');
renderSpringMeterUi();
updateHudAndDocks();
void loadSprites().then((loaded) => {
  sprites = loaded;
});

// --- Auto-resume active online session on socket drop / app switch / bfcache ---
let resumeTimer: number | null = null;
let resumeAttempt = 0;
let resumeInFlight = false;

function clearResumeTimer(): void {
  if (resumeTimer !== null) {
    window.clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

function resumeSession(): void {
  const session = loadSession();
  if (!session) {
    clearResumeTimer();
    resumeAttempt = 0;
    return;
  }
  if (document.visibilityState !== 'visible') return;
  if (onlineClient.connected || resumeInFlight) return;

  clearResumeTimer();
  resumeInFlight = true;
  void onlineClient
    .connect(getOnlinePlayerName())
    .then(() => {
      const latest = loadSession();
      if (latest) {
        onlineClient.reconnect(latest.code, latest.token);
      }
      resumeAttempt = 0;
    })
    .catch(() => {
      if (!loadSession()) {
        resumeAttempt = 0;
        return;
      }
      const delayMs = Math.min(5000, 1000 * 2 ** resumeAttempt);
      resumeAttempt += 1;
      clearResumeTimer();
      resumeTimer = window.setTimeout(() => {
        resumeTimer = null;
        resumeSession();
      }, delayMs);
    })
    .finally(() => {
      resumeInFlight = false;
    });
}

onlineClient.onStatus((connected) => {
  if (!connected) {
    resumeSession();
  } else {
    clearResumeTimer();
    resumeAttempt = 0;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resumeSession();
  }
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    resumeSession();
  }
});

// Connect silently on boot for live online counter + handle ?room=XXXX or reconnect
const urlParams = new URLSearchParams(window.location.search);
const urlRoomRaw = urlParams.get('room');
const urlCode =
  urlRoomRaw && /^[A-Za-z0-9]{4}$/.test(urlRoomRaw.trim()) ? urlRoomRaw.trim().toUpperCase() : null;
if (urlParams.has('room')) {
  urlParams.delete('room');
  const nextSearch = urlParams.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
  );
}
const prevSession = loadSession();
if (urlCode && (!prevSession || prevSession.code !== urlCode)) {
  roomCodeInput.value = urlCode;
  if (!friendDialog.open) friendDialog.showModal();
  void onlineClient
    .connect(getOnlinePlayerName())
    .then(() => {
      onlineClient.joinRoom(urlCode, getOnlinePlayerName());
    })
    .catch(() => {
      friendStatusMsg.textContent = 'UNABLE TO REACH SERVER';
    });
} else {
  void onlineClient
    .connect(getOnlinePlayerName())
    .then(() => {
      if (prevSession) {
        onlineClient.reconnect(prevSession.code, prevSession.token);
      }
    })
    .catch(() => {
      if (prevSession) {
        resumeSession();
      }
    });
}

window.setInterval(() => {
  void pollHealthVersion();
}, 60_000);

applyLocaleToDom();
requestAnimationFrame(step);
