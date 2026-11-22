import {
  checkCatcherCatch,
  chooseCpuPitch,
  createCatcherFielder,
  createOutfielders,
  createPitcherFielder,
  evaluateCpuSwing,
  resetOutfielders,
  updateOutfielders,
  type CpuSwingPlan,
  type FielderInterceptionTarget,
  type OutfielderActor,
} from './ai/cpu';
import { sfx } from './audio/sfx';
import {
  createTranslator,
  formatInningHalf,
  getActiveLocale,
  getPitchShortLabel,
  loadLocalePref,
  localizeGradeOrTiming,
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
  type RoomKind,
  type ServerMessage,
  type TurnState,
} from './net/client';
import {
  simulateBattedCap,
  simToField,
  type BattedCapResult,
  type FieldV3,
} from './physics/batted';
import { buildFullDefense, evaluateSwingResolution, simulateOutfieldGroundBlock, type CatchInfo } from './physics/contact';
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
  type OnZoneFeedbackState,
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
import {
  createCatcherReturnState,
  drawCatcherReturnThrow,
  startCatcherReturn,
  stepCatcherReturn,
} from './render/catcherReturn';
import { renderBoxScore } from './ui/boxScore';
import { EmoteController } from './ui/emotes';
import type { SwingFeedbackPayload } from './ui/swingFeedback';
import { TransitionDirector, type TransitionSpeed } from './ui/transitions';

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

const updateBanner = document.getElementById('update-banner') as HTMLElement;
const btnUpdateRefresh = document.getElementById('btn-update-refresh') as HTMLButtonElement;
const btnUpdateDismiss = document.getElementById('btn-update-dismiss') as HTMLButtonElement;
const preUpdateBanner = document.getElementById('pre-update-banner') as HTMLElement;
const preUpdateText = document.getElementById('pre-update-text') as HTMLElement;

const matchOfferToast = document.getElementById('match-offer-toast') as HTMLElement;
const motTimerEl = document.getElementById('mot-timer') as HTMLElement;
const motBodyEl = document.getElementById('mot-body') as HTMLElement;
const motBarFillEl = document.getElementById('mot-bar-fill') as HTMLElement;
const btnOfferAccept = document.getElementById('btn-offer-accept') as HTMLButtonElement;
const btnOfferDecline = document.getElementById('btn-offer-decline') as HTMLButtonElement;

const pitcherDock = document.getElementById('pitcher-dock') as HTMLElement;
const chatHubEl = document.getElementById('chat-hub') as HTMLElement;
const zoneTopHud = document.getElementById('zone-top-hud') as HTMLElement;
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
const topOnlinePill = document.getElementById('top-online-pill') as HTMLElement;
const topOnlineText = document.getElementById('top-online-text') as HTMLElement;
let lastOnlineCount = 0;
const sbRoomKindEl = document.getElementById('sb-room-kind') as HTMLElement;
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
const btnHubCpu = document.getElementById('btn-hub-cpu') as HTMLButtonElement;
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
const setCursorOffset = document.getElementById('set-cursor-offset') as HTMLSelectElement;
const setTransitionSpeed = document.getElementById('set-transition-speed') as HTMLSelectElement;
const setFx = document.getElementById('set-fx') as HTMLInputElement;
const setDifficulty = document.getElementById('set-difficulty') as HTMLSelectElement;
const setGuideRing = document.getElementById('set-guide-ring') as HTMLInputElement;
const setBreakPreview = document.getElementById('set-break-preview') as HTMLInputElement;
const setSound = document.getElementById('set-sound') as HTMLInputElement;
const setEmoteSfx = document.getElementById('set-emote-sfx') as HTMLInputElement;
const btnMuteEmotes = document.getElementById('btn-mute-emotes') as HTMLButtonElement;
const friendMercyRule = document.getElementById('friend-mercy-rule') as HTMLInputElement;

const catcherReturn = createCatcherReturnState();
let onZoneFeedback: OnZoneFeedbackState | null = null;
let pendingBattedFeedback: SwingFeedbackPayload | null = null;
let pendingMissFeedback: SwingFeedbackPayload | null = null;
let lastPitchCode = '4SFB';
let lastPitchSpeedKmh = 70;
let lastPitchBreakCm = 0;

type PresentationStep =
  | { kind: 'wait_camera_rest'; maxSec: number; elapsedSec: number }
  | { kind: 'wait_abs' }
  | { kind: 'wait_abs_replay' }
  | { kind: 'brief_pause'; remainingSec: number }
  | {
      kind: 'show_feedback';
      payload: SwingFeedbackPayload;
      durationSec: number;
      sfxTone?: 'strike' | 'ball' | 'out' | 'foul';
      started?: boolean;
    }
  | { kind: 'big_hit'; title: string; sub: string; isWalkOff: boolean; started?: boolean }
  | { kind: 'strikeout'; batterName: string; started?: boolean }
  | { kind: 'inning_change'; inning: number; half: 'top' | 'bottom'; awayRuns: number; homeRuns: number; started?: boolean }
  | { kind: 'game_over' }
  | { kind: 'next_batter'; orderNum: number; batterName: string };

let presentationQueue: PresentationStep[] = [];

function getFeedbackDurationSec(): number {
  return transitionDirector.config.speed === 'compact' ? 1.2 : 2.0;
}

function showOnZoneFeedback(
  payload: SwingFeedbackPayload,
  durationSec = getFeedbackDurationSec(),
  absMasked = false,
): void {
  const brkVal = typeof payload.breakCm === 'number' ? payload.breakCm : lastPitchBreakCm;
  const brkSuffix = brkVal > 0 ? ` · ${t('brkShort')} ${brkVal}cm` : '';
  const pitchTxt = `${getPitchShortLabel(locale, payload.pitchCode)} ${Math.round(payload.speedKmh)} km/h${brkSuffix}`;
  const locCall = localizeServerCallout(locale, payload.callLabel, payload.resultDetail ?? '');
  const callTxt = locCall.title !== payload.callLabel ? locCall.title : localizeGradeOrTiming(locale, payload.callLabel);
  const timingTxt = payload.timingLabel
    ? localizeGradeOrTiming(locale, payload.timingLabel)
    : payload.contact
      ? t('gradeGood')
      : t('gradeMiss');
  lastCallLabel = locCall.subtitle ? `${callTxt} ${locCall.subtitle}` : callTxt;
  onZoneFeedback = {
    kind: payload.kind,
    elapsedSec: 0,
    durationSec,
    batterHandedness,
    pitchLabel: pitchTxt,
    plateX: payload.plateX,
    plateY: payload.plateY,
    callLabel: callTxt,
    callColor: payload.callColor,
    resultDetail: locCall.subtitle || undefined,
    dtTiming: payload.dtTiming,
    timingLabel: timingTxt,
    timingColor: payload.timingColor,
    batX: payload.batX,
    batY: payload.batY,
    powerSwing: payload.powerSwing,
    contact: payload.contact,
    contactGrade: payload.contactGrade ? localizeGradeOrTiming(locale, payload.contactGrade) : undefined,
    exitSpeedKmh: payload.exitSpeedKmh,
    launchAngleDeg: payload.launchAngleDeg,
    absMasked,
    absMaskLabel: absMasked ? t('sfAbsMasked') : undefined,
    pciTitle: t('sfPciTitle'),
    pitchLocTitle: t('sfPitchLocTitle'),
    timingTitle: t('sfTimingTitle'),
    contactPrefix: t('sfContact'),
    evPrefix: t('evShort'),
    laPrefix: t('laShort'),
  };
  updateHudAndDocks();
}

function clearPresentationQueue(): void {
  presentationQueue = [];
  onZoneFeedback = null;
  pendingBattedFeedback = null;
  pendingMissFeedback = null;
}

