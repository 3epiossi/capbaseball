import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export type MonitorLoadStatus = 'green' | 'yellow' | 'red';

export interface AlertEntry {
  ts: string;
  level: 'warn' | 'crit';
  code: string;
  message: string;
}

export interface MetricsSample {
  ts: number;
  clients: number;
  rooms: number;
  queued: number;
  wsInPerSec: number;
  wsOutPerSec: number;
  wsOutKbPerSec: number;
  httpReqPerSec: number;
  httpOutKbPerSec: number;
  lagMs: number;
  rssMb: number;
  cpuPct: number;
  piTempC: number | null;
}

export interface PiSystemStats {
  platform: string;
  arch: string;
  cpus: number;
  load1m: number;
  load5m: number;
  load15m: number;
  memTotalMb: number;
  memAvailMb: number;
  cpuTempC: number | null;
  throttledHex: string | null;
  tcpEstab8788: number | null;
}

export interface RoomHealthSnapshot {
  startedRooms: number;
  waitingRooms: number;
  stalledRooms: number;
  disconnectedRooms: number;
  highInningRooms: number;
  extremeRunDiffRooms: number;
  zeroPitchOldRooms: number;
  oldestRoomAgeMin: number;
  avgMatchPitches: number;
  maxMatchRuns: number;
}

export interface ServerSnapshotInput {
  uptimeSec: number;
  version: string | null;
  draining: boolean;
  load: {
    status: MonitorLoadStatus;
    eventLoopLagMs: number;
    rssMb: number;
    rooms: number;
    maxRooms: number;
    clients: number;
    maxClients: number;
  };
  queuesTotal: number;
  inMatchClients: number;
  spectatingClients: number;
  friendRooms: number;
  matchmakingRooms: number;
  uniqueIps: number;
  maxConnsSingleIp: number;
  staticCacheFiles: number;
  staticCacheMb: number;
  roomsHealth?: RoomHealthSnapshot;
}

export class ServerMonitor {
  private readonly history: MetricsSample[] = [];
  private readonly maxHistory = 300; // 10 min at 2s resolution
  private readonly alerts: AlertEntry[] = [];
  private readonly maxAlerts = 40;
  private readonly metricsLogPath: string | null;

  // Cumulative counters
  httpRequestsTotal = 0;
  httpOutBytesTotal = 0;
  httpStatus2xx = 0;
  httpStatus3xx = 0;
  httpStatus4xx = 0;
  httpStatus5xx = 0;
  staticCacheHits = 0;
  static304Hits = 0;

  wsInMsgsTotal = 0;
  wsOutMsgsTotal = 0;
  wsInBytesTotal = 0;
  wsOutBytesTotal = 0;

  connAcceptedTotal = 0;
  connClosedTotal = 0;
  rejectedIpLimit = 0;
  rejectedRateLimit = 0;
  rejectedBusy = 0;
  terminatedDeadPong = 0;

  physicsSolvesTotal = 0;
  private physicsTotalMs = 0;
  physicsMaxMs = 0;

  // Match lifecycle & gameplay anomaly counters
  matchesStarted = 0;
  matchesCompleted = 0;
  matchesResigned = 0;
  matchesDisconnectTimeout = 0;
  waitingExpired = 0;
  rematchesStarted = 0;

  pitchClockViolations = 0;
  swingTimeouts = 0;
  staleOrOutOfTurnIgnored = 0;
  disconnectsInMatch = 0;
  reconnectsSucceeded = 0;
  reconnectsFailed = 0;

  absChallengesTotal = 0;
  absOverturned = 0;
  outOfRangeInputsClamped = 0;
  nanSanityErrors = 0;

  private lastSwingTimeouts = 0;
  private lastStaleIgnored = 0;
  private lastInputsClamped = 0;
  private lastNanErrors = 0;

  private readonly msgTypeCountsIn = new Map<string, number>();
  private readonly msgTypeCountsOut = new Map<string, number>();

