/**
 * Ultra-compact WebSocket wire protocol (v2) for fallen skywalker.
 *
 * Cuts per-pitch network traffic by ~75-80% compared to raw JSON MatchState:
 * - Short message tags ("p", "po", "ps", "sw", "ns", "pl", "pr", "st", "ms", "ss", "sp", "abs", "err")
 * - Compact MatchState tuple/bitmask encoding (bases as 3-bit mask, lineups reconstructed locally)
 * - 3-decimal float rounding to eliminate 17-digit IEEE-754 serialization noise
 */
import type { PitchId } from '../physics/pitches';
import type { GameMode, MatchEndReason, MatchState, PlayerSlot } from '../rules/match';

export type ServerLoadStatus = 'green' | 'yellow' | 'red';
export type SpringZoneWire = 'SOFT' | 'BEST' | 'OVER';

export interface ClientDeviceProfile {
  device: 'mobile' | 'tablet' | 'desktop';
  os: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other';
  browser: 'line' | 'ig' | 'fb' | 'safari' | 'chrome' | 'edge' | 'firefox' | 'other';
  input: 'touch' | 'mouse';
  orient: 'landscape' | 'portrait';
  pwa: boolean;
  locale: 'zh-TW' | 'en' | 'ja';
  skipLog?: boolean;
}

const VALID_DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const VALID_OS = new Set(['ios', 'android', 'macos', 'windows', 'linux', 'other']);
const VALID_BROWSERS = new Set(['line', 'ig', 'fb', 'safari', 'chrome', 'edge', 'firefox', 'other']);
const VALID_INPUTS = new Set(['touch', 'mouse']);
const VALID_ORIENTS = new Set(['landscape', 'portrait']);
const VALID_LOCALES = new Set(['zh-TW', 'en', 'ja']);

export function sanitizeDeviceProfile(raw: unknown): ClientDeviceProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dv = String(r.dv ?? r.device ?? '');
  const os = String(r.os ?? '');
  const br = String(r.br ?? r.browser ?? '');
  const inp = String(r.in ?? r.input ?? '');
  const or = String(r.or ?? r.orient ?? '');
  const lc = String(r.lc ?? r.locale ?? '');
  if (!VALID_DEVICES.has(dv) && !VALID_INPUTS.has(inp)) return null;
  return {
    device: (VALID_DEVICES.has(dv) ? dv : 'desktop') as ClientDeviceProfile['device'],
    os: (VALID_OS.has(os) ? os : 'other') as ClientDeviceProfile['os'],
    browser: (VALID_BROWSERS.has(br) ? br : 'other') as ClientDeviceProfile['browser'],
    input: (VALID_INPUTS.has(inp) ? inp : dv === 'desktop' ? 'mouse' : 'touch') as ClientDeviceProfile['input'],
    orient: (VALID_ORIENTS.has(or) ? or : 'landscape') as ClientDeviceProfile['orient'],
    pwa: r.pw === 1 || r.pwa === true,
    locale: (VALID_LOCALES.has(lc) ? lc : 'zh-TW') as ClientDeviceProfile['locale'],
    skipLog: r.nr === 1 || r.skipLog === true,
  };
}

export function encodeSpringZone(zone?: SpringZoneWire | null): number | undefined {
  if (zone === 'SOFT') return 0;
  if (zone === 'BEST') return 1;
  if (zone === 'OVER') return 2;
  return undefined;
}

export function decodeSpringZone(code: unknown): SpringZoneWire | null {
  if (code === 0 || code === 'SOFT') return 'SOFT';
  if (code === 1 || code === 'BEST') return 'BEST';
  if (code === 2 || code === 'OVER') return 'OVER';
  return null;
}

export const PITCH_IDS_ORDER: readonly PitchId[] = ['straight', 'cutter', 'fork', 'changeup', 'knuckle', 'shuuto'];
const LOAD_ORDER: readonly ServerLoadStatus[] = ['green', 'yellow', 'red'];

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const DEFAULT_AWAY_LINEUP: PlayerSlot[] = [
  { id: 'away-1', name: 'NastYboY #99', position: 'LF' },
  { id: 'away-2', name: 'NastYboY #99', position: 'RF' },
  { id: 'away-3', name: 'NastYboY #99', position: 'DH' },
  { id: 'away-4', name: 'NastYboY #99', position: 'C' },
  { id: 'away-5', name: 'skywalker #18', position: 'P' },
];

const DEFAULT_HOME_LINEUP: PlayerSlot[] = [
  { id: 'home-1', name: 'NastYboY #99', position: 'LF' },
  { id: 'home-2', name: 'NastYboY #99', position: 'RF' },
  { id: 'home-3', name: 'NastYboY #99', position: 'DH' },
  { id: 'home-4', name: 'NastYboY #99', position: 'C' },
  { id: 'home-5', name: 'skywalker #18', position: 'P' },
];

const MODE_LIST: readonly GameMode[] = ['quick3', 'official6', 'practice_bat', 'practice_pitch', 'hotseat2p'];