function stepPresentationQueue(rawDt: number): void {
  let changed = false;
  while (presentationQueue.length > 0) {
    const head = presentationQueue[0];
    if (head.kind === 'wait_camera_rest') {
      head.elapsedSec += rawDt;
      if (cam.isNearRest() || head.elapsedSec >= head.maxSec) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'wait_abs') {
      if (absPromptTimer <= 0 && !(absReplay && absReplay.active)) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'wait_abs_replay') {
      if (!(absReplay && absReplay.active)) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'brief_pause') {
      head.remainingSec -= rawDt;
      if (head.remainingSec <= 0) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'show_feedback') {
      if (!head.started) {
        head.started = true;
        if (head.sfxTone) {
          sfx.playUmpireTone(head.sfxTone);
        }
        if (onZoneFeedback && onZoneFeedback.absMasked) {
          // Scheme B (原地翻牌感): Unmask the exact same side card in-place with a reveal pop!
          onZoneFeedback.absMasked = false;
          onZoneFeedback.absRevealElapsed = 0;
          onZoneFeedback.elapsedSec = 0;
          onZoneFeedback.durationSec = head.durationSec;
        } else {
          showOnZoneFeedback(head.payload, head.durationSec, false);
        }
        changed = true;
      }
      if (onZoneFeedback === null) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'big_hit') {
      if (!head.started) {
        head.started = true;
        transitionDirector.playBigHit(head.title, head.sub, head.isWalkOff);
        changed = true;
      }
      if (!transitionDirector.isActive()) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'strikeout') {
      if (!head.started) {
        head.started = true;
        transitionDirector.playStrikeout(head.batterName);
        changed = true;
      }
      if (!transitionDirector.isActive()) {
        presentationQueue.shift();
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'inning_change') {
      if (!head.started) {
        head.started = true;
        sfx.playInningChange();
        transitionDirector.playInningChange(head.inning, head.half, head.awayRuns, head.homeRuns);
        changed = true;
      }
      if (!transitionDirector.isActive()) {
        presentationQueue.shift();
        visualHalf = head.half;
        changed = true;
        continue;
      }
      break;
    }
    if (head.kind === 'game_over') {
      presentationQueue.shift();
      showGameOverModal();
      changed = true;
      break;
    }
    if (head.kind === 'next_batter') {
      presentationQueue.shift();
      emoteCtrl.showBroadcast(t('transAtBat'), `#${head.orderNum} ${head.batterName}`, '#f4c41c', 2200);
      changed = true;
      continue;
    }
  }
  if (presentationQueue.length === 0 && !transitionDirector.isActive() && visualHalf !== match.half) {
    visualHalf = match.half;
    changed = true;
  }
  if (changed) {
    updateHudAndDocks();
  }
}

// --- i18n, Touch Batting & v2 Presentation Preferences ---
type TouchSwingMode = 'drag_release' | 'instant_tap';
type CursorOffsetLevel = 'low' | 'mid' | 'high';
const TOUCH_SWING_KEY = 'capbaseball_touch_swing_v1';
const CURSOR_OFFSET_KEY = 'capbaseball_cursor_offset_v1';
const TRANS_SPEED_KEY = 'capbaseball_trans_speed_v1';
const FX_ENABLED_KEY = 'capbaseball_fx_v1';
const EMOTE_SFX_KEY = 'capbaseball_emote_sfx_v1';

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
let cursorOffsetLevel: CursorOffsetLevel = (() => {
  try {
    const v = localStorage.getItem(CURSOR_OFFSET_KEY);
    if (v === 'low' || v === 'mid' || v === 'high') return v;
  } catch {
    // ignore
  }
  return 'mid';
})();
const initialTransSpeed: TransitionSpeed = (() => {
  try {
    return localStorage.getItem(TRANS_SPEED_KEY) === 'compact' ? 'compact' : 'normal';
  } catch {
    return 'normal';
  }
})();
const initialFxEnabled: boolean = (() => {
  try {
    return localStorage.getItem(FX_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
})();
const initialEmoteSfx: boolean = (() => {
  try {
    return localStorage.getItem(EMOTE_SFX_KEY) !== '0';
  } catch {
    return true;
  }
})();

const transitionDirector = new TransitionDirector(
  {
    layer: document.getElementById('v2-transition-layer') as HTMLElement,
    badge: document.getElementById('v2-trans-badge') as HTMLElement,
    title: document.getElementById('v2-trans-title') as HTMLElement,
    sub: document.getElementById('v2-trans-sub') as HTMLElement,
    art: document.getElementById('v2-trans-art') as HTMLElement,
  },
  { speed: initialTransSpeed, fxEnabled: initialFxEnabled },
);

const emoteCtrl = new EmoteController(
  {
    dock: document.getElementById('chat-hub') as HTMLElement,
    toggleBtn: document.getElementById('btn-chat-toggle') as HTMLButtonElement,
    tray: document.getElementById('chat-tray') as HTMLElement,
    bubble: document.getElementById('chat-bubble') as HTMLElement,
  },
  (id) => {
    if (isOnline || spectating) {
      onlineClient.sendEmote(id);
    }
  },
  () => sfx.playUmpireTone('ball'),
);
emoteCtrl.sfxEnabled = initialEmoteSfx;

// Wire 4-tab Settings navigation
const settingsTabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-set-tab]'));
const settingsPanes = Array.from(document.querySelectorAll<HTMLElement>('[data-set-pane]'));
function selectSettingsTab(target: string): void {
  for (const b of settingsTabButtons) {
    const active = b.dataset.setTab === target;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  }
  for (const p of settingsPanes) {
    p.hidden = p.dataset.setPane !== target;
  }
}
for (const tabBtn of settingsTabButtons) {
  tabBtn.addEventListener('click', () => {
    if (tabBtn.dataset.setTab) selectSettingsTab(tabBtn.dataset.setTab);
  });
}

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
  setCursorOffset.value = cursorOffsetLevel;
  setTransitionSpeed.value = transitionDirector.config.speed;
  setFx.checked = transitionDirector.config.fxEnabled;
  setEmoteSfx.checked = emoteCtrl.sfxEnabled;
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
  btnMuteEmotes.textContent = emoteCtrl.mutedOpponent ? t('btnUnmuteEmotes') : t('btnMuteEmotes');
  pitchSelectedNameEl.textContent = getLocalizedPitchName(selectedPitch);
  if (phase === 'idle') {
    btnThrow.textContent = isPlayCallActive() ? t('btnWait') : t('btnHoldToPitch');
  }
  topOnlineText.textContent = `${t('livePrefix')} ${lastOnlineCount}`;
  transitionDirector.setLabels({
    playBall: t('transPlayBall'),
    changeSides: t('transChangeSides'),
    out: t('transOut'),
    strikeOut: t('callStrikeOut'),
    walkOffBadge: t('transWalkOff'),
    bigFlyBadge: t('transBigFly'),
    coldGameBadge: t('labelColdGame'),
    finalBadge: t('transFinal'),
    atBatPrefix: t('transAtBat'),
    formatInning: (half, inn) => formatInningHalf(locale, half, inn),
  });
  emoteCtrl.setLabels(
    {
      nice: t('emoteNice'),
      gg: t('emoteGg'),
      hr: t('emoteHr'),
      fire: t('emoteFire'),
      clap: t('emoteClap'),
      sweat: t('emoteSweat'),
      k: t('emoteK'),
      wow: t('emoteWow'),
    },
    {
      title: t('chatHubTitle'),
      broadcastTag: t('chatBroadcastTag'),
      systemTag: t('chatSystemTag'),
      cooldownHint: t('chatCooldownHint'),
      offlineNote: t('chatOfflineNote'),
      emptyLog: t('chatEmptyLog'),
    },
  );
  renderSpringMeterUi();
  updateHudAndDocks();
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
let onlineRoomKind: RoomKind | null = null;
let onlinePitchSeq = 1;
let onlineTurnState: TurnState = 'awaiting_pitch';
let onlineWaitingQueue = false;
let queueElapsedSec = 0;
let visualHalf: 'top' | 'bottom' = 'top';
let serverUpdateAtMs: number | null = null;
let lastPreUpdateRenderedSec = -999;

interface ClientMatchOffer {
  offerId: string;
  opponentName: string;
  mode: OnlineMode;
  timeoutSec: number;
  visible: boolean;
  shownAtMs: number;
  expiresAtMs: number;
}
let pendingMatchOffer: ClientMatchOffer | null = null;
let lastOfferRenderedSec = -1;

function hideMatchOfferToast(): void {
  pendingMatchOffer = null;
  lastOfferRenderedSec = -1;
  matchOfferToast.hidden = true;
}

function setServerUpdateCountdown(updateAtMs: number | null | undefined, countdownSec?: number): void {
  if (typeof updateAtMs === 'number' && updateAtMs > 0) {
    serverUpdateAtMs = updateAtMs;
  } else if (typeof countdownSec === 'number' && countdownSec >= 0) {
    serverUpdateAtMs = Date.now() + countdownSec * 1000;
  } else {
    return;
  }
  lastPreUpdateRenderedSec = -999;
  updatePreUpdateBannerUi();
}

function updatePreUpdateBannerUi(): void {
  if (serverUpdateAtMs === null) {
    preUpdateBanner.hidden = true;
    return;
  }
  const remSec = Math.max(0, Math.ceil((serverUpdateAtMs - Date.now()) / 1000));
  if (remSec === lastPreUpdateRenderedSec && !preUpdateBanner.hidden) return;
  lastPreUpdateRenderedSec = remSec;
  preUpdateBanner.hidden = false;
  if (remSec > 0) {
    const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
    const ss = String(remSec % 60).padStart(2, '0');
    preUpdateText.textContent = `${t('preUpdatePrefix')} ${mm}:${ss} ${t('preUpdateSuffix')}`;
  } else {
    preUpdateText.textContent = t('preUpdateNow');
  }
}
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

const SWING_LOAD_SEC = 0.035;
const SWING_EARLY_SEC = 0.030;
const SWING_LEAD_SEC = SWING_LOAD_SEC + SWING_EARLY_SEC; // 65ms crisp swing buildup

let batterAnim: BatterAnim = 'ready';
let batterAnimTime = 0;
let batterSwungThisPitch = false;
let swingChecked = false;
let swingLockedBatPos = { x: 0, y: 0.72 };
let swingTargetContactTimeSec = 0;

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
let oppAbsWaitTimer = 0;
let absReplay: AbsReplayState | null = null;
const ONLINE_MENU_TIMEOUT_SEC = 20;
let onlineMenuTimerSec = 0;
let onlinePausedSides: OnlineSide[] = [];
let onlinePauseRemainingSec = 0;
let onlineOpponentDisconnected = false;
let lastSentOnlineMenuPaused = false;
let pitchClockSec = 15;
let pitchClockLastWhole = 15;
let detectedServerVersion: string | null = null;
let updateBannerDismissed = false;

function isOnlineMenuTimerActive(): boolean {
  return isOnline && !spectating && !onTitleScreen && !match.isGameOver;
}

function isOnlineMatchFrozen(): boolean {
  return isOnline && (onlinePausedSides.length > 0 || onlineOpponentDisconnected);
}

function syncOnlineMenuPauseState(): void {
  const shouldPause =
    isOnlineMenuTimerActive() && (menuDialog.open || rulesDialog.open || settingsDialog.open);
  if (shouldPause !== lastSentOnlineMenuPaused) {
    lastSentOnlineMenuPaused = shouldPause;
    if (onlineClient.connected) {
      onlineClient.sendMenuPause(shouldPause);
    }
  }
}

function resetOnlineFreezeState(): void {
  onlinePausedSides = [];
  onlinePauseRemainingSec = 0;
  onlineOpponentDisconnected = false;
  lastSentOnlineMenuPaused = false;
  oppAbsWaitTimer = 0;
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
    if (detectedServerVersion && serverVer !== detectedServerVersion) {
      updateBannerDismissed = false;
    }
    detectedServerVersion = serverVer;
    serverUpdateAtMs = null;
    preUpdateBanner.hidden = true;
    if (!updateBannerDismissed) {
      updateBanner.hidden = false;
    }
  }
}

async function pollHealthVersion(): Promise<void> {
  if (IS_DEV_MODE || !CLIENT_BUILD_VERSION) return;
  if (document.visibilityState === 'hidden') return;
  try {
    const url = new URL('./health', window.location.href);
    url.searchParams.set('_t', String(Date.now()));
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string | null; draining?: boolean; updateAtMs?: number | null };
    handleServerVersion(data.version);
    if (data.draining && typeof data.updateAtMs === 'number' && data.updateAtMs > 0) {
      setServerUpdateCountdown(data.updateAtMs);
    }
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
  const urgent = running && whole <= 5;
  sbPitchClockEl.dataset.urgent = String(urgent);
  sbPitchClockEl.classList.toggle('urgent', urgent);
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
let resultDelayTimer = 0;
let lastCallLabel = 'READY';
let lastPitchTelemetry = 'READY';
let pendingPitchTelemetry = '';

const outfielders = createOutfielders();
const pitcherFielder = createPitcherFielder();
const catcherFielder = createCatcherFielder();
const allFielders: OutfielderActor[] = [...outfielders, pitcherFielder, catcherFielder];

function findFielderActor(info: CatchInfo | null): OutfielderActor | undefined {
  if (!info) return undefined;
  if (info.fielderId) {
    return allFielders.find((f) => f.id === info.fielderId);
  }
  if (typeof info.fielderIndex === 'number') {
    return allFielders[info.fielderIndex];
  }
  return undefined;
}
const cam = new GameCamera();
let sprites: SpriteBank = {
  ready: false,
  pitcherYellow: null,
  pitcherBlack: null,
  pitcherFieldYellow: null,
  pitcherFieldBlack: null,
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
  return visualHalf === 'top' ? 'yellow' : 'black';
}

function getBattingTeamColor(): TeamColor {
  return visualHalf === 'top' ? 'black' : 'yellow';
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
  const res = solvePitchTrajectory(selectedPitch, speedKmh, pitchTarget.x, pitchTarget.y, {
    outputHz: 45,
    seed: 1,
  });

  // Always couple aim crosshair tightly to the pitch's legal envelope endpoint so reticle & trajectory NEVER decouple!
  const hitEndField = simToField(res.hitPlanePos);
  if (Math.hypot(hitEndField[0] - pitchTarget.x, hitEndField[1] - pitchTarget.y) > 0.02) {
    pitchTarget = { x: hitEndField[0], y: hitEndField[1] };
  }

  if (!showBreakPreview) {
    breakDeltaField = null;
    previewPoints = [];
    return;
  }

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
  return (
    !isOnline &&
    !onTitleScreen &&
    (menuDialog.open || rulesDialog.open || settingsDialog.open || Boolean(pendingMatchOffer?.visible))
  );
}

function isPlayCallActive(): boolean {
  return (
    presentationQueue.length > 0 ||
    onZoneFeedback !== null ||
    isAbsChallengeAvailable() ||
    oppAbsWaitTimer > 0 ||
    isOnlineMatchFrozen() ||
    Boolean(absReplay && absReplay.active) ||
    transitionDirector.isActive()
  );
}

function startAbsPromptWindow(): void {
  const ttl = 2.2;
  absPromptMaxTimer = ttl;
  absPromptTimer = ttl;
  btnAbsChallenge.style.opacity = '1';
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
  clearPresentationQueue();
  btnAbsChallenge.hidden = true;

  if (isOnline) {
    onlineClient.sendAbsChallenge(lc.pitchSeq);
    return;
  }

  const prevInning = match.inning;
  const prevHalf = match.half;
  const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
  const prevBatterName = getCurrentBatter(match).name;

  const res = applyAbsChallenge(match, lc.eligibleSide);
  if (!res.ok) return;

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

  // Queue post-ABS transitions cleanly after Hawk-Eye replay completes
  presentationQueue.push({ kind: 'wait_abs_replay' });
  const inningChanged = match.inning !== prevInning || match.half !== prevHalf;
  const struckOut = match.strikes === 0 && match.lastEvent.includes('strikes out');
  if (struckOut && !match.isGameOver) {
    presentationQueue.push({ kind: 'strikeout', batterName: prevBatterName });
  }
  if (inningChanged && !match.isGameOver) {
    presentationQueue.push({
      kind: 'inning_change',
      inning: match.inning,
      half: match.half,
      awayRuns: match.away.totalRuns,
      homeRuns: match.home.totalRuns,
    });
  } else if (match.isGameOver) {
    presentationQueue.push({ kind: 'game_over' });
  } else {
    const curBatting = match.half === 'top' ? match.away : match.home;
    if (curBatting.batterIndex !== prevBatterIdx) {
      const nextB = getCurrentBatter(match);
      presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
    }
  }
  updateHudAndDocks();
}

function formatScorebugTeamName(raw: string): string {
  // Scoreboard already displays team color via the left Black/Yellow stripe;
  // strip redundant "中正黑 "/"中正黃 " prefix when an online player name is present so long names never crowd the score.
  const stripped = raw.replace(/^中正[黑黃]\s+/, '').trim();
  return stripped || raw;
}

function updateHudAndDocks(): void {
  appViewport.classList.toggle('in-game', !onTitleScreen);
  awayNameEl.textContent = formatScorebugTeamName(match.away.name);
  homeNameEl.textContent = formatScorebugTeamName(match.home.name);
  awayScoreEl.textContent = String(match.away.totalRuns);
  homeScoreEl.textContent = String(match.home.totalRuns);
  sbInningEl.textContent = `${match.half === 'top' ? '▲' : '▼'}${match.inning}`;

  const batter = getCurrentBatter(match);
  const fielding = getFieldingTeam(match);
  const pitcherSlot = fielding.lineup.find((p) => p.position === 'P') ?? fielding.lineup[0];
  sbBatterEl.textContent = batter.name;
  sbPitcherEl.textContent = pitcherSlot?.name ?? '--';

  // Show LIVE (matchmaking) vs FRIEND (friend room) badge in scoreboard ticker for all online/spectate games
  const showKind = isOnline && !onTitleScreen && onlineRoomKind !== null;
  sbRoomKindEl.hidden = !showKind;
  if (showKind && onlineRoomKind) {
    sbRoomKindEl.dataset.kind = onlineRoomKind;
    sbRoomKindEl.textContent = onlineRoomKind === 'friend' ? t('roomTagFriend') : t('roomTagLive');
  }

  // Pitch type / speed / break now lives inside the side Pitch Location panel so Scorebug stays sleek & narrow
  sbTelemetryEl.hidden = onTitleScreen || !spectating;
  if (spectating) {
    sbTelemetryEl.textContent = `${t('watchPrefix')} ${onlineRoomCode ?? ''}`;
  }

  if (match.derby.active) {
    sbNormalRow.hidden = true;
    sbDerbyRow.hidden = false;
    const left = match.derby.half === 'away' ? match.derby.awayPitchesLeft : match.derby.homePitchesLeft;
    sbDerbyText.textContent = `${left} ${t('derbyLeft')} · ${match.away.name} ${match.derby.awayHR} - ${match.derby.homeHR} ${match.home.name}`;
  } else {
    sbNormalRow.hidden = false;
    sbDerbyRow.hidden = true;
  }

  for (let i = 0; i < 3; i++) {
    document.getElementById(`base-${i + 1}`)?.classList.toggle('on', match.bases[i] !== null);
  }
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`b${i}`)?.classList.toggle('on', match.balls >= i);
  }
  for (let i = 1; i <= 2; i++) {
    document.getElementById(`s${i}`)?.classList.toggle('on', match.strikes >= i);
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
    if (onlineOpponentDisconnected) {
      btnThrow.textContent = t('callOpponentOffline');
    } else if (onlinePausedSides.length > 0) {
      const rem = Math.max(1, Math.ceil(onlinePauseRemainingSec));
      btnThrow.textContent = `${t('callOpponentPaused')} (${rem}s)`;
    } else {
      btnThrow.textContent = playCallBlocking ? t('btnWait') : t('btnHoldToPitch');
    }
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
    // Pin ABS cleanly in screen-space below Top HUD (decoupled from 3D camera motion)
    zoneTopHud.style.top = `${Math.round(hudRect.bottom + 10)}px`;
    // Keep Messenger Chat Ball cleanly above Pitcher Dock on portrait phones, bottom-right otherwise
    chatHubEl.style.bottom = !pitcherDock.hidden
      ? `calc(${cachedPortraitDockHeight + 14}px + env(safe-area-inset-bottom, 0px))`
      : '';
  } else {
    cam.setTargetCenterYRatio(0.5, immediate);
    chatHubEl.style.bottom = '';
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
  onlineRoomKind = null;
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
  visualHalf = match.half;
  onTitleScreen = false;
  titleScreen.hidden = true;
  scoreboardEl.hidden = false;
  if (cpuDialog.open) cpuDialog.close();

  phase = 'idle';
  pitcherFrame = 0;
  batterAnim = 'ready';
  batterAnimTime = 0;
  batCursor = { x: 0, y: 0.72 };
  capVisible = false;
  capTrail = [];
  hitFx = null;
  clearPresentationQueue();
  catcherReturn.active = false;
  transitionDirector.clear();
  emoteCtrl.clearHistory();
  emoteCtrl.setOnlineSendEnabled(false);
  emoteCtrl.setVisible(true);
  btnMuteEmotes.hidden = true;
  absPromptTimer = 0;
  absReplay = null;
  bounceRings = [];
  fenceImpact = null;
  hrBurst = null;
  fenceFlashAlpha = 0;
  resetSpringMeter();
  pendingPitchTelemetry = '';
  lastPitchTelemetry = t('telReady');
  cam.resetImmediate();
  resetOutfielders(allFielders);
  selectPitch('straight');
  resetPitchClock();
  updateHudAndDocks();
  updateSafeCameraFraming(true);

  if (mode !== 'practice_bat' && mode !== 'practice_pitch') {
    transitionDirector.playMatchStart(match.away.name, match.home.name);
  }
  if (getCurrentRole() === 'batter') {
    cpuAutoPitchTimer = 0.75;
  }
}

function returnToTitle(): void {
  hideMatchOfferToast();
  if (onlineClient.connected) {
    onlineClient.leaveStandby();
  }
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
  onlineRoomKind = null;
  onlineWaitingQueue = false;
  visualHalf = 'top';
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  pendingOnlineResult = null;
  onTitleScreen = true;
  phase = 'idle';
  titleScreen.hidden = false;
  scoreboardEl.hidden = true;
  pitcherDock.hidden = true;
  menuBatRow.hidden = true;
  clearPresentationQueue();
  catcherReturn.active = false;
  transitionDirector.clear();
  emoteCtrl.setOnlineSendEnabled(false);
  emoteCtrl.setVisible(false);
  btnMuteEmotes.hidden = true;
  btnAbsChallenge.hidden = true;
  resetSpringMeter();
  resetOnlineFreezeState();
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
  lastPitchCode = spec.code;
  lastPitchSpeedKmh = spdKmh;
  clearPresentationQueue();
  transitionDirector.clear();
  catcherReturn.active = false;
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
  lastPitchBreakCm = breakCm;
  // Hold pitch telemetry until the cap reaches the plate/contact (no mid-flight spoiler!)
  pendingPitchTelemetry = `${getPitchShortLabel(locale, spec.code)} ${Math.round(spdKmh)} km/h · ${t('brkShort')} ${breakCm}cm`;
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
  onlineNoSwingSentForSeq = 0;
  capVisible = false;
  capTrail = [];
  resetSpringMeter();
  resetOnlineFreezeState();
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
  btnThrow.textContent = t('btnHoldToPitch');
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
  btnThrow.textContent = t('btnRelease');
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
    lastPitchTelemetry = t('btnThrowing');
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
  btnThrow.textContent = t('btnLaunching');
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
  // Lock aim and exact press-to-contact arrival timestamp immediately (Scheme A)
  swingLockedBatPos = { x: batCursor.x, y: batCursor.y };
  const windupRemainSec =
    phase === 'windup' ? Math.max(0, (sprites.pitcherMeta.release_frame - pitcherFrame) / 28) : 0;
  swingTargetContactTimeSec = (phase === 'pitch_flight' ? pitchFlightTime : -windupRemainSec) + SWING_LEAD_SEC;
}

function resolveContact(
  dtTiming: number,
  batX = swingLockedBatPos.x,
  batY = swingLockedBatPos.y,
): boolean {
  if (!activePitch) return false;
  const resolution = evaluateSwingResolution({
    trajectory: activePitch,
    flightTimeSec: activePitch.hitPlaneTimeSec + dtTiming,
    batX,
    batY,
    swingMode: powerSwing ? 'power' : 'normal',
    batterSide: batterHandedness === 'right' ? 'R' : 'L',
    seed: Math.floor(Math.random() * 10000) + 1,
    outfielders,
  });

  // For swings, plot the ball dot at hitPlanePos (z = -0.22m) so side feedback matches
  // the exact collision plane evaluated against the 2D bat barrel PCI!
  const hitFieldNow = resolution.hitField;
  if (!resolution.contact) {
    pendingMissFeedback = {
      kind: 'swing',
      pitchCode: lastPitchCode,
      speedKmh: lastPitchSpeedKmh,
      plateX: hitFieldNow[0],
      plateY: hitFieldNow[1],
      callLabel: 'STRIKE',
      callColor: '#f4c41c',
      dtTiming,
      timingLabel: resolution.label || 'MISS',
      timingColor: resolution.color || '#f43f5e',
      batX,
      batY,
      powerSwing,
      contact: false,
    };
    return false;
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
  const la =
    typeof resolution.launchAngleDeg === 'number'
      ? resolution.launchAngleDeg
      : Math.round((Math.atan2(bvy, Math.hypot(bvx, bvz)) * 180) / Math.PI);
  // Defer showing dual feedback card until the batted play finishes & camera pulls back to home plate!
  pendingBattedFeedback = {
    kind: 'swing',
    pitchCode: lastPitchCode,
    speedKmh: lastPitchSpeedKmh,
    plateX: hitFieldNow[0],
    plateY: hitFieldNow[1],
    callLabel: resolution.outcome,
    callColor: resolution.color,
    dtTiming,
    timingLabel: resolution.label,
    timingColor: resolution.color,
    batX,
    batY,
    powerSwing,
    contact: true,
    contactGrade: grade,
    exitSpeedKmh: ev,
    launchAngleDeg: la,
  };

  if (activeBatted.overFence) {
    transitionDirector.triggerHitStop(0.048);
    transitionDirector.triggerSlowMo(0.62, 0.44);
  } else if (resolution.rawQuality > 0.72) {
    transitionDirector.triggerHitStop(0.04);
  }

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
  return true;
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
  const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
  const prevBatterName = getCurrentBatter(match).name;
  let struckOut = false;

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

    let callLbl = res.isStrike ? 'STRIKE' : 'BALL';
    let callCol = res.isStrike ? '#f4c41c' : '#4ade80';
    let callDetail = '';

    if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
      callLbl = 'UNCAUGHT 3RD';
      callCol = '#f97316';
      callDetail = 'DROPPED 3RD · BATTER TO 1B';
      sfx.playUmpireTone('out');
    } else if (res.isWildPitch) {
      callLbl = 'WILD PITCH';
      callCol = '#f97316';
      callDetail = 'WILD PITCH · RUNNERS ADVANCE';
      sfx.playUmpireTone('ball');
    } else if (res.isStrike) {
      const isK = match.strikes === 0 && match.lastEvent.includes('strikes out');
      struckOut = isK;
      if (isK) {
        callLbl = 'STRIKE OUT!';
        callCol = '#f43f5e';
        callDetail = 'CALLED STRIKE THREE';
      }
      sfx.playUmpireTone(isK ? 'out' : 'strike');
    } else {
      const isBB = match.balls === 0 && match.lastEvent.includes('walks');
      if (isBB) {
        callLbl = 'WALK (BB)';
        callDetail = 'BASE ON BALLS';
      }
      sfx.playUmpireTone('ball');
    }

    if (caughtByCatcher) {
      startCatcherReturn(catcherReturn, getPitchingTeamColor(), transitionDirector.config.speed === 'compact');
    }

    const takePayload: SwingFeedbackPayload = {
      kind: 'take',
      pitchCode: lastPitchCode,
      speedKmh: lastPitchSpeedKmh,
      plateX: plateField[0],
      plateY: plateField[1],
      callLabel: callLbl,
      callColor: callCol,
      resultDetail: callDetail || undefined,
    };

    if (isAbsChallengeEligibleForPlayer()) {
      // Scheme B (原地翻牌感): Immediately show side card with 3x3 masked as "? ABS 可挑戰", reveal dot in-place when timer ends!
      showOnZoneFeedback(takePayload, getFeedbackDurationSec(), true);
      startAbsPromptWindow();
      presentationQueue.push({ kind: 'wait_abs' });
    }
    presentationQueue.push({ kind: 'show_feedback', payload: takePayload, durationSec: getFeedbackDurationSec() });
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

    if (caughtByCatcher) {
      startCatcherReturn(catcherReturn, getPitchingTeamColor(), transitionDirector.config.speed === 'compact');
    }

    let missLbl = 'SWINGING STRIKE';
    let missCol = '#f4c41c';
    let missDetail = '';

    if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
      missLbl = 'UNCAUGHT 3RD';
      missCol = '#f97316';
      missDetail = 'DROPPED 3RD · BATTER TO 1B';
      sfx.playUmpireTone('out');
    } else if (res.isWildPitch) {
      missLbl = 'WILD PITCH';
      missCol = '#f97316';
      missDetail = 'WILD PITCH · RUNNERS ADVANCE';
      sfx.playUmpireTone('ball');
    } else {
      const isK = match.strikes === 0 && match.lastEvent.includes('strikes out');
      struckOut = isK;
      if (isK) {
        missLbl = 'STRIKE OUT!';
        missCol = '#f43f5e';
      }
      sfx.playUmpireTone(isK ? 'out' : 'strike');
    }

    const hitFieldFallback = simToField(activePitch.hitPlanePos);
    const missPayload: SwingFeedbackPayload = {
      ...(pendingMissFeedback ?? {
        kind: 'swing',
        pitchCode: lastPitchCode,
        speedKmh: lastPitchSpeedKmh,
        plateX: hitFieldFallback[0],
        plateY: hitFieldFallback[1],
        dtTiming: swingTargetContactTimeSec - activePitch.hitPlaneTimeSec,
        timingLabel: 'MISS',
        timingColor: '#f43f5e',
        batX: swingLockedBatPos.x,
        batY: swingLockedBatPos.y,
        powerSwing,
        contact: false,
      }),
      callLabel: missLbl,
      callColor: missCol,
      resultDetail: missDetail || undefined,
    };
    pendingMissFeedback = null;
    presentationQueue.push({ kind: 'show_feedback', payload: missPayload, durationSec: getFeedbackDurationSec() });
  }

  const inningChanged = match.inning !== prevInning || match.half !== prevHalf;
  if (struckOut && !match.isGameOver) {
    presentationQueue.push({ kind: 'strikeout', batterName: prevBatterName });
  }
  if (inningChanged && !match.isGameOver) {
    presentationQueue.push({
      kind: 'inning_change',
      inning: match.inning,
      half: match.half,
      awayRuns: match.away.totalRuns,
      homeRuns: match.home.totalRuns,
    });
  } else if (match.isGameOver) {
    presentationQueue.push({ kind: 'game_over' });
  } else {
    const curBatting = match.half === 'top' ? match.away : match.home;
    if (curBatting.batterIndex !== prevBatterIdx) {
      const nextB = getCurrentBatter(match);
      presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
    }
  }

  enterResultPause();
}

