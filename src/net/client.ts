import type { PitchId } from '../physics/pitches';
import type { MatchState } from '../rules/match';
import {
  decodeServerMsg,
  encodePitchId,
  round2,
  round3,
  type ServerLoadStatus,
} from './protocol';

export type OnlineMode = 'quick3' | 'official6';
export type OnlineSide = 'home' | 'away';
export type TurnState = 'awaiting_pitch' | 'awaiting_swing' | 'game_over';
export type NetQuality = 'good' | 'fair' | 'poor' | 'offline';

export interface OnlineStats {
  online: number;
  rooms: number;
  queued: number;
  load?: ServerLoadStatus;
  lagMs?: number;
}

export interface NetMetrics {
  connected: boolean;
  rttMs: number;
  avgRttMs: number;
  jitterMs: number;
  quality: NetQuality;
  serverLoad: ServerLoadStatus;
  serverLagMs: number;
}

export interface LiveRoomInfo {
  code: string;
  awayName: string;
  homeName: string;
  inning: number;
  half: 'top' | 'bottom';
  awayScore: number;
  homeScore: number;
  spectators: number;
  isDerby: boolean;
  mode: OnlineMode;
}

export interface PitchLaunchMsg {
  type: 'pitch_launch';
  pitchSeq: number;
  seed: number;
  pitchId: PitchId;
  speedKmh: number;
  targetX: number;
  targetY: number;
  errorX: number;
  errorY: number;
  batterSide: 'R' | 'L';
  breakCm: number;
}

export interface PitchResultMsg {
  type: 'pitch_result';
  pitchSeq: number;
  nextPitchSeq: number;
  swung: boolean;
  ibb?: boolean;
  clockViolation?: boolean;
  swingData: {
    flightTimeSec: number;
    batX: number;
    batY: number;
    swingMode: 'normal' | 'power';
    batterSide: 'R' | 'L';
  } | null;
  resolution: {
    contact: true;
    feedback: string;
    label: string;
    detail: string;
    color: string;
    quality: 'perfect' | 'good' | 'early' | 'late';
    dtTiming: number;
    hitField: readonly [number, number, number];
    battedParams: {
      position: readonly [number, number, number];
      velocity: readonly [number, number, number];
      seed?: number;
    };
    catchInfo: {
      caught: boolean;
      bobbled?: boolean;
      blocked?: boolean;
      fielderId: 'LF' | 'RF' | null;
      catchTimeSec: number | null;
      catchPos: readonly [number, number, number] | null;
    };
    outcome: 'FOUL' | 'OUT' | '1B' | '2B' | '3B' | 'HR';
    exitSpeedKmh: number;
    launchAngleDeg?: number;
    distanceM: number;
  } | null;
  outcome: string;
  callout: { title: string; subtitle: string; color: string; ttl: number };
  inningChanged: boolean;
  telemetry: string;
  platePos?: readonly [number, number];
  match: MatchState;
}

export type ServerMessage =
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number }
  | { type: 'welcome'; clientId: string; name: string; version: string | null; stats: OnlineStats }
  | { type: 'stats'; stats: OnlineStats }
  | { type: 'queued'; mode: OnlineMode }
  | { type: 'unqueued' }
  | { type: 'room_created'; code: string; mode: OnlineMode; token: string; side: OnlineSide }
  | { type: 'room_joined'; code: string; mode: OnlineMode; token: string; side: OnlineSide }
  | {
      type: 'match_start';
      code: string;
      mode: OnlineMode;
      side: OnlineSide;
      token: string;
      pitchSeq: number;
      turnState: TurnState;
      batterSide: 'R' | 'L';
      match: MatchState;
      names: { home: string; away: string };
    }
  | {
      type: 'state_sync';
      code: string;
      mode: OnlineMode;
      side: OnlineSide;
      pitchSeq: number;
      turnState: TurnState;
      batterSide: 'R' | 'L';
      match: MatchState;
      names: { home: string; away: string };
      activePitch: Omit<PitchLaunchMsg, 'type' | 'batterSide'> | null;
      rtt: number;
    }
  | PitchLaunchMsg
  | { type: 'batter_side'; side: 'R' | 'L' }
  | PitchResultMsg
  | { type: 'opponent_disconnected'; graceSec: number }
  | { type: 'opponent_reconnected' }
  | { type: 'match_over'; winner: OnlineSide; reason: string; match: MatchState }
  | { type: 'rematch_requested'; side: OnlineSide }
  | { type: 'room_list'; rooms: LiveRoomInfo[] }
  | {
      type: 'spectate_sync';
      code: string;
      mode: OnlineMode;
      awayName: string;
      homeName: string;
      match: MatchState;
      pitchSeq: number;
      turnState: TurnState;
      batterSide: 'R' | 'L';
      activePitch: Omit<PitchLaunchMsg, 'type' | 'batterSide'> | null;
      spectators: number;
    }
  | { type: 'unwatched' }
  | {
      type: 'abs_result';
      overturned: boolean;
      trueCall: 'strike' | 'ball';
      umpireCall: 'strike' | 'ball';
      marginCm: number;
      plateX: number;
      plateY: number;
      challengerSide: OnlineSide;
      match: MatchState;
      pitchSeq: number;
    }
  | { type: 'emote'; side: OnlineSide; id: string }
  | { type: 'pause_state'; pausedSides: OnlineSide[]; remainingSec: number }
  | { type: 'notice'; kind: string }
  | { type: 'error'; code: string; message: string; load?: ServerLoadStatus };