export interface CompactMatch {
  /** mode index (omitted on delta updates) */
  m?: number;
  /** regulation innings (omitted on delta updates) */
  ri?: number;
  /** away name, home name (omitted on delta updates; cached on client from match_start/state_sync) */
  a?: string;
  h?: string;
  /** [awayRuns, homeRuns, awayHits, homeHits, awayPitches, homePitches, awayBatIdx, homeBatIdx, awayBB, homeBB, awayK, homeK] */
  t: [number, number, number, number, number, number, number, number, number, number, number, number];
  /** [inning, half(0=top,1=bottom), balls, strikes, outs, basesMask(0..7), absAway, absHome, paInHalf, maxPa] */
  g: [number, number, number, number, number, number, number, number, number, number];
  /** stats tuple [totalPitches, homeRuns, wildPitches, uncaughtThirdStrikes] (omitted when all 0) */
  s?: [number, number, number, number];
  /** optional derby [half(0=away,1=home), round, pitchesPerSide, awayLeft, homeLeft, awayHR, homeHR] */
  d?: [number, number, number, number, number, number, number];
  /** optional gameOver + winner ('h'|'a'|'t') */
  go?: 1;
  w?: 'h' | 'a' | 't';
  /** optional runs-by-inning arrays for full BoxScore line score (omitted on mid-game deltas until isGameOver) */
  ar?: number[];
  hr?: number[];
  /** mercy rule off flag (omitted when enabled) & triggered flag */
  mr?: 0;
  mt?: 1;
  /** match end reason code: 1=mercy, 2=disconnect, 3=resign, 4=pitch_clock */
  er?: 1 | 2 | 3 | 4;
  /** optional challengeable call [pitchSeq, eligibleSide(0=away,1=home), challenged(0|1)] */
  lc?: [number, number, number];
}

export interface CompactMatchDecodeContext {
  awayName?: string;
  homeName?: string;
  mode?: GameMode;
  regulationInnings?: number;
}

export function packMatch(m: MatchState, opts?: { delta?: boolean }): CompactMatch {
  const delta = opts?.delta === true;
  const basesMask =
    (m.bases[0] !== null ? 1 : 0) |
    (m.bases[1] !== null ? 2 : 0) |
    (m.bases[2] !== null ? 4 : 0);

  const cm: CompactMatch = {
    t: [
      m.away.totalRuns,
      m.home.totalRuns,
      m.away.hits,
      m.home.hits,
      m.away.pitchesThrown,
      m.home.pitchesThrown,
      m.away.batterIndex,
      m.home.batterIndex,
      m.away.walks,
      m.home.walks,
      m.away.strikeouts,
      m.home.strikeouts,
    ],
    g: [
      m.inning,
      m.half === 'top' ? 0 : 1,
      m.balls,
      m.strikes,
      m.outs,
      basesMask,
      m.absChallenges.away,
      m.absChallenges.home,
      m.plateAppearancesInHalf,
      m.maxBattersPerInning,
    ],
  };

  if (!delta) {
    cm.m = Math.max(0, MODE_LIST.indexOf(m.mode));
    cm.ri = m.regulationInnings;
    cm.a = m.away.name;
    cm.h = m.home.name;
  }

  if (
    m.stats.totalPitches > 0 ||
    m.stats.homeRuns > 0 ||
    m.stats.wildPitches > 0 ||
    m.stats.uncaughtThirdStrikes > 0
  ) {
    cm.s = [
      m.stats.totalPitches,
      m.stats.homeRuns,
      m.stats.wildPitches,
      m.stats.uncaughtThirdStrikes,
    ];
  }

  if (m.derby.active) {
    cm.d = [
      m.derby.half === 'away' ? 0 : 1,
      m.derby.round,
      m.derby.pitchesPerSide,
      m.derby.awayPitchesLeft,
      m.derby.homePitchesLeft,
      m.derby.awayHR,
      m.derby.homeHR,
    ];
  }
  if (m.isGameOver) cm.go = 1;
  if ((!delta || m.isGameOver) && m.away.runsByInning.length > 0) cm.ar = m.away.runsByInning;
  if ((!delta || m.isGameOver) && m.home.runsByInning.length > 0) cm.hr = m.home.runsByInning;
  if (m.mercyRule === false) cm.mr = 0;
  if (m.mercyTriggered) cm.mt = 1;
  if (m.endReason === 'mercy') cm.er = 1;
  else if (m.endReason === 'disconnect') cm.er = 2;
  else if (m.endReason === 'resign') cm.er = 3;
  else if (m.endReason === 'pitch_clock') cm.er = 4;
  if (m.winner) {
    cm.w = m.winner === 'home' ? 'h' : m.winner === 'away' ? 'a' : 't';
  }
  if (m.lastChallenge) {
    cm.lc = [
      m.lastChallenge.pitchSeq,
      m.lastChallenge.eligibleSide === 'home' ? 1 : 0,
      m.lastChallenge.challenged ? 1 : 0,
    ];
  }
  return cm;
}