function finishBattedPlay(): void {
  if (!activeBatted) return;

  if ((isOnline || spectating) && pendingOnlineResult) {
    const msg = pendingOnlineResult;
    pendingOnlineResult = null;
    const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
    match = msg.match;
    onlinePitchSeq = msg.nextPitchSeq;
    onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
    const outcome = msg.resolution && msg.resolution.contact ? msg.resolution.outcome : 'OUT';
    const locCall = localizeServerCallout(locale, msg.callout.title, msg.callout.subtitle);
    if (pendingBattedFeedback) {
      pendingBattedFeedback.callLabel = msg.callout.title;
      pendingBattedFeedback.callColor = msg.callout.color;
      pendingBattedFeedback.resultDetail = msg.callout.subtitle || undefined;
    }
    let verdictSfx: 'strike' | 'ball' | 'out' | 'foul' | undefined;
    if (outcome === 'HR') {
      sfx.playHomeRunFanfare();
      presentationQueue.push({
        kind: 'big_hit',
        title: t('callHr'),
        sub: locCall.subtitle,
        isWalkOff: Boolean(match.isGameOver && !match.mercyTriggered),
      });
    } else if (outcome === 'OUT') {
      verdictSfx = 'out';
    } else if (outcome === 'FOUL') {
      verdictSfx = 'foul';
    } else {
      verdictSfx = 'ball';
      if (match.isGameOver && !match.mercyTriggered) {
        presentationQueue.push({ kind: 'big_hit', title: t('callWalkOff'), sub: locCall.title, isWalkOff: true });
      }
    }

    // Wait for camera pullback to home plate BEFORE showing the side dual feedback card + verdict tone in lockstep!
    presentationQueue.push({ kind: 'wait_camera_rest', maxSec: 1.0, elapsedSec: 0 });
    if (pendingBattedFeedback) {
      presentationQueue.push({
        kind: 'show_feedback',
        payload: pendingBattedFeedback,
        durationSec: getFeedbackDurationSec(),
        sfxTone: verdictSfx,
      });
      pendingBattedFeedback = null;
    } else if (verdictSfx) {
      sfx.playUmpireTone(verdictSfx);
    }

    if (msg.inningChanged && !match.isGameOver) {
      presentationQueue.push({
        kind: 'inning_change',
        inning: match.inning,
        half: match.half,
        awayRuns: match.away.totalRuns,
        homeRuns: match.home.totalRuns,
      });
    } else if (match.isGameOver) {
      presentationQueue.push({ kind: 'game_over' });
    } else if (outcome !== 'FOUL') {
      const curBatting = match.half === 'top' ? match.away : match.home;
      if (curBatting.batterIndex !== prevBatterIdx) {
        const nextB = getCurrentBatter(match);
        presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
      }
    }
    enterResultPause();
    return;
  }

  const prevInning = match.inning;
  const prevHalf = match.half;
  const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;

  let outcome: ReturnType<typeof judgeBattedCap>;
  if (match.derby.active) {
    outcome = judgeBattedCap(activeBatted, { caughtInAir: battedCaughtInAir });
    applyDerbySwingResult(match, outcome === 'HR');
  } else {
    outcome = applyBattedOutcome(match, activeBatted, { caughtInAir: battedCaughtInAir });
  }

  const isBobbleHit = Boolean(activeCatchInfo?.bobbled && (outcome === '1B' || outcome === '2B' || outcome === '3B'));
  const isBlockedSingle = Boolean(activeCatchInfo?.blocked && outcome === '1B');

  let outTitle = 'OUT!';
  let outColor = '#f43f5e';
  let outDetail = '';
  let verdictSfx: 'strike' | 'ball' | 'out' | 'foul' | undefined;

  if (outcome === 'HR') {
    outTitle = 'HOME RUN!';
    outColor = '#f4c41c';
    outDetail = `${activeBatted.maxDistanceM.toFixed(1)}m`;
    sfx.playHomeRunFanfare();
    presentationQueue.push({
      kind: 'big_hit',
      title: t('callHr'),
      sub: outDetail,
      isWalkOff: Boolean(match.isGameOver && !match.mercyTriggered),
    });
  } else if (outcome === '3B') {
    outTitle = 'TRIPLE!';
    outColor = '#38bdf8';
    outDetail = isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : 'OFF WALL · 3B';
    verdictSfx = 'ball';
  } else if (outcome === '2B') {
    outTitle = 'DOUBLE!';
    outColor = '#4ade80';
    outDetail = isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : 'OFF WALL · 2B';
    verdictSfx = 'ball';
  } else if (outcome === '1B') {
    outTitle = 'SINGLE!';
    outColor = '#a3e635';
    outDetail = isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : isBlockedSingle ? 'OF CUTOFF · HELD TO 1B' : '';
    verdictSfx = 'ball';
  } else if (outcome === 'FOUL') {
    outTitle = 'FOUL';
    outColor = '#fb923c';
    verdictSfx = 'foul';
  } else {
    outTitle = 'OUT!';
    outColor = '#f43f5e';
    outDetail = battedCaughtInAir ? 'OUTFIELD CATCH!' : 'INFIELD OUT!';
    verdictSfx = 'out';
  }

  if (pendingBattedFeedback) {
    pendingBattedFeedback.callLabel = outTitle;
    pendingBattedFeedback.callColor = outColor;
    pendingBattedFeedback.resultDetail = outDetail || undefined;
  }

  if (match.isGameOver && outcome !== 'HR' && outcome !== 'OUT' && outcome !== 'FOUL' && !match.mercyTriggered) {
    presentationQueue.push({
      kind: 'big_hit',
      title: t('callWalkOff'),
      sub: `${match.home.totalRuns} — ${match.away.totalRuns}`,
      isWalkOff: true,
    });
  }

  // Wait until camera pulls back & settles at home plate BEFORE popping the dual feedback card + verdict tone in lockstep!
  presentationQueue.push({ kind: 'wait_camera_rest', maxSec: 1.0, elapsedSec: 0 });
  if (pendingBattedFeedback) {
    presentationQueue.push({
      kind: 'show_feedback',
      payload: pendingBattedFeedback,
      durationSec: getFeedbackDurationSec(),
      sfxTone: verdictSfx,
    });
    pendingBattedFeedback = null;
  } else if (verdictSfx) {
    sfx.playUmpireTone(verdictSfx);
  }

  const inningChanged = match.inning !== prevInning || match.half !== prevHalf;
  if (inningChanged && !match.isGameOver) {
    presentationQueue.push({
      kind: 'inning_change',
      inning: match.inning,
      half: match.half,
      awayRuns: match.away.totalRuns,
      homeRuns: match.home.totalRuns,
    });
  } else if (match.isGameOver) {
    presentationQueue.push({ kind: 'game_over' });
  } else if (outcome !== 'FOUL') {
    const curBatting = match.half === 'top' ? match.away : match.home;
    if (curBatting.batterIndex !== prevBatterIdx) {
      const nextB = getCurrentBatter(match);
      presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
    }
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

  const endReasonText =
    match.endReason === 'disconnect'
      ? t('labelDisconnectWin')
      : match.endReason === 'resign'
        ? t('labelResignWin')
        : '';
  const scoreSub = `${match.away.name} ${match.away.totalRuns} — ${match.home.totalRuns} ${match.home.name}`;

  transitionDirector.playGameSet(
    winLabel,
    endReasonText ? `${endReasonText} · ${scoreSub}` : scoreSub,
    Boolean(match.mercyTriggered),
  );

  // Safe DOM construction (zero innerHTML XSS exposure)
  resultBody.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'result-summary';

  const winnerEl = document.createElement('div');
  winnerEl.className = 'result-winner';
  winnerEl.textContent = winLabel;
  wrap.appendChild(winnerEl);

  const boxHost = document.createElement('div');
  boxHost.className = 'result-boxscore-host';
  renderBoxScore(boxHost, match, {
    team: t('bsTeam'),
    r: t('bsR'),
    h: t('bsH'),
    k: t('bsK'),
    bb: t('bsBb'),
    pitches: t('bsPitches'),
    hr: t('bsHr'),
    diff10: t('bsDiff10'),
    coldGameLabel: t('labelColdGame'),
    disconnectWinLabel: t('labelDisconnectWin'),
    disconnectTag: t('labelDisconnectTag'),
    resignWinLabel: t('labelResignWin'),
    resignTag: t('labelResignTag'),
    mvpLabel: t('labelMatchMvp'),
  });
  wrap.appendChild(boxHost);

  resultBody.appendChild(wrap);
  if (!resultDialog.open) resultDialog.showModal();
}

function enterResultPause(): void {
  phase = 'result';
  resultDelayTimer = 1.05;
  cam.setFollowTarget(null);
  if (match.isGameOver && isOnline) {
    saveSession(null);
  }
  updateHudAndDocks();

  if (match.isGameOver && !presentationQueue.some((s) => s.kind === 'game_over')) {
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
function getBatTouchOffsetPx(): number {
  const rect = overlayCanvas.getBoundingClientRect();
  const ratio = cursorOffsetLevel === 'low' ? 0.11 : cursorOffsetLevel === 'high' ? 0.21 : 0.16;
  const minPx = cursorOffsetLevel === 'low' ? 54 : cursorOffsetLevel === 'high' ? 96 : 76;
  const maxPx = cursorOffsetLevel === 'low' ? 92 : cursorOffsetLevel === 'high' ? 154 : 124;
  return Math.max(minPx, Math.min(maxPx, Math.round(rect.height * ratio)));
}

function projectClientToHitPlane(clientX: number, clientY: number, yOffsetPx = 0): readonly [number, number, number] | null {
  const rect = overlayCanvas.getBoundingClientRect();
  const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * cam.width;
  const sy = ((clientY - yOffsetPx - rect.top) / Math.max(1, rect.height)) * cam.height;
  return cam.screenToPlaneZ(sx, sy, HIT_PLANE_Z);
}

function updateAimFromClient(clientX: number, clientY: number, yOffsetPx = 0): void {
  const hit = projectClientToHitPlane(clientX, clientY, yOffsetPx);
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
let batTouchStartX = 0;
let batTouchStartY = 0;
let batTouchLastX = 0;
let batTouchLastY = 0;
let batTouchUseOffset = false;
let batTouchOffsetPx = 96;
let batTouchHoldTimer: number | null = null;

function clearBatTouchHoldTimer(): void {
  if (batTouchHoldTimer !== null) {
    window.clearTimeout(batTouchHoldTimer);
    batTouchHoldTimer = null;
  }
}

overlayCanvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  pointerDownOnCanvas = true;
  if (getCurrentRole() === 'batter') {
    if (e.pointerType === 'mouse' || touchSwingMode === 'instant_tap') {
      updateAimFromClient(e.clientX, e.clientY, 0);
      if (phase === 'windup' || phase === 'pitch_flight') {
        triggerSwing();
      }
    } else {
      // Unified below-cursor drag & release + direct point tap:
      // - Touching below the strike zone (y < 0.42m) immediately places the cursor above the fingertip.
      // - Dragging (>= 6px) OR holding (>= 130ms) anywhere (including inside the strike zone) locks full upward offset so finger never blocks the cap.
      // - Quick tapping inside the strike zone (< 6px and < 130ms) swings directly at the tapped spot (zero offset).
      clearBatTouchHoldTimer();
      activeBatTouchId = e.pointerId;
      batTouchStartX = e.clientX;
      batTouchStartY = e.clientY;
      batTouchLastX = e.clientX;
      batTouchLastY = e.clientY;
      batTouchOffsetPx = getBatTouchOffsetPx();
      const rawHit = projectClientToHitPlane(e.clientX, e.clientY, 0);
      const startedBelow = rawHit !== null && rawHit[1] < 0.42;
      batTouchUseOffset = startedBelow;
      updateAimFromClient(e.clientX, e.clientY, batTouchUseOffset ? batTouchOffsetPx : 0);

      if (!batTouchUseOffset) {
        const pointerId = e.pointerId;
        batTouchHoldTimer = window.setTimeout(() => {
          batTouchHoldTimer = null;
          if (activeBatTouchId === pointerId && !batTouchUseOffset) {
            batTouchUseOffset = true;
            updateAimFromClient(batTouchLastX, batTouchLastY, batTouchOffsetPx);
          }
        }, 130);
      }
    }
  } else {
    updateAimFromClient(e.clientX, e.clientY, 0);
  }
});
window.addEventListener('pointermove', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    batTouchLastX = e.clientX;
    batTouchLastY = e.clientY;
    if (!batTouchUseOffset) {
      const dist = Math.hypot(e.clientX - batTouchStartX, e.clientY - batTouchStartY);
      if (dist >= 6) {
        clearBatTouchHoldTimer();
        batTouchUseOffset = true;
      }
    }
    updateAimFromClient(e.clientX, e.clientY, batTouchUseOffset ? batTouchOffsetPx : 0);
  } else if (pointerDownOnCanvas || (getCurrentRole() === 'batter' && e.pointerType === 'mouse')) {
    updateAimFromClient(e.clientX, e.clientY, 0);
  }
});
window.addEventListener('pointerup', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    clearBatTouchHoldTimer();
    updateAimFromClient(e.clientX, e.clientY, batTouchUseOffset ? batTouchOffsetPx : 0);
    activeBatTouchId = null;
    batTouchUseOffset = false;
    if (getCurrentRole() === 'batter' && (phase === 'windup' || phase === 'pitch_flight')) {
      triggerSwing();
    }
  }
  pointerDownOnCanvas = false;
});
window.addEventListener('pointercancel', (e) => {
  if (activeBatTouchId !== null && e.pointerId === activeBatTouchId) {
    clearBatTouchHoldTimer();
    activeBatTouchId = null;
    batTouchUseOffset = false;
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
    lastCallLabel = t('callIbb');
    emoteCtrl.showBroadcast(t('callIbb'), t('callIbbSub'), '#38bdf8', 2200);
    sfx.playUmpireTone('ball');
    presentationQueue.push({ kind: 'brief_pause', remainingSec: 0.9 });
    if (match.isGameOver) {
      presentationQueue.push({ kind: 'game_over' });
    } else {
      const curBatting = match.half === 'top' ? match.away : match.home;
      const nextB = getCurrentBatter(match);
      presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
    }
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
  selectSettingsTab('controls');
  settingsDialog.showModal();
});
btnNickChip.addEventListener('click', () => {
  cancelSpringCharge();
  if (menuDialog.open) menuDialog.close();
  selectSettingsTab('account');
  if (!settingsDialog.open) settingsDialog.showModal();
  onlineNameInput.focus();
  onlineNameInput.select();
});

// --- Online UI, Lobby Hub, Load/Stability Auto-CPU Failover & Spectating ---
function generateGuestName(): string {
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
  const rand = new Uint32Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < 6; i++) rand[i] = Math.floor(Math.random() * 0x100000000);
  }
  let out = '';
  for (let i = 0; i < 6; i++) {
    const idx = i + (rand[i] % (pool.length - i));
    const ch = pool[idx];
    pool[idx] = pool[i];
    out += ch;
  }
  return out;
}

