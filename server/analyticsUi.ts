import fs from 'node:fs';

export const MAX_RETAINED_MATCHES = 5000;
export const MAX_RETAINED_PITCHES = 25000;
export const MAX_RETAINED_SESSIONS = 5000;
export const ANALYTICS_WINDOW_MATCHES = 100;
export const ANALYTICS_WINDOW_PITCHES = 2000;
export const ANALYTICS_WINDOW_SESSIONS = 1000;

export const MATCH_LOG_MAX_BYTES = 2_500_000;
export const PITCH_LOG_MAX_BYTES = 10_000_000;
export const SESSION_LOG_MAX_BYTES = 1_500_000;

const trimWriteCounters = new Map<string, number>();

/**
 * Rolling disk retention cap: keeps up to `maxLines` in a JSONL file when its size exceeds
 * `byteThreshold`, bounding Raspberry Pi SD card usage forever.
 */
export async function trimJsonlFileIfNeeded(
  logPath: string,
  maxLines: number,
  byteThreshold: number,
): Promise<void> {
  try {
    const st = await fs.promises.stat(logPath);
    if (st.size <= byteThreshold) return;
    const raw = await fs.promises.readFile(logPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) return;
    const kept = lines.slice(-maxLines).join('\n') + '\n';
    await fs.promises.writeFile(logPath, kept, 'utf8');
  } catch {
    // ignore missing file or transient IO errors
  }
}

/**
 * Throttled trim helper: only stats/trims every `checkEveryNWrites` appends to minimize SD card I/O.
 */
export async function maybeTrimJsonlFile(
  logPath: string,
  maxLines: number,
  byteThreshold: number,
  checkEveryNWrites = 40,
): Promise<void> {
  const next = (trimWriteCounters.get(logPath) ?? 0) + 1;
  if (next < checkEveryNWrites) {
    trimWriteCounters.set(logPath, next);
    return;
  }
  trimWriteCounters.set(logPath, 0);
  await trimJsonlFileIfNeeded(logPath, maxLines, byteThreshold);
}

/**
 * Fast tail-chunk JSONL reader: reads at most the last `tailBytes` of `logPath` and parses
 * the last `maxLines` JSON objects without scanning the entire historical file from byte 0.
 */
export function readJsonlTail<T = Record<string, unknown>>(
  logPath: string,
  maxLines: number,
  tailBytes: number,
): { rows: T[]; fileBytes: number } {
  try {
    if (!fs.existsSync(logPath)) return { rows: [], fileBytes: 0 };
    const st = fs.statSync(logPath);
    if (st.size === 0) return { rows: [], fileBytes: 0 };
    const readLen = Math.min(st.size, tailBytes);
    const startOffset = st.size - readLen;
    const buf = Buffer.alloc(readLen);
    const fd = fs.openSync(logPath, 'r');
    try {
      fs.readSync(fd, buf, 0, readLen, startOffset);
    } finally {
      fs.closeSync(fd);
    }
    let text = buf.toString('utf8');
    if (startOffset > 0) {
      const firstNl = text.indexOf('\n');
      text = firstNl >= 0 ? text.slice(firstNl + 1) : '';
    }
    const rawLines = text.split('\n');
    const rows: T[] = [];
    for (let i = rawLines.length - 1; i >= 0 && rows.length < maxLines; i--) {
      const line = rawLines[i].trim();
      if (!line) continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // skip malformed line
      }
    }
    rows.reverse();
    return { rows, fileBytes: st.size };
  } catch {
    return { rows: [], fileBytes: 0 };
  }
}