export function unpackMatch(cm: CompactMatch, ctx?: CompactMatchDecodeContext): MatchState {
  const mode: GameMode =
    typeof cm.m === 'number' ? (MODE_LIST[cm.m] ?? 'quick3') : (ctx?.mode ?? 'quick3');
  const regInnings =
    typeof cm.ri === 'number' ? cm.ri : (ctx?.regulationInnings ?? (mode === 'official6' ? 6 : 3));
  const [ar, hr, ah, hh, ap, hp, abi, hbi, abb, hbb, ak, hk] = cm.t;
  const [inning, halfNum, balls, strikes, outs, basesMask, absAway, absHome, paInHalf, maxPa] = cm.g;
  const [totalPitches, homeRuns, wildPitches, uncaughtThirdStrikes] = cm.s ?? [0, 0, 0, 0];
  const half = halfNum === 0 ? 'top' : 'bottom';
  const winner = cm.w === 'h' ? 'home' : cm.w === 'a' ? 'away' : cm.w === 't' ? 'tie' : null;
  const bases: [string | null, string | null, string | null] = [
    (basesMask & 1) !== 0 ? 'r1' : null,
    (basesMask & 2) !== 0 ? 'r2' : null,
    (basesMask & 4) !== 0 ? 'r3' : null,
  ];

  return {
    mode,
    regulationInnings: regInnings,
    inning,
    half,
    balls,
    strikes,
    outs,
    bases,
    away: {
      name: cm.a ?? ctx?.awayName ?? '',
      lineup: DEFAULT_AWAY_LINEUP.map((p) => ({ ...p })),
      batterIndex: abi,
      runsByInning: Array.isArray(cm.ar) && cm.ar.length > 0 ? [...cm.ar] : [ar],
      totalRuns: ar,
      hits: ah,
      walks: abb,
      strikeouts: ak,
      pitchesThrown: ap,
    },
    home: {
      name: cm.h ?? ctx?.homeName ?? '',
      lineup: DEFAULT_HOME_LINEUP.map((p) => ({ ...p })),
      batterIndex: hbi,
      runsByInning: Array.isArray(cm.hr) && cm.hr.length > 0 ? [...cm.hr] : [hr],
      totalRuns: hr,
      hits: hh,
      walks: hbb,
      strikeouts: hk,
      pitchesThrown: hp,
    },
    isGameOver: cm.go === 1,
    winner,
    mercyRule: cm.mr !== 0,
    mercyTriggered: cm.mt === 1,
    endReason: (
      cm.er === 1
        ? 'mercy'
        : cm.er === 2
          ? 'disconnect'
          : cm.er === 3
            ? 'resign'
            : cm.er === 4
              ? 'pitch_clock'
              : cm.mt === 1
                ? 'mercy'
                : undefined
    ) as MatchEndReason | undefined,
    lastEvent: '',
    stats: {
      totalPitches,
      homeRuns,
      wildPitches,
      uncaughtThirdStrikes,
    },
    plateAppearancesInHalf: paInHalf,
    maxBattersPerInning: maxPa,
    absChallenges: { away: absAway, home: absHome },
    lastChallenge: cm.lc
      ? {
          pitchSeq: cm.lc[0],
          plateX: 0,
          plateY: 0.72,
          trueCall: 'strike',
          umpireCall: 'strike',
          marginCm: 0,
          eligibleSide: cm.lc[1] === 1 ? 'home' : 'away',
          challenged: cm.lc[2] === 1,
          preSnapshot: {
            balls,
            strikes,
            outs,
            inning,
            half,
            bases: [null, null, null],
            awayRuns: ar,
            homeRuns: hr,
            awayBatterIdx: abi,
            homeBatterIdx: hbi,
            awayWalks: abb,
            homeWalks: hbb,
            awayStrikeouts: ak,
            homeStrikeouts: hk,
            isGameOver: cm.go === 1,
            winner,
          },
        }
      : null,
    derby: cm.d
      ? {
          active: true,
          half: cm.d[0] === 0 ? 'away' : 'home',
          round: cm.d[1],
          pitchesPerSide: cm.d[2],
          awayPitchesLeft: cm.d[3],
          homePitchesLeft: cm.d[4],
          awayHR: cm.d[5],
          homeHR: cm.d[6],
        }
      : {
          active: false,
          half: 'away',
          round: 1,
          pitchesPerSide: 5,
          awayPitchesLeft: 5,
          homePitchesLeft: 5,
          awayHR: 0,
          homeHR: 0,
        },
  };
}

export function encodePitchId(id: PitchId): number {
  const i = PITCH_IDS_ORDER.indexOf(id);
  return i >= 0 ? i : 0;
}

export function decodePitchId(v: unknown): PitchId {
  if (typeof v === 'number' && PITCH_IDS_ORDER[v]) return PITCH_IDS_ORDER[v];
  if (typeof v === 'string' && PITCH_IDS_ORDER.includes(v as PitchId)) return v as PitchId;
  return 'straight';
}

export function encodeLoad(status: ServerLoadStatus): number {
  return LOAD_ORDER.indexOf(status);
}

export function decodeLoad(v: unknown): ServerLoadStatus {
  if (typeof v === 'number' && LOAD_ORDER[v]) return LOAD_ORDER[v];
  if (v === 'green' || v === 'yellow' || v === 'red') return v;
  return 'green';
}

/**
 * Decode a compact v2 or legacy verbose client-to-server payload into canonical verbose form.
 */
