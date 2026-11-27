import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ServerMonitor, type ServerSnapshotInput } from './monitor';
import { MONITOR_HTML, MONITOR_JS } from './monitorUi';
import {
  buildAnalyticsReport,
  MATCH_LOG_MAX_BYTES,
  MAX_RETAINED_MATCHES,
  MAX_RETAINED_PITCHES,
  MAX_RETAINED_SESSIONS,
  maybeTrimJsonlFile,
  PITCH_LOG_MAX_BYTES,
  SESSION_LOG_MAX_BYTES,
} from './analyticsUi';
import { PhysicsPool, type ServerPitchSummary } from './physicsPool';
import { evaluateCatcherCatch } from '../src/ai/cpu';
import {
  decodeOnlineMode,
  decodeSpringZone,
  encodeServerMsgV2,
  normalizeClientMsg,
  round2,
  round3,
  sanitizeDeviceProfile,
  type ClientDeviceProfile,
  type OnlineGameMode,
  type ServerLoadStatus,
  type SpringZoneWire,
} from '../src/net/protocol';
import { simToField } from '../src/physics/batted';
import type { SwingMode } from '../src/physics/contact';
import {
  PITCH_IDS,
  PITCH_SPECS,
  type PitchId,
} from '../src/physics/pitches';
import {
  evaluateUmpirePitchCall,
  judgeBattedCap,
  judgePitch,
} from '../src/rules/judge';
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
  getPitchClockSeconds,
  recordChallengeableCall,
  type MatchState,
  type PlayerSlot,
} from '../src/rules/match';
import { ALL_EMOTE_IDS } from '../src/ui/emotes';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const AWAY_LINEUP: PlayerSlot[] = [
  { id: 'away-1', name: 'NastYboY #99', position: 'LF', number: 99, handedness: 'left', avatar: 'nastyboy' },
  { id: 'away-2', name: 'Skywalker #18', position: 'P', number: 18, handedness: 'right', avatar: 'skywalker' },
  { id: 'away-3', name: 'NastYboY #99', position: 'C', number: 99, handedness: 'left', avatar: 'nastyboy' },
  { id: 'away-4', name: 'Skywalker #18', position: 'DH', number: 18, handedness: 'right', avatar: 'skywalker' },
  { id: 'away-5', name: 'NastYboY #99', position: 'RF', number: 99, handedness: 'left', avatar: 'nastyboy' },
];

const HOME_LINEUP: PlayerSlot[] = [
  { id: 'home-1', name: 'NastYboY #99', position: 'LF', number: 99, handedness: 'left', avatar: 'nastyboy' },
  { id: 'home-2', name: 'Skywalker #18', position: 'P', number: 18, handedness: 'right', avatar: 'skywalker' },
  { id: 'home-3', name: 'NastYboY #99', position: 'C', number: 99, handedness: 'left', avatar: 'nastyboy' },
  { id: 'home-4', name: 'Skywalker #18', position: 'DH', number: 18, handedness: 'right', avatar: 'skywalker' },
  { id: 'home-5', name: 'NastYboY #99', position: 'RF', number: 99, handedness: 'left', avatar: 'nastyboy' },
];

export type OnlineMode = OnlineGameMode;
const ONLINE_MODES: readonly OnlineMode[] = ['quick3', 'tiebreak', 'official6'];
const parseOnlineMode = decodeOnlineMode;
export type Side = 'home' | 'away';
export type TurnState = 'awaiting_pitch' | 'awaiting_swing' | 'game_over';

interface ClientMeta {
  id: string;
  ws: WebSocket;
  ip: string;
  compactV2: boolean;
  name: string;
  rttMs: number;
  roomCode: string | null;
  side: Side | null;
  watchingCode: string | null;
  queuedMode: OnlineMode | null;
  queuedAtMs: number;
  standbyMode: OnlineMode | null;
  standbyPriority: boolean;
  pageActivity: 'title' | 'cpu_match' | 'practice_bat' | 'practice_pitch' | 'pitch_lab';
  lastPingSentAt: number;
  lastPongAt: number;
  lastEmoteAt: number;
  msgWindowStart: number;
  msgCount: number;
  deviceProfile: ClientDeviceProfile | null;
}

interface RoomPlayer {
  token: string;
  name: string;
  clientId: string | null;
  ws: WebSocket | null;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
  disconnectDeadlineAt: number | null;
  device?: ClientDeviceProfile['device'] | null;
  input?: ClientDeviceProfile['input'] | null;
}

interface ActivePitchData {
  pitchSeq: number;
  seed: number;
  /** Spring charge 0..1 reported by the pitcher's client; absent for old clients. Logging only. */
  u?: number;
  pitchId: PitchId;
  speedKmh: number;
  targetX: number;
  targetY: number;
  errorX: number;
  errorY: number;
  breakCm: number;
  springZone: SpringZoneWire | null;
  trajectory: ServerPitchSummary;
}

interface Room {
  code: string;
  matchId: string;
  mode: OnlineMode;
  isMatchmaking: boolean;
  mercyRule: boolean;
  createdAt: number;
  startedAtMs: number;
  lastActivityAt: number;
  match: MatchState;
  pitchSeq: number;
  solvingSeq: number | null;
  turnState: TurnState;
  batterSides: { away: 'R' | 'L'; home: 'R' | 'L' };
  activePitch: ActivePitchData | null;
  swingTimer: NodeJS.Timeout | null;
  pitchClockTimer: NodeJS.Timeout | null;
  pitchClockDeadlineAt: number | null;
  pitchClockRemainingMs: number | null;
  consecutiveClockViolations: Record<Side, number>;
  pausedBy: Set<Side>;
  pauseTimers: Record<Side, NodeJS.Timeout | null>;
  pauseExpiresAt: Record<Side, number>;
  absWindowUntil: number;
  gameOverAbsTimer?: NodeJS.Timeout | null;
  lastSpectatorEmoteAt: number;
  players: {
    home: RoomPlayer;
    away: RoomPlayer | null;
  };
  spectators: Set<ClientMeta>;
  spectatorsPeak: number;
  recorded: boolean;
}

export interface ServerOptions {
  port?: number;
  staticDir?: string;
  matchLogPath?: string;
  pitchLogPath?: string;
  sessionLogPath?: string;
  queueLogPath?: string;
  pingIntervalMs?: number;
  deadSocketTimeoutMs?: number;
  graceMs?: number;
  /** How long (ms) session_check waits for an old socket to answer ws.ping() before treating it as a zombie (default 700). */
  sessionProbeMs?: number;
  /** How long a room with no guest survives its host going offline (sharing the code on a phone). */
  waitingGraceMs?: number;
  swingTimeoutPaddingMs?: number;
  /** Scale factor for server Pitch Clock duration (1 = normal 15s/20s; 0 disables; <1 accelerates tests). */
  pitchClockScale?: number;
  /** Consecutive pitch clock timeouts by the same pitcher before automatic forfeit loss (default 2). */
  pitchClockForfeitLimit?: number;
  /** Max duration (ms) a single player's online menu pause can hold the match (default 20000). */
  menuPauseMs?: number;
  /** Protection window (ms) preventing pitcher sneak-throws while opponent decides on ABS (default 2200). */
  absWindowMs?: number;
  /** How long (ms) a standby player has to accept/decline an online match offer once shown (default 20000). */
  offerTimeoutMs?: number;
  /** Randomize first/second batting (away/home) when a guest joins a friend room (default true). */
  randomizeFriendSides?: boolean;
  maxRooms?: number;
  maxClients?: number;
  /** Soft cap for public matchmaking; clients above this up to maxClients are reserved for Friend Rooms (default maxClients - 20 = 480). */
  publicClientCap?: number;
  maxRssMb?: number;
  maxConnPerIp?: number;
  maxMsgsPerSec?: number;
  metricsLogPath?: string;
  monitorToken?: string;
  metricsCacheMs?: number;
  physicsWorkers?: number;
  getLoadOverride?: () => ServerLoadStatus | null;
}

const wsCompactMode = new WeakMap<WebSocket, boolean>();
const wsMonitorMap = new WeakMap<WebSocket, ServerMonitor>();

function generateGuestName(isTaken?: (candidate: string) => boolean): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 32; attempt++) {
    const pool = chars.split('');
    let out = '';
    for (let i = 0; i < 6; i++) {
      const idx = i + crypto.randomInt(0, pool.length - i);
      const ch = pool[idx];
      pool[idx] = pool[i];
      out += ch;
    }
    if (!isTaken || !isTaken(out)) return out;
  }
  return generateGuestName();
}