interface MatchRecord {
  ts?: string;
  matchId?: string;
  code?: string;
  status?: 'live' | 'ended';
  roomKind?: 'live' | 'friend';
  mode?: string;
  durationSec?: number;
  reason?: string;
  endReason?: string;
  winner?: 'away' | 'home' | null;
  innings?: number;
  inningsPlayed?: number;
  half?: 'top' | 'bottom';
  outs?: number;
  awayName?: string;
  homeName?: string;
  awayDevice?: 'mobile' | 'tablet' | 'desktop' | null;
  homeDevice?: 'mobile' | 'tablet' | 'desktop' | null;
  awayInput?: 'touch' | 'mouse' | null;
  homeInput?: 'touch' | 'mouse' | null;
  awayRuns?: number;
  homeRuns?: number;
  awayScore?: number;
  homeScore?: number;
  awayHits?: number;
  homeHits?: number;
  awayWalks?: number;
  homeWalks?: number;
  awayStrikeouts?: number;
  homeStrikeouts?: number;
  awayPitches?: number;
  homePitches?: number;
  pitches?: number;
  totalPitches?: number;
  absUsedAway?: number;
  absUsedHome?: number;
  spectatorsPeak?: number;
}

interface PitchRecord {
  ts?: string;
  matchId?: string;
  code?: string;
  roomKind?: 'live' | 'friend';
  event?: 'pitch' | 'ibb' | 'pitch_clock' | 'abs_challenge';
  pitchId?: 'straight' | 'cutter' | 'fork' | 'changeup' | 'knuckle' | 'shuuto';
  speedKmh?: number;
  breakCm?: number;
  plateX?: number;
  plateY?: number;
  batterHand?: 'L' | 'R';
  springZone?: 'SOFT' | 'BEST' | 'OVER' | null;
  pitcherDevice?: 'mobile' | 'tablet' | 'desktop' | null;
  batterDevice?: 'mobile' | 'tablet' | 'desktop' | null;
  pitcherInput?: 'touch' | 'mouse' | null;
  batterInput?: 'touch' | 'mouse' | null;
  trueCall?: 'strike' | 'ball';
  umpireCall?: 'strike' | 'ball';
  swung?: boolean;
  powerSwing?: boolean;
  dtTiming?: number | null;
  contact?: boolean;
  exitSpeedKmh?: number | null;
  launchAngleDeg?: number | null;
  distanceM?: number | null;
  outcome?: string;
  catchKind?: 'caught' | 'wild_pitch' | 'passed_ball' | null;
  droppedThirdStrike?: boolean;
  isFoulFlyOut?: boolean;
  caughtBy?: 'LF' | 'RF' | 'P' | 'C' | null;
  bobbledBy?: 'LF' | 'RF' | 'P' | 'C' | null;
  blockedBy?: 'LF' | 'RF' | 'P' | 'C' | null;
  overturned?: boolean;
}

interface SessionRecord {
  ts?: string;
  device?: 'mobile' | 'tablet' | 'desktop';
  os?: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other';
  browser?: 'line' | 'ig' | 'fb' | 'safari' | 'chrome' | 'edge' | 'firefox' | 'other';
  input?: 'touch' | 'mouse';
  orient?: 'landscape' | 'portrait';
  pwa?: boolean;
  locale?: 'zh-TW' | 'en' | 'ja';
}

const ALL_PITCH_IDS = ['straight', 'cutter', 'fork', 'changeup', 'knuckle', 'shuuto'] as const;

// Strike zone bounds matching src/rules/field.ts: PLATE_WIDTH = 0.43, STRIKE_ZONE_LO = 0.42, STRIKE_ZONE_HI = 1.02
const ZONE_HALF_W = 0.215;
const ZONE_LO = 0.42;
const ZONE_HI = 1.02;

function classifyZoneCell(plateX: number, plateY: number): number {
  if (
    !Number.isFinite(plateX) ||
    !Number.isFinite(plateY) ||
    plateX < -ZONE_HALF_W ||
    plateX > ZONE_HALF_W ||
    plateY < ZONE_LO ||
    plateY > ZONE_HI
  ) {
    return -1; // outside strike zone
  }
  const col = Math.min(2, Math.max(0, Math.floor(((plateX + ZONE_HALF_W) / (ZONE_HALF_W * 2)) * 3)));
  // row 0 = high, row 1 = mid, row 2 = low
  const rowFromBottom = Math.min(2, Math.max(0, Math.floor(((plateY - ZONE_LO) / (ZONE_HI - ZONE_LO)) * 3)));
  const row = 2 - rowFromBottom;
  return row * 3 + col;
}