export function normalizeClientMsg(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.type === 'string') return raw;
  const tag = raw.t;
  switch (tag) {
    case 'p':
      return { type: 'ping', t: raw.n };
    case 'po':
      return { type: 'pong', t: raw.n };
    case 'hi':
      return {
        type: 'hello',
        name: raw.n,
        v: raw.v ?? 2,
        ...(raw.d ? { deviceProfile: sanitizeDeviceProfile(raw.d) } : {}),
      };
    case 'q':
      return { type: 'queue', mode: raw.m === 1 ? 'official6' : 'quick3', name: raw.n };
    case 'uq':
      return { type: 'unqueue' };
    case 'cr':
      return {
        type: 'create',
        mode: raw.m === 1 ? 'official6' : 'quick3',
        name: raw.n,
        ...(raw.mr !== undefined ? { mercyRule: raw.mr !== 0 } : {}),
      };
    case 'jn':
      return { type: 'join', code: raw.c, name: raw.n };
    case 'rc':
      return { type: 'reconnect', code: raw.c, token: raw.k };
    case 'scq':
      return { type: 'session_check', code: raw.c, token: raw.k };
    case 'scf':
      return { type: 'session_forfeit', code: raw.c, token: raw.k };
    case 'bs':
      return { type: 'set_batter_side', side: raw.s === 1 ? 'R' : 'L' };
    case 'ib':
      return { type: 'ibb', pitchSeq: raw.q };
    case 'ps':
      return {
        type: 'pitch_submit',
        pitchSeq: raw.q,
        pitchId: decodePitchId(raw.p),
        speedKmh: raw.v,
        targetX: raw.x,
        targetY: raw.y,
        errorX: raw.ex ?? 0,
        errorY: raw.ey ?? 0,
        ...(raw.sz !== undefined ? { springZone: decodeSpringZone(raw.sz) } : {}),
        ...(raw.u !== undefined ? { u: raw.u } : {}),
      };
    case 'sw':
      return {
        type: 'swing_input',
        pitchSeq: raw.q,
        flightTimeSec: raw.ft,
        batX: raw.x,
        batY: raw.y,
        swingMode: raw.m === 1 ? 'power' : 'normal',
        batterSide: raw.s === 1 ? 'R' : 'L',
      };
    case 'ns':
      return { type: 'no_swing', pitchSeq: raw.q };
    case 'ls':
      return { type: 'list' };
    case 'wt':
      return { type: 'watch', code: raw.c };
    case 'uw':
      return { type: 'unwatch' };
    case 'ab':
      return { type: 'abs_challenge', pitchSeq: raw.q };
    case 'rs':
      return { type: 'resign' };
    case 'em':
      return { type: 'emote', id: raw.e };
    case 'mp':
      return { type: 'menu_pause', paused: raw.p === 1 || raw.p === true };
    case 'sj':
      return { type: 'standby_join', mode: raw.m === 1 ? 'official6' : 'quick3', priority: raw.p === 1 };
    case 'sl':
      return { type: 'standby_leave' };
    case 'os':
      return { type: 'offer_shown', offerId: raw.id };
    case 'or':
      return { type: 'offer_reply', offerId: raw.id, accept: raw.a === 1 || raw.a === true };
    case 'ac':
      return { type: 'activity', page: raw.a };
    default:
      return raw;
  }
}

/**
 * Encode a canonical server message into compact v2 wire JSON (when client supports v2).
 */