function sanitizeName(raw: unknown, isTaken?: (candidate: string) => boolean): string {
  if (typeof raw === 'string') {
    const cleaned = raw
      .replace(/[\x00-\x1f\x7f<>'"`&]/g, '')
      .trim()
      .slice(0, 12);
    if (cleaned.length > 0 && cleaned.toUpperCase() !== 'PLAYER') return cleaned;
  }
  return generateGuestName(isTaken);
}

function generateRoomCode(rooms: Map<string, Room>): string {
  for (let i = 0; i < 2000; i++) {
    let code = '';
    for (let j = 0; j < 4; j++) {
      code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to allocate unique room code');
}

function sendJson(ws: WebSocket | null | undefined, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const compact = wsCompactMode.get(ws);
      const wire =
        compact && payload && typeof payload === 'object'
          ? encodeServerMsgV2(payload as Record<string, unknown>)
          : payload;
      const encoded = JSON.stringify(wire);
      ws.send(encoded);
      const mon = wsMonitorMap.get(ws);
      if (mon) {
        const msgType =
          payload && typeof payload === 'object' && typeof (payload as { type?: unknown }).type === 'string'
            ? (payload as { type: string }).type
            : 'unknown';
        mon.recordWsOut(msgType, Buffer.byteLength(encoded, 'utf8'), 1);
      }
    } catch {
      // ignore closed socket error
    }
  }
}

function getPitchingSide(match: MatchState): Side {
  return match.half === 'top' ? 'home' : 'away';
}

function getBattingSide(match: MatchState): Side {
  return match.half === 'top' ? 'away' : 'home';
}

const MAX_RETAINED_QUEUE = 50000;
const QUEUE_LOG_MAX_BYTES = 5_000_000;

function getMatchLogPath(override?: string): string {
  const target = override || process.env.MATCH_LOG || 'data/matches.jsonl';
  return path.resolve(process.cwd(), target);
}

function getPitchLogPath(override?: string): string {
  const target = override || process.env.PITCH_LOG || 'data/pitches.jsonl';
  return path.resolve(process.cwd(), target);
}

// Default sits next to the pitch log so a deploy that only sets PITCH_LOG still gets a queue log.
function getQueueLogPath(override?: string, pitchOverride?: string): string {
  const target =
    override || process.env.QUEUE_LOG || path.join(path.dirname(getPitchLogPath(pitchOverride)), 'queue.jsonl');
  return path.resolve(process.cwd(), target);
}

function getSessionLogPath(override?: string): string {
  const target = override || process.env.SESSION_LOG || 'data/sessions.jsonl';
  return path.resolve(process.cwd(), target);
}

const ensuredMatchLogDirs = new Set<string>();
let matchLogWriteChain: Promise<void> = Promise.resolve();

function appendJsonlFile(
  logPath: string,
  record: unknown,
  label: string,
  maxLines: number,
  byteThreshold: number,
): void {
  const dir = path.dirname(logPath);
  const line = JSON.stringify(record) + '\n';
  matchLogWriteChain = matchLogWriteChain
    .then(async () => {
      if (!ensuredMatchLogDirs.has(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
        ensuredMatchLogDirs.add(dir);
      }
      await fs.promises.appendFile(logPath, line, 'utf8');
      await maybeTrimJsonlFile(logPath, maxLines, byteThreshold);
    })
    .catch((err) => {
      console.error(`[${label}] write failed:`, err);
    });
}

function appendMatchLog(record: unknown, override?: string): void {
  appendJsonlFile(getMatchLogPath(override), record, 'match-log', MAX_RETAINED_MATCHES, MATCH_LOG_MAX_BYTES);
}

function appendPitchLog(record: unknown, override?: string): void {
  appendJsonlFile(getPitchLogPath(override), record, 'pitch-log', MAX_RETAINED_PITCHES, PITCH_LOG_MAX_BYTES);
}

function appendQueueLog(record: unknown, override?: string, pitchOverride?: string): void {
  appendJsonlFile(getQueueLogPath(override, pitchOverride), record, 'queue-log', MAX_RETAINED_QUEUE, QUEUE_LOG_MAX_BYTES);
}

function appendSessionLog(record: unknown, override?: string): void {
  appendJsonlFile(getSessionLogPath(override), record, 'session-log', MAX_RETAINED_SESSIONS, SESSION_LOG_MAX_BYTES);
}

function generateMatchId(code: string): string {
  return `${Date.now().toString(36)}-${code}`;
}

function buildMatchState(mode: OnlineMode, homeName: string, awayName: string, mercyRule = true): MatchState {
  return createMatch(mode, {
    awayName: `中正黑 ${awayName}`,
    homeName: `中正黃 ${homeName}`,
    awayLineup: AWAY_LINEUP,
    homeLineup: HOME_LINEUP,
    mercyRule,
  });
}

const VALID_EMOTE_IDS = new Set<string>(ALL_EMOTE_IDS);
const VALID_PAGE_ACTIVITIES = new Set<string>(['title', 'cpu_match', 'practice_bat', 'practice_pitch', 'pitch_lab']);

export function startServer(
  port = Number(process.env.PORT) || 8788,
  opts: ServerOptions = {},
): Promise<{
  server: http.Server;
  wss: WebSocketServer;
  rooms: Map<string, Room>;
  port: number;
  close: () => Promise<void>;
}> {
  const staticDir = path.resolve(
    opts.staticDir ||
      process.env.STATIC_DIR ||
      fileURLToPath(new URL('../dist', import.meta.url)),
  );
  const pingIntervalMs = opts.pingIntervalMs ?? 12_000;
  const deadSocketTimeoutMs = opts.deadSocketTimeoutMs ?? Math.max(35_000, pingIntervalMs * 3);
  const graceMs = opts.graceMs ?? 30_000;
  const sessionProbeMs = opts.sessionProbeMs ?? 700;
  const waitingGraceMs = opts.waitingGraceMs ?? 300_000;
  const swingTimeoutPaddingMs = opts.swingTimeoutPaddingMs ?? 4500;
  const pitchClockScale = opts.pitchClockScale ?? 1;
  const pitchClockForfeitLimit = Math.max(1, opts.pitchClockForfeitLimit ?? 2);
  const randomizeFriendSides = opts.randomizeFriendSides ?? true;
  const menuPauseMs = opts.menuPauseMs ?? 20_000;
  const absWindowMs = opts.absWindowMs ?? 2_200;
  const offerTimeoutMs = opts.offerTimeoutMs ?? 15_000;
  const maxRooms = opts.maxRooms ?? (Number(process.env.MAX_ROOMS) || 80);
  const maxClients = opts.maxClients ?? (Number(process.env.MAX_CLIENTS) || 500);
  const publicClientCap =
    opts.publicClientCap ??
    (Number(process.env.PUBLIC_CLIENT_CAP) || Math.max(1, maxClients - 20));
  const maxRssMb = opts.maxRssMb ?? (Number(process.env.MAX_RSS_MB) || 640);
  const maxConnPerIp = opts.maxConnPerIp ?? (Number(process.env.MAX_CONN_PER_IP) || 48);
  const maxMsgsPerSec = opts.maxMsgsPerSec ?? (Number(process.env.MAX_MSGS_PER_SEC) || 30);
  const monitorToken = opts.monitorToken ?? (process.env.MONITOR_TOKEN || '');
  const metricsCacheMs = opts.metricsCacheMs ?? (process.env.VITEST ? 0 : 1000);
  const monitor = new ServerMonitor(opts.metricsLogPath ?? process.env.METRICS_LOG);
  const physicsPool = new PhysicsPool({ workers: opts.physicsWorkers });
  let cachedMetricsPayload = '';
  let cachedMetricsAt = 0;

  interface StaticCacheEntry {
    contentType: string;
    cacheControl: string;
    etag: string;
    raw: Buffer;
    gz: Buffer | null;
  }

  const staticCache = new Map<string, StaticCacheEntry>();
  let staticCacheBytes = 0;

  if (fs.existsSync(staticDir)) {
    const walkStatic = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkStatic(full);
          continue;
        }
        if (!entry.isFile() || entry.name.endsWith('.gz')) continue;
        const rel = '/' + path.relative(staticDir, full).split(path.sep).join('/');
        const ext = path.extname(full).toLowerCase();
        const raw = fs.readFileSync(full);
        let gz: Buffer | null = null;
        try {
          if (fs.existsSync(`${full}.gz`)) {
            gz = fs.readFileSync(`${full}.gz`);
          }
        } catch {
          gz = null;
        }
        const sha = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
        staticCache.set(rel, {
          contentType: MIME_TYPES[ext] || 'application/octet-stream',
          cacheControl: rel.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : rel === '/sw.js' ||
                rel === '/version.json' ||
                rel === '/index.html' ||
                rel === '/pitch-lab.html' ||
                rel === '/manifest.webmanifest'
              ? 'no-store, no-cache, must-revalidate'
              : 'no-cache',
          etag: `"${raw.length}-${sha}"`,
          raw,
          gz,
        });
        staticCacheBytes += raw.length + (gz ? gz.length : 0);
      }
    };
    try {
      walkStatic(staticDir);
    } catch {
      staticCache.clear();
      staticCacheBytes = 0;
    }
  }

  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  let rollingLagMs = 0;

  let version: string | null = null;
  try {
    const vData = JSON.parse(fs.readFileSync(path.join(staticDir, 'version.json'), 'utf8'));
    if (vData?.build) version = String(vData.build);
  } catch {
    version = null;
  }

  const startedAt = Date.now();
  let draining = false;
  let updateAtMs: number | null = null;
  const drainWaiters = new Set<() => void>();
  const clients = new Map<string, ClientMeta>();
  const ipConnCounts = new Map<string, number>();
  const rooms = new Map<string, Room>();
  const queues: Record<OnlineMode, string[]> = {
    quick3: [],
    tiebreak: [],
    official6: [],
  };
  const STANDBY_OFFER_FANOUT = 5;
  const standbyQueues: Record<OnlineMode, string[]> = {
    quick3: [],
    tiebreak: [],
    official6: [],
  };
  const getTotalQueued = () => queues.quick3.length + queues.tiebreak.length + queues.official6.length;
  interface PendingOffer {
    offerId: string;
    mode: OnlineMode;
    standbyClientId: string;
    waitingClientId: string;
    timer: NodeJS.Timeout | null;
    shown: boolean;
  }
  const pendingOffers = new Map<string, PendingOffer>();
  /** Tracks sibling offerIds closed when a contender won the race, so late replies still see "taken" */
  const recentlyTakenOffers = new Map<string, { mode: OnlineMode; takenAtMs: number }>();
  /** Tracks offerIds cancelled because the waiting player cancelled/disconnected, so late accepts get explicit feedback */
  const recentlyCancelledOffers = new Map<string, { mode: OnlineMode; atMs: number }>();

  function pruneRecentlyTakenOffers(nowMs = Date.now()) {
    for (const [id, info] of recentlyTakenOffers.entries()) {
      if (nowMs - info.takenAtMs > 30_000) {
        recentlyTakenOffers.delete(id);
      }
    }
    for (const [id, info] of recentlyCancelledOffers.entries()) {
      if (nowMs - info.atMs > 30_000) {
        recentlyCancelledOffers.delete(id);
      }
    }
  }

  function sampleEventLoopLag(): number {
    const rawP95 = eld.percentile(95);
    if (Number.isFinite(rawP95) && rawP95 > 0) {
      // Subtract the 20ms monitor resolution floor so idle loop reads ~0ms
      rollingLagMs = Math.max(0, Math.round(rawP95 / 1e6 - 20));
    }
    eld.reset();
    return rollingLagMs;
  }

  function getServerLoad() {
    const lagMs = rollingLagMs;
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const override = opts.getLoadOverride?.() ?? null;
    let status: ServerLoadStatus;
    if (override) {
      status = override;
    } else if (
      lagMs >= 160 ||
      rooms.size >= maxRooms ||
      clients.size >= maxClients ||
      rssMb >= maxRssMb * 0.9
    ) {
      status = 'red';
    } else if (
      lagMs >= 80 ||
      rooms.size >= maxRooms * 0.8 ||
      clients.size >= maxClients * 0.85 ||
      rssMb >= maxRssMb * 0.8
    ) {
      status = 'yellow';
    } else {
      status = 'green';
    }
    return {
      status,
      eventLoopLagMs: lagMs,
      rssMb,
      rooms: rooms.size,
      maxRooms,
      clients: clients.size,
      maxClients,
      publicClientCap,
      friendReserveActive: clients.size > publicClientCap && clients.size < maxClients,
    };
  }

  function getStats() {
    const load = getServerLoad();
    return {
      online: clients.size,
      rooms: rooms.size,
      queued: getTotalQueued(),
      load: load.status,
      lagMs: load.eventLoopLagMs,
    };
  }

  let statsBroadcastTimer: NodeJS.Timeout | null = null;

  function broadcastStats() {
    if (statsBroadcastTimer) {
      clearTimeout(statsBroadcastTimer);
      statsBroadcastTimer = null;
    }
    if (clients.size === 0) return;
    const msg = { type: 'stats', stats: getStats() };
    let legacyStr: string | null = null;
    let v2Str: string | null = null;
    let legacyCount = 0;
    let v2Count = 0;
    for (const c of clients.values()) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      try {
        if (c.compactV2) {
          if (v2Str === null) v2Str = JSON.stringify(encodeServerMsgV2(msg));
          c.ws.send(v2Str);
          v2Count += 1;
        } else {
          if (legacyStr === null) legacyStr = JSON.stringify(msg);
          c.ws.send(legacyStr);
          legacyCount += 1;
        }
      } catch {
        // ignore closed socket error
      }
    }
    if (legacyStr !== null && legacyCount > 0) {
      monitor.recordWsOut('stats', Buffer.byteLength(legacyStr, 'utf8'), legacyCount);
    }
    if (v2Str !== null && v2Count > 0) {
      monitor.recordWsOut('stats', Buffer.byteLength(v2Str, 'utf8'), v2Count);
    }
  }

  function scheduleStatsBroadcast() {
    if (statsBroadcastTimer) return;
    statsBroadcastTimer = setTimeout(() => {
      statsBroadcastTimer = null;
      broadcastStats();
    }, 800);
  }

  function buildMonitorSnapshot(): ServerSnapshotInput {
    const now = Date.now();
    let inMatchClients = 0;
    let spectatingClients = 0;
    for (const c of clients.values()) {
      if (c.roomCode) inMatchClients += 1;
      else if (c.watchingCode) spectatingClients += 1;
    }
    let matchmakingRooms = 0;
    let startedRooms = 0;
    let waitingRooms = 0;
    let stalledRooms = 0;
    let disconnectedRooms = 0;
    let highInningRooms = 0;
    let extremeRunDiffRooms = 0;
    let zeroPitchOldRooms = 0;
    let oldestAgeMs = 0;
    let startedPitchSum = 0;
    let maxMatchRuns = 0;

    const roomsByMode: Record<OnlineMode, number> = { quick3: 0, tiebreak: 0, official6: 0 };
    for (const r of rooms.values()) {
      roomsByMode[r.mode] += 1;
      if (r.isMatchmaking) matchmakingRooms += 1;
      const ageMs = Math.max(0, now - r.createdAt);
      if (ageMs > oldestAgeMs) oldestAgeMs = ageMs;

      if (!r.players.away) {
        waitingRooms += 1;
        if (ageMs > 60_000) zeroPitchOldRooms += 1;
        continue;
      }

      if (r.turnState !== 'game_over') {
        startedRooms += 1;
        startedPitchSum += r.match.stats.totalPitches;
        const bothConnected = r.players.home.connected && r.players.away.connected;
        if (!bothConnected) {
          disconnectedRooms += 1;
        } else if (now - r.lastActivityAt > 45_000) {
          stalledRooms += 1;
        }
        if (ageMs > 60_000 && r.match.stats.totalPitches === 0) {
          zeroPitchOldRooms += 1;
        }
      }

      if (r.match.inning >= 8) highInningRooms += 1;
      const runDiff = Math.abs(r.match.home.totalRuns - r.match.away.totalRuns);
      if (runDiff >= 15) extremeRunDiffRooms += 1;
      const topRuns = Math.max(r.match.home.totalRuns, r.match.away.totalRuns);
      if (topRuns > maxMatchRuns) maxMatchRuns = topRuns;
    }

    let maxConnsSingleIp = 0;
    for (const cnt of ipConnCounts.values()) {
      if (cnt > maxConnsSingleIp) maxConnsSingleIp = cnt;
    }

    const offeredStandbyIds = new Set<string>();
    for (const o of pendingOffers.values()) offeredStandbyIds.add(o.standbyClientId);

    const activities: Record<string, number> = {
      online_live: 0,
      online_friend: 0,
      online_queue: 0,
      friend_wait: 0,
      spectating: 0,
      cpu_match: 0,
      practice_bat: 0,
      practice_pitch: 0,
      pitch_lab: 0,
      title: 0,
    };
    let standbyCount = 0;
    for (const c of clients.values()) {
      if (c.standbyMode || offeredStandbyIds.has(c.id)) {
        standbyCount += 1;
      }
      if (c.roomCode) {
        const rm = rooms.get(c.roomCode);
        if (rm && rm.players.away) {
          activities[rm.isMatchmaking ? 'online_live' : 'online_friend'] += 1;
        } else if (rm) {
          activities.friend_wait += 1;
        } else {
          activities[c.pageActivity] += 1;
        }
      } else if (c.watchingCode) {
        activities.spectating += 1;
      } else if (c.queuedMode) {
        activities.online_queue += 1;
      } else {
        activities[c.pageActivity] = (activities[c.pageActivity] ?? 0) + 1;
      }
    }

    return {
      uptimeSec: Math.floor((now - startedAt) / 1000),
      version,
      draining,
      load: getServerLoad(),
      queuesTotal: getTotalQueued(),
      queuesByMode: { quick3: queues.quick3.length, tiebreak: queues.tiebreak.length, official6: queues.official6.length },
      roomsByMode,
      inMatchClients,
      spectatingClients,
      friendRooms: rooms.size - matchmakingRooms,
      matchmakingRooms,
      uniqueIps: ipConnCounts.size,
      maxConnsSingleIp,
      staticCacheFiles: staticCache.size,
      staticCacheMb: Math.round((staticCacheBytes / (1024 * 1024)) * 10) / 10,
      physicsWorkerMode: physicsPool.mode,
      physicsWorkerCount: physicsPool.workerCount,
      activities,
      standbyCount,
      roomsHealth: {
        startedRooms,
        waitingRooms,
        stalledRooms,
        disconnectedRooms,
        highInningRooms,
        extremeRunDiffRooms,
        zeroPitchOldRooms,
        oldestRoomAgeMin: Number((oldestAgeMs / 60_000).toFixed(1)),
        avgMatchPitches: startedRooms > 0 ? Number((startedPitchSum / startedRooms).toFixed(1)) : 0,
        maxMatchRuns,
      },
    };
  }

  function countActiveMatches(): number {
    let active = 0;
    for (const r of rooms.values()) {
      if (r.players.away && r.turnState !== 'game_over') active += 1;
    }
    return active;
  }

  let drainGraceTimer: NodeJS.Timeout | null = null;

  function checkDrainComplete() {
    if (draining && countActiveMatches() === 0) {
      if (drainGraceTimer) {
        clearTimeout(drainGraceTimer);
        drainGraceTimer = null;
      }
      for (const resolve of drainWaiters) resolve();
      drainWaiters.clear();
    }
  }

  function scheduleDrainCompleteCheck(delayMs = 3000) {
    if (!draining || countActiveMatches() > 0) return;
    if (drainGraceTimer) return;
    drainGraceTimer = setTimeout(() => {
      drainGraceTimer = null;
      checkDrainComplete();
    }, delayMs);
  }

  function clearPitchClock(room: Room) {
    if (room.pitchClockTimer) {
      clearTimeout(room.pitchClockTimer);
      room.pitchClockTimer = null;
    }
    room.pitchClockDeadlineAt = null;
    room.pitchClockRemainingMs = null;
  }

  function pausePitchClock(room: Room) {
    if (room.pitchClockTimer) {
      clearTimeout(room.pitchClockTimer);
      room.pitchClockTimer = null;
      if (room.pitchClockDeadlineAt !== null) {
        room.pitchClockRemainingMs = Math.max(250, room.pitchClockDeadlineAt - Date.now());
      }
      room.pitchClockDeadlineAt = null;
    }
  }

  function clearRoomPauses(room: Room) {
    for (const s of ['home', 'away'] as const) {
      if (room.pauseTimers[s]) {
        clearTimeout(room.pauseTimers[s]!);
        room.pauseTimers[s] = null;
      }
      room.pauseExpiresAt[s] = 0;
    }
    room.pausedBy.clear();
  }

  function getPauseRemainingSec(room: Room): number {
    if (room.pausedBy.size === 0) return 0;
    const nowTs = Date.now();
    let maxMs = 0;
    for (const s of room.pausedBy) {
      maxMs = Math.max(maxMs, Math.max(0, room.pauseExpiresAt[s] - nowTs));
    }
    return Math.max(1, Math.ceil(maxMs / 1000));
  }

  function broadcastPauseState(room: Room) {
    sendToRoom(room, {
      type: 'pause_state',
      pausedSides: Array.from(room.pausedBy),
      remainingSec: getPauseRemainingSec(room),
    });
  }

  function armPitchClockMs(room: Room, limitMs: number) {
    if (room.pitchClockTimer) {
      clearTimeout(room.pitchClockTimer);
      room.pitchClockTimer = null;
    }
    room.pitchClockDeadlineAt = null;
    room.pitchClockRemainingMs = null;
    if (pitchClockScale <= 0) return;
    if (!room.players.away || room.turnState !== 'awaiting_pitch' || room.match.isGameOver) return;
    if (!room.players.home.connected || !room.players.away.connected) return;
    if (room.pausedBy.size > 0) {
      room.pitchClockRemainingMs = Math.max(120, limitMs);
      return;
    }
    const clampedMs = Math.max(120, Math.round(limitMs));
    const expectedSeq = room.pitchSeq;
    room.pitchClockDeadlineAt = Date.now() + clampedMs;
    room.pitchClockTimer = setTimeout(() => {
      room.pitchClockTimer = null;
      room.pitchClockDeadlineAt = null;
      room.pitchClockRemainingMs = null;
      if (room.turnState !== 'awaiting_pitch' || room.match.isGameOver || room.pitchSeq !== expectedSeq) return;
      if (!room.players.home.connected || !room.players.away?.connected) return;
      if (room.pausedBy.size > 0) return;

      const pitchingSide = getPitchingSide(room.match);
      const battingSide = getBattingSide(room.match);
      room.consecutiveClockViolations[pitchingSide] += 1;
      const violationCount = room.consecutiveClockViolations[pitchingSide];
      monitor.pitchClockViolations += 1;
      room.lastActivityAt = Date.now();

      if (violationCount >= pitchClockForfeitLimit) {
        clearPitchClock(room);
        clearRoomPauses(room);
        room.absWindowUntil = 0;
        if (room.swingTimer) {
          clearTimeout(room.swingTimer);
          room.swingTimer = null;
        }
        room.match.isGameOver = true;
        room.match.winner = battingSide;
        room.match.endReason = 'pitch_clock';
        room.match.lastEvent = `${room.players[pitchingSide]?.name ?? pitchingSide} forfeited (pitch clock x${violationCount})`;
        room.turnState = 'game_over';
        room.activePitch = null;
        recordMatchEnd(room, 'pitch_clock_forfeit');
        sendToRoom(room, {
          type: 'match_over',
          winner: battingSide,
          reason: 'pitch_clock_forfeit',
          match: room.match,
        });
        return;
      }

      const res = applyPitchClockViolation(room.match);
      if (!res.applied) return;
      const solvedSeq = room.pitchSeq;
      room.pitchSeq += 1;
      room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
      recordPitchAnalytics(room, {
        event: 'pitch_clock',
        pitchSeq: solvedSeq,
        inning: room.match.inning,
        half: room.match.half,
        pitcherSide: pitchingSide,
        pitcherName: room.players[pitchingSide]?.name ?? pitchingSide,
        violationCount,
        outcome: res.walked ? 'WALK' : 'BALL',
      });
      sendToRoom(room, {
        type: 'pitch_result',
        pitchSeq: solvedSeq,
        nextPitchSeq: room.pitchSeq,
        swung: false,
        clockViolation: true,
        swingData: null,
        resolution: null,
        outcome: res.walked ? 'WALK' : 'BALL',
        callout: {
          title: 'PITCH CLOCK',
          subtitle: res.walked
            ? `WALK (BB) · ${violationCount}/${pitchClockForfeitLimit}`
            : `AUTO BALL · ${violationCount}/${pitchClockForfeitLimit}`,
          color: '#f97316',
          ttl: 2.2,
        },
        inningChanged: false,
        telemetry: `PITCH CLOCK (${violationCount}/${pitchClockForfeitLimit})`,
        match: room.match,
      });
      if (room.match.isGameOver) {
        recordMatchEnd(room, 'completed');
      } else {
        armPitchClock(room, 2600);
      }
    }, clampedMs);
  }

  function armPitchClock(room: Room, postCallBufferMs = 2800) {
    if (pitchClockScale <= 0) {
      clearPitchClock(room);
      return;
    }
    const limitMs = Math.max(
      120,
      Math.round((getPitchClockSeconds(room.match) * 1000 + postCallBufferMs) * pitchClockScale),
    );
    armPitchClockMs(room, limitMs);
  }

  function resumePitchClock(room: Room) {
    if (room.pausedBy.size > 0) return;
    if (!room.players.away || !room.players.home.connected || !room.players.away.connected) return;
    if (room.turnState !== 'awaiting_pitch' || room.match.isGameOver) return;
    if (room.pitchClockTimer) return;
    if (room.pitchClockRemainingMs !== null) {
      const floorMs = Math.round(1500 * pitchClockScale);
      const rem = Math.max(floorMs, room.pitchClockRemainingMs);
      armPitchClockMs(room, rem);
    } else {
      armPitchClock(room, 1500);
    }
  }

  function cleanupRoom(code: string) {
    const room = rooms.get(code);
    if (!room) return;
    clearPitchClock(room);
    clearRoomPauses(room);
    if (room.swingTimer) {
      clearTimeout(room.swingTimer);
      room.swingTimer = null;
    }
    if (room.gameOverAbsTimer) {
      clearTimeout(room.gameOverAbsTimer);
      room.gameOverAbsTimer = null;
    }
    for (const side of ['home', 'away'] as const) {
      const p = room.players[side];
      if (p?.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = null;
      }
      if (p?.clientId) {
        const c = clients.get(p.clientId);
        if (c && c.roomCode === code) {
          c.roomCode = null;
          c.side = null;
        }
      }
    }
    for (const spec of room.spectators) {
      if (spec.watchingCode === code) spec.watchingCode = null;
    }
    room.spectators.clear();
    rooms.delete(code);
    checkDrainComplete();
  }

  /** A player's reconnect grace ran out: forfeit a started match, then free the room. */
  function expireSeat(code: string, side: Side) {
    const room = rooms.get(code);
    const player = room?.players[side];
    if (!room || !player) return;
    player.disconnectTimer = null;
    const oppSide: Side = side === 'home' ? 'away' : 'home';
    if (room.players.away && room.turnState !== 'game_over') {
      room.match.isGameOver = true;
      room.match.winner = oppSide;
      room.match.endReason = 'disconnect';
      room.match.lastEvent = `${player.name} disconnected (timeout)`;
      room.turnState = 'game_over';
      recordMatchEnd(room, 'disconnect_timeout');
      sendToRoom(room, {
        type: 'match_over',
        winner: oppSide,
        reason: 'disconnect_timeout',
        match: room.match,
      });
    } else if (!room.players.away) {
      monitor.waitingExpired += 1;
    }
    cleanupRoom(code);
  }

  function recordMatchEnd(room: Room, reason: string) {
    if (room.recorded) return;
    room.recorded = true;
    if (reason === 'completed') monitor.matchesCompleted += 1;
    else if (reason === 'resign' || reason === 'pitch_clock_forfeit') monitor.matchesResigned += 1;
    else if (reason === 'disconnect_timeout') monitor.matchesDisconnectTimeout += 1;
    const durationSec = room.startedAtMs > 0 ? Math.max(0, Math.round((Date.now() - room.startedAtMs) / 1000)) : 0;
    appendMatchLog(
      {
        ts: new Date().toISOString(),
        matchId: room.matchId,
        code: room.code,
        roomKind: room.isMatchmaking ? 'live' : 'friend',
        mode: room.mode,
        durationSec,
        reason,
        endReason: room.match.endReason ?? null,
        winner: room.match.winner,
        awayName: room.players.away?.name ?? room.match.away.name,
        homeName: room.players.home.name,
        awayDevice: room.players.away?.device ?? null,
        homeDevice: room.players.home.device ?? null,
        awayInput: room.players.away?.input ?? null,
        homeInput: room.players.home.input ?? null,
        awayRuns: room.match.away.totalRuns,
        homeRuns: room.match.home.totalRuns,
        awayHits: room.match.away.hits,
        homeHits: room.match.home.hits,
        awayWalks: room.match.away.walks,
        homeWalks: room.match.home.walks,
        awayStrikeouts: room.match.away.strikeouts,
        homeStrikeouts: room.match.home.strikeouts,
        awayPitches: room.match.away.pitchesThrown,
        homePitches: room.match.home.pitchesThrown,
        awayRunsByInning: room.match.away.runsByInning,
        homeRunsByInning: room.match.home.runsByInning,
        innings: room.match.inning,
        pitches: room.match.stats.totalPitches,
        homeRunsCount: room.match.stats.homeRuns,
        absUsedAway: Math.max(0, 2 - room.match.absChallenges.away),
        absUsedHome: Math.max(0, 2 - room.match.absChallenges.home),
        spectatorsPeak: room.spectatorsPeak,
      },
      opts.matchLogPath,
    );
    // Allow 3s for final pitch_result / match_over delivery before draining server exits
    scheduleDrainCompleteCheck(3000);
  }

  function recordPitchAnalytics(room: Room, data: Record<string, unknown>) {
    appendPitchLog(
      {
        ts: new Date().toISOString(),
        matchId: room.matchId,
        code: room.code,
        roomKind: room.isMatchmaking ? 'live' : 'friend',
        mode: room.mode,
        ...(version ? { version } : {}),
        ...data,
      },
      opts.pitchLogPath,
    );
  }

  function removeFromStandby(clientId: string) {
    for (const m of ONLINE_MODES) {
      const idx = standbyQueues[m].indexOf(clientId);
      if (idx !== -1) standbyQueues[m].splice(idx, 1);
    }
    const c = clients.get(clientId);
    if (c) {
      c.standbyMode = null;
      c.standbyPriority = false;
    }
  }

  function enqueueStandby(c: ClientMeta, mode: OnlineMode, priority: boolean, frontOfTier = false) {
    removeFromStandby(c.id);
    c.standbyMode = mode;
    c.standbyPriority = priority;
    const sq = standbyQueues[mode];
    if (priority) {
      if (frontOfTier) {
        sq.unshift(c.id);
      } else {
        // Insert right after existing priority clients, ahead of passive CPU/practice standby clients
        const firstNormalIdx = sq.findIndex((id) => !clients.get(id)?.standbyPriority);
        if (firstNormalIdx === -1) sq.push(c.id);
        else sq.splice(firstNormalIdx, 0, c.id);
      }
    } else if (frontOfTier) {
      const firstNormalIdx = sq.findIndex((id) => !clients.get(id)?.standbyPriority);
      if (firstNormalIdx === -1) sq.push(c.id);
      else sq.splice(firstNormalIdx, 0, c.id);
    } else {
      sq.push(c.id);
    }
  }

  function cancelOffersForClient(clientId: string, reason: string, requeueStandby = true) {
    let changed = false;
    for (const [offerId, offer] of [...pendingOffers.entries()]) {
      if (offer.waitingClientId === clientId) {
        if (offer.timer) clearTimeout(offer.timer);
        pendingOffers.delete(offerId);
        changed = true;
        if (reason === 'taken') {
          recentlyTakenOffers.set(offerId, { mode: offer.mode, takenAtMs: Date.now() });
        } else if (reason === 'waiter_cancelled') {
          recentlyCancelledOffers.set(offerId, { mode: offer.mode, atMs: Date.now() });
        }
        const sc = clients.get(offer.standbyClientId);
        if (sc && sc.ws.readyState === WebSocket.OPEN) {
          sendJson(sc.ws, { type: 'offer_cancelled', offerId, reason });
          if (requeueStandby && !sc.roomCode && !draining) {
            enqueueStandby(sc, offer.mode, reason === 'taken' ? true : sc.standbyPriority, true);
          }
        }
      } else if (offer.standbyClientId === clientId) {
        if (offer.timer) clearTimeout(offer.timer);
        pendingOffers.delete(offerId);
        changed = true;
        const mode = offer.mode;
        tryOfferToStandby(mode);
      }
    }
    if (changed) scheduleStatsBroadcast();
  }

  function logQueue(record: Record<string, unknown>) {
    appendQueueLog({ ts: new Date().toISOString(), ...record }, opts.queueLogPath, opts.pitchLogPath);
  }

  function removeFromQueues(clientId: string, reason: 'cancel' | 'disconnect' | 'matched' | 'drain' = 'cancel') {
    const queued = clients.get(clientId);
    if (queued?.queuedMode) {
      logQueue({
        event: 'queue_leave',
        cid: clientId,
        mode: queued.queuedMode,
        reason,
        waitMs: Date.now() - queued.queuedAtMs,
      });
    }
    for (const m of ONLINE_MODES) {
      const idx = queues[m].indexOf(clientId);
      if (idx !== -1) queues[m].splice(idx, 1);
    }
    const c = clients.get(clientId);
    if (c) c.queuedMode = null;
    removeFromStandby(clientId);
    cancelOffersForClient(clientId, 'waiter_cancelled', true);
  }

  /**
   * If a client is only sitting alone as the host of an unstarted waiting room (away === null),
   * close that waiting room so they can freely join a friend's room, re-create, queue, or watch.
   */
  function abandonWaitingRoomIfHost(client: ClientMeta): boolean {
    if (!client.roomCode) return false;
    const existing = rooms.get(client.roomCode);
    if (!existing) {
      client.roomCode = null;
      client.side = null;
      return true;
    }
    if (!existing.players.away && existing.players.home.clientId === client.id) {
      if (existing.players.home.disconnectTimer) {
        clearTimeout(existing.players.home.disconnectTimer);
        existing.players.home.disconnectTimer = null;
      }
      rooms.delete(existing.code);
      client.roomCode = null;
      client.side = null;
      return true;
    }
    return false;
  }

  function sendToRoom(room: Room, payload: unknown) {
    sendJson(room.players.home.ws, payload);
    if (room.players.away) {
      sendJson(room.players.away.ws, payload);
    }
    for (const spec of room.spectators) {
      if (spec.ws.readyState !== WebSocket.OPEN) {
        room.spectators.delete(spec);
        continue;
      }
      sendJson(spec.ws, payload);
    }
  }

  function getCurrentBatterSide(room: Room): 'R' | 'L' {
    return room.batterSides[getBattingSide(room.match)];
  }

  function sendStateSync(room: Room, side: Side) {
    const player = room.players[side];
    if (!player?.ws) return;
    const client = player.clientId ? clients.get(player.clientId) : null;
    sendJson(player.ws, {
      type: 'state_sync',
      code: room.code,
      mode: room.mode,
      roomKind: room.isMatchmaking ? 'live' : 'friend',
      side,
      pitchSeq: room.pitchSeq,
      turnState: room.turnState,
      batterSide: getCurrentBatterSide(room),
      batterSides: room.batterSides,
      match: room.match,
      names: {
        home: room.players.home.name,
        away: room.players.away?.name ?? 'WAITING',
      },
      activePitch: room.activePitch
        ? {
            pitchSeq: room.activePitch.pitchSeq,
            seed: room.activePitch.seed,
            pitchId: room.activePitch.pitchId,
            speedKmh: room.activePitch.speedKmh,
            targetX: room.activePitch.targetX,
            targetY: room.activePitch.targetY,
            errorX: room.activePitch.errorX,
            errorY: room.activePitch.errorY,
            breakCm: room.activePitch.breakCm,
          }
        : null,
      rtt: client?.rttMs ?? 0,
      spectators: room.spectators.size,
    });
  }

  function broadcastSpectatorCount(room: Room) {
    if (room.spectators.size > room.spectatorsPeak) {
      room.spectatorsPeak = room.spectators.size;
    }
    sendToRoom(room, {
      type: 'spectator_count',
      count: room.spectators.size,
    });
  }

  function resolveNoContactPitch(
    room: Room,
    swung: boolean,
    swingData: {
      flightTimeSec: number;
      batX: number;
      batY: number;
      swingMode: SwingMode;
      batterSide: 'R' | 'L';
    } | null = null,
    missResolution: {
      contact: false;
      feedback: string;
      label: string;
      detail: string;
      color: string;
      quality: 'weak';
      dtTiming: number;
      hitField: readonly [number, number, number];
    } | null = null,
  ) {
    if (!room.activePitch) return;
    const activeSnap = room.activePitch;
    const traj = activeSnap.trajectory;
    const plateField = simToField(traj.plateCrossPos);
    const effectiveReachesPassLine = traj.reachesPassLine || plateField[1] < 0.14;
    const catchRes = evaluateCatcherCatch(
      plateField[0],
      plateField[1],
      effectiveReachesPassLine,
      {
        pitchId: activeSnap.pitchId,
        speedKmh: activeSnap.speedKmh,
        breakCm: activeSnap.breakCm,
        seed: activeSnap.seed,
      },
    );
    const caughtByCatcher = catchRes.caught;

    const prevInning = room.match.inning;
    const prevHalf = room.match.half;
    const prevBalls = room.match.balls;
    const prevStrikes = room.match.strikes;
    const prevOuts = room.match.outs;
    const prevBasesMask =
      (room.match.bases[0] !== null ? 1 : 0) |
      (room.match.bases[1] !== null ? 2 : 0) |
      (room.match.bases[2] !== null ? 4 : 0);
    const pitcherSide = getPitchingSide(room.match);
    const batterSideRole = getBattingSide(room.match);

    let outcomeStr: string;
    let callout: { title: string; subtitle: string; color: string; ttl: number };
    let recordedTrueCall: 'strike' | 'ball' | undefined;
    let recordedUmpireCall: 'strike' | 'ball' | undefined;

    if (room.match.derby.active) {
      room.match.lastChallenge = null;
      applyDerbySwingResult(room.match, false);
      outcomeStr = swung ? 'STRIKE' : 'BALL';
      callout = {
        title: 'NO HR',
        subtitle: swung ? 'SWING & MISS · NO HR' : 'TAKEN · NO HR',
        color: '#94a3b8',
        ttl: 1.35,
      };
    } else if (!swung) {
      const umpireEval = evaluateUmpirePitchCall(
        plateField[0],
        plateField[1],
        room.activePitch.seed,
      );
      recordedTrueCall = umpireEval.trueCall;
      recordedUmpireCall = umpireEval.umpireCall;
      const preSnap = captureAbsPreSnapshot(room.match);
      const res = judgePitch({
        plateX: plateField[0],
        plateY: plateField[1],
        swung: false,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: effectiveReachesPassLine,
        currentStrikes: room.match.strikes,
        runnersOnBase: room.match.bases.some((b) => b !== null),
        forceCall: umpireEval.umpireCall,
      });

      applyPitchResult(room.match, {
        plateX: plateField[0],
        plateY: plateField[1],
        swung: false,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: effectiveReachesPassLine,
        forceCall: umpireEval.umpireCall,
      });

      recordChallengeableCall(room.match, {
        pitchSeq: room.activePitch.pitchSeq,
        plateX: plateField[0],
        plateY: plateField[1],
        trueCall: umpireEval.trueCall,
        umpireCall: umpireEval.umpireCall,
        marginM: umpireEval.marginM,
        preSnapshot: preSnap,
        caughtByCatcher,
        reachesPassLine: effectiveReachesPassLine,
        catchKind: catchRes.kind,
      });

      outcomeStr = res.call;
      const isBB = !res.isStrike && room.match.balls === 0 && room.match.lastEvent.includes('walks');
      if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
        callout = { title: 'UNCAUGHT 3RD', subtitle: 'DROPPED 3RD · BATTER TO 1B', color: '#f97316', ttl: 1.7 };
      } else if (res.isWildPitch) {
        const isPb = catchRes.kind === 'passed_ball';
        if (isBB) {
          callout = isPb
            ? { title: 'WALK + PASSED BALL', subtitle: 'PASSED BALL · WALK + RUNNERS ADVANCE', color: '#f97316', ttl: 1.7 }
            : { title: 'WALK + WILD PITCH', subtitle: 'WILD PITCH · WALK + RUNNERS ADVANCE', color: '#f97316', ttl: 1.7 };
        } else {
          callout = isPb
            ? { title: 'PASSED BALL', subtitle: 'PASSED BALL · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 }
            : { title: 'WILD PITCH', subtitle: 'WILD PITCH · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 };
        }
      } else if (res.isStrike) {
        const isK = room.match.strikes === 0 && room.match.lastEvent.includes('strikes out');
        callout = {
          title: isK ? 'STRIKE OUT!' : 'STRIKE',
          subtitle: isK ? 'CALLED STRIKE THREE' : 'CALLED STRIKE',
          color: isK ? '#f43f5e' : '#f4c41c',
          ttl: 1.25,
        };
      } else {
        callout = {
          title: isBB ? 'WALK (BB)' : 'BALL',
          subtitle: isBB ? 'BASE ON BALLS' : 'OUTSIDE ZONE',
          color: '#4ade80',
          ttl: 1.25,
        };
      }
    } else {
      room.match.lastChallenge = null;
      const res = judgePitch({
        plateX: plateField[0],
        plateY: plateField[1],
        swung: true,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: effectiveReachesPassLine,
        currentStrikes: room.match.strikes,
        runnersOnBase: room.match.bases.some((b) => b !== null),
      });

      applyPitchResult(room.match, {
        plateX: plateField[0],
        plateY: plateField[1],
        swung: true,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: effectiveReachesPassLine,
      });

      outcomeStr = res.call;
      if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
        callout = { title: 'UNCAUGHT 3RD', subtitle: 'DROPPED 3RD · BATTER TO 1B', color: '#f97316', ttl: 1.7 };
      } else if (res.isWildPitch) {
        const isPb = catchRes.kind === 'passed_ball';
        callout = isPb
          ? { title: 'PASSED BALL', subtitle: 'PASSED BALL · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 }
          : { title: 'WILD PITCH', subtitle: 'WILD PITCH · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 };
      } else {
        const isK = room.match.strikes === 0 && room.match.lastEvent.includes('strikes out');
        callout = {
          title: isK ? 'STRIKE OUT!' : 'STRIKE',
          subtitle: 'SWINGING STRIKE',
          color: isK ? '#f43f5e' : '#f4c41c',
          ttl: 1.25,
        };
      }
    }

    const inningChanged = room.match.inning !== prevInning || room.match.half !== prevHalf;
    const solvedSeq = activeSnap.pitchSeq;
    const spec = PITCH_SPECS[activeSnap.pitchId];
    const telemetry = `${spec.code} ${Math.round(activeSnap.speedKmh)} km/h · BRK ${activeSnap.breakCm}cm`;

    recordPitchAnalytics(room, {
      event: 'pitch',
      pitchSeq: solvedSeq,
      inning: prevInning,
      half: prevHalf,
      ballsBefore: prevBalls,
      strikesBefore: prevStrikes,
      outsBefore: prevOuts,
      basesMaskBefore: prevBasesMask,
      pitcherSide,
      batterSide: batterSideRole,
      batterHand: getCurrentBatterSide(room),
      pitcherName: room.players[pitcherSide]?.name ?? pitcherSide,
      batterName: room.players[batterSideRole]?.name ?? batterSideRole,
      pitcherDevice: room.players[pitcherSide]?.device ?? null,
      batterDevice: room.players[batterSideRole]?.device ?? null,
      pitcherInput: room.players[pitcherSide]?.input ?? null,
      batterInput: room.players[batterSideRole]?.input ?? null,
      pitchId: activeSnap.pitchId,
      seed: activeSnap.seed,
      ...(activeSnap.u !== undefined ? { u: activeSnap.u } : {}),
      speedKmh: round2(activeSnap.speedKmh),
      springZone: activeSnap.springZone ?? null,
      targetX: round3(activeSnap.targetX),
      targetY: round3(activeSnap.targetY),
      errorX: round3(activeSnap.errorX),
      errorY: round3(activeSnap.errorY),
      plateX: round3(plateField[0]),
      plateY: round3(plateField[1]),
      breakCm: activeSnap.breakCm,
      ...(recordedTrueCall ? { trueCall: recordedTrueCall } : {}),
      ...(recordedUmpireCall ? { umpireCall: recordedUmpireCall } : {}),
      swung,
      powerSwing: swingData?.swingMode === 'power',
      dtTiming: missResolution ? round3(missResolution.dtTiming) : null,
      batX: swingData ? round3(swingData.batX) : null,
      batY: swingData ? round3(swingData.batY) : null,
      contact: false,
      outcome: outcomeStr,
      caughtByCatcher,
      catchKind: catchRes.kind,
      droppedThirdStrike: outcomeStr === 'UNCAUGHT_THIRD_STRIKE',
      inningChanged,
      awayRunsAfter: room.match.away.totalRuns,
      homeRunsAfter: room.match.home.totalRuns,
    });

    room.pitchSeq += 1;
    room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
    room.activePitch = null;

      sendToRoom(room, {
        type: 'pitch_result',
        pitchSeq: solvedSeq,
        nextPitchSeq: room.pitchSeq,
        swung,
        swingData,
        resolution: missResolution,
        outcome: outcomeStr,
        callout,
        inningChanged,
        telemetry,
        platePos: [plateField[0], plateField[1]],
        match: room.match,
      });
      if (inningChanged && !room.match.isGameOver) {
        sendToRoom(room, {
          type: 'batter_side',
          side: getCurrentBatterSide(room),
          team: getBattingSide(room.match),
        });
      }

    const lc = room.match.lastChallenge;
    const absEligible =
      !swung &&
      Boolean(lc && !lc.challenged && room.match.absChallenges[lc.eligibleSide] > 0);
    if (room.match.isGameOver) {
      if (room.gameOverAbsTimer) {
        clearTimeout(room.gameOverAbsTimer);
        room.gameOverAbsTimer = null;
      }
      if (absEligible && absWindowMs > 0) {
        // Hold final match recording briefly so the losing/affected side can ABS-challenge the game-ending call!
        const holdMs = Math.max(400, Math.round((absWindowMs + 1500) * (pitchClockScale > 0 ? Math.min(1, pitchClockScale) : 1)));
        room.absWindowUntil = Date.now() + holdMs;
        room.gameOverAbsTimer = setTimeout(() => {
          room.gameOverAbsTimer = null;
          if (rooms.get(room.code) === room && room.match.isGameOver && !room.recorded) {
            room.absWindowUntil = 0;
            recordMatchEnd(room, 'completed');
          }
        }, holdMs);
      } else {
        room.absWindowUntil = 0;
        recordMatchEnd(room, 'completed');
      }
    } else {
      room.absWindowUntil =
        absEligible && absWindowMs > 0
          ? Date.now() + Math.round(absWindowMs * (pitchClockScale > 0 ? Math.min(1, pitchClockScale) : 1))
          : 0;
      const struckOut = room.match.strikes === 0 && room.match.lastEvent.includes('strikes out');
      const bufMs =
        2400 +
        (absEligible ? 2400 : 0) +
        (struckOut ? 1400 : 0) +
        (inningChanged ? 1200 : 0);
      armPitchClock(room, bufMs);
    }
  }

  async function finalizeSwing(
    room: Room,
    swung: boolean,
    swingData: {
      flightTimeSec: number;
      batX: number;
      batY: number;
      swingMode: SwingMode;
      batterSide: 'R' | 'L';
    } | null,
  ): Promise<void> {
    if (room.turnState !== 'awaiting_swing' || !room.activePitch) return;
    if (room.solvingSeq === room.activePitch.pitchSeq) return;
    if (room.swingTimer) {
      clearTimeout(room.swingTimer);
      room.swingTimer = null;
    }
    if (room.gameOverAbsTimer) {
      clearTimeout(room.gameOverAbsTimer);
      room.gameOverAbsTimer = null;
    }

    if (!swung || !swingData) {
      resolveNoContactPitch(room, false);
      return;
    }

    const expectedSeq = room.activePitch.pitchSeq;
    const traj = room.activePitch.trajectory;
    const pitchSeed = room.activePitch.seed;
    room.solvingSeq = expectedSeq;

    let resolution: Awaited<ReturnType<typeof physicsPool.evaluateSwing>>['result'];
    try {
      const evaluated = await physicsPool.evaluateSwing({
        hitPlanePos: traj.hitPlanePos,
        hitPlaneTimeSec: traj.hitPlaneTimeSec,
        hitPlaneSpeedMs: traj.hitPlaneSpeedMs,
        flightTimeSec: swingData.flightTimeSec,
        batX: swingData.batX,
        batY: swingData.batY,
        swingMode: swingData.swingMode,
        batterSide: swingData.batterSide,
        seed: pitchSeed,
      });
      resolution = evaluated.result;
    } catch {
      if (room.solvingSeq === expectedSeq) room.solvingSeq = null;
      return;
    }

    if (room.solvingSeq === expectedSeq) room.solvingSeq = null;
    if (
      rooms.get(room.code) !== room ||
      room.turnState !== 'awaiting_swing' ||
      !room.activePitch ||
      room.activePitch.pitchSeq !== expectedSeq ||
      room.match.isGameOver
    ) {
      return;
    }

    if (!resolution.contact) {
      resolveNoContactPitch(room, true, swingData, {
        contact: false,
        feedback: resolution.feedback,
        label: resolution.label,
        detail: resolution.detail,
        color: resolution.color,
        quality: 'weak',
        dtTiming: resolution.dtTiming,
        hitField: resolution.hitField,
      });
      return;
    }

    if (
      !Number.isFinite(resolution.exitSpeedKmh) ||
      !Number.isFinite(resolution.distanceM) ||
      !resolution.hitField.every(Number.isFinite) ||
      (resolution.battedResult.firstLandingPos !== null &&
        !resolution.battedResult.firstLandingPos.every(Number.isFinite))
    ) {
      monitor.nanSanityErrors += 1;
    }

    const plateField = simToField(traj.plateCrossPos);
    const prevInning = room.match.inning;
    const prevHalf = room.match.half;
    const prevBalls = room.match.balls;
    const prevStrikes = room.match.strikes;
    const prevOuts = room.match.outs;
    const prevBasesMask =
      (room.match.bases[0] !== null ? 1 : 0) |
      (room.match.bases[1] !== null ? 2 : 0) |
      (room.match.bases[2] !== null ? 4 : 0);
    const pitcherSide = getPitchingSide(room.match);
    const batterSideRole = getBattingSide(room.match);
    const activeSnap = room.activePitch;

    room.match.lastChallenge = null;
    let outcome: ReturnType<typeof judgeBattedCap>;
    if (room.match.derby.active) {
      outcome = judgeBattedCap(resolution.battedResult, {
        caughtInAir: resolution.catchInfo.caught,
      });
      applyDerbySwingResult(room.match, outcome === 'HR');
    } else {
      applyPitchResult(room.match, {
        plateX: plateField[0],
        plateY: plateField[1],
        swung: true,
        contacted: true,
        caughtByCatcher: true,
        reachesPassLine: false,
      });

      outcome = applyBattedOutcome(room.match, resolution.battedResult, {
        caughtInAir: resolution.catchInfo.caught,
      });
    }

    const isBobbleHit = resolution.catchInfo.bobbled && (outcome === '1B' || outcome === '2B' || outcome === '3B');
    const isBlockedSingle = Boolean(resolution.catchInfo.blocked) && outcome === '1B';
    let callout: { title: string; subtitle: string; color: string; ttl: number };
    if (outcome === 'HR') {
      callout = { title: 'HOME RUN!', subtitle: `${resolution.distanceM.toFixed(1)}m`, color: '#d946ef', ttl: 2.1 };
    } else if (outcome === '3B') {
      callout = { title: 'TRIPLE!', subtitle: isBobbleHit ? 'FIELDER BOBBLE' : `${resolution.distanceM.toFixed(1)}m`, color: '#38bdf8', ttl: 1.6 };
    } else if (outcome === '2B') {
      callout = { title: 'DOUBLE!', subtitle: isBobbleHit ? 'FIELDER BOBBLE' : `${resolution.distanceM.toFixed(1)}m`, color: '#38bdf8', ttl: 1.5 };
    } else if (outcome === '1B') {
      callout = {
        title: 'SINGLE!',
        subtitle: isBlockedSingle ? 'OUTFIELD BLOCK' : isBobbleHit ? 'FIELDER BOBBLE' : `${resolution.distanceM.toFixed(1)}m`,
        color: '#38bdf8',
        ttl: 1.4,
      };
    } else if (outcome === 'FOUL') {
      callout = { title: 'FOUL', subtitle: '', color: '#fb923c', ttl: 1.1 };
    } else {
      const isFoulFlyCatch = Boolean(resolution.catchInfo.caught && resolution.detail.includes('FOUL OUT'));
      callout = {
        title: 'OUT!',
        subtitle: isFoulFlyCatch
          ? 'FOUL OUT'
          : resolution.catchInfo.caught
            ? 'OUTFIELD CATCH'
            : 'INFIELD OUT',
        color: '#ef4444',
        ttl: 1.5,
      };
    }

    const inningChanged = room.match.inning !== prevInning || room.match.half !== prevHalf;
    const solvedSeq = activeSnap.pitchSeq;
    const spec = PITCH_SPECS[activeSnap.pitchId];
    const telemetry = `${spec.code} ${Math.round(activeSnap.speedKmh)} km/h · BRK ${activeSnap.breakCm}cm`;

    recordPitchAnalytics(room, {
      event: 'pitch',
      pitchSeq: solvedSeq,
      inning: prevInning,
      half: prevHalf,
      ballsBefore: prevBalls,
      strikesBefore: prevStrikes,
      outsBefore: prevOuts,
      basesMaskBefore: prevBasesMask,
      pitcherSide,
      batterSide: batterSideRole,
      batterHand: getCurrentBatterSide(room),
      pitcherName: room.players[pitcherSide]?.name ?? pitcherSide,
      batterName: room.players[batterSideRole]?.name ?? batterSideRole,
      pitcherDevice: room.players[pitcherSide]?.device ?? null,
      batterDevice: room.players[batterSideRole]?.device ?? null,
      pitcherInput: room.players[pitcherSide]?.input ?? null,
      batterInput: room.players[batterSideRole]?.input ?? null,
      pitchId: activeSnap.pitchId,
      seed: activeSnap.seed,
      ...(activeSnap.u !== undefined ? { u: activeSnap.u } : {}),
      speedKmh: round2(activeSnap.speedKmh),
      springZone: activeSnap.springZone ?? null,
      targetX: round3(activeSnap.targetX),
      targetY: round3(activeSnap.targetY),
      errorX: round3(activeSnap.errorX),
      errorY: round3(activeSnap.errorY),
      plateX: round3(plateField[0]),
      plateY: round3(plateField[1]),
      breakCm: activeSnap.breakCm,
      swung: true,
      powerSwing: swingData.swingMode === 'power',
      dtTiming: round3(resolution.dtTiming),
      batX: round3(swingData.batX),
      batY: round3(swingData.batY),
      contact: true,
      quality: resolution.quality,
      exitSpeedKmh: Math.round(resolution.exitSpeedKmh),
      launchAngleDeg: Math.round(resolution.launchAngleDeg ?? 0),
      distanceM: round2(resolution.distanceM),
      outcome,
      isFoulFlyOut: Boolean(resolution.catchInfo.caught && resolution.detail.includes('FOUL OUT')),
      caughtBy: resolution.catchInfo.caught ? resolution.catchInfo.fielderId : null,
      bobbledBy: resolution.catchInfo.bobbled ? resolution.catchInfo.fielderId : null,
      blockedBy: resolution.catchInfo.blocked ? resolution.catchInfo.fielderId : null,
      inningChanged,
      awayRunsAfter: room.match.away.totalRuns,
      homeRunsAfter: room.match.home.totalRuns,
    });

    room.pitchSeq += 1;
    room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
    room.activePitch = null;

    // Compact resolution (omit frames array; clients reconstruct via simulateBattedCap(battedParams))
    const compactResolution = {
      contact: true,
      feedback: resolution.feedback,
      label: resolution.label,
      detail: resolution.detail,
      color: resolution.color,
      quality: resolution.quality,
      dtTiming: resolution.dtTiming,
      hitField: resolution.hitField,
      battedParams: resolution.battedParams,
      catchInfo: resolution.catchInfo,
      outcome: resolution.outcome,
      exitSpeedKmh: resolution.exitSpeedKmh,
      launchAngleDeg: resolution.launchAngleDeg,
      distanceM: resolution.distanceM,
      bounces: resolution.battedResult.bounces,
      hitFence: resolution.battedResult.hitFence,
      overFence: resolution.battedResult.overFence,
      firstLandingPos: resolution.battedResult.firstLandingPos,
      stoppedPos: resolution.battedResult.stoppedPos,
      flightTimeSec: resolution.battedResult.flightTimeSec,
    };

    sendToRoom(room, {
      type: 'pitch_result',
      pitchSeq: solvedSeq,
      nextPitchSeq: room.pitchSeq,
      swung: true,
      swingData,
      resolution: compactResolution,
      outcome,
      callout,
      inningChanged,
      telemetry,
      platePos: [plateField[0], plateField[1]],
      match: room.match,
    });
    if (inningChanged && !room.match.isGameOver) {
      sendToRoom(room, {
        type: 'batter_side',
        side: getCurrentBatterSide(room),
        team: getBattingSide(room.match),
      });
    }

    room.absWindowUntil = 0;
    if (room.match.isGameOver) {
      recordMatchEnd(room, 'completed');
    } else {
      const flightMs = resolution.contact ? Math.round(resolution.battedResult.flightTimeSec * 1000) : 0;
      const bufMs =
        Math.max(3200, flightMs + 2800) +
        (outcome === 'HR' ? 1600 : 0) +
        (inningChanged ? 1200 : 0);
      armPitchClock(room, bufMs);
    }
  }

  function startMatchInRoom(room: Room) {
    const home = room.players.home;
    const away = room.players.away;
    if (!away) return;

    const now = Date.now();
    if (!room.startedAtMs) room.startedAtMs = now;
    room.lastActivityAt = now;
    monitor.matchesStarted += 1;
    const names = { home: home.name, away: away.name };
    for (const side of ['home', 'away'] as const) {
      const p = room.players[side]!;
      sendJson(p.ws, {
        type: 'match_start',
        code: room.code,
        mode: room.mode,
        roomKind: room.isMatchmaking ? 'live' : 'friend',
        side,
        token: p.token,
        pitchSeq: room.pitchSeq,
        turnState: room.turnState,
        batterSide: getCurrentBatterSide(room),
        batterSides: room.batterSides,
        match: room.match,
        names,
        spectators: room.spectators.size,
      });
    }
    armPitchClock(room, 1500);
  }

  function createMatchmakingRoom(mode: OnlineMode, c1: ClientMeta, c2: ClientMeta) {
    const matchedAtMs = Date.now();
    const waits = [c1, c2].map((c) => (c.queuedMode ? matchedAtMs - c.queuedAtMs : null));
    removeFromQueues(c1.id, 'matched');
    removeFromQueues(c2.id, 'matched');

    const code = generateRoomCode(rooms);
    const homeFirst = crypto.randomInt(0, 2) === 0;
    const homeClient = homeFirst ? c1 : c2;
    const awayClient = homeFirst ? c2 : c1;

    const now = Date.now();
    const room: Room = {
      code,
      matchId: generateMatchId(code),
      mode,
      isMatchmaking: true,
      mercyRule: true,
      createdAt: now,
      startedAtMs: now,
      lastActivityAt: now,
      match: buildMatchState(mode, homeClient.name, awayClient.name),
      pitchSeq: 1,
      solvingSeq: null,
      turnState: 'awaiting_pitch',
      batterSides: { away: 'L', home: 'L' },
      activePitch: null,
      swingTimer: null,
      pitchClockTimer: null,
      pitchClockDeadlineAt: null,
      pitchClockRemainingMs: null,
      consecutiveClockViolations: { home: 0, away: 0 },
      pausedBy: new Set(),
      pauseTimers: { home: null, away: null },
      pauseExpiresAt: { home: 0, away: 0 },
      absWindowUntil: 0,
      lastSpectatorEmoteAt: 0,
      players: {
        home: {
          token: crypto.randomUUID(),
          name: homeClient.name,
          clientId: homeClient.id,
          ws: homeClient.ws,
          connected: true,
          disconnectTimer: null,
          disconnectDeadlineAt: null,
          device: homeClient.deviceProfile?.device ?? null,
          input: homeClient.deviceProfile?.input ?? null,
        },
        away: {
          token: crypto.randomUUID(),
          name: awayClient.name,
          clientId: awayClient.id,
          ws: awayClient.ws,
          connected: true,
          disconnectTimer: null,
          disconnectDeadlineAt: null,
          device: awayClient.deviceProfile?.device ?? null,
          input: awayClient.deviceProfile?.input ?? null,
        },
      },
      spectators: new Set(),
      spectatorsPeak: 0,
      recorded: false,
    };
    rooms.set(code, room);
    homeClient.roomCode = code;
    homeClient.side = 'home';
    awayClient.roomCode = code;
    awayClient.side = 'away';
    logQueue({
      event: 'match_made',
      mode,
      matchId: room.matchId,
      via: waits[0] !== null && waits[1] !== null ? 'queue' : 'standby',
      cids: [c1.id, c2.id],
      waitsMs: waits,
      waitMs: Math.max(waits[0] ?? 0, waits[1] ?? 0),
    });

    startMatchInRoom(room);
    scheduleStatsBroadcast();
  }

  function armOfferTimer(offer: PendingOffer, ms: number) {
    if (offer.timer) clearTimeout(offer.timer);
    offer.timer = setTimeout(() => {
      if (pendingOffers.get(offer.offerId) !== offer) return;
      offer.timer = null;
      pendingOffers.delete(offer.offerId);
      const sc = clients.get(offer.standbyClientId);
      if (sc) {
        removeFromStandby(sc.id);
        sendJson(sc.ws, { type: 'offer_cancelled', offerId: offer.offerId, reason: 'timeout' });
      }
      scheduleStatsBroadcast();
      tryOfferToStandby(offer.mode);
    }, ms);
  }

  function tryOfferToStandby(mode: OnlineMode) {
    if (draining) return;
    pruneRecentlyTakenOffers();
    const q = queues[mode];
    const sq = standbyQueues[mode];
    if (q.length === 0 || sq.length === 0) return;

    const offersPerWaiter = new Map<string, number>();
    const busyStandby = new Set<string>();
    for (const o of pendingOffers.values()) {
      offersPerWaiter.set(o.waitingClientId, (offersPerWaiter.get(o.waitingClientId) ?? 0) + 1);
      busyStandby.add(o.standbyClientId);
    }

    let sentAny = false;
    for (const waitingId of q) {
      let openCount = offersPerWaiter.get(waitingId) ?? 0;
      if (openCount >= STANDBY_OFFER_FANOUT) continue;
      const wc = clients.get(waitingId);
      if (!wc || wc.ws.readyState !== WebSocket.OPEN || wc.roomCode) continue;

      while (sq.length > 0 && openCount < STANDBY_OFFER_FANOUT) {
        const standbyId = sq.shift()!;
        if (standbyId === waitingId || busyStandby.has(standbyId)) continue;
        const sc = clients.get(standbyId);
        if (!sc || sc.ws.readyState !== WebSocket.OPEN || sc.roomCode) {
          if (sc) sc.standbyMode = null;
          continue;
        }
        sc.standbyMode = null;
        const offerId = crypto.randomUUID().slice(0, 8);
        const offer: PendingOffer = {
          offerId,
          mode,
          standbyClientId: sc.id,
          waitingClientId: wc.id,
          timer: null,
          shown: false,
        };
        pendingOffers.set(offerId, offer);
        busyStandby.add(sc.id);
        openCount += 1;
        offersPerWaiter.set(wc.id, openCount);
        sentAny = true;
        // Delivery cushion until client finishes current pitch and reports `offer_shown`
        armOfferTimer(offer, offerTimeoutMs + 12_000);
        sendJson(sc.ws, {
          type: 'match_offer',
          offerId,
          opponentName: wc.name,
          mode,
          timeoutSec: Math.max(1, Math.round(offerTimeoutMs / 1000)),
        });
      }
    }
    if (sentAny) scheduleStatsBroadcast();
  }

  function tryPairQueue(mode: OnlineMode) {
    const q = queues[mode];
    while (q.length >= 2) {
      const id1 = q.shift()!;
      const id2 = q.shift()!;
      const c1 = clients.get(id1);
      const c2 = clients.get(id2);
      if (!c1 || c1.ws.readyState !== WebSocket.OPEN) {
        if (c2 && c2.ws.readyState === WebSocket.OPEN) q.unshift(id2);
        continue;
      }
      if (!c2 || c2.ws.readyState !== WebSocket.OPEN) {
        q.unshift(id1);
        continue;
      }
      cancelOffersForClient(c1.id, 'expired', true);
      cancelOffersForClient(c2.id, 'expired', true);
      createMatchmakingRoom(mode, c1, c2);
    }
    if (q.length > 0) {
      tryOfferToStandby(mode);
    }
  }

  // --- HTTP Server (Static + /health + Security Headers) ---
  const CSP_POLICY =
    "default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com; base-uri 'self'; frame-ancestors 'none'";

  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CSP_POLICY);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';

    // Canonicalize /capbaseball -> /capbaseball/ so relative ./assets & ./sprites resolve cleanly
    if (isGetOrHead && parsedUrl.pathname === '/capbaseball') {
      const loc = `/capbaseball/${parsedUrl.search}`;
      monitor.recordHttp(301, 0);
      res.writeHead(301, { Location: loc });
      res.end();
      return;
    }

    // Support serving both at root "/" and subpath "/capbaseball/..."
    const normalizedPath = parsedUrl.pathname.startsWith('/capbaseball/')
      ? parsedUrl.pathname.slice('/capbaseball'.length)
      : parsedUrl.pathname;

    if (
      isGetOrHead &&
      (normalizedPath === '/monitor/' || normalizedPath === '/analytics/' || normalizedPath === '/pitch-lab/')
    ) {
      const target = parsedUrl.pathname.slice(0, -1) + parsedUrl.search;
      monitor.recordHttp(301, 0);
      res.writeHead(301, { Location: target });
      res.end();
      return;
    }

    if (isGetOrHead && normalizedPath === '/health') {
      const load = getServerLoad();
      const payload = JSON.stringify({
        ok: true,
        version,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        rooms: rooms.size,
        queued: getTotalQueued(),
        clients: clients.size,
        draining,
        updateAtMs,
        load,
      });
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(payload, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    if (isGetOrHead && normalizedPath === '/metrics') {
      if (monitorToken) {
        const provided =
          parsedUrl.searchParams.get('token') ||
          String(req.headers['x-monitor-token'] || '') ||
          String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (provided !== monitorToken) {
          const body = JSON.stringify({ error: 'unauthorized' });
          monitor.recordHttp(401, req.method === 'HEAD' ? 0 : Buffer.byteLength(body, 'utf8'));
          res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
      }
      const nowMs = Date.now();
      let payload = cachedMetricsPayload;
      if (!payload || metricsCacheMs <= 0 || nowMs - cachedMetricsAt >= metricsCacheMs) {
        payload = JSON.stringify(monitor.buildReport(buildMonitorSnapshot()));
        cachedMetricsPayload = payload;
        cachedMetricsAt = nowMs;
      }
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(payload, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    if (isGetOrHead && (normalizedPath === '/monitor' || normalizedPath === '/analytics')) {
      const html = MONITOR_HTML.replace(
        'src="./monitor.js"',
        `src="./monitor.js?v=${encodeURIComponent(version ?? 'dev')}"`,
      );
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(html, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    if (isGetOrHead && (normalizedPath === '/monitor.js' || normalizedPath === '/analytics.js')) {
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(MONITOR_JS, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(req.method === 'HEAD' ? undefined : MONITOR_JS);
      return;
    }

    if (isGetOrHead && normalizedPath === '/analytics.json') {
      if (monitorToken) {
        const provided =
          parsedUrl.searchParams.get('token') ||
          String(req.headers['x-monitor-token'] || '') ||
          String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (provided !== monitorToken) {
          const body = JSON.stringify({ error: 'unauthorized' });
          monitor.recordHttp(401, req.method === 'HEAD' ? 0 : Buffer.byteLength(body, 'utf8'));
          res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
      }
      const monReport = monitor.buildReport(buildMonitorSnapshot());
      const nowMs = Date.now();
      const liveMatches = Array.from(rooms.values())
        .filter((rm) => rm.players.away && rm.turnState !== 'game_over')
        .sort((a, b) => (b.startedAtMs ?? b.createdAt) - (a.startedAtMs ?? a.createdAt))
        .map((rm) => ({
          ts: new Date(rm.startedAtMs ?? rm.createdAt).toISOString(),
          status: 'live' as const,
          code: rm.code,
          roomKind: rm.isMatchmaking ? ('live' as const) : ('friend' as const),
          awayName: rm.match.away.name,
          homeName: rm.match.home.name,
          awayDevice: rm.players.away?.device ?? null,
          homeDevice: rm.players.home.device ?? null,
          awayInput: rm.players.away?.input ?? null,
          homeInput: rm.players.home.input ?? null,
          awayRuns: rm.match.away.totalRuns,
          homeRuns: rm.match.home.totalRuns,
          innings: rm.match.inning,
          half: rm.match.half,
          outs: rm.match.outs,
          awayHits: rm.match.away.hits,
          homeHits: rm.match.home.hits,
          awayStrikeouts: rm.match.away.strikeouts,
          homeStrikeouts: rm.match.home.strikeouts,
          awayWalks: rm.match.away.walks,
          homeWalks: rm.match.home.walks,
          pitches: rm.match.stats.totalPitches,
          durationSec: Math.max(0, Math.round((nowMs - (rm.startedAtMs ?? rm.createdAt)) / 1000)),
          reason: 'in_progress',
        }));
      const report = buildAnalyticsReport(
        getMatchLogPath(opts.matchLogPath),
        getPitchLogPath(opts.pitchLogPath),
        monReport.gameplay,
        liveMatches,
        getSessionLogPath(opts.sessionLogPath),
      );
      const payload = JSON.stringify(report);
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(payload, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    if (isGetOrHead && staticCache.size > 0) {
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(normalizedPath);
      } catch {
        monitor.recordHttp(400, 11);
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }
      if (decodedPath.includes('\0') || /(^|\/)\./.test(decodedPath)) {
        monitor.recordHttp(403, 9);
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      const relTarget =
        decodedPath === '/'
          ? '/index.html'
          : decodedPath === '/pitch-lab'
            ? '/pitch-lab.html'
            : decodedPath;
      let entry = staticCache.get(relTarget);
      if (!entry && !path.extname(decodedPath)) {
        entry = staticCache.get('/index.html');
      }
      if (!entry) {
        monitor.recordHttp(404, 9);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ifNoneMatch = String(req.headers['if-none-match'] || '');
      if (ifNoneMatch && (ifNoneMatch === entry.etag || ifNoneMatch.includes(entry.etag))) {
        monitor.static304Hits += 1;
        monitor.recordHttp(304, 0);
        res.writeHead(304, {
          ETag: entry.etag,
          'Cache-Control': entry.cacheControl,
          Vary: 'Accept-Encoding',
        });
        res.end();
        return;
      }

      const useGz = Boolean(entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')));
      const buf = useGz && entry.gz ? entry.gz : entry.raw;
      const headers: Record<string, string | number> = {
        'Content-Type': entry.contentType,
        'Cache-Control': entry.cacheControl,
        'Content-Length': buf.length,
        ETag: entry.etag,
      };
      if (entry.gz) headers.Vary = 'Accept-Encoding';
      if (useGz) headers['Content-Encoding'] = 'gzip';

      monitor.staticCacheHits += 1;
      monitor.recordHttp(200, req.method === 'HEAD' ? 0 : buf.length);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : buf);
      return;
    }

    const notFoundBody = JSON.stringify({ error: 'not_found' });
    monitor.recordHttp(404, req.method === 'HEAD' ? 0 : Buffer.byteLength(notFoundBody, 'utf8'));
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(req.method === 'HEAD' ? undefined : notFoundBody);
  });

  // --- WebSocket Server (Compact framing, 16KB maxPayload, no deflate overhead on tiny frames) ---
  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });

  const heartbeatTimer = setInterval(() => {
    const t = Date.now();
    for (const c of clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        if (t - c.lastPongAt > deadSocketTimeoutMs) {
          if (c.roomCode || c.watchingCode || c.queuedMode) {
            monitor.terminatedDeadPong += 1;
            c.ws.terminate();
          } else {
            monitor.idleClosedTotal += 1;
            try {
              c.ws.close(1000, 'idle');
            } catch {
              c.ws.terminate();
            }
          }
          continue;
        }
        c.lastPingSentAt = t;
        try {
          // RFC 6455 protocol-level ping: answered automatically by browser network thread even when tab JS is frozen
          c.ws.ping();
        } catch {
          // ignore closed socket error
        }
      }
    }
  }, pingIntervalMs);

  const statsTimer = setInterval(() => {
    sampleEventLoopLag();
    broadcastStats();
  }, 5000);

  monitor.start(buildMonitorSnapshot, 2000);

  wss.on('connection', (ws, req) => {
    const ip =
      String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
        .split(',')[0]
        .trim();
    const curIpConns = ipConnCounts.get(ip) ?? 0;
    if (curIpConns >= maxConnPerIp) {
      monitor.rejectedIpLimit += 1;
      ws.close(1008, 'too_many_connections');
      return;
    }
    ipConnCounts.set(ip, curIpConns + 1);
    monitor.connAcceptedTotal += 1;
    wsMonitorMap.set(ws, monitor);

    const isNameTaken = (candidate: string): boolean => {
      for (const c of clients.values()) {
        if (c.name === candidate) return true;
      }
      return false;
    };

    const clientId = crypto.randomUUID();
    const nowOnConnect = Date.now();
    const client: ClientMeta = {
      id: clientId,
      ws,
      ip,
      compactV2: false,
      name: sanitizeName(null, isNameTaken),
      rttMs: 0,
      roomCode: null,
      side: null,
      watchingCode: null,
      queuedMode: null,
      queuedAtMs: 0,
      standbyMode: null,
      standbyPriority: false,
      pageActivity: 'title',
      lastPingSentAt: nowOnConnect,
      lastPongAt: nowOnConnect,
      lastEmoteAt: 0,
      msgWindowStart: nowOnConnect,
      msgCount: 0,
      deviceProfile: null,
    };
    clients.set(clientId, client);

    ws.on('pong', () => {
      client.lastPongAt = Date.now();
    });

    ws.on('message', (raw) => {
      // Sliding-window per-socket rate limiter
      const now = Date.now();
      if (now - client.msgWindowStart >= 1000) {
        client.msgWindowStart = now;
        client.msgCount = 0;
      }
      client.msgCount += 1;
      if (client.msgCount > maxMsgsPerSec) {
        monitor.rejectedRateLimit += 1;
        sendJson(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
        ws.close(1008, 'rate_limited');
        return;
      }

      const rawStr = String(raw);
      const rawByteLen = Buffer.byteLength(rawStr, 'utf8');
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawStr);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = normalizeClientMsg(parsed);
      if (typeof msg.type !== 'string') return;
      monitor.recordWsIn(msg.type, rawByteLen);
      client.lastPongAt = now;

      switch (msg.type) {
        case 'ping': {
          sendJson(ws, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : now });
          break;
        }

        case 'pong': {
          const sentAt = typeof msg.t === 'number' ? msg.t : client.lastPingSentAt;
          client.rttMs = Math.max(0, Math.min(9999, now - sentAt));
          break;
        }

        case 'hello': {
          if (msg.v === 2) {
            client.compactV2 = true;
            wsCompactMode.set(ws, true);
          }
          client.name = sanitizeName(msg.name, isNameTaken);
          const dp = sanitizeDeviceProfile(msg.deviceProfile ?? msg.d);
          if (dp) {
            client.deviceProfile = dp;
            if (client.roomCode && client.side) {
              const curRoom = rooms.get(client.roomCode);
              const seat = curRoom?.players[client.side];
              if (seat) {
                seat.device = dp.device;
                seat.input = dp.input;
              }
            }
            if (!dp.skipLog) {
              appendSessionLog(
                {
                  ts: new Date().toISOString(),
                  device: dp.device,
                  os: dp.os,
                  browser: dp.browser,
                  input: dp.input,
                  orient: dp.orient,
                  pwa: dp.pwa,
                  locale: dp.locale,
                },
                opts.sessionLogPath,
              );
            }
          }
          sendJson(ws, {
            type: 'welcome',
            clientId,
            name: client.name,
            version,
            updateAtMs,
            stats: getStats(),
          });
          scheduleStatsBroadcast();
          break;
        }

        case 'queue': {
          if (draining) {
            sendJson(ws, { type: 'error', code: 'draining', message: 'Server updating — matchmaking paused' });
            return;
          }
          const load = getServerLoad();
          // Reserve the final 20 slots (481..500) exclusively for Friend Rooms
          if (load.status === 'red' || clients.size > publicClientCap) {
            monitor.rejectedBusy += 1;
            sendJson(ws, {
              type: 'error',
              code: 'server_busy',
              message:
                clients.size > publicClientCap && load.status !== 'red'
                  ? 'Public matchmaking full (Friend Reserve active) — routing to CPU match'
                  : 'Server busy — routing to CPU match',
              load: load.status,
            });
            return;
          }
          abandonWaitingRoomIfHost(client);
          if (client.roomCode) return;
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const mode = parseOnlineMode(msg.mode);
          removeFromQueues(clientId);
          client.queuedMode = mode;
          client.queuedAtMs = Date.now();
          queues[mode].push(clientId);
          logQueue({ event: 'queue_enter', cid: clientId, mode });
          sendJson(ws, { type: 'queued', mode });
          tryPairQueue(mode);
          scheduleStatsBroadcast();
          break;
        }

        case 'unqueue': {
          removeFromQueues(clientId);
          sendJson(ws, { type: 'unqueued' });
          scheduleStatsBroadcast();
          break;
        }

        case 'standby_join': {
          if (draining || client.roomCode) return;
          const load = getServerLoad();
          if (load.status === 'red' || clients.size > publicClientCap) return;
          const mode = parseOnlineMode(msg.mode);
          const priority = Boolean(msg.priority);
          removeFromQueues(clientId);
          enqueueStandby(client, mode, priority, false);
          scheduleStatsBroadcast();
          tryOfferToStandby(mode);
          break;
        }

        case 'standby_leave': {
          removeFromStandby(clientId);
          cancelOffersForClient(clientId, 'declined', false);
          scheduleStatsBroadcast();
          break;
        }

        case 'activity': {
          const page = typeof msg.page === 'string' ? msg.page : '';
          if (VALID_PAGE_ACTIVITIES.has(page)) {
            client.pageActivity = page as ClientMeta['pageActivity'];
          }
          break;
        }

        case 'offer_shown': {
          const offerId = typeof msg.offerId === 'string' ? msg.offerId : '';
          const offer = pendingOffers.get(offerId);
          if (!offer || offer.standbyClientId !== clientId || offer.shown) return;
          offer.shown = true;
          armOfferTimer(offer, offerTimeoutMs);
          break;
        }

        case 'offer_reply': {
          const offerId = typeof msg.offerId === 'string' ? msg.offerId : '';
          const offer = pendingOffers.get(offerId);
          if (!offer || offer.standbyClientId !== clientId) {
            if (msg.accept) {
              pruneRecentlyTakenOffers();
              const takenInfo = recentlyTakenOffers.get(offerId);
              if (takenInfo) {
                recentlyTakenOffers.delete(offerId);
                if (!draining && !client.roomCode) {
                  enqueueStandby(client, takenInfo.mode, true, true);
                  scheduleStatsBroadcast();
                }
                sendJson(ws, { type: 'offer_cancelled', offerId, reason: 'taken' });
                return;
              }
              const cancelledInfo = recentlyCancelledOffers.get(offerId);
              if (cancelledInfo) {
                recentlyCancelledOffers.delete(offerId);
                if (!draining && !client.roomCode) {
                  enqueueStandby(client, cancelledInfo.mode, client.standbyPriority, true);
                  scheduleStatsBroadcast();
                }
                sendJson(ws, { type: 'offer_cancelled', offerId, reason: 'waiter_cancelled' });
              }
            }
            return;
          }
          if (offer.timer) clearTimeout(offer.timer);
          pendingOffers.delete(offerId);

          if (!msg.accept) {
            removeFromStandby(clientId);
            scheduleStatsBroadcast();
            tryOfferToStandby(offer.mode);
            break;
          }

          if (draining || client.roomCode) {
            sendJson(ws, { type: 'offer_cancelled', offerId, reason: 'expired' });
            scheduleStatsBroadcast();
            break;
          }
          const wc = clients.get(offer.waitingClientId);
          if (!wc || wc.ws.readyState !== WebSocket.OPEN || wc.roomCode || wc.queuedMode !== offer.mode) {
            sendJson(ws, { type: 'offer_cancelled', offerId, reason: 'expired' });
            scheduleStatsBroadcast();
            break;
          }
          // Winner claimed this waiting opponent: notify sibling contenders with reason 'taken' and preserve priority!
          cancelOffersForClient(wc.id, 'taken', true);
          createMatchmakingRoom(offer.mode, wc, client);
          break;
        }

        case 'create': {
          if (draining) {
            sendJson(ws, { type: 'error', code: 'draining', message: 'Server updating — room creation paused' });
            return;
          }
          const load = getServerLoad();
          if (load.status === 'red') {
            monitor.rejectedBusy += 1;
            sendJson(ws, {
              type: 'error',
              code: 'server_busy',
              message: 'Server busy — routing to CPU match',
              load: load.status,
            });
            return;
          }
          abandonWaitingRoomIfHost(client);
          if (client.roomCode) return;
          removeFromQueues(clientId);
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const mode = parseOnlineMode(msg.mode);
          const mercyRule = msg.mercyRule !== false;
          const code = generateRoomCode(rooms);
          const token = crypto.randomUUID();

          const now = Date.now();
          const room: Room = {
            code,
            matchId: generateMatchId(code),
            mode,
            isMatchmaking: false,
            mercyRule,
            createdAt: now,
            startedAtMs: 0,
            lastActivityAt: now,
            match: buildMatchState(mode, client.name, 'Opponent', mercyRule),
            pitchSeq: 1,
            solvingSeq: null,
            turnState: 'awaiting_pitch',
            batterSides: { away: 'L', home: 'L' },
            activePitch: null,
            swingTimer: null,
            pitchClockTimer: null,
            pitchClockDeadlineAt: null,
            pitchClockRemainingMs: null,
            consecutiveClockViolations: { home: 0, away: 0 },
            pausedBy: new Set(),
            pauseTimers: { home: null, away: null },
            pauseExpiresAt: { home: 0, away: 0 },
            absWindowUntil: 0,
            lastSpectatorEmoteAt: 0,
            players: {
              home: {
                token,
                name: client.name,
                clientId,
                ws,
                connected: true,
                disconnectTimer: null,
                disconnectDeadlineAt: null,
                device: client.deviceProfile?.device ?? null,
                input: client.deviceProfile?.input ?? null,
              },
              away: null,
            },
            spectators: new Set(),
            spectatorsPeak: 0,
            recorded: false,
          };
          rooms.set(code, room);
          client.roomCode = code;
          client.side = 'home';

          sendJson(ws, {
            type: 'room_created',
            code,
            mode,
            token,
            side: 'home',
          });
          scheduleStatsBroadcast();
          break;
        }

        case 'join': {
          if (draining) {
            sendJson(ws, { type: 'error', code: 'draining', message: 'Server updating — joining paused' });
            return;
          }
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          if (client.roomCode && client.roomCode === code) {
            sendJson(ws, { type: 'error', code: 'already_in_room', message: 'You are already hosting this room' });
            return;
          }
          const room = rooms.get(code);
          if (!room) {
            sendJson(ws, { type: 'error', code: 'room_not_found', message: 'Room code not found' });
            return;
          }
          if (room.players.away) {
            sendJson(ws, { type: 'error', code: 'room_full', message: 'Room is full' });
            return;
          }
          // If the joiner accidentally created their own empty waiting room first, cleanly abandon it!
          abandonWaitingRoomIfHost(client);
          if (client.roomCode) {
            sendJson(ws, { type: 'error', code: 'already_in_match', message: 'Already in an active match' });
            return;
          }
          removeFromQueues(clientId);
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const token = crypto.randomUUID();
          const guestPlayer: RoomPlayer = {
            token,
            name: client.name,
            clientId,
            ws,
            connected: true,
            disconnectTimer: null,
            disconnectDeadlineAt: null,
            device: client.deviceProfile?.device ?? null,
            input: client.deviceProfile?.input ?? null,
          };
          const hostPlayer = room.players.home;
          const swapSides = randomizeFriendSides && crypto.randomInt(0, 2) === 1;
          let hostSide: Side = 'home';
          let guestSide: Side = 'away';
          if (swapSides) {
            hostSide = 'away';
            guestSide = 'home';
            room.players.home = guestPlayer;
            room.players.away = hostPlayer;
            room.match.home.name = `中正黃 ${guestPlayer.name}`;
            room.match.away.name = `中正黑 ${hostPlayer.name}`;
            const hostClient = hostPlayer.clientId ? clients.get(hostPlayer.clientId) : null;
            if (hostClient && hostClient.roomCode === code) {
              hostClient.side = 'away';
            }
          } else {
            room.players.away = guestPlayer;
            room.match.away.name = `中正黑 ${guestPlayer.name}`;
          }
          client.roomCode = code;
          client.side = guestSide;

          sendJson(ws, {
            type: 'room_joined',
            code,
            mode: room.mode,
            token,
            side: guestSide,
          });
          startMatchInRoom(room);
          if (hostPlayer.disconnectTimer) {
            // Host went offline while waiting; the match has started, so fall back to the normal grace.
            clearTimeout(hostPlayer.disconnectTimer);
            hostPlayer.disconnectDeadlineAt = Date.now() + graceMs;
            hostPlayer.disconnectTimer = setTimeout(() => expireSeat(code, hostSide), graceMs);
            sendJson(ws, { type: 'opponent_disconnected', graceSec: Math.round(graceMs / 1000) });
          }
          scheduleStatsBroadcast();
          break;
        }

        case 'reconnect': {
          removeFromQueues(clientId);
          if (client.watchingCode) {
            const watched = rooms.get(client.watchingCode);
            if (watched && watched.spectators.delete(client)) {
              broadcastSpectatorCount(watched);
            }
            client.watchingCode = null;
          }
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const token = typeof msg.token === 'string' ? msg.token : '';
          const room = rooms.get(code);
          if (!room || !token) {
            monitor.reconnectsFailed += 1;
            sendJson(ws, { type: 'error', code: 'reconnect_failed', message: 'Room ended or invalid token' });
            return;
          }
          let matchedSide: Side | null = null;
          if (room.players.home.token === token) matchedSide = 'home';
          else if (room.players.away?.token === token) matchedSide = 'away';

          if (!matchedSide) {
            monitor.reconnectsFailed += 1;
            sendJson(ws, { type: 'error', code: 'reconnect_failed', message: 'Invalid reconnect token' });
            return;
          }
          monitor.reconnectsSucceeded += 1;
          room.lastActivityAt = Date.now();

          const player = room.players[matchedSide]!;
          if (player.disconnectTimer) {
            clearTimeout(player.disconnectTimer);
            player.disconnectTimer = null;
          }
          player.disconnectDeadlineAt = null;
          if (client.deviceProfile) {
            player.device = client.deviceProfile.device;
            player.input = client.deviceProfile.input;
          }
          if (player.ws && player.ws !== ws) {
            const oldClient = player.clientId ? clients.get(player.clientId) : null;
            if (oldClient) {
              oldClient.roomCode = null;
              oldClient.side = null;
            }
            try {
              player.ws.close(1000, 'replaced_by_reconnect');
            } catch {
              // ignore
            }
          }
          player.clientId = clientId;
          player.ws = ws;
          player.connected = true;
          client.roomCode = code;
          client.side = matchedSide;
          client.name = player.name;

          if (!room.players.away) {
            sendJson(ws, {
              type: 'room_created',
              code,
              mode: room.mode,
              token: player.token,
              side: 'home',
            });
            break;
          }

          sendStateSync(room, matchedSide);
          const oppSide: Side = matchedSide === 'home' ? 'away' : 'home';
          const opp = room.players[oppSide];
          if (opp?.ws) {
            sendJson(opp.ws, { type: 'opponent_reconnected' });
          }
          if (room.pausedBy.size > 0) {
            sendJson(ws, {
              type: 'pause_state',
              pausedSides: Array.from(room.pausedBy),
              remainingSec: getPauseRemainingSec(room),
            });
          } else if (room.turnState === 'awaiting_pitch') {
            resumePitchClock(room);
          }
          break;
        }

        case 'session_check': {
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const token = typeof msg.token === 'string' ? msg.token : '';
          const room = rooms.get(code);
          if (!room || !token || room.turnState === 'game_over') {
            sendJson(ws, { type: 'session_status', active: false });
            break;
          }
          let matchedSide: Side | null = null;
          if (room.players.home.token === token) matchedSide = 'home';
          else if (room.players.away?.token === token) matchedSide = 'away';
          if (!matchedSide) {
            sendJson(ws, { type: 'session_status', active: false });
            break;
          }
          const seat = room.players[matchedSide]!;
          const sendActiveStatus = (curRoom: Room, curSeat: RoomPlayer) => {
            const oppSide: Side = matchedSide === 'home' ? 'away' : 'home';
            const opp = curRoom.players[oppSide];
            const remMs = curSeat.disconnectDeadlineAt ? Math.max(0, curSeat.disconnectDeadlineAt - Date.now()) : graceMs;
            sendJson(ws, {
              type: 'session_status',
              active: true,
              code,
              roomKind: curRoom.isMatchmaking ? 'live' : 'friend',
              opponentName: opp?.name ?? '',
              remainingSec: Math.ceil(remMs / 1000),
              waiting: !curRoom.players.away,
            });
          };
          const seatOnline = seat.connected && seat.ws !== null && seat.ws.readyState === WebSocket.OPEN;
          if (seatOnline) {
            if (seat.ws === ws) {
              sendJson(ws, { type: 'session_status', active: false, alreadyActive: true });
              break;
            }
            // Probe old socket via RFC 6455 ping: a genuinely active 2nd tab answers within ~10-200ms,
            // while a zombie half-open mobile socket (behind Cloudflare Tunnel after network switch/reload)
            // never replies and should be terminated so the player can reclaim their seat.
            const oldWs = seat.ws!;
            let responded = false;
            const onPong = () => {
              responded = true;
            };
            oldWs.once('pong', onPong);
            try {
              oldWs.ping();
            } catch {
              responded = false;
            }
            setTimeout(() => {
              oldWs.off('pong', onPong);
              if (ws.readyState !== WebSocket.OPEN) return;
              if (responded && oldWs.readyState === WebSocket.OPEN) {
                sendJson(ws, { type: 'session_status', active: false, alreadyActive: true });
                return;
              }
              try {
                oldWs.terminate();
              } catch {
                // ignore
              }
              const curRoom = rooms.get(code);
              if (!curRoom || curRoom.turnState === 'game_over') {
                sendJson(ws, { type: 'session_status', active: false });
                return;
              }
              const curSeat = curRoom.players[matchedSide!];
              if (!curSeat || curSeat.token !== token) {
                sendJson(ws, { type: 'session_status', active: false });
                return;
              }
              sendActiveStatus(curRoom, curSeat);
            }, sessionProbeMs);
            break;
          }
          sendActiveStatus(room, seat);
          break;
        }

        case 'session_forfeit': {
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const token = typeof msg.token === 'string' ? msg.token : '';
          const room = rooms.get(code);
          if (!room || !token || room.turnState === 'game_over') {
            sendJson(ws, { type: 'session_status', active: false });
            break;
          }
          let matchedSide: Side | null = null;
          if (room.players.home.token === token) matchedSide = 'home';
          else if (room.players.away?.token === token) matchedSide = 'away';
          if (!matchedSide) {
            sendJson(ws, { type: 'session_status', active: false });
            break;
          }
          const seat = room.players[matchedSide]!;
          if (seat.disconnectTimer) {
            clearTimeout(seat.disconnectTimer);
            seat.disconnectTimer = null;
          }
          seat.disconnectDeadlineAt = null;
          if (!room.players.away) {
            cleanupRoom(code);
            scheduleStatsBroadcast();
            sendJson(ws, { type: 'session_status', active: false });
            break;
          }
          clearPitchClock(room);
          clearRoomPauses(room);
          room.absWindowUntil = 0;
          if (room.swingTimer) {
            clearTimeout(room.swingTimer);
            room.swingTimer = null;
          }
          const winner: Side = matchedSide === 'home' ? 'away' : 'home';
          room.match.isGameOver = true;
          room.match.winner = winner;
          room.match.endReason = 'resign';
          room.match.lastEvent = `${seat.name} forfeited`;
          room.turnState = 'game_over';
          room.activePitch = null;
          recordMatchEnd(room, 'resign');
          sendToRoom(room, {
            type: 'match_over',
            winner,
            reason: 'resign',
            match: room.match,
          });
          cleanupRoom(code);
          scheduleStatsBroadcast();
          sendJson(ws, { type: 'session_status', active: false });
          break;
        }

        case 'set_batter_side': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState === 'game_over') return;
          const sideVal = msg.side === 'L' || msg.side === 'left' ? 'L' : 'R';
          room.batterSides[client.side] = sideVal;
          sendToRoom(room, { type: 'batter_side', side: sideVal, team: client.side });
          break;
        }

        case 'ibb': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (
            !room ||
            !room.players.away ||
            !room.players.home.connected ||
            !room.players.away.connected ||
            room.pausedBy.size > 0 ||
            room.turnState !== 'awaiting_pitch' ||
            client.side !== getPitchingSide(room.match) ||
            msg.pitchSeq !== room.pitchSeq
          ) {
            if (room && room.turnState !== 'game_over' && room.pausedBy.size === 0) monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          if (!canIntentionalWalk(room.match)) return;
          room.consecutiveClockViolations[client.side] = 0;
          room.lastActivityAt = Date.now();
          room.absWindowUntil = 0;

          clearPitchClock(room);
          applyIntentionalWalk(room.match);
          const solvedSeq = room.pitchSeq;
          room.pitchSeq += 1;
          room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
          recordPitchAnalytics(room, {
            event: 'ibb',
            pitchSeq: solvedSeq,
            inning: room.match.inning,
            half: room.match.half,
            pitcherSide: client.side,
            pitcherName: room.players[client.side]?.name ?? client.side,
            outcome: 'IBB',
          });

          sendToRoom(room, {
            type: 'pitch_result',
            pitchSeq: solvedSeq,
            nextPitchSeq: room.pitchSeq,
            swung: false,
            ibb: true,
            swingData: null,
            resolution: null,
            outcome: 'IBB',
            callout: { title: 'INTENTIONAL WALK', subtitle: 'INTENTIONAL WALK (5.01D)', color: '#38bdf8', ttl: 1.4 },
            inningChanged: false,
            telemetry: 'IBB',
            match: room.match,
          });

          if (room.match.isGameOver) {
            recordMatchEnd(room, 'completed');
          } else {
            armPitchClock(room, 2200);
          }
          break;
        }

        case 'pitch_submit': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (
            !room ||
            !room.players.away ||
            !room.players.home.connected ||
            !room.players.away.connected ||
            room.pausedBy.size > 0 ||
            Date.now() < room.absWindowUntil ||
            room.turnState !== 'awaiting_pitch' ||
            client.side !== getPitchingSide(room.match) ||
            msg.pitchSeq !== room.pitchSeq ||
            room.solvingSeq === room.pitchSeq
          ) {
            if (room && room.players.away && room.turnState !== 'game_over' && room.pausedBy.size === 0 && Date.now() >= room.absWindowUntil) {
              monitor.staleOrOutOfTurnIgnored += 1;
            }
            return;
          }
          room.consecutiveClockViolations[client.side] = 0;
          room.lastActivityAt = Date.now();
          room.absWindowUntil = 0;

          const pitchId = PITCH_IDS.includes(msg.pitchId as PitchId)
            ? (msg.pitchId as PitchId)
            : 'straight';
          const spec = PITCH_SPECS[pitchId];
          const rawSpeed = Number(msg.speedKmh);
          const minSpd = spec.speedRangeKmh[0];
          const maxSpd = spec.speedRangeKmh[1] + 4;
          const speedKmh = Number.isFinite(rawSpeed)
            ? Math.max(minSpd, Math.min(maxSpd, rawSpeed))
            : spec.defaultSpeedKmh;
          const rawTargetX = Number(msg.targetX);
          const rawTargetY = Number(msg.targetY);
          const targetX = Number.isFinite(rawTargetX) ? Math.max(-0.5, Math.min(0.5, rawTargetX)) : 0;
          const targetY = Number.isFinite(rawTargetY) ? Math.max(0.15, Math.min(1.45, rawTargetY)) : 0.72;
          const rawErrX = Number(msg.errorX);
          const rawErrY = Number(msg.errorY);
          const errorX = Number.isFinite(rawErrX) ? Math.max(-0.35, Math.min(0.35, rawErrX)) : 0;
          const errorY = Number.isFinite(rawErrY) ? Math.max(-0.35, Math.min(0.35, rawErrY)) : 0;

          if (
            (msg.speedKmh !== undefined && (!Number.isFinite(rawSpeed) || rawSpeed < minSpd - 2 || rawSpeed > maxSpd + 2)) ||
            (msg.targetX !== undefined && (!Number.isFinite(rawTargetX) || rawTargetX < -0.65 || rawTargetX > 0.65)) ||
            (msg.targetY !== undefined && (!Number.isFinite(rawTargetY) || rawTargetY < 0.0 || rawTargetY > 1.7)) ||
            (msg.errorX !== undefined && (!Number.isFinite(rawErrX) || Math.abs(rawErrX) > 0.45)) ||
            (msg.errorY !== undefined && (!Number.isFinite(rawErrY) || Math.abs(rawErrY) > 0.45))
          ) {
            monitor.outOfRangeInputsClamped += 1;
          }

          const rawU = Number(msg.u);
          const u = msg.u !== undefined && Number.isFinite(rawU) ? Math.max(0, Math.min(1, rawU)) : undefined;
          const springZone = decodeSpringZone(msg.springZone);
          const expectedSeq = room.pitchSeq;
          const seed = crypto.randomInt(1, 2147483647);
          room.solvingSeq = expectedSeq;
          clearPitchClock(room);

          void physicsPool
            .solvePitch({
              pitchId,
              speedKmh,
              targetX,
              targetY,
              errorX,
              errorY,
              outputHz: 120,
              seed,
            })
            .then(({ result: trajectory, solveMs }) => {
              if (room.solvingSeq === expectedSeq) room.solvingSeq = null;
              monitor.recordPhysicsSolve(solveMs);
              if (
                rooms.get(room.code) !== room ||
                room.turnState !== 'awaiting_pitch' ||
                room.pitchSeq !== expectedSeq ||
                room.match.isGameOver
              ) {
                return;
              }
              if (!trajectory.plateCrossPos.every(Number.isFinite) || !Number.isFinite(trajectory.flightTimeSec)) {
                monitor.nanSanityErrors += 1;
              }
              const breakCm = Math.round(
                Math.hypot(trajectory.breakDelta[1], trajectory.breakDelta[2]) * 100,
              );

              room.turnState = 'awaiting_swing';
              room.activePitch = {
                pitchSeq: expectedSeq,
                seed,
                ...(u !== undefined ? { u } : {}),
                pitchId,
                speedKmh,
                targetX,
                targetY,
                errorX,
                errorY,
                breakCm,
                springZone,
                trajectory,
              };

              const timeoutMs = Math.round(trajectory.flightTimeSec * 1000) + swingTimeoutPaddingMs;
              room.swingTimer = setTimeout(() => {
                monitor.swingTimeouts += 1;
                room.lastActivityAt = Date.now();
                void finalizeSwing(room, false, null);
              }, timeoutMs);

              sendToRoom(room, {
                type: 'pitch_launch',
                pitchSeq: expectedSeq,
                seed,
                pitchId,
                speedKmh,
                targetX,
                targetY,
                errorX,
                errorY,
                batterSide: getCurrentBatterSide(room),
                breakCm,
              });
            })
            .catch(() => {
              if (room.solvingSeq === expectedSeq) room.solvingSeq = null;
              if (rooms.get(room.code) === room && room.turnState === 'awaiting_pitch' && !room.match.isGameOver) {
                armPitchClock(room, 1500);
              }
            });
          break;
        }

        case 'swing_input': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (
            !room ||
            room.turnState !== 'awaiting_swing' ||
            client.side !== getBattingSide(room.match) ||
            msg.pitchSeq !== room.pitchSeq ||
            room.solvingSeq === room.pitchSeq
          ) {
            if (room && room.turnState !== 'game_over') monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }

          const flightTimeSec = Number(msg.flightTimeSec);
          const batX = Number(msg.batX);
          const batY = Number(msg.batY);
          if (!Number.isFinite(flightTimeSec) || !Number.isFinite(batX) || !Number.isFinite(batY)) {
            monitor.outOfRangeInputsClamped += 1;
            return;
          }
          if (flightTimeSec < 0.05 || flightTimeSec > 3.5 || batX < -0.65 || batX > 0.65 || batY < 0 || batY > 1.7) {
            monitor.outOfRangeInputsClamped += 1;
          }
          room.lastActivityAt = Date.now();
          const swingMode: SwingMode = msg.swingMode === 'power' ? 'power' : 'normal';
          const batterSide: 'R' | 'L' = msg.batterSide === 'L' || msg.batterSide === 'left' ? 'L' : 'R';
          room.batterSides[getBattingSide(room.match)] = batterSide;

          void finalizeSwing(room, true, {
            flightTimeSec,
            batX: Math.max(-0.5, Math.min(0.5, batX)),
            batY: Math.max(0.15, Math.min(1.45, batY)),
            swingMode,
            batterSide,
          });
          break;
        }

        case 'no_swing': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (
            !room ||
            room.turnState !== 'awaiting_swing' ||
            client.side !== getBattingSide(room.match) ||
            msg.pitchSeq !== room.pitchSeq ||
            room.solvingSeq === room.pitchSeq
          ) {
            if (room && room.turnState !== 'game_over') monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          room.lastActivityAt = Date.now();

          void finalizeSwing(room, false, null);
          break;
        }

        case 'list': {
          const liveRooms = [];
          for (const room of rooms.values()) {
            if (!room.players.away || room.turnState === 'game_over') continue;
            liveRooms.push({
              code: room.code,
              awayName: room.match.away.name,
              homeName: room.match.home.name,
              inning: room.match.inning,
              half: room.match.half,
              outs: room.match.outs,
              awayScore: room.match.away.totalRuns,
              homeScore: room.match.home.totalRuns,
              spectators: room.spectators.size,
              isDerby: room.match.derby.active,
              mode: room.mode,
              roomKind: room.isMatchmaking ? 'live' : 'friend',
            });
          }
          sendJson(ws, { type: 'room_list', rooms: liveRooms });
          break;
        }

        case 'watch': {
          abandonWaitingRoomIfHost(client);
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const room = rooms.get(code);
          if (!room) {
            sendJson(ws, { type: 'error', code: 'room_not_found', message: 'Room code not found' });
            return;
          }
          if (client.watchingCode && client.watchingCode !== room.code) {
            const oldRoom = rooms.get(client.watchingCode);
            if (oldRoom && oldRoom.spectators.delete(client)) {
              broadcastSpectatorCount(oldRoom);
            }
          }
          const addedSpectator = !room.spectators.has(client);
          room.spectators.add(client);
          client.watchingCode = room.code;
          sendJson(ws, {
            type: 'spectate_sync',
            code: room.code,
            mode: room.mode,
            roomKind: room.isMatchmaking ? 'live' : 'friend',
            awayName: room.match.away.name,
            homeName: room.match.home.name,
            match: room.match,
            pitchSeq: room.pitchSeq,
            turnState: room.turnState,
            batterSide: getCurrentBatterSide(room),
            batterSides: room.batterSides,
            activePitch: room.activePitch
              ? {
                  pitchSeq: room.activePitch.pitchSeq,
                  seed: room.activePitch.seed,
                  pitchId: room.activePitch.pitchId,
                  speedKmh: room.activePitch.speedKmh,
                  targetX: room.activePitch.targetX,
                  targetY: room.activePitch.targetY,
                  errorX: room.activePitch.errorX,
                  errorY: room.activePitch.errorY,
                  breakCm: room.activePitch.breakCm,
                }
              : null,
            spectators: room.spectators.size,
          });
          if (addedSpectator) {
            broadcastSpectatorCount(room);
          }
          break;
        }

        case 'unwatch': {
          if (client.watchingCode) {
            const room = rooms.get(client.watchingCode);
            if (room && room.spectators.delete(client)) {
              broadcastSpectatorCount(room);
            }
            client.watchingCode = null;
          }
          sendJson(ws, { type: 'unwatched' });
          break;
        }

        case 'abs_challenge': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          const allowGameOverAbs = Boolean(
            room &&
              room.turnState === 'game_over' &&
              !room.recorded &&
              room.match.lastChallenge &&
              !room.match.lastChallenge.challenged,
          );
          if (!room || (room.turnState !== 'awaiting_pitch' && !allowGameOverAbs)) {
            if (room && room.turnState !== 'game_over') monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          if (!room.match.lastChallenge) return;
          if (
            typeof msg.pitchSeq === 'number' &&
            msg.pitchSeq !== room.match.lastChallenge.pitchSeq
          ) {
            monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          if (room.gameOverAbsTimer) {
            clearTimeout(room.gameOverAbsTimer);
            room.gameOverAbsTimer = null;
          }
          const prevAbsHalf = room.match.half;
          const res = applyAbsChallenge(room.match, client.side);
          if (!res.ok) return;
          monitor.absChallengesTotal += 1;
          if (res.overturned) monitor.absOverturned += 1;
          room.lastActivityAt = Date.now();
          room.absWindowUntil = 0;

          room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
          recordPitchAnalytics(room, {
            event: 'abs_challenge',
            pitchSeq: room.pitchSeq,
            inning: room.match.inning,
            half: room.match.half,
            challengerSide: res.challengerSide,
            challengerName: room.players[res.challengerSide]?.name ?? res.challengerSide,
            overturned: res.overturned,
            trueCall: res.trueCall,
            umpireCall: res.umpireCall,
            marginCm: round2(res.marginCm),
            plateX: round3(res.plateX),
            plateY: round3(res.plateY),
          });
          sendToRoom(room, {
            type: 'abs_result',
            overturned: res.overturned,
            trueCall: res.trueCall,
            umpireCall: res.umpireCall,
            marginCm: res.marginCm,
            plateX: res.plateX,
            plateY: res.plateY,
            challengerSide: res.challengerSide,
            outcome: res.outcome,
            wildKind: res.wildKind,
            match: room.match,
            pitchSeq: room.pitchSeq,
          });
          if (room.match.half !== prevAbsHalf && !room.match.isGameOver) {
            sendToRoom(room, {
              type: 'batter_side',
              side: getCurrentBatterSide(room),
              team: getBattingSide(room.match),
            });
          }
          if (room.match.isGameOver) {
            clearPitchClock(room);
            clearRoomPauses(room);
            recordMatchEnd(room, 'completed');
          } else {
            armPitchClock(room, 3200);
          }
          break;
        }

        case 'resign': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState === 'game_over') return;
          clearPitchClock(room);
          clearRoomPauses(room);
          room.absWindowUntil = 0;
          if (room.swingTimer) {
            clearTimeout(room.swingTimer);
            room.swingTimer = null;
          }
          const winner: Side = client.side === 'home' ? 'away' : 'home';
          room.match.isGameOver = true;
          room.match.winner = winner;
          room.match.endReason = 'resign';
          room.match.lastEvent = `${room.players[client.side]?.name ?? client.side} forfeited`;
          room.turnState = 'game_over';
          room.activePitch = null;
          recordMatchEnd(room, 'resign');

          sendToRoom(room, {
            type: 'match_over',
            winner,
            reason: 'resign',
            match: room.match,
          });
          break;
        }

        case 'emote': {
          const targetCode = client.roomCode || client.watchingCode;
          if (!targetCode) return;
          const room = rooms.get(targetCode);
          if (!room) return;
          const emoteId = typeof msg.id === 'string' ? msg.id : '';
          if (!VALID_EMOTE_IDS.has(emoteId)) return;
          if (now - client.lastEmoteAt < 3000) return;
          const isPlayer = Boolean(client.roomCode && client.side);
          if (!isPlayer) {
            // Room-wide spectator throttle (1.2s) prevents crowd floods from distracting players
            if (now - room.lastSpectatorEmoteAt < 1200) return;
            room.lastSpectatorEmoteAt = now;
          }
          client.lastEmoteAt = now;
          const senderSide: Side | 'spectator' = isPlayer ? client.side! : 'spectator';
          sendToRoom(room, {
            type: 'emote',
            side: senderSide,
            id: emoteId,
            senderName: client.name,
          });
          break;
        }

        case 'menu_pause': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || !room.players.away || room.turnState === 'game_over') return;
          const side = client.side;
          const wantPause = Boolean(msg.paused);
          room.lastActivityAt = now;

          if (wantPause) {
            if (!room.pausedBy.has(side)) {
              room.pausedBy.add(side);
              room.pauseExpiresAt[side] = now + menuPauseMs;
              if (room.pauseTimers[side]) clearTimeout(room.pauseTimers[side]!);
              room.pauseTimers[side] = setTimeout(() => {
                room.pauseTimers[side] = null;
                room.pauseExpiresAt[side] = 0;
                if (!room.pausedBy.delete(side)) return;
                if (rooms.get(room.code) !== room || room.turnState === 'game_over') return;
                broadcastPauseState(room);
                if (room.pausedBy.size === 0) {
                  resumePitchClock(room);
                }
              }, menuPauseMs);
              pausePitchClock(room);
              broadcastPauseState(room);
            }
          } else if (room.pausedBy.has(side)) {
            if (room.pauseTimers[side]) {
              clearTimeout(room.pauseTimers[side]!);
              room.pauseTimers[side] = null;
            }
            room.pauseExpiresAt[side] = 0;
            room.pausedBy.delete(side);
            broadcastPauseState(room);
            if (room.pausedBy.size === 0) {
              resumePitchClock(room);
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      monitor.connClosedTotal += 1;
      const ipLeft = (ipConnCounts.get(ip) ?? 1) - 1;
      if (ipLeft <= 0) ipConnCounts.delete(ip);
      else ipConnCounts.set(ip, ipLeft);
      removeFromQueues(clientId, 'disconnect');
      if (client.watchingCode) {
        const watched = rooms.get(client.watchingCode);
        if (watched && watched.spectators.delete(client)) {
          broadcastSpectatorCount(watched);
        }
        client.watchingCode = null;
      }
      const code = client.roomCode;
      const side = client.side;
      clients.delete(clientId);

      if (code && side) {
        const room = rooms.get(code);
        if (room) {
          const player = room.players[side];
          if (player && player.clientId === clientId) {
            player.connected = false;
            player.ws = null;

            if (room.turnState === 'game_over') {
              // Already finished -> clean up immediately
              cleanupRoom(code);
            } else {
              if (room.pauseTimers[side]) {
                clearTimeout(room.pauseTimers[side]!);
                room.pauseTimers[side] = null;
              }
              room.pauseExpiresAt[side] = 0;
              room.pausedBy.delete(side);
              pausePitchClock(room);
              const oppSide: Side = side === 'home' ? 'away' : 'home';
              if (room.players.away) {
                monitor.disconnectsInMatch += 1;
                sendJson(room.players[oppSide]?.ws, {
                  type: 'opponent_disconnected',
                  graceSec: Math.round(graceMs / 1000),
                });
              }
              const waitDurationMs = room.players.away ? graceMs : waitingGraceMs;
              player.disconnectDeadlineAt = Date.now() + waitDurationMs;
              player.disconnectTimer = setTimeout(
                () => expireSeat(code, side),
                waitDurationMs,
              );
            }
          }
        }
      }

      scheduleStatsBroadcast();
    });
  });

  async function close() {
    monitor.stop();
    eld.disable();
    clearInterval(heartbeatTimer);
    clearInterval(statsTimer);
    if (statsBroadcastTimer) {
      clearTimeout(statsBroadcastTimer);
      statsBroadcastTimer = null;
    }
    if (drainGraceTimer) {
      clearTimeout(drainGraceTimer);
      drainGraceTimer = null;
    }
    for (const offer of pendingOffers.values()) {
      if (offer.timer) clearTimeout(offer.timer);
    }
    pendingOffers.clear();
    for (const room of rooms.values()) {
      clearPitchClock(room);
      clearRoomPauses(room);
      if (room.swingTimer) clearTimeout(room.swingTimer);
      for (const side of ['home', 'away'] as const) {
        const p = room.players[side];
        if (p?.disconnectTimer) clearTimeout(p.disconnectTimer);
      }
    }
    rooms.clear();
    for (const c of clients.values()) {
      try {
        c.ws.close();
      } catch {
        // ignore
      }
    }
    clients.clear();
    await physicsPool.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Graceful SIGTERM drain: 10-minute countdown, blocks all new online/friend matches,
  // restarts immediately once all active matches finish (or force-restarts at 00:00).
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const drainSec = Math.max(5, Number(process.env.DRAIN_SECONDS) || 600);
    const handleDrain = () => {
      if (draining) {
        process.exit(0);
      }
      draining = true;
      updateAtMs = Date.now() + drainSec * 1000;
      for (const offer of pendingOffers.values()) {
        if (offer.timer) clearTimeout(offer.timer);
        const sc = clients.get(offer.standbyClientId);
        if (sc) sendJson(sc.ws, { type: 'offer_cancelled', offerId: offer.offerId, reason: 'draining' });
      }
      pendingOffers.clear();
      for (const m of ONLINE_MODES) {
        queues[m].length = 0;
        standbyQueues[m].length = 0;
      }
      for (const c of clients.values()) {
        if (c.queuedMode) removeFromQueues(c.id, 'drain');
        c.queuedMode = null;
        c.standbyMode = null;
        sendJson(c.ws, { type: 'notice', kind: 'draining', countdownSec: drainSec, updateAtMs });
      }

      if (countActiveMatches() === 0) {
        void close().then(() => process.exit(0));
        return;
      }
      const forceTimer = setTimeout(() => {
        void close().then(() => process.exit(0));
      }, drainSec * 1000);
      drainWaiters.add(() => {
        clearTimeout(forceTimer);
        void close().then(() => process.exit(0));
      });
    };
    process.on('SIGTERM', handleDrain);
    process.on('SIGINT', () => {
      void close().then(() => process.exit(0));
    });
  }

  const bindHost = process.env.HOST || '0.0.0.0';
  return new Promise((resolve) => {
    server.listen(port, bindHost, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, wss, rooms, port: actualPort, close });
    });
  });
}

// Auto-start when executed directly (e.g., `node dist-server/index.mjs`)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bindHost = process.env.HOST || '0.0.0.0';
  startServer().then(({ port }) => {
    console.log(`[capbaseball-server] listening on http://${bindHost}:${port}`);
  });
}
