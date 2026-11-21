import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ServerMonitor, type ServerSnapshotInput } from './monitor';
import { MONITOR_HTML, MONITOR_JS } from './monitorUi';
import { PhysicsPool, type ServerPitchSummary } from './physicsPool';
import { checkCatcherCatch } from '../src/ai/cpu';
import {
  encodeServerMsgV2,
  normalizeClientMsg,
  type ServerLoadStatus,
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
};

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export type OnlineMode = 'quick3' | 'official6';
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
  lastPingSentAt: number;
  lastPongAt: number;
  msgWindowStart: number;
  msgCount: number;
}

interface RoomPlayer {
  token: string;
  name: string;
  clientId: string | null;
  ws: WebSocket | null;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
}

interface ActivePitchData {
  pitchSeq: number;
  seed: number;
  pitchId: PitchId;
  speedKmh: number;
  targetX: number;
  targetY: number;
  errorX: number;
  errorY: number;
  breakCm: number;
  trajectory: ServerPitchSummary;
}

interface Room {
  code: string;
  mode: OnlineMode;
  isMatchmaking: boolean;
  createdAt: number;
  lastActivityAt: number;
  match: MatchState;
  pitchSeq: number;
  solvingSeq: number | null;
  turnState: TurnState;
  batterSide: 'R' | 'L';
  activePitch: ActivePitchData | null;
  swingTimer: NodeJS.Timeout | null;
  pitchClockTimer: NodeJS.Timeout | null;
  players: {
    home: RoomPlayer;
    away: RoomPlayer | null;
  };
  spectators: Set<ClientMeta>;
  rematchVotes: Set<Side>;
  recorded: boolean;
}