const GUEST_NICK_KEY = 'capbaseball_guest_nick';
let guestNick = localStorage.getItem(GUEST_NICK_KEY);
if (!guestNick || !/^[A-Z0-9]{6}$/.test(guestNick) || new Set(guestNick).size !== 6) {
  guestNick = generateGuestName();
  localStorage.setItem(GUEST_NICK_KEY, guestNick);
}

const savedNickRaw = localStorage.getItem('capbaseball_nick');
const savedNick =
  savedNickRaw && savedNickRaw !== '瓶蓋玩家' && savedNickRaw !== 'PLAYER'
    ? savedNickRaw.trim().slice(0, 12)
    : null;
if (savedNickRaw === '瓶蓋玩家' || savedNickRaw === 'PLAYER') {
  localStorage.removeItem('capbaseball_nick');
} else if (savedNick && savedNick !== savedNickRaw) {
  localStorage.setItem('capbaseball_nick', savedNick);
}
onlineNameInput.placeholder = guestNick;
if (savedNick) {
  onlineNameInput.value = savedNick;
  nickChipLabel.textContent = savedNick;
} else {
  nickChipLabel.textContent = guestNick;
}
onlineNameInput.addEventListener('change', () => {
  const raw = onlineNameInput.value.trim().slice(0, 12);
  if (raw && raw !== '瓶蓋玩家' && raw !== 'PLAYER') {
    onlineNameInput.value = raw;
    localStorage.setItem('capbaseball_nick', raw);
    nickChipLabel.textContent = raw;
  } else {
    localStorage.removeItem('capbaseball_nick');
    onlineNameInput.value = '';
    nickChipLabel.textContent = guestNick!;
  }
});

