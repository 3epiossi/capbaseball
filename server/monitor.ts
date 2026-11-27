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

export interface StorageHealthStats {
  status: MonitorLoadStatus;
  device: string;
  fsType: string;
  readOnly: boolean;
  totalGb: number;
  availGb: number;
  usedPct: number;
  writtenGbBoot: number | null;
  writeKbPerSec: number;
  avgWriteAwaitMs: number;
  ioBusyPct: number;
  fsErrorsCount: number;
  hwLifeInfo: string | null;
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
  storage?: StorageHealthStats;
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
    publicClientCap?: number;
    friendReserveActive?: boolean;
  };
  queuesTotal: number;
  queuesByMode: Record<'quick3' | 'tiebreak' | 'official6', number>;
  roomsByMode: Record<'quick3' | 'tiebreak' | 'official6', number>;
  inMatchClients: number;
  spectatingClients: number;
  friendRooms: number;
  matchmakingRooms: number;
  uniqueIps: number;
  maxConnsSingleIp: number;
  staticCacheFiles: number;
  staticCacheMb: number;
  physicsWorkerMode?: string;
  physicsWorkerCount?: number;
  roomsHealth?: RoomHealthSnapshot;
  activities?: Record<string, number>;
  standbyCount?: number;
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
  idleClosedTotal = 0;

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

  private storageStats: StorageHealthStats = {
    status: 'green',
    device: '--',
    fsType: '--',
    readOnly: false,
    totalGb: 0,
    availGb: 0,
    usedPct: 0,
    writtenGbBoot: null,
    writeKbPerSec: 0,
    avgWriteAwaitMs: 0,
    ioBusyPct: 0,
    fsErrorsCount: 0,
    hwLifeInfo: null,
  };

  private lastDiskSampleAt = 0;
  private lastDiskSectorsWritten = -1;
  private lastDiskWritesCompleted = -1;
  private lastDiskWriteMs = -1;
  private lastDiskIoMs = -1;

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
  private throttleTimer: NodeJS.Timeout | null = null;
  private storageTimer: NodeJS.Timeout | null = null;
  private persistCounter = 0;
  private getSnapshot: (() => ServerSnapshotInput) | null = null;

  constructor(metricsLogPath?: string) {
    this.metricsLogPath = metricsLogPath || null;
  }

  start(getSnapshot: () => ServerSnapshotInput, sampleMs = 2000): void {
    this.getSnapshot = getSnapshot;
    this.samplePiSystemAsync();
    this.sampleThrottleAsync();
    this.sampleStorageHealthAsync();
    this.piTimer = setInterval(() => this.samplePiSystemAsync(), 10_000);
    this.throttleTimer = setInterval(() => this.sampleThrottleAsync(), 60_000);
    // Storage health reads only kernel RAM virtual files (statfs / procfs / sysfs) every 30s -> ZERO SD card wear!
    this.storageTimer = setInterval(() => this.sampleStorageHealthAsync(), 30_000);
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
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.storageTimer) {
      clearInterval(this.storageTimer);
      this.storageTimer = null;
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
            this.pushAlert('crit', 'TEMP_HIGH', `伺服器 CPU 溫度達 ${tempC}°C`);
          }
        }
      }
    });
  }

  private sampleThrottleAsync(): void {
    if (os.platform() === 'linux') {
      execFile('vcgencmd', ['get_throttled'], { timeout: 800 }, (err, stdout) => {
        if (!err && stdout) {
          const m = /throttled=(0x[0-9a-fA-F]+)/.exec(stdout);
          if (m) {
            this.piStats.throttledHex = m[1];
            if (m[1] !== '0x0') {
              this.pushAlert('warn', 'SERVER_THROTTLED', `伺服器降頻或電壓不足旗標：${m[1]}`);
            }
          }
        }
      });
    }
  }

  /**
   * Zero-wear storage health check: reads only in-memory kernel structures (VFS statfs, /proc/mounts,
   * /proc/diskstats, /sys/fs/ext4, /sys/block). Performs zero physical disk reads or writes.
   */
  private sampleStorageHealthAsync(): void {
    if (typeof fs.statfs === 'function') {
      fs.statfs(process.cwd(), (err, st) => {
        if (!err && st) {
          const totalBytes = st.blocks * st.bsize;
          const availBytes = st.bavail * st.bsize;
          this.storageStats.totalGb = Number((totalBytes / 1073741824).toFixed(2));
          this.storageStats.availGb = Number((availBytes / 1073741824).toFixed(2));
          this.storageStats.usedPct =
            totalBytes > 0 ? Number((((totalBytes - availBytes) / totalBytes) * 100).toFixed(1)) : 0;
          this.recomputeStorageStatus();
        }
      });
    }

    if (os.platform() !== 'linux') {
      this.storageStats.device = os.platform();
      this.storageStats.fsType = 'local';
      this.recomputeStorageStatus();
      return;
    }

    fs.readFile('/proc/mounts', 'utf8', (err, data) => {
      if (err || !data) return;
      let bestMountLen = -1;
      let rootDev = '';
      let rootFs = '';
      let rootOpts = '';
      const cwd = process.cwd();
      for (const line of data.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const [dev, mnt, fstype, opts] = parts;
        if (!dev.startsWith('/dev/')) continue;
        if (cwd.startsWith(mnt) && mnt.length > bestMountLen) {
          bestMountLen = mnt.length;
          rootDev = dev.replace('/dev/', '');
          rootFs = fstype;
          rootOpts = opts;
        }
      }
      if (rootDev) {
        this.storageStats.device = rootDev;
        this.storageStats.fsType = rootFs;
        this.storageStats.readOnly = /(^|,)ro(,|$)/.test(rootOpts);

        // Read EXT4 kernel superblock error counter from sysfs (in-RAM)
        fs.readFile(`/sys/fs/ext4/${rootDev}/errors_count`, 'utf8', (e2, errTxt) => {
          if (!e2 && errTxt) {
            const n = Number(errTxt.trim());
            if (Number.isFinite(n)) this.storageStats.fsErrorsCount = n;
          }
          this.recomputeStorageStatus();
        });

        // Base block device (e.g. mmcblk0p2 -> mmcblk0, nvme0n1p2 -> nvme0n1, sda1 -> sda)
        const baseDev = rootDev.replace(/p?\d+$/, '');
        fs.readFile(`/sys/block/${baseDev}/device/life_time`, 'utf8', (e3, lifeTxt) => {
          if (!e3 && lifeTxt) {
            this.storageStats.hwLifeInfo = lifeTxt.trim();
          }
        });
      }
    });

    fs.readFile('/proc/diskstats', 'utf8', (err, data) => {
      if (err || !data) return;
      const now = Date.now();
      for (const line of data.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 14) continue;
        const devName = parts[2];
        if (devName !== 'mmcblk0' && devName !== 'nvme0n1' && devName !== 'sda' && devName !== 'vda') {
          continue;
        }
        const writesCompleted = Number(parts[7]);
        const sectorsWritten = Number(parts[9]);
        const writeMs = Number(parts[10]);
        const ioMs = Number(parts[12]);
        if (!Number.isFinite(sectorsWritten)) break;

        this.storageStats.writtenGbBoot = Number(((sectorsWritten * 512) / 1073741824).toFixed(2));
        if (this.lastDiskSampleAt > 0 && this.lastDiskSectorsWritten >= 0) {
          const dtSec = Math.max(1, (now - this.lastDiskSampleAt) / 1000);
          const dSectors = Math.max(0, sectorsWritten - this.lastDiskSectorsWritten);
          const dWrites = Math.max(0, writesCompleted - this.lastDiskWritesCompleted);
          const dWriteMs = Math.max(0, writeMs - this.lastDiskWriteMs);
          const dIoMs = Math.max(0, ioMs - this.lastDiskIoMs);

          this.storageStats.writeKbPerSec = Number(((dSectors * 0.5) / dtSec).toFixed(1));
          this.storageStats.avgWriteAwaitMs = dWrites > 0 ? Number((dWriteMs / dWrites).toFixed(2)) : 0;
          this.storageStats.ioBusyPct = Number(Math.min(100, (dIoMs / (dtSec * 1000)) * 100).toFixed(1));
        }
        this.lastDiskSampleAt = now;
        this.lastDiskSectorsWritten = sectorsWritten;
        this.lastDiskWritesCompleted = writesCompleted;
        this.lastDiskWriteMs = writeMs;
        this.lastDiskIoMs = ioMs;
        break;
      }
      this.recomputeStorageStatus();
    });
  }

  private recomputeStorageStatus(): void {
    const s = this.storageStats;
    if (s.readOnly || s.fsErrorsCount > 0 || s.usedPct >= 92 || s.avgWriteAwaitMs >= 150) {
      s.status = 'red';
      if (s.readOnly) {
        this.pushAlert('crit', 'STORAGE_RO', '伺服器儲存空間已被降級為唯讀模式（RO），請立即檢查儲存裝置！');
      }
      if (s.fsErrorsCount > 0) {
        this.pushAlert('crit', 'STORAGE_FS_ERR', `伺服器檔案系統偵測到 ${s.fsErrorsCount} 次 I/O 錯誤！`);
      }
      if (s.usedPct >= 92) {
        this.pushAlert('crit', 'STORAGE_FULL', `伺服器儲存空間使用率達 ${s.usedPct}%（剩餘 ${s.availGb} GB）`);
      }
    } else if (s.usedPct >= 82 || s.avgWriteAwaitMs >= 50) {
      s.status = 'yellow';
      if (s.avgWriteAwaitMs >= 50) {
        this.pushAlert('warn', 'STORAGE_SLOW', `伺服器磁碟寫入平均延遲偏高（${s.avgWriteAwaitMs} ms）`);
      }
    } else {
      s.status = 'green';
    }
    this.piStats.storage = { ...s };
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
          `負載紅燈：連線=${snap.load.clients}/${snap.load.maxClients}，房間=${snap.load.rooms}/${snap.load.maxRooms}，延遲=${snap.load.eventLoopLagMs}ms，記憶體=${snap.load.rssMb}MB`,
          5000,
        );
      } else if (snap.load.status === 'yellow') {
        this.pushAlert(
          'warn',
          'LOAD_YELLOW',
          `負載黃燈：連線=${snap.load.clients}/${snap.load.maxClients}，房間=${snap.load.rooms}/${snap.load.maxRooms}，延遲=${snap.load.eventLoopLagMs}ms，記憶體=${snap.load.rssMb}MB`,
          5000,
        );
      }
      this.lastLoadStatus = snap.load.status;
    }
    if (snap.load.eventLoopLagMs >= 75) {
      this.pushAlert('warn', 'LAG_SPIKE', `事件迴圈 p95 延遲升高至 ${snap.load.eventLoopLagMs}ms`);
    }

    // Gameplay & match-state anomaly alerts
    const rh = snap.roomsHealth;
    if (rh) {
      if (rh.stalledRooms > 0) {
        this.pushAlert(
          'warn',
          'ROOM_STALLED',
          `${rh.stalledRooms} 間對戰房雙方在線但停滯超過 45 秒`,
        );
      }
      if (rh.highInningRooms > 0) {
        this.pushAlert('warn', 'HIGH_INNING', `${rh.highInningRooms} 間對戰房進入第 8 局以上延長賽`);
      }
      if (rh.extremeRunDiffRooms > 0) {
        this.pushAlert('warn', 'EXTREME_SCORE', `${rh.extremeRunDiffRooms} 間對戰房分差達 15 分以上`);
      }
    }
    if (this.nanSanityErrors > this.lastNanErrors) {
      this.pushAlert(
        'crit',
        'PHYSICS_NAN',
        `物理引擎出現非有限數值 NaN（累計=${this.nanSanityErrors}）`,
        10_000,
      );
    }
    this.lastNanErrors = this.nanSanityErrors;

    if (this.swingTimeouts - this.lastSwingTimeouts >= 5) {
      this.pushAlert(
        'warn',
        'SWING_TIMEOUT_SPIKE',
        `2 秒內新增 ${this.swingTimeouts - this.lastSwingTimeouts} 次揮棒逾時（累計=${this.swingTimeouts}）`,
      );
    }
    this.lastSwingTimeouts = this.swingTimeouts;

    if (this.staleOrOutOfTurnIgnored - this.lastStaleIgnored >= 15) {
      this.pushAlert(
        'warn',
        'DESYNC_SPIKE',
        `2 秒內忽略 ${this.staleOrOutOfTurnIgnored - this.lastStaleIgnored} 筆過期或非當回合封包`,
      );
    }
    this.lastStaleIgnored = this.staleOrOutOfTurnIgnored;

    if (this.outOfRangeInputsClamped - this.lastInputsClamped >= 3) {
      this.pushAlert(
        'warn',
        'INPUT_OUT_OF_RANGE',
        `攔截並修正 ${this.outOfRangeInputsClamped - this.lastInputsClamped} 筆超界投打參數`,
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
        queuesByMode: snap.queuesByMode,
        roomsByMode: snap.roomsByMode,
        spectating: snap.spectatingClients,
        lobbyIdle: Math.max(0, snap.load.clients - snap.inMatchClients - snap.queuesTotal - snap.spectatingClients),
        roomsActive: snap.load.rooms,
        friendRooms: snap.friendRooms,
        matchmakingRooms: snap.matchmakingRooms,
        uniqueIps: snap.uniqueIps,
        maxConnsSingleIp: snap.maxConnsSingleIp,
        acceptedTotal: this.connAcceptedTotal,
        closedTotal: this.connClosedTotal,
        activities: snap.activities ?? {},
        standbyCount: snap.standbyCount ?? 0,
      },
      rejections: {
        ipLimit: this.rejectedIpLimit,
        rateLimit: this.rejectedRateLimit,
        serverBusy: this.rejectedBusy,
        deadPongTimeout: this.terminatedDeadPong,
        idleClosed: this.idleClosedTotal,
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
        physicsWorkerMode: snap.physicsWorkerMode ?? 'inline',
        physicsWorkerCount: snap.physicsWorkerCount ?? 0,
      },
      pi: {
        ...this.piStats,
        storage: { ...this.storageStats },
      },
      storage: { ...this.storageStats },
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