  // Rate-window snapshots (deltas since last 2s tick)
  private lastTickAt = Date.now();
  private lastHttpReq = 0;
  private lastHttpOutBytes = 0;
  private lastWsInMsgs = 0;
  private lastWsOutMsgs = 0;
  private lastWsInBytes = 0;
  private lastWsOutBytes = 0;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuAt = process.hrtime.bigint();
  private latestCpuPct = 0;
  private latestRates = {
    httpReqPerSec: 0,
    httpOutKbPerSec: 0,
    wsInPerSec: 0,
    wsOutPerSec: 0,
    wsInKbPerSec: 0,
    wsOutKbPerSec: 0,
  };

  private piStats: PiSystemStats = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length || 1,
    load1m: 0,
    load5m: 0,
    load15m: 0,
    memTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
    memAvailMb: Math.round(os.freemem() / (1024 * 1024)),
    cpuTempC: null,
    throttledHex: null,
    tcpEstab8788: null,
  };

  private lastAlertAt = new Map<string, number>();
  private lastLoadStatus: MonitorLoadStatus = 'green';
  private sampleTimer: NodeJS.Timeout | null = null;
  private piTimer: NodeJS.Timeout | null = null;
  private persistCounter = 0;
  private getSnapshot: (() => ServerSnapshotInput) | null = null;

  constructor(metricsLogPath?: string) {
    this.metricsLogPath = metricsLogPath || null;
  }

  start(getSnapshot: () => ServerSnapshotInput, sampleMs = 2000): void {
    this.getSnapshot = getSnapshot;
    this.samplePiSystemAsync();
    this.piTimer = setInterval(() => this.samplePiSystemAsync(), 5000);
    this.sampleTimer = setInterval(() => this.tickSample(), sampleMs);
  }

  stop(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.piTimer) {
      clearInterval(this.piTimer);
      this.piTimer = null;
    }
  }

  recordHttp(statusCode: number, bytesOut: number): void {
    this.httpRequestsTotal += 1;
    this.httpOutBytesTotal += Math.max(0, bytesOut);
    if (statusCode >= 500) this.httpStatus5xx += 1;
    else if (statusCode >= 400) this.httpStatus4xx += 1;
    else if (statusCode >= 300) this.httpStatus3xx += 1;
    else this.httpStatus2xx += 1;
  }

  recordWsIn(type: string, byteLen: number): void {
    this.wsInMsgsTotal += 1;
    this.wsInBytesTotal += byteLen;
    this.msgTypeCountsIn.set(type, (this.msgTypeCountsIn.get(type) ?? 0) + 1);
  }

  recordWsOut(type: string, byteLen: number, recipientCount = 1): void {
    this.wsOutMsgsTotal += recipientCount;
    this.wsOutBytesTotal += byteLen * recipientCount;
    this.msgTypeCountsOut.set(type, (this.msgTypeCountsOut.get(type) ?? 0) + recipientCount);
  }

  recordPhysicsSolve(durationMs: number): void {
    this.physicsSolvesTotal += 1;
    this.physicsTotalMs += durationMs;
    if (durationMs > this.physicsMaxMs) this.physicsMaxMs = durationMs;
  }

  pushAlert(level: 'warn' | 'crit', code: string, message: string, cooldownMs = 30_000): void {
    const now = Date.now();
    const prev = this.lastAlertAt.get(code) ?? 0;
    if (now - prev < cooldownMs) return;
    this.lastAlertAt.set(code, now);
    this.alerts.unshift({
      ts: new Date(now).toISOString(),
      level,
      code,
      message,
    });
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.length = this.maxAlerts;
    }
  }

  private samplePiSystemAsync(): void {
    const [load1m, load5m, load15m] = os.loadavg();
    this.piStats.load1m = Number(load1m.toFixed(2));
    this.piStats.load5m = Number(load5m.toFixed(2));
    this.piStats.load15m = Number(load15m.toFixed(2));

    // Read Linux /proc/meminfo & thermal zone if available (non-blocking)
    fs.readFile('/proc/meminfo', 'utf8', (err, data) => {
      if (!err && data) {
        const mTot = /MemTotal:\s+(\d+)\s+kB/.exec(data);
        const mAvail = /MemAvailable:\s+(\d+)\s+kB/.exec(data);
        if (mTot) this.piStats.memTotalMb = Math.round(Number(mTot[1]) / 1024);
        if (mAvail) this.piStats.memAvailMb = Math.round(Number(mAvail[1]) / 1024);
      } else {
        this.piStats.memTotalMb = Math.round(os.totalmem() / (1024 * 1024));
        this.piStats.memAvailMb = Math.round(os.freemem() / (1024 * 1024));
      }
    });

    fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', (err, data) => {
      if (!err && data) {
        const milliC = Number(data.trim());
        if (Number.isFinite(milliC) && milliC > 0) {
          const tempC = Number((milliC > 1000 ? milliC / 1000 : milliC).toFixed(1));
          this.piStats.cpuTempC = tempC;
          if (tempC >= 78) {
            this.pushAlert('crit', 'TEMP_HIGH', `Pi CPU temperature reached ${tempC}°C`);
          }
        }
      }
    });

    if (os.platform() === 'linux') {
      execFile('vcgencmd', ['get_throttled'], { timeout: 800 }, (err, stdout) => {
        if (!err && stdout) {
          const m = /throttled=(0x[0-9a-fA-F]+)/.exec(stdout);
          if (m) {
            this.piStats.throttledHex = m[1];
            if (m[1] !== '0x0') {
              this.pushAlert('warn', 'PI_THROTTLED', `Raspberry Pi throttle/undervoltage flag: ${m[1]}`);
            }
          }
        }
      });
    }
  }

  private tickSample(): void {
    const now = Date.now();
    const dtSec = Math.max(0.2, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    // CPU % of 1 core (100% = 1 full vCPU core)
    const nowNs = process.hrtime.bigint();
    const elapsedUs = Math.max(1000, Number(nowNs - this.lastCpuAt) / 1000);
    const deltaCpu = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuAt = nowNs;
    this.latestCpuPct = Number((((deltaCpu.user + deltaCpu.system) / elapsedUs) * 100).toFixed(1));

    const dHttpReq = this.httpRequestsTotal - this.lastHttpReq;
    const dHttpBytes = this.httpOutBytesTotal - this.lastHttpOutBytes;
    const dWsIn = this.wsInMsgsTotal - this.lastWsInMsgs;
    const dWsOut = this.wsOutMsgsTotal - this.lastWsOutMsgs;
    const dWsInBytes = this.wsInBytesTotal - this.lastWsInBytes;
    const dWsOutBytes = this.wsOutBytesTotal - this.lastWsOutBytes;

    this.lastHttpReq = this.httpRequestsTotal;
    this.lastHttpOutBytes = this.httpOutBytesTotal;
    this.lastWsInMsgs = this.wsInMsgsTotal;
    this.lastWsOutMsgs = this.wsOutMsgsTotal;
    this.lastWsInBytes = this.wsInBytesTotal;
    this.lastWsOutBytes = this.wsOutBytesTotal;

    this.latestRates = {
      httpReqPerSec: Number((dHttpReq / dtSec).toFixed(1)),
      httpOutKbPerSec: Number((dHttpBytes / 1024 / dtSec).toFixed(2)),
      wsInPerSec: Number((dWsIn / dtSec).toFixed(1)),
      wsOutPerSec: Number((dWsOut / dtSec).toFixed(1)),
      wsInKbPerSec: Number((dWsInBytes / 1024 / dtSec).toFixed(2)),
      wsOutKbPerSec: Number((dWsOutBytes / 1024 / dtSec).toFixed(2)),
    };

    const snap = this.getSnapshot?.();
    if (!snap) return;

    // Anomaly checks
    if (snap.load.status !== this.lastLoadStatus) {
      if (snap.load.status === 'red') {
        this.pushAlert(
          'crit',
          'LOAD_RED',
          `Load RED: clients=${snap.load.clients}/${snap.load.maxClients}, rooms=${snap.load.rooms}/${snap.load.maxRooms}, lag=${snap.load.eventLoopLagMs}ms, rss=${snap.load.rssMb}MB`,
          5000,
        );
      } else if (snap.load.status === 'yellow') {
        this.pushAlert(
          'warn',
          'LOAD_YELLOW',
          `Load YELLOW: clients=${snap.load.clients}/${snap.load.maxClients}, rooms=${snap.load.rooms}/${snap.load.maxRooms}, lag=${snap.load.eventLoopLagMs}ms, rss=${snap.load.rssMb}MB`,
          5000,
        );
      }
      this.lastLoadStatus = snap.load.status;
    }
    if (snap.load.eventLoopLagMs >= 75) {
      this.pushAlert('warn', 'LAG_SPIKE', `Event loop p95 lag spiked to ${snap.load.eventLoopLagMs}ms`);
    }

    // Gameplay & match-state anomaly alerts
    const rh = snap.roomsHealth;
    if (rh) {
      if (rh.stalledRooms > 0) {
        this.pushAlert(
          'warn',
          'ROOM_STALLED',
          `${rh.stalledRooms} active room(s) stalled >45s with both players connected`,
        );
      }
      if (rh.highInningRooms > 0) {
        this.pushAlert('warn', 'HIGH_INNING', `${rh.highInningRooms} room(s) reached inning 8+`);
      }
      if (rh.extremeRunDiffRooms > 0) {
        this.pushAlert('warn', 'EXTREME_SCORE', `${rh.extremeRunDiffRooms} room(s) have run differential >= 15`);
      }
    }
    if (this.nanSanityErrors > this.lastNanErrors) {
      this.pushAlert(
        'crit',
        'PHYSICS_NAN',
        `Physics solver produced non-finite value (total=${this.nanSanityErrors})`,
        10_000,
      );
    }
    this.lastNanErrors = this.nanSanityErrors;

    if (this.swingTimeouts - this.lastSwingTimeouts >= 5) {
      this.pushAlert(
        'warn',
        'SWING_TIMEOUT_SPIKE',
        `+${this.swingTimeouts - this.lastSwingTimeouts} swing timeouts in 2s (total=${this.swingTimeouts})`,
      );
    }
    this.lastSwingTimeouts = this.swingTimeouts;

    if (this.staleOrOutOfTurnIgnored - this.lastStaleIgnored >= 15) {
      this.pushAlert(
        'warn',
        'DESYNC_SPIKE',
        `+${this.staleOrOutOfTurnIgnored - this.lastStaleIgnored} stale/out-of-turn packets ignored in 2s`,
      );
    }
    this.lastStaleIgnored = this.staleOrOutOfTurnIgnored;

    if (this.outOfRangeInputsClamped - this.lastInputsClamped >= 3) {
      this.pushAlert(
        'warn',
        'INPUT_OUT_OF_RANGE',
        `+${this.outOfRangeInputsClamped - this.lastInputsClamped} out-of-range pitch/swing inputs clamped`,
      );
    }
    this.lastInputsClamped = this.outOfRangeInputsClamped;

    const sample: MetricsSample = {
      ts: now,
      clients: snap.load.clients,
      rooms: snap.load.rooms,
      queued: snap.queuesTotal,
      wsInPerSec: this.latestRates.wsInPerSec,
      wsOutPerSec: this.latestRates.wsOutPerSec,
      wsOutKbPerSec: this.latestRates.wsOutKbPerSec,
      httpReqPerSec: this.latestRates.httpReqPerSec,
      httpOutKbPerSec: this.latestRates.httpOutKbPerSec,
      lagMs: snap.load.eventLoopLagMs,
      rssMb: snap.load.rssMb,
      cpuPct: this.latestCpuPct,
      piTempC: this.piStats.cpuTempC,
    };

    this.history.push(sample);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Persist compact 60s summary snapshot to disk if configured
    this.persistCounter += 1;
    if (this.metricsLogPath && this.persistCounter >= 30) {
      this.persistCounter = 0;
      const line = JSON.stringify({
        ts: new Date(now).toISOString(),
        clients: sample.clients,
        rooms: sample.rooms,
        queued: sample.queued,
        wsInPerSec: sample.wsInPerSec,
        wsOutPerSec: sample.wsOutPerSec,
        wsOutKbPerSec: sample.wsOutKbPerSec,
        lagMs: sample.lagMs,
        rssMb: sample.rssMb,
        cpuPct: sample.cpuPct,
        tempC: sample.piTempC,
        rejectedBusy: this.rejectedBusy,
        rejectedIp: this.rejectedIpLimit,
      });
      fs.mkdir(path.dirname(this.metricsLogPath), { recursive: true }, () => {
        fs.appendFile(this.metricsLogPath!, line + '\n', () => {});
      });
    }
  }

  buildReport(snap: ServerSnapshotInput) {
    const mem = process.memoryUsage();
    const topTypes = (m: Map<string, number>) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([type, count]) => ({ type, count }));

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      version: snap.version,
      uptimeSec: snap.uptimeSec,
      draining: snap.draining,
      load: snap.load,
      rates: this.latestRates,
      connections: {
        activeClients: snap.load.clients,
        inMatch: snap.inMatchClients,
        queuing: snap.queuesTotal,
        spectating: snap.spectatingClients,
        lobbyIdle: Math.max(0, snap.load.clients - snap.inMatchClients - snap.queuesTotal - snap.spectatingClients),
        roomsActive: snap.load.rooms,
        friendRooms: snap.friendRooms,
        matchmakingRooms: snap.matchmakingRooms,
        uniqueIps: snap.uniqueIps,
        maxConnsSingleIp: snap.maxConnsSingleIp,
        acceptedTotal: this.connAcceptedTotal,
        closedTotal: this.connClosedTotal,
      },
      rejections: {
        ipLimit: this.rejectedIpLimit,
        rateLimit: this.rejectedRateLimit,
        serverBusy: this.rejectedBusy,
        deadPongTimeout: this.terminatedDeadPong,
      },
      traffic: {
        httpRequestsTotal: this.httpRequestsTotal,
        httpOutMbTotal: Number((this.httpOutBytesTotal / (1024 * 1024)).toFixed(2)),
        httpStatuses: {
          '2xx': this.httpStatus2xx,
          '3xx': this.httpStatus3xx,
          '4xx': this.httpStatus4xx,
          '5xx': this.httpStatus5xx,
        },
        staticCache: {
          files: snap.staticCacheFiles,
          sizeMb: snap.staticCacheMb,
          hits: this.staticCacheHits,
          notModified304: this.static304Hits,
        },
        wsInMsgsTotal: this.wsInMsgsTotal,
        wsOutMsgsTotal: this.wsOutMsgsTotal,
        wsInMbTotal: Number((this.wsInBytesTotal / (1024 * 1024)).toFixed(2)),
        wsOutMbTotal: Number((this.wsOutBytesTotal / (1024 * 1024)).toFixed(2)),
        topInTypes: topTypes(this.msgTypeCountsIn),
        topOutTypes: topTypes(this.msgTypeCountsOut),
      },
      runtime: {
        nodeVersion: process.version,
        cpuPct: this.latestCpuPct,
        eventLoopLagMs: snap.load.eventLoopLagMs,
        rssMb: snap.load.rssMb,
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
        externalMb: Math.round(mem.external / (1024 * 1024)),
        physicsSolvesTotal: this.physicsSolvesTotal,
        physicsAvgMs:
          this.physicsSolvesTotal > 0
            ? Number((this.physicsTotalMs / this.physicsSolvesTotal).toFixed(2))
            : 0,
        physicsMaxMs: Number(this.physicsMaxMs.toFixed(2)),
      },
      pi: this.piStats,
      gameplay: {
        matchesStarted: this.matchesStarted,
        matchesCompleted: this.matchesCompleted,
        matchesResigned: this.matchesResigned,
        matchesDisconnectTimeout: this.matchesDisconnectTimeout,
        waitingExpired: this.waitingExpired,
        rematchesStarted: this.rematchesStarted,
        pitchClockViolations: this.pitchClockViolations,
        swingTimeouts: this.swingTimeouts,
        staleOrOutOfTurnIgnored: this.staleOrOutOfTurnIgnored,
        disconnectsInMatch: this.disconnectsInMatch,
        reconnectsSucceeded: this.reconnectsSucceeded,
        reconnectsFailed: this.reconnectsFailed,
        absChallengesTotal: this.absChallengesTotal,
        absOverturned: this.absOverturned,
        outOfRangeInputsClamped: this.outOfRangeInputsClamped,
        nanSanityErrors: this.nanSanityErrors,
        roomsHealth: snap.roomsHealth ?? {
          startedRooms: 0,
          waitingRooms: 0,
          stalledRooms: 0,
          disconnectedRooms: 0,
          highInningRooms: 0,
          extremeRunDiffRooms: 0,
          zeroPitchOldRooms: 0,
          oldestRoomAgeMin: 0,
          avgMatchPitches: 0,
          maxMatchRuns: 0,
        },
      },
      alerts: this.alerts,
      history: this.history,
    };
  }
}