function getOnlinePlayerName(): string {
  const n = onlineNameInput.value.trim().slice(0, 12);
  if (n && n !== '瓶蓋玩家' && n !== 'PLAYER') {
    localStorage.setItem('capbaseball_nick', n);
    nickChipLabel.textContent = n;
    return n;
  }
  nickChipLabel.textContent = guestNick!;
  return guestNick!;
}

function cancelQueueToCpu(registerStandby = true): void {
  autoFallbackToCpu(
    t('callNoOpponent'),
    registerStandby && onlineClient.connected && !onlineClient.isServerBusy && !onlineClient.isUnstable
      ? t('standbyNoticeSub')
      : t('callAutoCpuSub'),
    registerStandby,
  );
}

function autoFallbackToCpu(title: string, detail: string, registerStandby = false): void {
  onlineWaitingQueue = false;
  queueElapsedSec = 0;
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  if (onlineClient.connected) {
    onlineClient.unqueue();
    if (registerStandby && !onlineClient.isServerBusy && !onlineClient.isUnstable) {
      onlineClient.joinStandby(onlineModeChoice);
    }
  }
  if (friendDialog.open) friendDialog.close();
  startMode('quick3');
  const loc = localizeServerCallout(locale, title, detail);
  emoteCtrl.showSystem(loc.title, loc.subtitle, '#f97316', 3600);
}

btnOfferAccept.addEventListener('click', () => {
  if (!pendingMatchOffer) return;
  const id = pendingMatchOffer.offerId;
  hideMatchOfferToast();
  if (onlineClient.connected) {
    onlineClient.replyMatchOffer(id, true);
  }
});

btnOfferDecline.addEventListener('click', () => {
  if (!pendingMatchOffer) return;
  const id = pendingMatchOffer.offerId;
  hideMatchOfferToast();
  if (onlineClient.connected) {
    onlineClient.replyMatchOffer(id, false);
  }
});

onlineClient.onNetUpdate((m) => {
  if (!m.connected) {
    topOnlinePill.dataset.quality = 'offline';
    topOnlinePill.title = t('netLocal');
  } else if (m.serverLoad === 'red') {
    topOnlinePill.dataset.quality = 'busy';
    topOnlinePill.title = `${t('netBusy')} (${m.serverLagMs}ms) · RTT ${m.rttMs}ms`;
  } else if (m.serverLoad === 'yellow') {
    topOnlinePill.dataset.quality = 'fair';
    topOnlinePill.title = `RTT ${m.rttMs}ms · Load YELLOW`;
  } else {
    topOnlinePill.dataset.quality = m.quality;
    topOnlinePill.title = `RTT ${m.rttMs}ms · Jitter ${m.jitterMs}ms`;
  }

  // If queuing and connection drops/becomes unstable OR server reaches red overload -> auto-match CPU!
  if (onTitleScreen && onlineWaitingQueue) {
    if (!m.connected || m.quality === 'poor') {
      autoFallbackToCpu('UNSTABLE NET', 'AUTO-MATCHED VS CPU');
    } else if (m.serverLoad === 'red') {
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
  queueStatusText.textContent = `${t('queueFinding')} 0:00...`;
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

btnHubCpu.addEventListener('click', () => {
  sfx.unlock();
  if (!cpuDialog.open) cpuDialog.showModal();
});

btnHubFriend.addEventListener('click', async () => {
  sfx.unlock();
  roomCreatedBox.hidden = true;
  friendStatusMsg.textContent = t('friendConnecting');
  if (!friendDialog.open) friendDialog.showModal();
  try {
    await onlineClient.connect(getOnlinePlayerName());
    friendStatusMsg.textContent = t('friendConnected');
  } catch {
    friendStatusMsg.textContent = t('friendUnreachable');
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
  setWatchMessage(t('watchLoading'));
  if (!watchDialog.open) watchDialog.showModal();
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.listRooms();
  } catch {
    setWatchMessage(t('friendUnreachable'));
  }
});

btnWatchRefresh.addEventListener('click', async () => {
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.listRooms();
  } catch {
    setWatchMessage(t('friendUnreachable'));
  }
});

btnRoomCreate.addEventListener('click', async () => {
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.createRoom(onlineModeChoice, getOnlinePlayerName(), friendMercyRule.checked);
    friendStatusMsg.textContent = t('friendCreating');
  } catch {
    friendStatusMsg.textContent = t('friendConnFailed');
  }
});

btnRoomJoin.addEventListener('click', async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    friendStatusMsg.textContent = t('friendEnterCode');
    return;
  }
  try {
    await onlineClient.connect(getOnlinePlayerName());
    onlineClient.joinRoom(code, getOnlinePlayerName());
    friendStatusMsg.textContent = `${t('friendJoining')} ${code}...`;
  } catch {
    friendStatusMsg.textContent = t('friendConnFailed');
  }
});

btnCopyCode.addEventListener('click', () => {
  const code = roomCodeDisplay.textContent?.trim() || '';
  if (code) {
    void navigator.clipboard?.writeText(code);
    friendStatusMsg.textContent = `${t('friendCopiedCode')} ${code}`;
  }
});

btnCopyLink.addEventListener('click', () => {
  const code = roomCodeDisplay.textContent?.trim() || '';
  if (code) {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    void navigator.clipboard?.writeText(url);
    friendStatusMsg.textContent = t('friendCopiedLink');
  }
});

function renderWatchRooms(rooms: LiveRoomInfo[]): void {
  watchListEl.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'watch-empty';
    empty.textContent = t('watchEmpty');
    watchListEl.appendChild(empty);
    return;
  }
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'watch-item';

    // Col 1: Inning & Outs (gold big number + outs subtitle)
    const leftCol = document.createElement('div');
    leftCol.className = 'wi-left';
    const innEl = document.createElement('span');
    innEl.className = 'wi-inning';
    innEl.textContent = `${r.half === 'top' ? '▲' : '▼'}${r.inning}`;
    const outsEl = document.createElement('span');
    outsEl.className = 'wi-outs';
    outsEl.textContent = `${r.outs ?? 0} ${t('watchOuts')}`;
    leftCol.append(innEl, outsEl);

    // Col 2: Two stacked player rows with team jersey icon + clean player name
    const playersCol = document.createElement('div');
    playersCol.className = 'wi-players';

    const makePlayerRow = (side: 'away' | 'home', rawName: string) => {
      const pRow = document.createElement('div');
      pRow.className = 'wi-player-row';
      const av = document.createElement('span');
      av.className = `wi-avatar ${side}`;
      av.textContent = side === 'away' ? '黑' : '黃';
      const nm = document.createElement('span');
      nm.className = `wi-name ${side}`;
      nm.textContent = formatScorebugTeamName(rawName);
      pRow.append(av, nm);
      return pRow;
    };
    playersCol.append(makePlayerRow('away', r.awayName), makePlayerRow('home', r.homeName));

    // Col 3: Two stacked scores aligned 1:1 with the players
    const scoresCol = document.createElement('div');
    scoresCol.className = 'wi-scores';
    const awaySc = document.createElement('span');
    awaySc.className = 'wi-score';
    awaySc.textContent = String(r.awayScore);
    const homeSc = document.createElement('span');
    homeSc.className = 'wi-score';
    homeSc.textContent = String(r.homeScore);
    scoresCol.append(awaySc, homeSc);

    // Col 4: LIVE / FRIEND tag on top + rounded pill Watch button below
    const actCol = document.createElement('div');
    actCol.className = 'wi-action';
    const kind = r.roomKind === 'friend' ? 'friend' : 'live';
    const kindTag = document.createElement('span');
    kindTag.className = `wi-kind ${kind}`;
    kindTag.textContent = kind === 'friend' ? t('roomTagFriend') : t('roomTagLive');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wi-watch-btn';
    btn.textContent = t('watchBtn');
    btn.addEventListener('click', () => {
      onlineClient.watchRoom(r.code);
    });
    actCol.append(kindTag, btn);

    row.append(leftCol, playersCol, scoresCol, actCol);
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
  hideMatchOfferToast();
  lobbyHub.hidden = false;
  queuePanel.hidden = true;
  onlineSide = msg.side;
  onlineRoomCode = msg.code;
  onlineRoomKind = msg.roomKind ?? 'live';
  onlinePitchSeq = msg.pitchSeq;
  onlineTurnState = msg.turnState;
  pendingOnlineResult = null;
  queuedOnlinePitchResult = null;
  match = msg.match;
  visualHalf = match.half;
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
  clearPresentationQueue();
  catcherReturn.active = false;
  transitionDirector.clear();
  emoteCtrl.clearHistory();
  emoteCtrl.setOnlineSendEnabled(true);
  emoteCtrl.setVisible(true);
  btnMuteEmotes.hidden = false;
  resetOnlineFreezeState();
  absPromptTimer = 0;
  absReplay = null;
  batterSwungThisPitch = false;
  batCursor = { x: 0, y: 0.72 };
  cam.resetImmediate();
  resetOutfielders(allFielders);
  selectPitch('straight');
  pendingPitchTelemetry = '';
  lastPitchTelemetry = getCurrentRole() === 'pitcher' ? t('telYourPitch') : t('telWaitingPitch');
  resetPitchClock();
  updateHudAndDocks();
  updateSafeCameraFraming(true);
  if (msg.type === 'match_start' && !match.isGameOver) {
    transitionDirector.playMatchStart(match.away.name, match.home.name);
  }
  if (match.isGameOver) {
    saveSession(null);
    showGameOverModal();
  }
}