function classifyTimingBucket(dt: number): 'very_early' | 'early' | 'perfect' | 'late' | 'very_late' {
  if (dt < -0.06) return 'very_early';
  if (dt < -0.025) return 'early';
  if (dt <= 0.025) return 'perfect';
  if (dt <= 0.06) return 'late';
  return 'very_late';
}

export function buildAnalyticsReport(
  matchLogPath: string,
  pitchLogPath: string,
  liveGameplay?: Record<string, unknown>,
  inProgressMatches: MatchRecord[] = [],
  sessionLogPath?: string,
) {
  const matchTail = readJsonlTail<MatchRecord>(matchLogPath, ANALYTICS_WINDOW_MATCHES, 192 * 1024);
  const pitchTail = readJsonlTail<PitchRecord>(pitchLogPath, ANALYTICS_WINDOW_PITCHES, 1536 * 1024);
  const sessionTail = sessionLogPath
    ? readJsonlTail<SessionRecord>(sessionLogPath, ANALYTICS_WINDOW_SESSIONS, 256 * 1024)
    : { rows: [], fileBytes: 0 };

  const matches = matchTail.rows;
  const events = pitchTail.rows;
  const sessions = sessionTail.rows;

  let liveMatches = 0;
  let friendMatches = 0;
  let awayWins = 0;
  let homeWins = 0;
  let totalDurationSec = 0;
  let totalRuns = 0;
  let totalHits = 0;
  let totalWalks = 0;
  let totalStrikeouts = 0;
  let totalMatchPitches = 0;
  let maxMatchRuns = 0;
  let highInningMatches = 0;
  let extremeRunDiffMatches = 0;
  const reasons: Record<string, number> = {};

  // Cross-platform match win tracking (touch vs mouse)
  const cpPlatform = {
    touch: {
      matches: 0,
      wins: 0,
      pitchesThrown: 0,
      springRecorded: 0,
      springBest: 0,
      pitchesFaced: 0,
      swings: 0,
      contacts: 0,
      hits: 0,
      powerSwings: 0,
      evSum: 0,
    },
    mouse: {
      matches: 0,
      wins: 0,
      pitchesThrown: 0,
      springRecorded: 0,
      springBest: 0,
      pitchesFaced: 0,
      swings: 0,
      contacts: 0,
      hits: 0,
      powerSwings: 0,
      evSum: 0,
    },
  };
  let h2hMatches = 0;
  let h2hTouchWins = 0;
  let h2hMouseWins = 0;

  for (const m of matches) {
    if (m.roomKind === 'friend') friendMatches += 1;
    else liveMatches += 1;
    if (m.winner === 'away') awayWins += 1;
    else if (m.winner === 'home') homeWins += 1;
    totalDurationSec += Number(m.durationSec) || 0;
    const awaySc = Number(m.awayRuns ?? m.awayScore) || 0;
    const homeSc = Number(m.homeRuns ?? m.homeScore) || 0;
    const matchRuns = awaySc + homeSc;
    totalRuns += matchRuns;
    if (matchRuns > maxMatchRuns) maxMatchRuns = matchRuns;
    if (Math.abs(awaySc - homeSc) >= 15) extremeRunDiffMatches += 1;
    if ((Number(m.innings ?? m.inningsPlayed) || 0) >= 8) highInningMatches += 1;
    totalMatchPitches += Number(m.pitches ?? m.totalPitches) || 0;
    totalHits += (Number(m.awayHits) || 0) + (Number(m.homeHits) || 0);
    totalWalks += (Number(m.awayWalks) || 0) + (Number(m.homeWalks) || 0);
    totalStrikeouts += (Number(m.awayStrikeouts) || 0) + (Number(m.homeStrikeouts) || 0);
    const r = String(m.reason || m.endReason || 'normal');
    reasons[r] = (reasons[r] || 0) + 1;

    const aIn = m.awayInput;
    const hIn = m.homeInput;
    if (aIn === 'touch' || aIn === 'mouse') {
      cpPlatform[aIn].matches += 1;
      if (m.winner === 'away') cpPlatform[aIn].wins += 1;
    }
    if (hIn === 'touch' || hIn === 'mouse') {
      cpPlatform[hIn].matches += 1;
      if (m.winner === 'home') cpPlatform[hIn].wins += 1;
    }
    if (aIn && hIn && aIn !== hIn && (m.winner === 'away' || m.winner === 'home')) {
      h2hMatches += 1;
      const winInput = m.winner === 'away' ? aIn : hIn;
      if (winInput === 'touch') h2hTouchWins += 1;
      else h2hMouseWins += 1;
    }
  }

  const makePitchBucket = () => ({
    count: 0,
    speedSum: 0,
    breakSum: 0,
    strikes: 0,
    swings: 0,
    whiffs: 0,
    contacts: 0,
    hits: 0,
    outsInPlay: 0,
  });

  const pitchStats: Record<string, ReturnType<typeof makePitchBucket>> = {
    straight: makePitchBucket(),
    cutter: makePitchBucket(),
    fork: makePitchBucket(),
    changeup: makePitchBucket(),
    knuckle: makePitchBucket(),
    shuuto: makePitchBucket(),
  };

  const makeHandBucket = () => ({ pitches: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0 });
  const handStats: Record<string, { L: ReturnType<typeof makeHandBucket>; R: ReturnType<typeof makeHandBucket> }> = {
    straight: { L: makeHandBucket(), R: makeHandBucket() },
    cutter: { L: makeHandBucket(), R: makeHandBucket() },
    fork: { L: makeHandBucket(), R: makeHandBucket() },
    changeup: { L: makeHandBucket(), R: makeHandBucket() },
    knuckle: { L: makeHandBucket(), R: makeHandBucket() },
    shuuto: { L: makeHandBucket(), R: makeHandBucket() },
  };

  const springStats: Record<'SOFT' | 'BEST' | 'OVER', { count: number; speedSum: number; strikes: number }> = {
    SOFT: { count: 0, speedSum: 0, strikes: 0 },
    BEST: { count: 0, speedSum: 0, strikes: 0 },
    OVER: { count: 0, speedSum: 0, strikes: 0 },
  };

  const timingOrder = ['very_early', 'early', 'perfect', 'late', 'very_late'] as const;
  const timingLabels: Record<(typeof timingOrder)[number], string> = {
    very_early: '極早 (< -60ms)',
    early: '偏早 (-60~-25ms)',
    perfect: '完美 (±25ms)',
    late: '偏晚 (+25~+60ms)',
    very_late: '極晚 (> +60ms)',
  };
  const timingStats: Record<(typeof timingOrder)[number], { count: number; contacts: number; hits: number }> = {
    very_early: { count: 0, contacts: 0, hits: 0 },
    early: { count: 0, contacts: 0, hits: 0 },
    perfect: { count: 0, contacts: 0, hits: 0 },
    late: { count: 0, contacts: 0, hits: 0 },
    very_late: { count: 0, contacts: 0, hits: 0 },
  };

  const makeZoneCell = (id: string, row: number, col: number) => ({
    id,
    row,
    col,
    pitches: 0,
    swings: 0,
    contacts: 0,
    hits: 0,
    taken: 0,
    umpireErrors: 0,
  });
  const zoneCells = Array.from({ length: 9 }, (_, idx) => makeZoneCell(`z${idx}`, Math.floor(idx / 3), idx % 3));
  const zoneOutside = makeZoneCell('outside', -1, -1);

  let totalThrownPitches = 0;
  let totalSwings = 0;
  let totalContacts = 0;
  let evSum = 0;
  let laSum = 0;
  let maxHrDistM = 0;
  let foulBalls = 0;
  let foulFlyOuts = 0;
  let singles = 0;
  let doubles = 0;
  let triples = 0;
  let homeRuns = 0;
  let outsInPlay = 0;
  let absChallenges = 0;
  let absOverturned = 0;
  let umpireZoneDisagreements = 0;
  let takenPitches = 0;
  let ibbCount = 0;
  let clockViolations = 0;

  // Special rules & fielding events
  let nonContactPitches = 0;
  let wildPitches = 0;
  let passedBalls = 0;
  let droppedThirdStrikes = 0;
  let airCatches = 0;
  let fielderBobbles = 0;
  let groundBlocks = 0;
  const byFielder: Record<'LF' | 'RF' | 'P' | 'C', { catches: number; blocks: number; bobbles: number }> = {
    LF: { catches: 0, blocks: 0, bobbles: 0 },
    RF: { catches: 0, blocks: 0, bobbles: 0 },
    P: { catches: 0, blocks: 0, bobbles: 0 },
    C: { catches: 0, blocks: 0, bobbles: 0 },
  };

  for (const ev of events) {
    if (ev.event === 'abs_challenge') {
      absChallenges += 1;
      if (ev.overturned) absOverturned += 1;
      continue;
    }
    if (ev.event === 'ibb') {
      ibbCount += 1;
      continue;
    }
    if (ev.event === 'pitch_clock') {
      clockViolations += 1;
      continue;
    }
    if (ev.event && ev.event !== 'pitch') continue;

    totalThrownPitches += 1;
    const pid = ev.pitchId && pitchStats[ev.pitchId] ? ev.pitchId : 'straight';
    const ps = pitchStats[pid];
    ps.count += 1;
    const spd = Number(ev.speedKmh) || 0;
    ps.speedSum += spd;
    ps.breakSum += Number(ev.breakCm) || 0;

    const isHitOutcome = ev.outcome === '1B' || ev.outcome === '2B' || ev.outcome === '3B' || ev.outcome === 'HR';
    const isStrikeOutcome =
      ev.swung ||
      ev.umpireCall === 'strike' ||
      ev.outcome === 'STRIKE' ||
      ev.outcome === 'STRIKEOUT' ||
      ev.outcome === 'UNCAUGHT_THIRD_STRIKE' ||
      ev.outcome === 'FOUL';
    if (isStrikeOutcome) ps.strikes += 1;

    // Spring zone mechanics
    if (ev.springZone && springStats[ev.springZone]) {
      springStats[ev.springZone].count += 1;
      springStats[ev.springZone].speedSum += spd;
      if (isStrikeOutcome) springStats[ev.springZone].strikes += 1;
    }

    // Cross-platform pitcher & batter stats
    if (ev.pitcherInput === 'touch' || ev.pitcherInput === 'mouse') {
      const cp = cpPlatform[ev.pitcherInput];
      cp.pitchesThrown += 1;
      if (ev.springZone) {
        cp.springRecorded += 1;
        if (ev.springZone === 'BEST') cp.springBest += 1;
      }
    }
    if (ev.batterInput === 'touch' || ev.batterInput === 'mouse') {
      const cp = cpPlatform[ev.batterInput];
      cp.pitchesFaced += 1;
      if (ev.swung) {
        cp.swings += 1;
        if (ev.powerSwing) cp.powerSwings += 1;
        if (ev.contact) {
          cp.contacts += 1;
          cp.evSum += Number(ev.exitSpeedKmh) || 0;
          if (isHitOutcome) cp.hits += 1;
        }
      }
    }

    // Handedness matchup matrix
    const hand = ev.batterHand === 'L' || ev.batterHand === 'R' ? ev.batterHand : null;
    const hs = hand ? handStats[pid][hand] : null;
    if (hs) hs.pitches += 1;

    // Strike zone 9-cell grid
    let zCell: ReturnType<typeof makeZoneCell> | null = null;
    if (typeof ev.plateX === 'number' && typeof ev.plateY === 'number') {
      const idx = classifyZoneCell(ev.plateX, ev.plateY);
      zCell = idx >= 0 ? zoneCells[idx] : zoneOutside;
      zCell.pitches += 1;
    }

    if (!ev.swung) {
      takenPitches += 1;
      if (zCell) zCell.taken += 1;
      if (ev.trueCall && ev.umpireCall && ev.trueCall !== ev.umpireCall) {
        umpireZoneDisagreements += 1;
        if (zCell) zCell.umpireErrors += 1;
      }
    } else {
      totalSwings += 1;
      ps.swings += 1;
      if (hs) hs.swings += 1;
      if (zCell) zCell.swings += 1;

      if (typeof ev.dtTiming === 'number' && Number.isFinite(ev.dtTiming)) {
        const tb = timingStats[classifyTimingBucket(ev.dtTiming)];
        tb.count += 1;
        if (ev.contact) {
          tb.contacts += 1;
          if (isHitOutcome) tb.hits += 1;
        }
      }

      if (ev.contact) {
        totalContacts += 1;
        ps.contacts += 1;
        if (hs) hs.contacts += 1;
        if (zCell) zCell.contacts += 1;
        evSum += Number(ev.exitSpeedKmh) || 0;
        laSum += Number(ev.launchAngleDeg) || 0;

        if (ev.outcome === '1B') {
          singles += 1;
          ps.hits += 1;
          if (hs) hs.hits += 1;
          if (zCell) zCell.hits += 1;
        } else if (ev.outcome === '2B') {
          doubles += 1;
          ps.hits += 1;
          if (hs) hs.hits += 1;
          if (zCell) zCell.hits += 1;
        } else if (ev.outcome === '3B') {
          triples += 1;
          ps.hits += 1;
          if (hs) hs.hits += 1;
          if (zCell) zCell.hits += 1;
        } else if (ev.outcome === 'HR') {
          homeRuns += 1;
          ps.hits += 1;
          if (hs) hs.hits += 1;
          if (zCell) zCell.hits += 1;
          const dist = Number(ev.distanceM) || 0;
          if (dist > maxHrDistM) maxHrDistM = dist;
        } else if (ev.outcome === 'FOUL') {
          foulBalls += 1;
        } else if (ev.outcome === 'OUT') {
          outsInPlay += 1;
          ps.outsInPlay += 1;
          if (ev.isFoulFlyOut) foulFlyOuts += 1;
        }

        if (ev.caughtBy && byFielder[ev.caughtBy]) {
          airCatches += 1;
          byFielder[ev.caughtBy].catches += 1;
        }
        if (ev.bobbledBy && byFielder[ev.bobbledBy]) {
          fielderBobbles += 1;
          byFielder[ev.bobbledBy].bobbles += 1;
        }
        if (ev.blockedBy && byFielder[ev.blockedBy]) {
          groundBlocks += 1;
          byFielder[ev.blockedBy].blocks += 1;
        }
      } else {
        ps.whiffs += 1;
        if (hs) hs.whiffs += 1;
      }
    }

    if (!ev.contact) {
      nonContactPitches += 1;
      if (ev.catchKind === 'wild_pitch') wildPitches += 1;
      else if (ev.catchKind === 'passed_ball') passedBalls += 1;
      if (ev.droppedThirdStrike || ev.outcome === 'UNCAUGHT_THIRD_STRIKE') {
        droppedThirdStrikes += 1;
      }
    }
  }

  // Device & environment aggregations from sessions.jsonl
  const byDevice: Record<string, number> = { mobile: 0, tablet: 0, desktop: 0 };
  const byOs: Record<string, number> = { ios: 0, android: 0, macos: 0, windows: 0, linux: 0, other: 0 };
  const byBrowser: Record<string, number> = { chrome: 0, safari: 0, line: 0, ig: 0, fb: 0, edge: 0, firefox: 0, other: 0 };
  const byInput: Record<string, number> = { touch: 0, mouse: 0 };
  const byOrient: Record<string, number> = { landscape: 0, portrait: 0 };
  const byLocale: Record<string, number> = { 'zh-TW': 0, en: 0, ja: 0 };
  let pwaCount = 0;

  for (const s of sessions) {
    if (s.device && s.device in byDevice) byDevice[s.device] += 1;
    if (s.os && s.os in byOs) byOs[s.os] += 1;
    else byOs.other += 1;
    if (s.browser && s.browser in byBrowser) byBrowser[s.browser] += 1;
    else byBrowser.other += 1;
    if (s.input && s.input in byInput) byInput[s.input] += 1;
    if (s.orient && s.orient in byOrient) byOrient[s.orient] += 1;
    if (s.locale && s.locale in byLocale) byLocale[s.locale] += 1;
    if (s.pwa) pwaCount += 1;
  }

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
  const avg = (sum: number, den: number) => (den > 0 ? Math.round((sum / den) * 10) / 10 : 0);

  const pitchRepertoire = ALL_PITCH_IDS.map((id) => {
    const s = pitchStats[id];
    return {
      pitchId: id,
      count: s.count,
      usagePct: pct(s.count, totalThrownPitches),
      avgSpeedKmh: avg(s.speedSum, s.count),
      avgBreakCm: avg(s.breakSum, s.count),
      strikePct: pct(s.strikes, s.count),
      swingPct: pct(s.swings, s.count),
      whiffPct: pct(s.whiffs, s.swings),
      hitPct: pct(s.hits, s.contacts),
    };
  });

  const handednessMatrix = ALL_PITCH_IDS.map((id) => {
    const L = handStats[id].L;
    const R = handStats[id].R;
    return {
      pitchId: id,
      L: {
        pitches: L.pitches,
        swings: L.swings,
        whiffPct: pct(L.whiffs, L.swings),
        hitPct: pct(L.hits, L.contacts),
      },
      R: {
        pitches: R.pitches,
        swings: R.swings,
        whiffPct: pct(R.whiffs, R.swings),
        hitPct: pct(R.hits, R.contacts),
      },
    };
  });

  const totalSpringRecorded = springStats.SOFT.count + springStats.BEST.count + springStats.OVER.count;
  const springSummary = (['SOFT', 'BEST', 'OVER'] as const).map((zone) => {
    const s = springStats[zone];
    return {
      zone,
      count: s.count,
      pct: pct(s.count, totalSpringRecorded),
      avgSpeedKmh: avg(s.speedSum, s.count),
      strikePct: pct(s.strikes, s.count),
    };
  });

  const totalTimingRecorded = timingOrder.reduce((acc, k) => acc + timingStats[k].count, 0);
  const timingSummary = timingOrder.map((bucket) => {
    const t = timingStats[bucket];
    return {
      bucket,
      label: timingLabels[bucket],
      count: t.count,
      pct: pct(t.count, totalTimingRecorded),
      contactPct: pct(t.contacts, t.count),
      hitPct: pct(t.hits, t.contacts),
    };
  });

  const totalZonePitches = zoneCells.reduce((acc, c) => acc + c.pitches, 0) + zoneOutside.pitches;
  const formatZoneCell = (c: ReturnType<typeof makeZoneCell>) => ({
    id: c.id,
    row: c.row,
    col: c.col,
    pitches: c.pitches,
    pitchPct: pct(c.pitches, totalZonePitches),
    swings: c.swings,
    swingPct: pct(c.swings, c.pitches),
    contacts: c.contacts,
    hits: c.hits,
    hitPct: pct(c.hits, c.contacts),
    taken: c.taken,
    umpireErrors: c.umpireErrors,
    errorPct: pct(c.umpireErrors, c.taken),
  });

  const formatCp = (p: typeof cpPlatform.touch) => ({
    matches: p.matches,
    wins: p.wins,
    winPct: pct(p.wins, p.matches),
    pitchesThrown: p.pitchesThrown,
    bestSpringPct: pct(p.springBest, p.springRecorded),
    pitchesFaced: p.pitchesFaced,
    swings: p.swings,
    swingPct: pct(p.swings, p.pitchesFaced),
    whiffPct: pct(p.swings - p.contacts, p.swings),
    contacts: p.contacts,
    hits: p.hits,
    hitPct: pct(p.hits, p.contacts),
    powerSwingPct: pct(p.powerSwings, p.swings),
    avgExitSpeedKmh: avg(p.evSum, p.contacts),
  });

  const matchFileKb = Math.round((matchTail.fileBytes / 1024) * 10) / 10;
  const pitchFileKb = Math.round((pitchTail.fileBytes / 1024) * 10) / 10;
  const sessionFileKb = Math.round((sessionTail.fileBytes / 1024) * 10) / 10;
  const totalDiskKb = Math.round((matchFileKb + pitchFileKb + sessionFileKb) * 10) / 10;

  return {
    ts: new Date().toISOString(),
    window: {
      maxMatches: ANALYTICS_WINDOW_MATCHES,
      maxPitches: ANALYTICS_WINDOW_PITCHES,
      maxSessions: ANALYTICS_WINDOW_SESSIONS,
      retainedMaxMatches: MAX_RETAINED_MATCHES,
      retainedMaxPitches: MAX_RETAINED_PITCHES,
      retainedMaxSessions: MAX_RETAINED_SESSIONS,
      matchesAnalyzed: matches.length,
      eventsAnalyzed: events.length,
      pitchesAnalyzed: totalThrownPitches,
      sessionsAnalyzed: sessions.length,
      matchFileKb,
      pitchFileKb,
      sessionFileKb,
      totalDiskKb,
      maxDiskKb: Math.round((MATCH_LOG_MAX_BYTES + PITCH_LOG_MAX_BYTES + SESSION_LOG_MAX_BYTES) / 1024),
    },
    matchesSummary: {
      total: matches.length,
      activeLive: inProgressMatches.length,
      live: liveMatches,
      friend: friendMatches,
      awayWins,
      homeWins,
      avgDurationSec: matches.length > 0 ? Math.round(totalDurationSec / matches.length) : 0,
      avgRunsPerMatch: avg(totalRuns, matches.length),
      avgPitchesPerMatch: avg(totalMatchPitches, matches.length),
      maxMatchRuns,
      highInningMatches,
      extremeRunDiffMatches,
      avgHitsPerMatch: avg(totalHits, matches.length),
      avgStrikeoutsPerMatch: avg(totalStrikeouts, matches.length),
      avgWalksPerMatch: avg(totalWalks, matches.length),
      reasons,
    },
    battingSummary: {
      totalPitches: totalThrownPitches,
      swings: totalSwings,
      swingPct: pct(totalSwings, totalThrownPitches),
      contacts: totalContacts,
      contactPct: pct(totalContacts, totalSwings),
      whiffPct: pct(totalSwings - totalContacts, totalSwings),
      avgExitSpeedKmh: avg(evSum, totalContacts),
      avgLaunchAngleDeg: avg(laSum, totalContacts),
      maxHrDistM: Math.round(maxHrDistM * 10) / 10,
      outcomes: {
        singles,
        doubles,
        triples,
        homeRuns,
        outsInPlay,
        foulBalls,
        foulFlyOuts,
        ibbCount,
        clockViolations,
      },
      abs: {
        takenPitches,
        umpireBorderlineDiffs: umpireZoneDisagreements,
        challenges: absChallenges,
        overturned: absOverturned,
        overturnPct: pct(absOverturned, absChallenges),
      },
    },
    pitchRepertoire,
    handednessMatrix,
    specialEvents: {
      nonContactPitches,
      wildPitches,
      wildPitchPct: pct(wildPitches, nonContactPitches),
      passedBalls,
      passedBallPct: pct(passedBalls, nonContactPitches),
      droppedThirdStrikes,
      droppedThirdStrikePct: pct(droppedThirdStrikes, totalThrownPitches),
      foulFlyOuts,
      foulFlyOutPct: pct(foulFlyOuts, foulBalls + foulFlyOuts),
      airCatches,
      airCatchPct: pct(airCatches, totalContacts),
      fielderBobbles,
      fielderBobblePct: pct(fielderBobbles, totalContacts),
      groundBlocks,
      groundBlockPct: pct(groundBlocks, totalContacts),
      byFielder,
    },
    mechanics: {
      springTotal: totalSpringRecorded,
      spring: springSummary,
      timingTotal: totalTimingRecorded,
      timing: timingSummary,
    },
    strikeZoneGrid: {
      totalPitches: totalZonePitches,
      cells: zoneCells.map(formatZoneCell),
      outside: formatZoneCell(zoneOutside),
    },
    devices: {
      totalSessions: sessions.length,
      byDevice,
      byOs,
      byBrowser,
      byInput,
      byOrient,
      byLocale,
      pwaCount,
      pwaPct: pct(pwaCount, sessions.length),
    },
    crossPlatform: {
      touch: formatCp(cpPlatform.touch),
      mouse: formatCp(cpPlatform.mouse),
      headToHead: {
        totalMatches: h2hMatches,
        touchWins: h2hTouchWins,
        mouseWins: h2hMouseWins,
        touchWinPct: pct(h2hTouchWins, h2hMatches),
      },
    },
    gameplay: liveGameplay ?? {},
    liveMatches: inProgressMatches,
    recentMatches: [...matches].reverse(),
  };
}