export function encodeServerMsgV2(msg: Record<string, unknown>): Record<string, unknown> {
  switch (msg.type) {
    case 'ping':
      return { t: 'p', n: msg.t };
    case 'pong':
      return { t: 'po', n: msg.t };
    case 'stats': {
      const s = msg.stats as { online: number; rooms: number; queued: number; load?: ServerLoadStatus; lagMs?: number };
      return { t: 'st', o: s.online, r: s.rooms, q: s.queued, l: encodeLoad(s.load ?? 'green'), lg: s.lagMs ?? 0 };
    }
    case 'welcome': {
      const s = msg.stats as { online: number; rooms: number; queued: number; load?: ServerLoadStatus; lagMs?: number };
      return {
        t: 'w',
        id: msg.clientId,
        n: msg.name,
        v: msg.version,
        o: s.online,
        r: s.rooms,
        q: s.queued,
        l: encodeLoad(s.load ?? 'green'),
        lg: s.lagMs ?? 0,
        ...(typeof msg.updateAtMs === 'number' && msg.updateAtMs > 0 ? { ua: msg.updateAtMs } : {}),
      };
    }
    case 'pitch_launch': {
      const ex = round3(Number(msg.errorX));
      const ey = round3(Number(msg.errorY));
      return {
        t: 'pl',
        q: msg.pitchSeq,
        sd: msg.seed,
        p: encodePitchId(msg.pitchId as PitchId),
        v: round2(Number(msg.speedKmh)),
        x: round3(Number(msg.targetX)),
        y: round3(Number(msg.targetY)),
        ...(ex !== 0 ? { ex } : {}),
        ...(ey !== 0 ? { ey } : {}),
        s: msg.batterSide === 'R' ? 1 : 0,
        b: msg.breakCm,
      };
    }
    case 'pitch_result': {
      const res = msg.resolution as Record<string, unknown> | null;
      let cr: Record<string, unknown> | undefined;
      if (res && res.contact === false) {
        const hf = res.hitField as number[];
        cr = {
          c: 0,
          lb: res.label,
          ...(res.feedback !== res.label ? { fb: res.feedback } : {}),
          dt: res.detail,
          cl: res.color,
          tm: round3(Number(res.dtTiming)),
          hf: [round3(hf[0]), round3(hf[1]), round3(hf[2])],
        };
      } else if (res) {
        const bp = res.battedParams as { position: number[]; velocity: number[]; seed?: number };
        const ci = res.catchInfo as {
          caught: boolean;
          bobbled?: boolean;
          blocked?: boolean;
          fielderId: 'LF' | 'RF' | 'P' | 'C' | null;
          catchTimeSec: number | null;
          catchPos: number[] | null;
          blockTimeSec?: number | null;
          blockPos?: number[] | null;
        };
        const fielderCode =
          ci.fielderId === 'RF' ? 1 : ci.fielderId === 'P' ? 2 : ci.fielderId === 'C' ? 3 : 0;
        const interceptT = ci.blocked
          ? (ci.blockTimeSec ?? ci.catchTimeSec ?? -1)
          : (ci.catchTimeSec ?? -1);
        const interceptPos = ci.blocked ? (ci.blockPos ?? ci.catchPos) : ci.catchPos;
        const hf = res.hitField as number[];
        cr = {
          lb: res.label,
          ...(res.feedback !== res.label ? { fb: res.feedback } : {}),
          dt: res.detail,
          cl: res.color,
          ql: res.quality,
          tm: round3(Number(res.dtTiming)),
          hf: [round3(hf[0]), round3(hf[1]), round3(hf[2])],
          bp: [
            round3(bp.position[0]),
            round3(bp.position[1]),
            round3(bp.position[2]),
            round3(bp.velocity[0]),
            round3(bp.velocity[1]),
            round3(bp.velocity[2]),
            bp.seed ?? 1,
          ],
          ci: ci.caught || ci.bobbled || ci.blocked
            ? [
                ci.caught ? 1 : 0,
                ci.bobbled ? 1 : 0,
                fielderCode,
                interceptT >= 0 ? round3(interceptT) : -1,
                ci.blocked ? 1 : 0,
                ...(interceptPos
                  ? [round2(interceptPos[0]), round2(interceptPos[1]), round2(interceptPos[2])]
                  : []),
              ]
            : 0,
          ...(res.outcome !== msg.outcome ? { oc: res.outcome } : {}),
          ev: Math.round(Number(res.exitSpeedKmh)),
          ...(typeof res.launchAngleDeg === 'number' ? { la: Math.round(res.launchAngleDeg) } : {}),
          dm: round2(Number(res.distanceM)),
        };
      }
      const co = msg.callout as { title: string; subtitle: string; color: string; ttl: number };
      const out: Record<string, unknown> = {
        t: 'pr',
        q: msg.pitchSeq,
        ...(msg.nextPitchSeq !== Number(msg.pitchSeq) + 1 ? { nq: msg.nextPitchSeq } : {}),
        sw: msg.swung ? 1 : 0,
        oc: msg.outcome,
        co: co.subtitle === co.title
          ? [co.title, co.color, round2(co.ttl)]
          : [co.title, co.subtitle, co.color, round2(co.ttl)],
        tl: msg.telemetry,
        cm: packMatch(msg.match as MatchState, { delta: true }),
      };
      if (msg.ibb) out.ib = 1;
      if (msg.clockViolation) out.cv = 1;
      if (msg.inningChanged) out.ic = 1;
      if (Array.isArray(msg.platePos)) {
        out.pp = [round3(Number(msg.platePos[0])), round3(Number(msg.platePos[1]))];
      }
      if (msg.swingData && typeof msg.swingData === 'object') {
        const sd = msg.swingData as { batX: number; batY: number; flightTimeSec: number; swingMode: string; batterSide: string };
        out.sd = [
          round3(sd.flightTimeSec),
          round3(sd.batX),
          round3(sd.batY),
          sd.swingMode === 'power' ? 1 : 0,
          sd.batterSide === 'R' ? 1 : 0,
        ];
      }
      if (cr) out.r = cr;
      return out;
    }
    case 'match_start':
    case 'state_sync': {
      const out: Record<string, unknown> = {
        t: msg.type === 'match_start' ? 'ms' : 'ss',
        c: msg.code,
        m: msg.mode === 'official6' ? 1 : 0,
        rk: msg.roomKind === 'friend' ? 1 : 0,
        sd: msg.side === 'home' ? 1 : 0,
        q: msg.pitchSeq,
        ts: msg.turnState === 'awaiting_swing' ? 1 : msg.turnState === 'game_over' ? 2 : 0,
        bs: msg.batterSide === 'R' ? 1 : 0,
        cm: packMatch(msg.match as MatchState),
      };
      if (msg.token) out.k = msg.token;
      if (msg.names) out.nm = msg.names;
      if (msg.batterSides && typeof msg.batterSides === 'object') {
        const bss = msg.batterSides as { away?: string; home?: string };
        out.bss = [bss.away === 'R' ? 1 : 0, bss.home === 'R' ? 1 : 0];
      }
      if (typeof msg.rtt === 'number') out.rt = msg.rtt;
      if (typeof msg.spectators === 'number') out.sc = msg.spectators;
      if (msg.activePitch) {
        const ap = msg.activePitch as Record<string, unknown>;
        out.ap = [
          ap.pitchSeq,
          ap.seed,
          encodePitchId(ap.pitchId as PitchId),
          round2(Number(ap.speedKmh)),
          round3(Number(ap.targetX)),
          round3(Number(ap.targetY)),
          round3(Number(ap.errorX)),
          round3(Number(ap.errorY)),
          ap.breakCm,
        ];
      }
      return out;
    }
    case 'spectate_sync': {
      const out: Record<string, unknown> = {
        t: 'sp',
        c: msg.code,
        m: msg.mode === 'official6' ? 1 : 0,
        rk: msg.roomKind === 'friend' ? 1 : 0,
        q: msg.pitchSeq,
        ts: msg.turnState === 'awaiting_swing' ? 1 : msg.turnState === 'game_over' ? 2 : 0,
        bs: msg.batterSide === 'R' ? 1 : 0,
        cm: packMatch(msg.match as MatchState),
        sc: msg.spectators,
        ...(msg.batterSides && typeof msg.batterSides === 'object'
          ? {
              bss: [
                (msg.batterSides as { away?: string }).away === 'R' ? 1 : 0,
                (msg.batterSides as { home?: string }).home === 'R' ? 1 : 0,
              ],
            }
          : {}),
      };
      if (msg.activePitch) {
        const ap = msg.activePitch as Record<string, unknown>;
        out.ap = [
          ap.pitchSeq,
          ap.seed,
          encodePitchId(ap.pitchId as PitchId),
          round2(Number(ap.speedKmh)),
          round3(Number(ap.targetX)),
          round3(Number(ap.targetY)),
          round3(Number(ap.errorX)),
          round3(Number(ap.errorY)),
          ap.breakCm,
        ];
      }
      return out;
    }
    case 'abs_result':
      return {
        t: 'ab',
        ov: msg.overturned ? 1 : 0,
        tc: msg.trueCall === 'strike' ? 1 : 0,
        uc: msg.umpireCall === 'strike' ? 1 : 0,
        mc: round2(Number(msg.marginCm)),
        px: round3(Number(msg.plateX)),
        py: round3(Number(msg.plateY)),
        cs: msg.challengerSide === 'home' ? 1 : 0,
        q: msg.pitchSeq,
        ...(msg.outcome ? { ao: msg.outcome } : {}),
        ...(msg.wildKind ? { awk: msg.wildKind === 'passed_ball' ? 2 : 1 } : {}),
        cm: packMatch(msg.match as MatchState, { delta: true }),
      };
    case 'match_over':
      return {
        t: 'mo',
        w: msg.winner,
        rs: msg.reason,
        cm: packMatch(msg.match as MatchState, { delta: true }),
      };
    case 'session_status':
      return {
        t: 'scs',
        ok: msg.active ? 1 : 0,
        ...(msg.alreadyActive ? { aa: 1 } : {}),
        ...(msg.code ? { c: msg.code } : {}),
        ...(msg.roomKind ? { rk: msg.roomKind === 'friend' ? 1 : 0 } : {}),
        ...(typeof msg.opponentName === 'string' && msg.opponentName ? { opp: msg.opponentName } : {}),
        ...(typeof msg.remainingSec === 'number' ? { rem: Math.max(0, Math.round(msg.remainingSec)) } : {}),
        ...(msg.waiting ? { wt: 1 } : {}),
      };
    case 'emote':
      return {
        t: 'em',
        s: msg.side === 'home' ? 1 : msg.side === 'away' ? 0 : 2,
        e: msg.id,
        ...(typeof msg.senderName === 'string' && msg.senderName ? { n: msg.senderName } : {}),
      };
    case 'pause_state':
      return {
        t: 'mp',
        sd: Array.isArray(msg.pausedSides)
          ? (msg.pausedSides as string[]).map((s) => (s === 'home' ? 1 : 0))
          : [],
        sec: typeof msg.remainingSec === 'number' ? msg.remainingSec : 0,
      };
    case 'spectator_count':
      return {
        t: 'sc',
        n: typeof msg.count === 'number' ? msg.count : 0,
      };
    case 'match_offer':
      return {
        t: 'of',
        id: msg.offerId,
        n: msg.opponentName,
        m: msg.mode === 'official6' ? 1 : 0,
        ts: typeof msg.timeoutSec === 'number' ? msg.timeoutSec : 20,
      };
    case 'offer_cancelled':
      return {
        t: 'ox',
        id: msg.offerId,
        r: msg.reason,
      };
    case 'error':
      return {
        t: 'er',
        c: msg.code,
        m: msg.message,
        ...(msg.load ? { l: encodeLoad(msg.load as ServerLoadStatus) } : {}),
      };
    default:
      return msg;
  }
}