function enterSpectateMatch(msg: Extract<ServerMessage, { type: 'spectate_sync' }>): void {
  isOnline = true;
  spectating = true;
  onlineWaitingQueue = false;
  hideMatchOfferToast();
  onlineSide = null;
  onlineRoomCode = msg.code;
  onlineRoomKind = msg.roomKind ?? 'live';
  onlinePitchSeq = msg.pitchSeq;
  onlineTurnState = msg.turnState;
  pendingOnlineResult = null;
  queuedOnlinePitchResult = null;
  match = msg.match;
  visualHalf = match.half;
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
  clearPresentationQueue();
  catcherReturn.active = false;
  transitionDirector.clear();
  emoteCtrl.clearHistory();
  emoteCtrl.setOnlineSendEnabled(true);
  emoteCtrl.setVisible(true);
  btnMuteEmotes.hidden = false;
  absPromptTimer = 0;
  absReplay = null;
  batterSwungThisPitch = false;
  batCursor = { x: 0, y: 0.72 };
  cam.resetImmediate();
  resetOutfielders(allFielders);
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
    const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
    match = msg.match;
    onlinePitchSeq = msg.nextPitchSeq;
    onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
    resetSpringMeter();
    const loc = localizeServerCallout(locale, msg.callout.title, msg.callout.subtitle);
    lastCallLabel = loc.subtitle ? `${loc.title} ${loc.subtitle}` : loc.title;
    emoteCtrl.showBroadcast(loc.title, loc.subtitle || loc.title, msg.callout.color, 2400);
    sfx.playUmpireTone('ball');
    presentationQueue.push({ kind: 'brief_pause', remainingSec: 0.9 });
    if (match.isGameOver) {
      presentationQueue.push({ kind: 'game_over' });
    } else {
      const curBatting = match.half === 'top' ? match.away : match.home;
      if (curBatting.batterIndex !== prevBatterIdx) {
        const nextB = getCurrentBatter(match);
        presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
      }
    }
    enterResultPause();
    return;
  }

  const plateX = msg.platePos ? msg.platePos[0] : activePitch ? simToField(activePitch.plateCrossPos)[0] : 0;
  const plateY = msg.platePos ? msg.platePos[1] : activePitch ? simToField(activePitch.plateCrossPos)[1] : 0.72;

  if (msg.resolution && msg.resolution.contact) {
    // Defer applying msg.match until finishBattedPlay() so:
    // 1) match.isGameOver does NOT freeze batted_flight before finishBattedPlay -> showGameOverModal
    // 2) match.half / scoreboard runs don't spoil or swap team colors mid-flight!
    const res = msg.resolution;
    pendingOnlineResult = msg;
    activeBatted = simulateBattedCap(res.battedParams);
    activeCatchInfo = (res.catchInfo as CatchInfo | undefined) ?? null;
    if (activeCatchInfo?.blocked) {
      const blk = simulateOutfieldGroundBlock(activeBatted, buildFullDefense(outfielders));
      if (blk.blocked) {
        activeBatted = blk.battedResult;
        activeCatchInfo.fielderId = blk.fielderId ?? activeCatchInfo.fielderId;
        activeCatchInfo.fielderIndex = blk.fielderIndex ?? activeCatchInfo.fielderIndex;
        activeCatchInfo.blockTimeSec = blk.blockTimeSec;
        activeCatchInfo.blockPos = blk.blockPos;
      }
    }
    bobbledTriggered = false;
    const ev = Math.round(res.exitSpeedKmh);
    const [bvx, bvy, bvz] = res.battedParams.velocity;
    const la =
      typeof res.launchAngleDeg === 'number'
        ? res.launchAngleDeg
        : Math.round((Math.atan2(bvy, Math.hypot(bvx, bvz)) * 180) / Math.PI);
    // Defer showing dual feedback card until batted play finishes & camera pulls back to home plate!
    const swingDotX = res.hitField ? res.hitField[0] : plateX;
    const swingDotY = res.hitField ? res.hitField[1] : plateY;
    pendingBattedFeedback = {
      kind: 'swing',
      pitchCode: lastPitchCode,
      speedKmh: lastPitchSpeedKmh,
      plateX: swingDotX,
      plateY: swingDotY,
      callLabel: res.outcome,
      callColor: res.color,
      dtTiming: res.dtTiming,
      timingLabel: res.label,
      timingColor: res.color,
      batX: msg.swingData ? msg.swingData.batX : swingLockedBatPos.x,
      batY: msg.swingData ? msg.swingData.batY : swingLockedBatPos.y,
      powerSwing: msg.swingData ? msg.swingData.swingMode === 'power' : powerSwing,
      contact: true,
      contactGrade: res.quality.toUpperCase(),
      exitSpeedKmh: ev,
      launchAngleDeg: la,
    };
    if (activeBatted.overFence) {
      transitionDirector.triggerHitStop(0.048);
      transitionDirector.triggerSlowMo(0.62, 0.44);
    } else if (res.quality === 'perfect') {
      transitionDirector.triggerHitStop(0.04);
    }

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
  const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
  const prevBatterName = getCurrentBatter(match).name;
  match = msg.match;
  onlinePitchSeq = msg.nextPitchSeq;
  onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
  if ((getCurrentRole() === 'pitcher' || spectating) && msg.swung) {
    batterAnim = 'follow_through';
    batterAnimTime = 0;
    batterSwungThisPitch = true;
  }
  const isCatcherReturnable =
    msg.outcome !== 'UNCAUGHT_THIRD_STRIKE' && msg.outcome !== 'WILD_PITCH';
  if (isCatcherReturnable) {
    startCatcherReturn(catcherReturn, getPitchingTeamColor(), transitionDirector.config.speed === 'compact');
  }
  if (msg.outcome === 'BALL') {
    sfx.playUmpireTone('ball');
  } else if (msg.outcome === 'UNCAUGHT_THIRD_STRIKE') {
    sfx.playUmpireTone('out');
  } else {
    sfx.playUmpireTone('strike');
  }

  const isStrikeout =
    match.strikes === 0 &&
    match.lastEvent.includes('strikes out');

  if (msg.swung) {
    const swingMissDot = msg.resolution?.hitField
      ? msg.resolution.hitField
      : activePitch
        ? simToField(activePitch.hitPlanePos)
        : ([plateX, plateY, HIT_PLANE_Z] as const);
    const missPayload: SwingFeedbackPayload = {
      kind: 'swing',
      pitchCode: lastPitchCode,
      speedKmh: lastPitchSpeedKmh,
      plateX: swingMissDot[0],
      plateY: swingMissDot[1],
      callLabel: msg.callout.title,
      callColor: msg.callout.color,
      resultDetail: msg.callout.subtitle || undefined,
      dtTiming: msg.resolution?.dtTiming ?? 0,
      timingLabel: msg.resolution?.detail || msg.resolution?.label || 'MISS',
      timingColor: msg.resolution?.color || '#f43f5e',
      batX: msg.swingData ? msg.swingData.batX : swingLockedBatPos.x,
      batY: msg.swingData ? msg.swingData.batY : swingLockedBatPos.y,
      powerSwing: msg.swingData ? msg.swingData.swingMode === 'power' : powerSwing,
      contact: false,
    };
    presentationQueue.push({ kind: 'show_feedback', payload: missPayload, durationSec: getFeedbackDurationSec() });
  } else {
    const takePayload: SwingFeedbackPayload = {
      kind: 'take',
      pitchCode: lastPitchCode,
      speedKmh: lastPitchSpeedKmh,
      plateX,
      plateY,
      callLabel: msg.callout.title,
      callColor: msg.callout.color,
      resultDetail: msg.callout.subtitle || undefined,
    };
    const canAbs =
      !spectating &&
      Boolean(match.lastChallenge && !match.lastChallenge.challenged) &&
      onlineSide === match.lastChallenge?.eligibleSide &&
      match.absChallenges[onlineSide] > 0;
    if (canAbs) {
      // Scheme B (原地翻牌感): Show side card immediately with 3x3 zone masked until ABS decision ends!
      showOnZoneFeedback(takePayload, getFeedbackDurationSec(), true);
      startAbsPromptWindow();
      presentationQueue.push({ kind: 'wait_abs' });
    } else if (
      !spectating &&
      match.lastChallenge &&
      !match.lastChallenge.challenged &&
      match.absChallenges[match.lastChallenge.eligibleSide] > 0
    ) {
      // Opponent has a 2.2s ABS decision window; hold pitcher briefly so they cannot sneak-throw over ABS!
      oppAbsWaitTimer = 2.2;
    }
    presentationQueue.push({ kind: 'show_feedback', payload: takePayload, durationSec: getFeedbackDurationSec() });
  }

  if (isStrikeout && !match.isGameOver) {
    presentationQueue.push({ kind: 'strikeout', batterName: prevBatterName });
  }
  if (msg.inningChanged && !match.isGameOver) {
    presentationQueue.push({
      kind: 'inning_change',
      inning: match.inning,
      half: match.half,
      awayRuns: match.away.totalRuns,
      homeRuns: match.home.totalRuns,
    });
  } else if (match.isGameOver) {
    presentationQueue.push({ kind: 'game_over' });
  } else {
    const curBatting = match.half === 'top' ? match.away : match.home;
    if (curBatting.batterIndex !== prevBatterIdx) {
      const nextB = getCurrentBatter(match);
      presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
    }
  }

  enterResultPause();
}