const SESSION_KEY = 'capbaseball_online_session';

export interface StoredSession {
  code: string;
  token: string;
}

export function getBasePath(): string {
  const p = window.location.pathname;
  if (p === '/capbaseball' || p.startsWith('/capbaseball/')) {
    return '/capbaseball';
  }
  return '';
}

export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${getBasePath()}/ws`;
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore storage errors
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed?.code && parsed?.token) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private listeners = new Set<(msg: ServerMessage) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private netListeners = new Set<(metrics: NetMetrics) => void>();
  private pingTimer: number | null = null;
  private pendingPingAt = 0;
  private missedPings = 0;
  private rttWindow: number[] = [];

  connected = false;
  rttMs = 0;
  avgRttMs = 0;
  jitterMs = 0;
  netQuality: NetQuality = 'offline';
  serverLoad: ServerLoadStatus = 'green';
  serverLagMs = 0;

  get isUnstable(): boolean {
    return !this.connected || this.netQuality === 'poor';
  }

  get isServerBusy(): boolean {
    return this.serverLoad === 'red';
  }

  getNetMetrics(): NetMetrics {
    return {
      connected: this.connected,
      rttMs: this.rttMs,
      avgRttMs: this.avgRttMs,
      jitterMs: this.jitterMs,
      quality: this.netQuality,
      serverLoad: this.serverLoad,
      serverLagMs: this.serverLagMs,
    };
  }

  onMessage(cb: (msg: ServerMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onNetUpdate(cb: (metrics: NetMetrics) => void): () => void {
    this.netListeners.add(cb);
    cb(this.getNetMetrics());
    return () => this.netListeners.delete(cb);
  }

  private emitNet(): void {
    const snap = this.getNetMetrics();
    for (const cb of this.netListeners) cb(snap);
  }

  private recomputeNetQuality(): void {
    if (!this.connected) {
      this.netQuality = 'offline';
      this.emitNet();
      return;
    }
    if (this.rttWindow.length > 0) {
      const sum = this.rttWindow.reduce((a, b) => a + b, 0);
      this.avgRttMs = Math.round(sum / this.rttWindow.length);
      const minR = Math.min(...this.rttWindow);
      const maxR = Math.max(...this.rttWindow);
      this.jitterMs = Math.round(maxR - minR);
    }
    if (this.missedPings >= 3 || this.avgRttMs > 650 || this.jitterMs > 350) {
      this.netQuality = 'poor';
    } else if (this.avgRttMs > 220 || this.jitterMs > 120) {
      this.netQuality = 'fair';
    } else {
      this.netQuality = 'good';
    }
    this.emitNet();
  }

  private recordRtt(ms: number): void {
    if (ms > 3000) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const clamped = Math.max(1, Math.min(9999, Math.round(ms)));
    this.rttMs = clamped;
    this.missedPings = 0;
    this.rttWindow.push(clamped);
    if (this.rttWindow.length > 5) this.rttWindow.shift();
    this.recomputeNetQuality();
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    const sendProbe = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.pendingPingAt > 0 && Date.now() - this.pendingPingAt >= 4500) {
        this.missedPings += 1;
        this.recomputeNetQuality();
      }
      const now = Date.now();
      this.pendingPingAt = now;
      this.sendRaw({ t: 'p', n: now });
    };
    sendProbe();
    this.pingTimer = window.setInterval(sendProbe, 4000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPingAt = 0;
  }

  private setConnected(val: boolean): void {
    if (this.connected === val) return;
    this.connected = val;
    if (!val) {
      this.stopPingLoop();
      this.rttWindow = [];
      this.missedPings = 0;
      this.netQuality = 'offline';
    }
    for (const cb of this.statusListeners) cb(val);
    this.emitNet();
  }

  connect(name?: string, timeoutMs = 6000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(getWsUrl());
      this.ws = ws;
      let settled = false;

      const connectTimer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          if (this.ws === ws) this.ws = null;
          try {
            ws.close();
          } catch {
            // ignore
          }
          reject(new Error('WebSocket connect timeout'));
        }
      }, timeoutMs);

      ws.addEventListener('open', () => {
        window.clearTimeout(connectTimer);
        if (this.ws !== ws) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          if (!settled) {
            settled = true;
            reject(new Error('WebSocket superseded'));
          }
          return;
        }
        settled = true;
        this.connectPromise = null;
        this.setConnected(true);
        // Negotiate ultra-compact v2 wire protocol
        this.sendRaw({ t: 'hi', n: name ?? '', v: 2 });
        this.startPingLoop();
        resolve();
      });

      ws.addEventListener('message', (ev) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const msg = decodeServerMsg(parsed) as ServerMessage;
        if (msg.type === 'ping') {
          this.sendRaw({ t: 'po', n: msg.t });
          return;
        }
        if (msg.type === 'pong') {
          const sentAt = typeof msg.t === 'number' ? msg.t : this.pendingPingAt;
          this.pendingPingAt = 0;
          if (sentAt > 0) this.recordRtt(Date.now() - sentAt);
          return;
        }
        if ((msg.type === 'welcome' || msg.type === 'stats') && msg.stats) {
          if (msg.stats.load) this.serverLoad = msg.stats.load;
          if (typeof msg.stats.lagMs === 'number') this.serverLagMs = msg.stats.lagMs;
          this.recomputeNetQuality();
        }
        if (msg.type === 'error' && msg.load) {
          this.serverLoad = msg.load;
          this.emitNet();
        }
        if (msg.type === 'state_sync' && typeof msg.rtt === 'number' && msg.rtt > 0) {
          this.recordRtt(msg.rtt);
        }
        for (const cb of this.listeners) cb(msg);
      });

      ws.addEventListener('close', () => {
        window.clearTimeout(connectTimer);
        if (!settled) {
          settled = true;
          if (this.ws === ws) this.connectPromise = null;
          reject(new Error('WebSocket closed before open'));
        }
        if (this.ws !== ws) return;
        this.ws = null;
        this.connectPromise = null;
        this.setConnected(false);
      });

      ws.addEventListener('error', () => {
        window.clearTimeout(connectTimer);
        if (!settled) {
          settled = true;
          if (this.ws === ws) this.connectPromise = null;
          reject(new Error('WebSocket connection error'));
        }
        if (this.ws !== ws) return;
      });
    });

    return this.connectPromise;
  }

  disconnect(): void {
    saveSession(null);
    this.stopPingLoop();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setConnected(false);
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  send(payload: Record<string, unknown>): void {
    this.sendRaw(payload);
  }

  queue(mode: OnlineMode, name: string): void {
    this.sendRaw({ t: 'q', m: mode === 'official6' ? 1 : 0, n: name });
  }

  unqueue(): void {
    this.sendRaw({ t: 'uq' });
  }

  createRoom(mode: OnlineMode, name: string, mercyRule = true): void {
    this.sendRaw({ t: 'cr', m: mode === 'official6' ? 1 : 0, n: name, mr: mercyRule ? 1 : 0 });
  }

  joinRoom(code: string, name: string): void {
    this.sendRaw({ t: 'jn', c: code.trim().toUpperCase(), n: name });
  }

  reconnect(code: string, token: string): void {
    this.sendRaw({ t: 'rc', c: code, k: token });
  }

  submitPitch(payload: {
    pitchSeq: number;
    pitchId: PitchId;
    speedKmh: number;
    targetX: number;
    targetY: number;
    errorX: number;
    errorY: number;
  }): void {
    this.sendRaw({
      t: 'ps',
      q: payload.pitchSeq,
      p: encodePitchId(payload.pitchId),
      v: round2(payload.speedKmh),
      x: round3(payload.targetX),
      y: round3(payload.targetY),
      ex: round3(payload.errorX),
      ey: round3(payload.errorY),
    });
  }

  setBatterSide(side: 'R' | 'L'): void {
    this.sendRaw({ t: 'bs', s: side === 'R' ? 1 : 0 });
  }

  sendIbb(pitchSeq: number): void {
    this.sendRaw({ t: 'ib', q: pitchSeq });
  }

  sendSwingInput(payload: {
    pitchSeq: number;
    flightTimeSec: number;
    batX: number;
    batY: number;
    swingMode: 'normal' | 'power';
    batterSide: 'R' | 'L';
  }): void {
    this.sendRaw({
      t: 'sw',
      q: payload.pitchSeq,
      ft: round3(payload.flightTimeSec),
      x: round3(payload.batX),
      y: round3(payload.batY),
      m: payload.swingMode === 'power' ? 1 : 0,
      s: payload.batterSide === 'R' ? 1 : 0,
    });
  }

  sendNoSwing(pitchSeq: number): void {
    this.sendRaw({ t: 'ns', q: pitchSeq });
  }

  resign(): void {
    this.sendRaw({ t: 'rs' });
  }

  rematch(): void {
    this.sendRaw({ t: 'rm' });
  }

  listRooms(): void {
    this.sendRaw({ t: 'ls' });
  }

  watchRoom(code: string): void {
    this.sendRaw({ t: 'wt', c: code.trim().toUpperCase() });
  }

  unwatchRoom(): void {
    this.sendRaw({ t: 'uw' });
  }

  sendAbsChallenge(pitchSeq: number): void {
    this.sendRaw({ t: 'ab', q: pitchSeq });
  }

  sendEmote(id: string): void {
    this.sendRaw({ t: 'em', e: id });
  }

  sendMenuPause(paused: boolean): void {
    this.sendRaw({ t: 'mp', p: paused ? 1 : 0 });
  }
}