/**
 * Decode compact v2 OR legacy verbose server-to-client message into canonical ServerMessage shape.
 */
export function decodeServerMsg(
  raw: Record<string, unknown>,
  ctx?: CompactMatchDecodeContext,
): Record<string, unknown> {
  if (typeof raw.type === 'string') return raw;
  const decodeTurn = (v: unknown) =>
    v === 1 ? 'awaiting_swing' : v === 2 ? 'game_over' : 'awaiting_pitch';
  const decodeAp = (ap: unknown) => {
    if (!Array.isArray(ap)) return null;
    return {
      pitchSeq: ap[0],
      seed: ap[1],
      pitchId: decodePitchId(ap[2]),
      speedKmh: ap[3],
      targetX: ap[4],
      targetY: ap[5],
      errorX: ap[6],
      errorY: ap[7],
      breakCm: ap[8],
    };
  };

  switch (raw.t) {
    case 'p':
      return { type: 'ping', t: raw.n };
    case 'po':
      return { type: 'pong', t: raw.n };
    case 'st':
      return {
        type: 'stats',
        stats: {
          online: raw.o,
          rooms: raw.r,
          queued: raw.q,
          load: decodeLoad(raw.l),
          lagMs: raw.lg ?? 0,
        },
      };
    case 'w':
      return {
        type: 'welcome',
        clientId: raw.id,
        name: raw.n,
        version: raw.v ?? null,
        updateAtMs: typeof raw.ua === 'number' ? raw.ua : null,
        stats: {
          online: raw.o,
          rooms: raw.r,
          queued: raw.q,
          load: decodeLoad(raw.l),
          lagMs: raw.lg ?? 0,
        },
      };
    case 'pl':
      return {
        type: 'pitch_launch',
        pitchSeq: raw.q,
        seed: raw.sd,
        pitchId: decodePitchId(raw.p),
        speedKmh: raw.v,
        targetX: raw.x,
        targetY: raw.y,
        errorX: raw.ex ?? 0,
        errorY: raw.ey ?? 0,
        batterSide: raw.s === 1 ? 'R' : 'L',
        breakCm: raw.b,
      };
    case 'pr': {
      const r = raw.r as Record<string, unknown> | undefined;
      let resolution: Record<string, unknown> | null = null;
      if (r && r.c === 0) {
        resolution = {
          contact: false,
          label: r.lb,
          feedback: r.fb ?? r.lb,
          detail: r.dt,
          color: r.cl,
          quality: 'weak',
          dtTiming: r.tm,
          hitField: r.hf,
        };
      } else if (r) {
        const bp = r.bp as number[];
        const ci = r.ci as number | number[];
        const decodeFielderId = (code: number): 'LF' | 'RF' | 'P' | 'C' =>
          code === 1 ? 'RF' : code === 2 ? 'P' : code === 3 ? 'C' : 'LF';
        const isBlocked = Array.isArray(ci) && ci[4] === 1;
        const wirePos =
          Array.isArray(ci) && ci.length >= 8
            ? ([ci[5], ci[6], ci[7]] as [number, number, number])
            : null;
        const catchInfo =
          Array.isArray(ci)
            ? {
                caught: ci[0] === 1,
                bobbled: ci[1] === 1,
                blocked: isBlocked,
                fielderId: decodeFielderId(ci[2]),
                catchTimeSec: !isBlocked && ci[3] >= 0 ? ci[3] : null,
                catchPos: !isBlocked ? wirePos : null,
                blockTimeSec: isBlocked && ci[3] >= 0 ? ci[3] : null,
                blockPos: isBlocked ? wirePos : null,
              }
            : {
                caught: false,
                bobbled: false,
                blocked: false,
                fielderId: null,
                catchTimeSec: null,
                catchPos: null,
                blockTimeSec: null,
                blockPos: null,
              };
        resolution = {
          contact: true,
          label: r.lb,
          feedback: r.fb ?? r.lb,
          detail: r.dt,
          color: r.cl,
          quality: r.ql,
          dtTiming: r.tm,
          hitField: r.hf,
          battedParams: {
            position: [bp[0], bp[1], bp[2]],
            velocity: [bp[3], bp[4], bp[5]],
            seed: bp[6],
          },
          catchInfo,
          outcome: r.oc ?? raw.oc,
          exitSpeedKmh: r.ev,
          ...(typeof r.la === 'number' ? { launchAngleDeg: r.la } : {}),
          distanceM: r.dm,
        };
      }
      const coArr = raw.co as unknown[];
      const callout =
        coArr.length === 3
          ? { title: String(coArr[0]), subtitle: String(coArr[0]), color: String(coArr[1]), ttl: Number(coArr[2]) }
          : { title: String(coArr[0]), subtitle: String(coArr[1]), color: String(coArr[2]), ttl: Number(coArr[3]) };
      const sdArr = Array.isArray(raw.sd) ? (raw.sd as number[]) : null;
      const pitchSeq = Number(raw.q);
      return {
        type: 'pitch_result',
        pitchSeq,
        nextPitchSeq: typeof raw.nq === 'number' ? raw.nq : pitchSeq + 1,
        swung: raw.sw === 1,
        ibb: raw.ib === 1,
        clockViolation: raw.cv === 1,
        swingData: sdArr
          ? {
              flightTimeSec: sdArr[0],
              batX: sdArr[1],
              batY: sdArr[2],
              swingMode: sdArr[3] === 1 ? 'power' : 'normal',
              batterSide: sdArr[4] === 1 ? 'R' : 'L',
            }
          : null,
        resolution,
        outcome: raw.oc,
        callout,
        inningChanged: raw.ic === 1,
        telemetry: raw.tl,
        ...(Array.isArray(raw.pp) ? { platePos: raw.pp } : {}),
        match: unpackMatch(raw.cm as CompactMatch, ctx),
      };
    }
    case 'ms':
    case 'ss': {
      const match = unpackMatch(raw.cm as CompactMatch, ctx);
      const bss = Array.isArray(raw.bss) ? (raw.bss as number[]) : null;
      return {
        type: raw.t === 'ms' ? 'match_start' : 'state_sync',
        code: raw.c,
        mode: raw.m === 1 ? 'official6' : 'quick3',
        roomKind: raw.rk === 1 ? 'friend' : 'live',
        side: raw.sd === 1 ? 'home' : 'away',
        token: raw.k,
        pitchSeq: raw.q,
        turnState: decodeTurn(raw.ts),
        batterSide: raw.bs === 1 ? 'R' : 'L',
        ...(bss
          ? { batterSides: { away: bss[0] === 1 ? 'R' : 'L', home: bss[1] === 1 ? 'R' : 'L' } }
          : {}),
        match,
        names: raw.nm ?? { home: match.home.name, away: match.away.name },
        activePitch: decodeAp(raw.ap),
        rtt: raw.rt ?? 0,
        spectators: typeof raw.sc === 'number' ? raw.sc : 0,
      };
    }
    case 'sp': {
      const match = unpackMatch(raw.cm as CompactMatch, ctx);
      const bss = Array.isArray(raw.bss) ? (raw.bss as number[]) : null;
      return {
        type: 'spectate_sync',
        code: raw.c,
        mode: raw.m === 1 ? 'official6' : 'quick3',
        roomKind: raw.rk === 1 ? 'friend' : 'live',
        awayName: match.away.name,
        homeName: match.home.name,
        match,
        pitchSeq: raw.q,
        turnState: decodeTurn(raw.ts),
        batterSide: raw.bs === 1 ? 'R' : 'L',
        ...(bss
          ? { batterSides: { away: bss[0] === 1 ? 'R' : 'L', home: bss[1] === 1 ? 'R' : 'L' } }
          : {}),
        activePitch: decodeAp(raw.ap),
        spectators: raw.sc ?? 0,
      };
    }
    case 'ab':
      return {
        type: 'abs_result',
        overturned: raw.ov === 1,
        trueCall: raw.tc === 1 ? 'strike' : 'ball',
        umpireCall: raw.uc === 1 ? 'strike' : 'ball',
        marginCm: raw.mc,
        plateX: raw.px,
        plateY: raw.py,
        challengerSide: raw.cs === 1 ? 'home' : 'away',
        pitchSeq: raw.q,
        ...(raw.ao ? { outcome: raw.ao } : {}),
        ...(raw.awk ? { wildKind: raw.awk === 2 ? 'passed_ball' : 'wild_pitch' } : {}),
        match: unpackMatch(raw.cm as CompactMatch, ctx),
      };
    case 'mo':
      return {
        type: 'match_over',
        winner: raw.w,
        reason: raw.rs,
        match: unpackMatch(raw.cm as CompactMatch, ctx),
      };
    case 'scs':
      return {
        type: 'session_status',
        active: raw.ok === 1,
        ...(raw.aa === 1 ? { alreadyActive: true } : {}),
        code: typeof raw.c === 'string' ? raw.c : '',
        roomKind: raw.rk === 1 ? 'friend' : 'live',
        opponentName: typeof raw.opp === 'string' ? raw.opp : '',
        remainingSec: typeof raw.rem === 'number' ? raw.rem : 0,
        waiting: raw.wt === 1,
      };
    case 'em':
      return {
        type: 'emote',
        side: raw.s === 1 ? 'home' : raw.s === 0 ? 'away' : 'spectator',
        id: raw.e,
        ...(typeof raw.n === 'string' ? { senderName: raw.n } : {}),
      };
    case 'mp':
      return {
        type: 'pause_state',
        pausedSides: Array.isArray(raw.sd) ? raw.sd.map((v) => (v === 1 ? 'home' : 'away')) : [],
        remainingSec: typeof raw.sec === 'number' ? raw.sec : 0,
      };
    case 'sc':
      return {
        type: 'spectator_count',
        count: typeof raw.n === 'number' ? raw.n : 0,
      };
    case 'of':
      return {
        type: 'match_offer',
        offerId: raw.id,
        opponentName: raw.n,
        mode: raw.m === 1 ? 'official6' : 'quick3',
        timeoutSec: typeof raw.ts === 'number' ? raw.ts : 20,
      };
    case 'ox':
      return {
        type: 'offer_cancelled',
        offerId: raw.id,
        reason: raw.r,
      };
    case 'er':
      return {
        type: 'error',
        code: raw.c,
        message: raw.m,
        ...(raw.l !== undefined ? { load: decodeLoad(raw.l) } : {}),
      };
    default:
      return raw;
  }
}