export interface ServerOptions {
  port?: number;
  staticDir?: string;
  matchLogPath?: string;
  pingIntervalMs?: number;
  deadSocketTimeoutMs?: number;
  graceMs?: number;
  /** How long a room with no guest survives its host going offline (sharing the code on a phone). */
  waitingGraceMs?: number;
  swingTimeoutPaddingMs?: number;
  /** Scale factor for server Pitch Clock duration (1 = normal 15s/20s; 0 disables; <1 accelerates tests). */
  pitchClockScale?: number;
  maxRooms?: number;
  maxClients?: number;
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

function getMatchLogPath(override?: string): string {
  const target = override || process.env.MATCH_LOG || 'data/matches.jsonl';
  return path.resolve(process.cwd(), target);
}

const ensuredMatchLogDirs = new Set<string>();
let matchLogWriteChain: Promise<void> = Promise.resolve();

function appendMatchLog(record: unknown, override?: string): void {
  const logPath = getMatchLogPath(override);
  const dir = path.dirname(logPath);
  const line = JSON.stringify(record) + '\n';
  matchLogWriteChain = matchLogWriteChain
    .then(async () => {
      if (!ensuredMatchLogDirs.has(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
        ensuredMatchLogDirs.add(dir);
      }
      await fs.promises.appendFile(logPath, line, 'utf8');
    })
    .catch((err) => {
      console.error('[match-log] write failed:', err);
    });
}

function buildMatchState(mode: OnlineMode, homeName: string, awayName: string): MatchState {
  return createMatch(mode, {
    awayName: `中正黑 ${awayName}`,
    homeName: `中正黃 ${homeName}`,
    awayLineup: AWAY_LINEUP,
    homeLineup: HOME_LINEUP,
  });
}

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
  const graceMs = opts.graceMs ?? 45_000;
  const waitingGraceMs = opts.waitingGraceMs ?? 300_000;
  const swingTimeoutPaddingMs = opts.swingTimeoutPaddingMs ?? 4500;
  const pitchClockScale = opts.pitchClockScale ?? 1;
  const maxRooms = opts.maxRooms ?? (Number(process.env.MAX_ROOMS) || 80);
  const maxClients = opts.maxClients ?? (Number(process.env.MAX_CLIENTS) || 500);
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
          cacheControl: rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
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
  const drainWaiters = new Set<() => void>();
  const clients = new Map<string, ClientMeta>();
  const ipConnCounts = new Map<string, number>();
  const rooms = new Map<string, Room>();
  const queues: Record<OnlineMode, string[]> = {
    quick3: [],
    official6: [],
  };

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
    };
  }

  function getStats() {
    const load = getServerLoad();
    return {
      online: clients.size,
      rooms: rooms.size,
      queued: queues.quick3.length + queues.official6.length,
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

    for (const r of rooms.values()) {
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
    return {
      uptimeSec: Math.floor((now - startedAt) / 1000),
      version,
      draining,
      load: getServerLoad(),
      queuesTotal: queues.quick3.length + queues.official6.length,
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

  function checkDrainComplete() {
    if (draining && rooms.size === 0) {
      for (const resolve of drainWaiters) resolve();
      drainWaiters.clear();
    }
  }

  function clearPitchClock(room: Room) {
    if (room.pitchClockTimer) {
      clearTimeout(room.pitchClockTimer);
      room.pitchClockTimer = null;
    }
  }

  function armPitchClock(room: Room, postCallBufferMs = 2800) {
    clearPitchClock(room);
    if (pitchClockScale <= 0) return;
    if (!room.players.away || room.turnState !== 'awaiting_pitch' || room.match.isGameOver) return;
    if (!room.players.home.connected || !room.players.away.connected) return;
    const limitMs = Math.max(
      120,
      Math.round((getPitchClockSeconds(room.match) * 1000 + postCallBufferMs) * pitchClockScale),
    );
    const expectedSeq = room.pitchSeq;
    room.pitchClockTimer = setTimeout(() => {
      room.pitchClockTimer = null;
      if (room.turnState !== 'awaiting_pitch' || room.match.isGameOver || room.pitchSeq !== expectedSeq) return;
      if (!room.players.home.connected || !room.players.away?.connected) return;
      const res = applyPitchClockViolation(room.match);
      if (!res.applied) return;
      monitor.pitchClockViolations += 1;
      room.lastActivityAt = Date.now();
      const solvedSeq = room.pitchSeq;
      room.pitchSeq += 1;
      room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
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
          subtitle: res.walked ? 'WALK (BB)' : 'AUTO BALL',
          color: '#f97316',
          ttl: 2.2,
        },
        inningChanged: false,
        telemetry: 'PITCH CLOCK',
        match: room.match,
      });
      if (room.match.isGameOver) {
        recordMatchEnd(room, 'completed');
      } else {
        armPitchClock(room, 2600);
      }
    }, limitMs);
  }

  function cleanupRoom(code: string) {
    const room = rooms.get(code);
    if (!room) return;
    clearPitchClock(room);
    if (room.swingTimer) {
      clearTimeout(room.swingTimer);
      room.swingTimer = null;
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
    else if (reason === 'resign') monitor.matchesResigned += 1;
    else if (reason === 'disconnect_timeout') monitor.matchesDisconnectTimeout += 1;
    appendMatchLog(
      {
        ts: new Date().toISOString(),
        code: room.code,
        mode: room.mode,
        reason,
        winner: room.match.winner,
        awayRuns: room.match.away.totalRuns,
        homeRuns: room.match.home.totalRuns,
        innings: room.match.inning,
        pitches: room.match.stats.totalPitches,
        homeRunsCount: room.match.stats.homeRuns,
      },
      opts.matchLogPath,
    );
  }

  function removeFromQueues(clientId: string) {
    for (const m of ['quick3', 'official6'] as const) {
      const idx = queues[m].indexOf(clientId);
      if (idx !== -1) queues[m].splice(idx, 1);
    }
    const c = clients.get(clientId);
    if (c) c.queuedMode = null;
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

  function sendStateSync(room: Room, side: Side) {
    const player = room.players[side];
    if (!player?.ws) return;
    const client = player.clientId ? clients.get(player.clientId) : null;
    sendJson(player.ws, {
      type: 'state_sync',
      code: room.code,
      mode: room.mode,
      side,
      pitchSeq: room.pitchSeq,
      turnState: room.turnState,
      batterSide: room.batterSide,
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
    });
  }

  function resolveNoContactPitch(room: Room, swung: boolean) {
    if (!room.activePitch) return;
    const traj = room.activePitch.trajectory;
    const plateField = simToField(traj.plateCrossPos);
    const caughtByCatcher = checkCatcherCatch(
      plateField[0],
      plateField[1],
      traj.reachesPassLine,
      room.activePitch.seed,
    );

    const prevInning = room.match.inning;
    const prevHalf = room.match.half;

    let outcomeStr: string;
    let callout: { title: string; subtitle: string; color: string; ttl: number };

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
      const preSnap = captureAbsPreSnapshot(room.match);
      const res = judgePitch({
        plateX: plateField[0],
        plateY: plateField[1],
        swung: false,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: traj.reachesPassLine,
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
        reachesPassLine: traj.reachesPassLine,
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
        reachesPassLine: traj.reachesPassLine,
      });

      outcomeStr = res.call;
      if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
        callout = { title: 'UNCAUGHT 3RD', subtitle: 'DROPPED 3RD · BATTER TO 1B', color: '#f97316', ttl: 1.7 };
      } else if (res.isWildPitch) {
        callout = { title: 'WILD PITCH', subtitle: 'WILD PITCH · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 };
      } else if (res.isStrike) {
        const isK = room.match.strikes === 0 && room.match.lastEvent.includes('strikes out');
        callout = {
          title: isK ? 'STRIKE OUT!' : 'STRIKE',
          subtitle: isK ? 'CALLED STRIKE THREE' : 'CALLED STRIKE',
          color: '#ffd23f',
          ttl: 1.25,
        };
      } else {
        const isBB = room.match.balls === 0 && room.match.lastEvent.includes('walks');
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
        reachesPassLine: traj.reachesPassLine,
        currentStrikes: room.match.strikes,
        runnersOnBase: room.match.bases.some((b) => b !== null),
      });

      applyPitchResult(room.match, {
        plateX: plateField[0],
        plateY: plateField[1],
        swung: true,
        contacted: false,
        caughtByCatcher,
        reachesPassLine: traj.reachesPassLine,
      });

      outcomeStr = res.call;
      if (res.call === 'UNCAUGHT_THIRD_STRIKE') {
        callout = { title: 'UNCAUGHT 3RD', subtitle: 'DROPPED 3RD · BATTER TO 1B', color: '#f97316', ttl: 1.7 };
      } else if (res.isWildPitch) {
        callout = { title: 'WILD PITCH', subtitle: 'WILD PITCH · RUNNERS ADVANCE', color: '#f97316', ttl: 1.5 };
      } else {
        const isK = room.match.strikes === 0 && room.match.lastEvent.includes('strikes out');
        callout = {
          title: isK ? 'STRIKE OUT!' : 'STRIKE',
          subtitle: 'SWINGING STRIKE',
          color: '#ffd23f',
          ttl: 1.25,
        };
      }
    }

    const inningChanged = room.match.inning !== prevInning || room.match.half !== prevHalf;
    const solvedSeq = room.activePitch.pitchSeq;
    const spec = PITCH_SPECS[room.activePitch.pitchId];
    const telemetry = `${spec.code} ${Math.round(room.activePitch.speedKmh)} km/h · BRK ${room.activePitch.breakCm}cm`;

    room.pitchSeq += 1;
    room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
    room.activePitch = null;

    sendToRoom(room, {
      type: 'pitch_result',
      pitchSeq: solvedSeq,
      nextPitchSeq: room.pitchSeq,
      swung,
      swingData: null,
      resolution: null,
      outcome: outcomeStr,
      callout,
      inningChanged,
      telemetry,
      match: room.match,
    });

    if (room.match.isGameOver) {
      recordMatchEnd(room, 'completed');
    } else {
      armPitchClock(room, 3000);
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
      resolveNoContactPitch(room, true);
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
    let callout: { title: string; subtitle: string; color: string; ttl: number };
    if (outcome === 'HR') {
      callout = { title: 'HOME RUN!', subtitle: `${resolution.distanceM.toFixed(1)}m OVER THE WALL!`, color: '#ffd23f', ttl: 2.1 };
    } else if (outcome === '3B') {
      callout = { title: 'TRIPLE!', subtitle: isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : 'OFF THE WALL ON THE FLY · 3B', color: '#38bdf8', ttl: 1.6 };
    } else if (outcome === '2B') {
      callout = { title: 'DOUBLE!', subtitle: isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : 'BOUNCED TO THE WALL · 2B', color: '#4ade80', ttl: 1.5 };
    } else if (outcome === '1B') {
      callout = { title: 'SINGLE!', subtitle: isBobbleHit ? 'FIELDER BOBBLE · SAFE!' : 'BASE HIT · 1B', color: '#a3e635', ttl: 1.4 };
    } else if (outcome === 'FOUL') {
      callout = { title: 'FOUL', subtitle: 'FOUL BALL', color: '#cbd5e1', ttl: 1.2 };
    } else {
      callout = {
        title: 'OUT!',
        subtitle: resolution.catchInfo.caught ? 'OUTFIELD CATCH!' : 'INFIELD OUT!',
        color: '#ef4444',
        ttl: 1.5,
      };
    }

    const inningChanged = room.match.inning !== prevInning || room.match.half !== prevHalf;
    const solvedSeq = room.activePitch.pitchSeq;
    const spec = PITCH_SPECS[room.activePitch.pitchId];
    const telemetry = `${spec.code} ${Math.round(room.activePitch.speedKmh)} km/h · BRK ${room.activePitch.breakCm}cm`;

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
      match: room.match,
    });

    if (room.match.isGameOver) {
      recordMatchEnd(room, 'completed');
    } else {
      armPitchClock(room, 4200);
    }
  }

  function startMatchInRoom(room: Room) {
    const home = room.players.home;
    const away = room.players.away;
    if (!away) return;

    room.lastActivityAt = Date.now();
    monitor.matchesStarted += 1;
    const names = { home: home.name, away: away.name };
    for (const side of ['home', 'away'] as const) {
      const p = room.players[side]!;
      sendJson(p.ws, {
        type: 'match_start',
        code: room.code,
        mode: room.mode,
        side,
        token: p.token,
        pitchSeq: room.pitchSeq,
        turnState: room.turnState,
        batterSide: room.batterSide,
        match: room.match,
        names,
      });
    }
    armPitchClock(room, 1500);
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
      c1.queuedMode = null;
      c2.queuedMode = null;

      const code = generateRoomCode(rooms);
      const homeFirst = crypto.randomInt(0, 2) === 0;
      const homeClient = homeFirst ? c1 : c2;
      const awayClient = homeFirst ? c2 : c1;

      const room: Room = {
        code,
        mode,
        isMatchmaking: true,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        match: buildMatchState(mode, homeClient.name, awayClient.name),
        pitchSeq: 1,
        solvingSeq: null,
        turnState: 'awaiting_pitch',
        batterSide: 'L',
        activePitch: null,
        swingTimer: null,
        pitchClockTimer: null,
        players: {
          home: {
            token: crypto.randomUUID(),
            name: homeClient.name,
            clientId: homeClient.id,
            ws: homeClient.ws,
            connected: true,
            disconnectTimer: null,
          },
          away: {
            token: crypto.randomUUID(),
            name: awayClient.name,
            clientId: awayClient.id,
            ws: awayClient.ws,
            connected: true,
            disconnectTimer: null,
          },
        },
        spectators: new Set(),
        rematchVotes: new Set(),
        recorded: false,
      };
      rooms.set(code, room);
      homeClient.roomCode = code;
      homeClient.side = 'home';
      awayClient.roomCode = code;
      awayClient.side = 'away';

      startMatchInRoom(room);
      scheduleStatsBroadcast();
    }
  }

  // --- HTTP Server (Static + /health + Security Headers) ---
  const CSP_POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; frame-ancestors 'none'";

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

    if (isGetOrHead && normalizedPath === '/monitor/') {
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
        queued: queues.quick3.length + queues.official6.length,
        clients: clients.size,
        draining,
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

    if (isGetOrHead && normalizedPath === '/monitor') {
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(MONITOR_HTML, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : MONITOR_HTML);
      return;
    }

    if (isGetOrHead && normalizedPath === '/monitor.js') {
      const bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(MONITOR_JS, 'utf8');
      monitor.recordHttp(200, bytes);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : MONITOR_JS);
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

      const relTarget = decodedPath === '/' ? '/index.html' : decodedPath;
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
      lastPingSentAt: nowOnConnect,
      lastPongAt: nowOnConnect,
      msgWindowStart: nowOnConnect,
      msgCount: 0,
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
          sendJson(ws, {
            type: 'welcome',
            clientId,
            name: client.name,
            version,
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
          if (client.roomCode) return;
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const mode: OnlineMode = msg.mode === 'official6' ? 'official6' : 'quick3';
          removeFromQueues(clientId);
          client.queuedMode = mode;
          queues[mode].push(clientId);
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
          if (client.roomCode) return;
          removeFromQueues(clientId);
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const mode: OnlineMode = msg.mode === 'official6' ? 'official6' : 'quick3';
          const code = generateRoomCode(rooms);
          const token = crypto.randomUUID();

          const room: Room = {
            code,
            mode,
            isMatchmaking: false,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            match: buildMatchState(mode, client.name, 'Opponent'),
            pitchSeq: 1,
            solvingSeq: null,
            turnState: 'awaiting_pitch',
            batterSide: 'L',
            activePitch: null,
            swingTimer: null,
            pitchClockTimer: null,
            players: {
              home: {
                token,
                name: client.name,
                clientId,
                ws,
                connected: true,
                disconnectTimer: null,
              },
              away: null,
            },
            spectators: new Set(),
            rematchVotes: new Set(),
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
          if (client.roomCode) return;
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const room = rooms.get(code);
          if (!room) {
            sendJson(ws, { type: 'error', code: 'room_not_found', message: 'Room code not found' });
            return;
          }
          if (room.players.away) {
            sendJson(ws, { type: 'error', code: 'room_full', message: 'Room is full' });
            return;
          }
          removeFromQueues(clientId);
          if (msg.name) client.name = sanitizeName(msg.name, isNameTaken);
          const token = crypto.randomUUID();
          room.players.away = {
            token,
            name: client.name,
            clientId,
            ws,
            connected: true,
            disconnectTimer: null,
          };
          room.match.away.name = `中正黑 ${client.name}`;
          client.roomCode = code;
          client.side = 'away';

          sendJson(ws, {
            type: 'room_joined',
            code,
            mode: room.mode,
            token,
            side: 'away',
          });
          startMatchInRoom(room);
          const host = room.players.home;
          if (host.disconnectTimer) {
            // Host went offline while waiting; the match has started, so fall back to the normal grace.
            clearTimeout(host.disconnectTimer);
            host.disconnectTimer = setTimeout(() => expireSeat(code, 'home'), graceMs);
            sendJson(ws, { type: 'opponent_disconnected', graceSec: Math.round(graceMs / 1000) });
          }
          scheduleStatsBroadcast();
          break;
        }

        case 'reconnect': {
          removeFromQueues(clientId);
          if (client.watchingCode) {
            const watched = rooms.get(client.watchingCode);
            watched?.spectators.delete(client);
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
          if (room.turnState === 'awaiting_pitch') {
            armPitchClock(room, 1500);
          }
          break;
        }

        case 'set_batter_side': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState !== 'awaiting_pitch') return;
          if (client.side !== getBattingSide(room.match)) return;
          const sideVal = msg.side === 'L' || msg.side === 'left' ? 'L' : 'R';
          room.batterSide = sideVal;
          sendToRoom(room, { type: 'batter_side', side: sideVal });
          break;
        }

        case 'ibb': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState !== 'awaiting_pitch' || client.side !== getPitchingSide(room.match) || msg.pitchSeq !== room.pitchSeq) {
            if (room && room.turnState !== 'game_over') monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          if (!canIntentionalWalk(room.match)) return;
          room.lastActivityAt = Date.now();

          clearPitchClock(room);
          applyIntentionalWalk(room.match);
          const solvedSeq = room.pitchSeq;
          room.pitchSeq += 1;
          room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';

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
            room.turnState !== 'awaiting_pitch' ||
            client.side !== getPitchingSide(room.match) ||
            msg.pitchSeq !== room.pitchSeq ||
            room.solvingSeq === room.pitchSeq
          ) {
            if (room && room.players.away && room.turnState !== 'game_over') monitor.staleOrOutOfTurnIgnored += 1;
            return;
          }
          room.lastActivityAt = Date.now();

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
                pitchId,
                speedKmh,
                targetX,
                targetY,
                errorX,
                errorY,
                breakCm,
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
                batterSide: room.batterSide,
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
          room.batterSide = batterSide;

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
              awayScore: room.match.away.totalRuns,
              homeScore: room.match.home.totalRuns,
              spectators: room.spectators.size,
              isDerby: room.match.derby.active,
              mode: room.mode,
            });
          }
          sendJson(ws, { type: 'room_list', rooms: liveRooms });
          break;
        }

        case 'watch': {
          const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
          const room = rooms.get(code);
          if (!room) {
            sendJson(ws, { type: 'error', code: 'room_not_found', message: 'Room code not found' });
            return;
          }
          if (client.watchingCode && client.watchingCode !== room.code) {
            const oldRoom = rooms.get(client.watchingCode);
            oldRoom?.spectators.delete(client);
          }
          room.spectators.add(client);
          client.watchingCode = room.code;
          sendJson(ws, {
            type: 'spectate_sync',
            code: room.code,
            mode: room.mode,
            awayName: room.match.away.name,
            homeName: room.match.home.name,
            match: room.match,
            pitchSeq: room.pitchSeq,
            turnState: room.turnState,
            batterSide: room.batterSide,
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
          break;
        }

        case 'unwatch': {
          if (client.watchingCode) {
            const room = rooms.get(client.watchingCode);
            room?.spectators.delete(client);
            client.watchingCode = null;
          }
          sendJson(ws, { type: 'unwatched' });
          break;
        }

        case 'abs_challenge': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState !== 'awaiting_pitch') {
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
          const res = applyAbsChallenge(room.match, client.side);
          if (!res.ok) return;
          monitor.absChallengesTotal += 1;
          if (res.overturned) monitor.absOverturned += 1;
          room.lastActivityAt = Date.now();

          room.turnState = room.match.isGameOver ? 'game_over' : 'awaiting_pitch';
          sendToRoom(room, {
            type: 'abs_result',
            overturned: res.overturned,
            trueCall: res.trueCall,
            umpireCall: res.umpireCall,
            marginCm: res.marginCm,
            plateX: res.plateX,
            plateY: res.plateY,
            challengerSide: res.challengerSide,
            match: room.match,
            pitchSeq: room.pitchSeq,
          });
          if (room.match.isGameOver) {
            clearPitchClock(room);
            recordMatchEnd(room, 'completed');
          } else {
            armPitchClock(room, 2600);
          }
          break;
        }

        case 'resign': {
          if (!client.roomCode || !client.side) return;
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState === 'game_over') return;
          clearPitchClock(room);
          if (room.swingTimer) {
            clearTimeout(room.swingTimer);
            room.swingTimer = null;
          }
          const winner: Side = client.side === 'home' ? 'away' : 'home';
          room.match.isGameOver = true;
          room.match.winner = winner;
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

        case 'rematch': {
          if (!client.roomCode || !client.side) {
            sendJson(ws, { type: 'error', code: 'opponent_left', message: 'Opponent left' });
            return;
          }
          const room = rooms.get(client.roomCode);
          if (!room || room.turnState !== 'game_over' || !room.players.away) {
            sendJson(ws, { type: 'error', code: 'opponent_left', message: 'Opponent left' });
            return;
          }
          const oppSide: Side = client.side === 'home' ? 'away' : 'home';
          const opp = room.players[oppSide];
          if (!opp || !opp.connected || !opp.ws || opp.ws.readyState !== WebSocket.OPEN) {
            sendJson(ws, { type: 'error', code: 'opponent_left', message: 'Opponent left' });
            return;
          }

          room.rematchVotes.add(client.side);
          if (room.rematchVotes.size < 2) {
            sendJson(opp.ws, { type: 'rematch_requested', side: client.side });
            return;
          }

          // Swap home/away sides for fair rematch
          const oldHome = room.players.home;
          const oldAway = room.players.away;
          room.players.home = oldAway;
          room.players.away = oldHome;

          const homeClient = oldAway.clientId ? clients.get(oldAway.clientId) : null;
          const awayClient = oldHome.clientId ? clients.get(oldHome.clientId) : null;
          if (homeClient) homeClient.side = 'home';
          if (awayClient) awayClient.side = 'away';

          room.rematchVotes.clear();
          room.match = buildMatchState(room.mode, room.players.home.name, room.players.away.name);
          room.pitchSeq = 1;
          room.solvingSeq = null;
          room.turnState = 'awaiting_pitch';
          room.batterSide = 'L';
          room.activePitch = null;
          room.recorded = false;
          monitor.rematchesStarted += 1;

          startMatchInRoom(room);
          break;
        }
      }
    });

    ws.on('close', () => {
      monitor.connClosedTotal += 1;
      const ipLeft = (ipConnCounts.get(ip) ?? 1) - 1;
      if (ipLeft <= 0) ipConnCounts.delete(ip);
      else ipConnCounts.set(ip, ipLeft);
      removeFromQueues(clientId);
      if (client.watchingCode) {
        const watched = rooms.get(client.watchingCode);
        watched?.spectators.delete(client);
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
              clearPitchClock(room);
              const oppSide: Side = side === 'home' ? 'away' : 'home';
              if (room.players.away) {
                monitor.disconnectsInMatch += 1;
                sendJson(room.players[oppSide]?.ws, {
                  type: 'opponent_disconnected',
                  graceSec: Math.round(graceMs / 1000),
                });
              }
              player.disconnectTimer = setTimeout(
                () => expireSeat(code, side),
                room.players.away ? graceMs : waitingGraceMs,
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
    for (const room of rooms.values()) {
      clearPitchClock(room);
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

  // Graceful SIGTERM drain when running as standalone process
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const drainSec = Math.max(5, Number(process.env.DRAIN_SECONDS) || 300);
    const handleDrain = () => {
      if (draining) {
        process.exit(0);
      }
      draining = true;
      for (const c of clients.values()) {
        sendJson(c.ws, { type: 'notice', kind: 'draining' });
      }
      if (rooms.size === 0) {
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