onlineClient.onMessage((msg) => {
  switch (msg.type) {
    case 'welcome': {
      lastOnlineCount = msg.stats.online;
      topOnlineText.textContent = `${t('livePrefix')} ${lastOnlineCount}`;
      handleServerVersion(msg.version);
      if (typeof msg.updateAtMs === 'number' && msg.updateAtMs > 0) {
        setServerUpdateCountdown(msg.updateAtMs);
      }
      break;
    }
    case 'stats': {
      lastOnlineCount = msg.stats.online;
      topOnlineText.textContent = `${t('livePrefix')} ${lastOnlineCount}`;
      break;
    }
    case 'room_created': {
      saveSession({ code: msg.code, token: msg.token });
      roomCodeDisplay.textContent = msg.code;
      roomCreatedBox.hidden = false;
      if (!friendDialog.open) friendDialog.showModal(); // also after resuming a waiting room
      friendStatusMsg.textContent = `${t('roomCodePrefix')} ${msg.code} · ${t('friendReady')}`;
      break;
    }
    case 'room_joined': {
      saveSession({ code: msg.code, token: msg.token });
      friendStatusMsg.textContent = `${t('friendJoined')} ${msg.code}`;
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
      const prevInning = match.inning;
      const prevHalf = match.half;
      const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
      const prevBatterName = getCurrentBatter(match).name;
      match = msg.match;
      onlinePitchSeq = msg.pitchSeq;
      onlineTurnState = match.isGameOver ? 'game_over' : 'awaiting_pitch';
      absPromptTimer = 0;
      oppAbsWaitTimer = 0;
      btnAbsChallenge.hidden = true;
      clearPresentationQueue();
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

      // Queue post-ABS transitions cleanly after Hawk-Eye replay finishes
      presentationQueue.push({ kind: 'wait_abs_replay' });
      const inningChanged = match.inning !== prevInning || match.half !== prevHalf;
      const struckOut = match.strikes === 0 && match.lastEvent.includes('strikes out');
      if (struckOut && !match.isGameOver) {
        presentationQueue.push({ kind: 'strikeout', batterName: prevBatterName });
      }
      if (inningChanged && !match.isGameOver) {
        presentationQueue.push({
          kind: 'inning_change',
          inning: match.inning,
          half: match.half,
          awayRuns: match.away.totalRuns,
          homeRuns: match.home.totalRuns,
        });
      } else if (match.isGameOver) {
        presentationQueue.push({ kind: 'game_over' });
      } else {
        const curBatting = match.half === 'top' ? match.away : match.home;
        if (curBatting.batterIndex !== prevBatterIdx) {
          const nextB = getCurrentBatter(match);
          presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
        }
      }
      updateHudAndDocks();
      break;
    }
    case 'pause_state': {
      const wasOppPaused =
        onlineSide !== null && onlinePausedSides.some((s) => s !== onlineSide);
      const wasSelfPaused =
        onlineSide !== null && onlinePausedSides.includes(onlineSide);
      onlinePausedSides = msg.pausedSides;
      onlinePauseRemainingSec = msg.remainingSec;
      const nowOppPaused =
        onlineSide !== null && onlinePausedSides.some((s) => s !== onlineSide);
      const nowSelfPaused =
        onlineSide !== null && onlinePausedSides.includes(onlineSide);

      if (nowOppPaused && !wasOppPaused) {
        cancelSpringCharge();
        emoteCtrl.showSystem(t('callOpponentPaused'), `${Math.max(1, Math.ceil(msg.remainingSec))}s`, '#f97316', 2800);
      } else if (!nowOppPaused && wasOppPaused && onlinePausedSides.length === 0) {
        emoteCtrl.showSystem(t('callPlayBall'), '', '#4ade80', 1800);
      }
      // If server's authoritative 20s timeout unpaused us while a dialog is still open, close it cleanly!
      if (wasSelfPaused && !nowSelfPaused && (menuDialog.open || rulesDialog.open || settingsDialog.open)) {
        if (rulesDialog.open) rulesDialog.close();
        if (settingsDialog.open) settingsDialog.close();
        if (menuDialog.open) menuDialog.close();
        menuOnlineTimerEl.hidden = true;
        onlineMenuTimerSec = 0;
        lastSentOnlineMenuPaused = false;
        emoteCtrl.showSystem(t('callMenuTimeout'), t('callResumingMatch'), '#f97316', 2400);
      }
      updateHudAndDocks();
      break;
    }
    case 'opponent_disconnected': {
      onlineOpponentDisconnected = true;
      cancelSpringCharge();
      emoteCtrl.showSystem(t('callOpponentOffline'), `${t('callWaitingReconnect')} (${msg.graceSec}s)...`, '#f97316', 3200);
      updateHudAndDocks();
      break;
    }
    case 'opponent_reconnected': {
      onlineOpponentDisconnected = false;
      emoteCtrl.showSystem(t('callReconnected'), t('callPlayBall'), '#4ade80', 2200);
      updateHudAndDocks();
      break;
    }
    case 'match_over': {
      queuedOnlinePitchResult = null;
      pendingOnlineResult = null;
      resetOnlineFreezeState();
      match = msg.match;
      if (!match.endReason) {
        if (msg.reason === 'disconnect_timeout') match.endReason = 'disconnect';
        else if (msg.reason === 'resign') match.endReason = 'resign';
      }
      visualHalf = match.half;
      onlineTurnState = 'game_over';
      phase = 'result';
      cam.setFollowTarget(null);
      saveSession(null);
      updateHudAndDocks();
      showGameOverModal();
      break;
    }
    case 'rematch_requested': {
      emoteCtrl.showSystem(t('rematchReqTitle'), t('rematchReqSub'), '#f4c41c', 2600);
      break;
    }
    case 'emote': {
      if (msg.side === 'spectator') {
        const specTag = msg.senderName ? `${t('watchPrefix')} · ${msg.senderName}` : t('watchPrefix');
        const isOwnSpec = spectating && msg.senderName === getOnlinePlayerName();
        emoteCtrl.showBubble(msg.id, specTag, !isOwnSpec, true);
      } else {
        const senderTeam = msg.side === 'away' ? match.away.name : match.home.name;
        const isOpp = !spectating && onlineSide !== null && msg.side !== onlineSide;
        emoteCtrl.showBubble(msg.id, senderTeam, isOpp, false);
      }
      break;
    }
    case 'match_offer': {
      if (isOnline || onTitleScreen) {
        onlineClient.replyMatchOffer(msg.offerId, false);
        break;
      }
      pendingMatchOffer = {
        offerId: msg.offerId,
        opponentName: msg.opponentName,
        mode: msg.mode,
        timeoutSec: msg.timeoutSec || 20,
        visible: false,
        shownAtMs: 0,
        expiresAtMs: 0,
      };
      break;
    }
    case 'offer_cancelled': {
      if (pendingMatchOffer && pendingMatchOffer.offerId === msg.offerId) {
        const wasVisible = pendingMatchOffer.visible;
        hideMatchOfferToast();
        if (wasVisible && msg.reason === 'expired') {
          emoteCtrl.showSystem(t('offerExpired'), t('offerExpiredSub'), '#94a3b8', 2600);
        }
      }
      break;
    }
    case 'notice': {
      if (msg.kind === 'draining') {
        setServerUpdateCountdown(msg.updateAtMs, msg.countdownSec ?? 600);
        emoteCtrl.showSystem(t('callMaintenance'), t('callMaintenanceSub'), '#f97316', 3600);
      }
      break;
    }
    case 'error': {
      friendStatusMsg.textContent = msg.message;
      if (msg.code === 'server_busy') {
        autoFallbackToCpu('SERVER BUSY', 'AUTO-MATCHED VS CPU');
      } else if (msg.code === 'draining') {
        onlineWaitingQueue = false;
        queueElapsedSec = 0;
        lobbyHub.hidden = false;
        queuePanel.hidden = true;
        emoteCtrl.showSystem(t('callMaintenance'), t('callMaintenanceSub'), '#f97316', 3400);
        updateHudAndDocks();
      } else if (msg.code === 'reconnect_failed') {
        saveSession(null);
      } else if (msg.code === 'opponent_left') {
        emoteCtrl.showSystem(t('callOpponentLeft'), msg.message.toUpperCase(), '#f97316', 2800);
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
setCursorOffset.addEventListener('change', () => {
  const v = setCursorOffset.value;
  if (v === 'low' || v === 'mid' || v === 'high') {
    cursorOffsetLevel = v;
    try {
      localStorage.setItem(CURSOR_OFFSET_KEY, v);
    } catch {
      // ignore
    }
  }
});
setTransitionSpeed.addEventListener('change', () => {
  const v = setTransitionSpeed.value === 'compact' ? 'compact' : 'normal';
  transitionDirector.config.speed = v;
  try {
    localStorage.setItem(TRANS_SPEED_KEY, v);
  } catch {
    // ignore
  }
});
setFx.addEventListener('change', () => {
  transitionDirector.config.fxEnabled = setFx.checked;
  try {
    localStorage.setItem(FX_ENABLED_KEY, setFx.checked ? '1' : '0');
  } catch {
    // ignore
  }
});
setEmoteSfx.addEventListener('change', () => {
  emoteCtrl.sfxEnabled = setEmoteSfx.checked;
  try {
    localStorage.setItem(EMOTE_SFX_KEY, setEmoteSfx.checked ? '1' : '0');
  } catch {
    // ignore
  }
});
btnMuteEmotes.addEventListener('click', () => {
  emoteCtrl.mutedOpponent = !emoteCtrl.mutedOpponent;
  btnMuteEmotes.textContent = emoteCtrl.mutedOpponent ? t('btnUnmuteEmotes') : t('btnMuteEmotes');
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
          emoteCtrl.showSystem(t('rematchSent'), t('rematchWait'), '#f4c41c', 2400);
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
let wasPresentationLocked = false;

function step(now: number): void {
  const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  const timeSec = now / 1000;
  const fx = transitionDirector.stepFx(rawDt);
  const dt = fx.dt;

  resizeCanvases();

  // Matchmaking 20s fallback timer (enters CPU + joins standby matchmaking queue)
  if (onTitleScreen && onlineWaitingQueue) {
    queueElapsedSec += rawDt;
    const secs = Math.floor(queueElapsedSec);
    queueStatusText.textContent = `${t('queueFinding')} 0:${String(secs).padStart(2, '0')}...`;
    if (queueElapsedSec >= 20) {
      cancelQueueToCpu(true);
    }
  }

  // Server pre-update countdown banner tick
  if (serverUpdateAtMs !== null) {
    updatePreUpdateBannerUi();
  }

  // Non-blocking standby online match offer card (waits until current ball finishes before appearing, then auto-dismisses after 20s)
  if (pendingMatchOffer) {
    if (isOnline || onTitleScreen) {
      hideMatchOfferToast();
    } else if (!pendingMatchOffer.visible) {
      if (phase === 'idle' && presentationQueue.length === 0 && !transitionDirector.isActive()) {
        const nowMs = Date.now();
        cancelSpringCharge();
        pendingMatchOffer.visible = true;
        pendingMatchOffer.shownAtMs = nowMs;
        pendingMatchOffer.expiresAtMs = nowMs + pendingMatchOffer.timeoutSec * 1000;
        lastOfferRenderedSec = -1;
        motBodyEl.textContent = `${t('offerBodyPrefix')} ${pendingMatchOffer.opponentName}`;
        motBarFillEl.style.width = '100%';
        matchOfferToast.hidden = false;
        onlineClient.sendOfferShown(pendingMatchOffer.offerId);
      }
    } else {
      const remMs = pendingMatchOffer.expiresAtMs - Date.now();
      if (remMs <= 0) {
        // Treat 20s timeout identically to declining: close modal, remove from standby queue & pass opponent to next player
        const expiredId = pendingMatchOffer.offerId;
        hideMatchOfferToast();
        if (onlineClient.connected) {
          onlineClient.replyMatchOffer(expiredId, false);
          onlineClient.leaveStandby();
        }
      } else {
        const totalMs = Math.max(1000, pendingMatchOffer.timeoutSec * 1000);
        motBarFillEl.style.width = `${Math.max(0, Math.min(100, (remMs / totalMs) * 100))}%`;
        const remSec = Math.ceil(remMs / 1000);
        if (remSec !== lastOfferRenderedSec) {
          lastOfferRenderedSec = remSec;
          motTimerEl.textContent = `${remSec}s`;
        }
      }
    }
  }

  // Smooth strike zone fade (fades to 0 as soon as pitch_flight begins)
  const targetSzAlpha =
    !onTitleScreen && (phase === 'idle' || phase === 'pitch_meter' || phase === 'windup') ? 1 : 0;
  strikeZoneAlpha += (targetSzAlpha - strikeZoneAlpha) * Math.min(1, rawDt * 14);

  const paused = isGamePaused();

  if (!paused) {
    stepCatcherReturn(catcherReturn, rawDt);
    if (onZoneFeedback) {
      if (onZoneFeedback.absMasked) {
        // Hold crisp & visible while ABS decision window is active (Scheme B: zero premature fade!)
        onZoneFeedback.elapsedSec = 0;
      } else {
        if (typeof onZoneFeedback.absRevealElapsed === 'number') {
          onZoneFeedback.absRevealElapsed += rawDt;
        }
        onZoneFeedback.elapsedSec += rawDt;
        if (onZoneFeedback.elapsedSec >= onZoneFeedback.durationSec) {
          onZoneFeedback = null;
          updateHudAndDocks();
        }
      }
    }
    stepPresentationQueue(rawDt);
    const nowLocked = isPlayCallActive();
    if (nowLocked !== wasPresentationLocked) {
      wasPresentationLocked = nowLocked;
      updateHudAndDocks();
    }

    // Online mode menu pause sync & countdown: notify server so BOTH players' Pitch Clocks freeze!
    syncOnlineMenuPauseState();
    if (onlinePausedSides.length > 0 && onlinePauseRemainingSec > 0) {
      const prevWhole = Math.ceil(onlinePauseRemainingSec);
      onlinePauseRemainingSec = Math.max(0, onlinePauseRemainingSec - rawDt);
      if (Math.ceil(onlinePauseRemainingSec) !== prevWhole) {
        updateHudAndDocks();
      }
    }
    if (oppAbsWaitTimer > 0) {
      oppAbsWaitTimer = Math.max(0, oppAbsWaitTimer - rawDt);
      if (oppAbsWaitTimer === 0) {
        updateHudAndDocks();
      }
    }
    if (isOnlineMenuTimerActive() && (menuDialog.open || rulesDialog.open || settingsDialog.open)) {
      if (onlineMenuTimerSec <= 0) {
        onlineMenuTimerSec = ONLINE_MENU_TIMEOUT_SEC;
      }
      onlineMenuTimerSec = Math.max(0, onlineMenuTimerSec - rawDt);
      updateOnlineMenuTimerUi();
      if (onlineMenuTimerSec <= 0) {
        if (rulesDialog.open) rulesDialog.close();
        if (settingsDialog.open) settingsDialog.close();
        if (menuDialog.open) menuDialog.close();
        menuOnlineTimerEl.hidden = true;
        syncOnlineMenuPauseState();
        emoteCtrl.showSystem(t('callMenuTimeout'), t('callResumingMatch'), '#f97316', 2400);
      }
    } else if (onlineMenuTimerSec > 0) {
      onlineMenuTimerSec = 0;
      menuOnlineTimerEl.hidden = true;
    }

    // ABS prompt & replay decay (synchronized with Play Call card fade-out)
    if (absPromptTimer > 0) {
      absPromptTimer = Math.max(0, absPromptTimer - rawDt);
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

    if (hitFx && hitFx.active) {
      hitFx.elapsedSec += dt;
      if (hitFx.elapsedSec > 0.45) hitFx.active = false;
    }

    // Pitch Clock tick (15s bases empty / 20s runners on base; paused during Feedback, ABS, Transitions, or Menu pause)
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
          const prevBatterIdx = (match.half === 'top' ? match.away : match.home).batterIndex;
          const res = applyPitchClockViolation(match);
          if (res.applied) {
            sfx.playUmpireTone('ball');
            const detailTxt = res.walked ? t('callAutoWalk') : t('callAutoBall');
            lastCallLabel = `${t('callPitchClock')} ${detailTxt}`;
            emoteCtrl.showBroadcast(t('callPitchClock'), detailTxt, '#f97316', 2400);
            presentationQueue.push({ kind: 'brief_pause', remainingSec: 0.9 });
            if (match.isGameOver) {
              presentationQueue.push({ kind: 'game_over' });
            } else {
              const curBatting = match.half === 'top' ? match.away : match.home;
              if (curBatting.batterIndex !== prevBatterIdx) {
                const nextB = getCurrentBatter(match);
                presentationQueue.push({ kind: 'next_batter', orderNum: curBatting.batterIndex + 1, batterName: nextB.name });
              }
            }
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

      if (
        cpuSwingPlan &&
        cpuSwingPlan.shouldSwing &&
        !batterSwungThisPitch &&
        pitchFlightTime >= Math.max(0.05, cpuSwingPlan.swingTimeSec - SWING_LEAD_SEC)
      ) {
        batCursor = { x: cpuSwingPlan.aimX, y: cpuSwingPlan.aimY };
        triggerSwing();
        swingTargetContactTimeSec = cpuSwingPlan.swingTimeSec;
      }

      // Online pitcher/spectator: start visible batter swing buildup SWING_LEAD_SEC before queued contact/plate time
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
          pitchFlightTime >= Math.max(0.02, queuedContactT - SWING_LEAD_SEC)
        ) {
          batterSwungThisPitch = true;
          batterAnim = 'load';
          batterAnimTime = 0;
        }
      }

      const dispatchPendingSwingCheck = (): boolean => {
        if (swingChecked || !activePitch) return false;
        swingChecked = true;
        if (isOnline && !spectating) {
          if (getCurrentRole() === 'batter') {
            onlineNoSwingSentForSeq = onlinePitchSeq;
            onlineClient.sendSwingInput({
              pitchSeq: onlinePitchSeq,
              flightTimeSec: swingTargetContactTimeSec,
              batX: swingLockedBatPos.x,
              batY: swingLockedBatPos.y,
              swingMode: powerSwing ? 'power' : 'normal',
              batterSide: batterHandedness === 'right' ? 'R' : 'L',
            });
            phase = 'awaiting_result';
            updateHudAndDocks();
          }
          return false;
        }
        if (!isOnline) {
          return resolveContact(
            swingTargetContactTimeSec - activePitch.hitPlaneTimeSec,
            swingLockedBatPos.x,
            swingLockedBatPos.y,
          );
        }
        return false;
      };

      if (batterSwungThisPitch) {
        batterAnimTime += dt;
        if (batterAnim === 'load' && batterAnimTime >= SWING_LOAD_SEC) {
          batterAnim = 'swing_early';
          batterAnimTime -= SWING_LOAD_SEC;
        }
        if (batterAnim === 'swing_early' && batterAnimTime >= SWING_EARLY_SEC) {
          batterAnim = 'swing_contact';
          batterAnimTime -= SWING_EARLY_SEC;
          dispatchPendingSwingCheck();
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
        // Never drop a swing pressed near pitch end (e.g. Changeup with short after-hit flight)!
        let handledBySwingFlush = false;
        if (batterSwungThisPitch && !swingChecked) {
          batterAnim = 'swing_contact';
          batterAnimTime = 0;
          const contacted = dispatchPendingSwingCheck();
          if (contacted || phase !== 'pitch_flight') {
            // Contact transitioned into batted_flight or online awaiting_result — do not force miss!
            handledBySwingFlush = true;
          }
        }
        if (!handledBySwingFlush) {
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
      }
    } else if (phase === 'awaiting_result') {
      batterAnimTime += dt;
      if (batterSwungThisPitch) {
        if (batterAnim === 'load' && batterAnimTime >= SWING_LOAD_SEC) {
          batterAnim = 'swing_early';
          batterAnimTime -= SWING_LOAD_SEC;
        }
        if (batterAnim === 'swing_early' && batterAnimTime >= SWING_EARLY_SEC) {
          batterAnim = 'swing_contact';
          batterAnimTime -= SWING_EARLY_SEC;
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

      // Fence impact shockwave + flash (keep batted flight 100% clean; verdict appears in side card after camera rest)
      if (!battedFencePlayed && activeBatted.hitFence && radialDist >= FENCE_DIST - 0.35) {
        battedFencePlayed = true;
        totalFenceHits += 1;
        sfx.playFenceHit();
        fenceFlashAngle = Math.atan2(capPos[0], -capPos[2]);
        fenceFlashAlpha = 1.0;
        fenceImpact = { pos: [...capPos], ageSec: 0, maxAgeSec: 0.5 };
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

      // Authoritative interception target so the fielding defender physically arrives AT the ball (Zero 隔山打牛)
      let interception: FielderInterceptionTarget | null = null;
      if (activeCatchInfo && activeCatchInfo.fielderId) {
        if (activeCatchInfo.blocked && typeof activeCatchInfo.blockTimeSec === 'number') {
          const tPos = activeCatchInfo.blockPos ?? activeBatted.stoppedPos;
          interception = {
            fielderId: activeCatchInfo.fielderId,
            targetPos: tPos,
            targetTimeSec: activeCatchInfo.blockTimeSec,
            isBlock: true,
          };
        } else if (
          (activeCatchInfo.caught || activeCatchInfo.bobbled) &&
          typeof activeCatchInfo.catchTimeSec === 'number'
        ) {
          let tPos = activeCatchInfo.catchPos;
          if (!tPos) {
            const cFrame =
              activeBatted.frames.find((fr) => fr.t >= activeCatchInfo!.catchTimeSec!) ??
              activeBatted.frames[activeBatted.frames.length - 1];
            tPos = cFrame ? cFrame.pos : landingTarget;
          }
          interception = {
            fielderId: activeCatchInfo.fielderId,
            targetPos: tPos,
            targetTimeSec: activeCatchInfo.catchTimeSec,
            isBlock: false,
          };
        }
      }

      const finalTarget = activeBatted.overFence ? landingTarget : activeBatted.stoppedPos;

      updateOutfielders(
        allFielders,
        dt,
        capPos,
        landingTarget,
        airborne,
        battedCaughtInAir,
        battedFlightTime,
        interception,
        finalTarget,
      );

      if (
        activeCatchInfo?.caught &&
        !battedCaughtInAir &&
        activeCatchInfo.catchTimeSec !== null &&
        battedFlightTime >= activeCatchInfo.catchTimeSec
      ) {
        const f = findFielderActor(activeCatchInfo);
        if (f) {
          const hitP = interception?.targetPos ?? capPos;
          f.pos[0] = hitP[0];
          f.pos[2] = hitP[2];
          f.anim = 'dive';
          f.animTime = 0;
          f.diveTimer = 0.6;
          f.flipX = hitP[0] < f.homePos[0];
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
        const f = findFielderActor(activeCatchInfo);
        if (f) {
          const hitP = interception?.targetPos ?? capPos;
          f.pos[0] = hitP[0];
          f.pos[2] = hitP[2];
          f.anim = 'dive';
          f.animTime = 0;
          f.diveTimer = 0.6;
          f.flipX = hitP[0] < f.homePos[0];
        }
      } else if (
        activeCatchInfo?.blocked &&
        !bobbledTriggered &&
        typeof activeCatchInfo.blockTimeSec === 'number' &&
        battedFlightTime >= activeCatchInfo.blockTimeSec - 0.03
      ) {
        bobbledTriggered = true;
        const f = findFielderActor(activeCatchInfo);
        if (f) {
          const hitP = interception?.targetPos ?? capPos;
          f.pos[0] = hitP[0];
          f.pos[2] = hitP[2];
          f.anim = 'dive';
          f.animTime = 0;
          f.diveTimer = 0.55;
          f.flipX = hitP[0] < f.homePos[0];
        }
        sfx.playCatchPop();
        finishBattedPlay();
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
          batterSwungThisPitch = false;
          batCursor = { x: 0, y: 0.72 };
          capVisible = false;
          capTrail = [];
          resetOutfielders(allFielders);
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
      updateOutfielders(allFielders, dt, null, null, false, false);
    }

    cam.update(dt);
  }

  // --- Render Pixel Buffer (True 3D Depth-Sorted Fence, Fielders & Batted Cap) ---
  const pw = pixelCanvas.width;
  const ph = pixelCanvas.height;
  cam.setViewport(pw, ph);
  drawGymBackground(pixelCtx, cam, pw, ph, timeSec);
  const fenceItems = buildFenceDepthItems(pixelCtx, cam, fenceFlashAngle, fenceFlashAlpha);
  const pitcherOffMound =
    Math.hypot(
      pitcherFielder.pos[0] - pitcherFielder.homePos[0],
      pitcherFielder.pos[2] - pitcherFielder.homePos[2],
    ) > 0.12 || pitcherFielder.anim === 'dive';
  const catcherOffPlate =
    Math.hypot(
      catcherFielder.pos[0] - catcherFielder.homePos[0],
      catcherFielder.pos[2] - catcherFielder.homePos[2],
    ) > 0.18 || catcherFielder.anim === 'dive';
  const visibleFielders: OutfielderActor[] = [
    ...outfielders,
    ...(catcherOffPlate ? [catcherFielder] : []),
  ];
  drawWorldEntities(pixelCtx, {
    bank: sprites,
    cam,
    timeSec,
    pitchingTeam: getPitchingTeamColor(),
    battingTeam: getBattingTeamColor(),
    pitcherFrame,
    pitcherFielder: {
      active: pitcherOffMound,
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
  // Converge shrinking timing guide ring at exact optimal press moment (hitPlaneTimeSec - SWING_LEAD_SEC)
  const idealPressTimeSec = activePitch
    ? Math.max(0.08, activePitch.hitPlaneTimeSec - SWING_LEAD_SEC)
    : 0.1;
  const guideProgress =
    phase === 'pitch_flight' && activePitch
      ? pitchFlightTime / idealPressTimeSec
      : null;

  // Play Call + ABS Stack is pinned in screen-space HUD (decoupled from 3D camera motion); update ABS timer bar
  if (!btnAbsChallenge.hidden && absPromptTimer > 0) {
    const pct = Math.max(0, Math.min(100, (absPromptTimer / Math.max(0.1, absPromptMaxTimer)) * 100));
    absTimerFillEl.style.width = `${pct.toFixed(1)}%`;
  }

  overlayCtx.save();
  if (fx.shakeX !== 0 || fx.shakeY !== 0) {
    overlayCtx.translate(fx.shakeX * dpr, fx.shakeY * dpr);
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
    showBatCursor: !batterSwungThisPitch && phase !== 'awaiting_result',
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
    absLabels: {
      strike: t('callStrike'),
      ball: t('callBall'),
      overturned: t('absOverturned'),
      upheld: t('absUpheld'),
      hawkEye: t('absHawkEye'),
    },
    pitchFeedback: onZoneFeedback,
    hudBottomPx: hudTopRegion.getBoundingClientRect().bottom * dpr,
  });
  drawCatcherReturnThrow(overlayCtx, cam, catcherReturn, dpr);
  overlayCtx.restore();

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
      visible: onZoneFeedback !== null,
      grade: onZoneFeedback?.callLabel ?? '',
      detail: onZoneFeedback?.resultDetail ?? '',
      absMasked: Boolean(onZoneFeedback?.absMasked),
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
    void pollHealthVersion();
  }
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    resumeSession();
  }
  void pollHealthVersion();
});

window.addEventListener('focus', () => {
  void pollHealthVersion();
});

window.addEventListener('online', () => {
  void pollHealthVersion();
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
  friendStatusMsg.textContent = `${t('friendJoining')} ${urlCode}...`;
  if (!friendDialog.open) friendDialog.showModal();
  void onlineClient
    .connect(getOnlinePlayerName())
    .then(() => {
      onlineClient.joinRoom(urlCode, getOnlinePlayerName());
    })
    .catch(() => {
      friendStatusMsg.textContent = t('friendUnreachable');
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

void pollHealthVersion();
window.setInterval(() => {
  void pollHealthVersion();
}, 30_000);

applyLocaleToDom();
requestAnimationFrame(step);
