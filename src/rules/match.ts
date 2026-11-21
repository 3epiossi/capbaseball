/**
 * Complete 2025-02 Cap Baseball Match State Machine.
 */
import type { BattedCapResult } from '../physics/batted';
import {
  judgeBattedCap,
  judgePitch,
  type BattedOutcome,
  type PitchJudgeInput,
} from './judge';

export type GameMode =
  | 'official6'
  | 'quick3'
  | 'practice_bat'
  | 'practice_pitch'
  | 'hotseat2p';

export type Position = 'P' | 'C' | 'LF' | 'RF' | 'DH';

export interface PlayerSlot {
  id: string;
  name: string;
  position: Position;
}

export interface TeamState {
  name: string;
  lineup: PlayerSlot[];
  batterIndex: number;
  runsByInning: number[];
  totalRuns: number;
  hits: number;
  walks: number;
  strikeouts: number;
  pitchesThrown: number;
}

export type HalfInning = 'top' | 'bottom';

export interface MatchStats {
  totalPitches: number;
  homeRuns: number;
  wildPitches: number;
  uncaughtThirdStrikes: number;
}

export interface AbsPreSnapshot {
  balls: number;
  strikes: number;
  outs: number;
  inning: number;
  half: HalfInning;
  bases: [string | null, string | null, string | null];
  awayRuns: number;
  homeRuns: number;
  awayBatterIdx: number;
  homeBatterIdx: number;
  awayWalks: number;
  homeWalks: number;
  awayStrikeouts: number;
  homeStrikeouts: number;
  isGameOver: boolean;
  winner: 'away' | 'home' | 'tie' | null;
}

export interface AbsChallengeRecord {
  pitchSeq: number;
  plateX: number;
  plateY: number;
  trueCall: 'strike' | 'ball';
  umpireCall: 'strike' | 'ball';
  marginCm: number;
  challenged: boolean;
  eligibleSide: 'away' | 'home';
  caughtByCatcher?: boolean;
  reachesPassLine?: boolean;
  preSnapshot: AbsPreSnapshot;
}

export interface DerbyState {
  active: boolean;
  round: number;
  half: 'away' | 'home';
  pitchesPerSide: number;
  awayPitchesLeft: number;
  homePitchesLeft: number;
  awayHR: number;
  homeHR: number;
}

export interface MatchState {
  mode: GameMode;
  regulationInnings: number;
  inning: number;
  half: HalfInning;
  balls: number;
  strikes: number;
  outs: number;
  /** Bases [1B, 2B, 3B]: null if empty, or runner's player ID */
  bases: [string | null, string | null, string | null];
  away: TeamState;
  home: TeamState;
  isGameOver: boolean;
  winner: 'away' | 'home' | 'tie' | null;
  lastEvent: string;
  stats: MatchStats;
  /** Batters faced in the current half-inning (for rule 5.01D checks) */
  plateAppearancesInHalf: number;
  maxBattersPerInning: number;
  absChallenges: { away: number; home: number };
  lastChallenge: AbsChallengeRecord | null;
  derby: DerbyState;
}

const DEFAULT_POSITIONS: Position[] = ['P', 'C', 'LF', 'RF', 'DH'];

function makeDefaultLineup(prefix: string): PlayerSlot[] {
  return DEFAULT_POSITIONS.map((pos, idx) => ({
    id: `${prefix}-${idx + 1}`,
    name: `${prefix.toUpperCase()} #${idx + 1} (${pos})`,
    position: pos,
  }));
}

function makeTeam(name: string, prefix: string, lineup?: PlayerSlot[]): TeamState {
  return {
    name,
    lineup: lineup && lineup.length === 5 ? lineup : makeDefaultLineup(prefix),
    batterIndex: 0,
    runsByInning: [],
    totalRuns: 0,
    hits: 0,
    walks: 0,
    strikeouts: 0,
    pitchesThrown: 0,
  };
}

export function createMatch(
  mode: GameMode = 'official6',
  options?: {
    awayName?: string;
    homeName?: string;
    awayLineup?: PlayerSlot[];
    homeLineup?: PlayerSlot[];
    maxBattersPerInning?: number;
  },
): MatchState {
  const regulationInnings = mode === 'quick3' ? 3 : 6;
  return {
    mode,
    regulationInnings,
    inning: 1,
    half: 'top',
    balls: 0,
    strikes: 0,
    outs: 0,
    bases: [null, null, null],
    away: makeTeam(options?.awayName ?? 'Away', 'away', options?.awayLineup),
    home: makeTeam(options?.homeName ?? 'Home', 'home', options?.homeLineup),
    isGameOver: false,
    winner: null,
    lastEvent: 'Play ball!',
    stats: {
      totalPitches: 0,
      homeRuns: 0,
      wildPitches: 0,
      uncaughtThirdStrikes: 0,
    },
    plateAppearancesInHalf: 0,
    maxBattersPerInning: options?.maxBattersPerInning ?? 99,
    absChallenges: { away: 2, home: 2 },
    lastChallenge: null,
    derby: {
      active: false,
      round: 0,
      half: 'away',
      pitchesPerSide: 5,
      awayPitchesLeft: 0,
      homePitchesLeft: 0,
      awayHR: 0,
      homeHR: 0,
    },
  };
}

export function getBattingTeam(state: MatchState): TeamState {
  return state.half === 'top' ? state.away : state.home;
}

export function getFieldingTeam(state: MatchState): TeamState {
  return state.half === 'top' ? state.home : state.away;
}

export function getCurrentBatter(state: MatchState): PlayerSlot {
  const team = getBattingTeam(state);
  return team.lineup[team.batterIndex % team.lineup.length];
}

function addRuns(state: MatchState, count: number): void {
  if (count <= 0) return;
  const team = getBattingTeam(state);
  while (team.runsByInning.length < state.inning) {
    team.runsByInning.push(0);
  }
  team.runsByInning[state.inning - 1] += count;
  team.totalRuns += count;
}

function ensureInningSlot(team: TeamState, inning: number): void {
  while (team.runsByInning.length < inning) {
    team.runsByInning.push(0);
  }
}

function advanceBatter(state: MatchState): void {
  const team = getBattingTeam(state);
  team.batterIndex = (team.batterIndex + 1) % team.lineup.length;
  state.balls = 0;
  state.strikes = 0;
  state.plateAppearancesInHalf += 1;
  if (state.mode === 'practice_bat' || state.mode === 'practice_pitch') {
    state.absChallenges.away = 2;
    state.absChallenges.home = 2;
  }
}

/**
 * Rule 5.07(C) walk / uncaught 3rd strike: forces only occupied chain from 1B.
 */
function advanceForcedChain(state: MatchState, batterId: string): number {
  let runs = 0;
  const [b1, b2, b3] = state.bases;
  if (b1 !== null) {
    if (b2 !== null) {
      if (b3 !== null) {
        runs += 1;
      }
      state.bases[2] = b2;
    }
    state.bases[1] = b1;
  }
  state.bases[0] = batterId;
  addRuns(state, runs);
  return runs;
}

/**
 * Rule 5.07(C) hit: advances batter & all runners by N bases (1..4).
 */
function advanceOnHit(state: MatchState, batterId: string, basesCount: 1 | 2 | 3 | 4): number {
  let runs = 0;
  const next: [string | null, string | null, string | null] = [null, null, null];

  for (let i = 2; i >= 0; i--) {
    const runner = state.bases[i];
    if (runner === null) continue;
    const target = i + basesCount;
    if (target >= 3) {
      runs += 1;
    } else {
      next[target] = runner;
    }
  }

  if (basesCount === 4) {
    runs += 1;
  } else {
    next[basesCount - 1] = batterId;
  }

  state.bases = next;
  addRuns(state, runs);
  return runs;
}

/**
 * Wild pitch / passed ball: advances all runners 1 base.
 */
function advanceAllRunnersOneBase(state: MatchState): number {
  let runs = 0;
  if (state.bases[2] !== null) {
    runs += 1;
  }
  state.bases = [null, state.bases[0], state.bases[1]];
  addRuns(state, runs);
  return runs;
}

function checkWalkOff(state: MatchState): boolean {
  if (
    state.mode !== 'practice_bat' &&
    state.mode !== 'practice_pitch' &&
    state.inning >= state.regulationInnings &&
    state.half === 'bottom' &&
    state.home.totalRuns > state.away.totalRuns
  ) {
    state.isGameOver = true;
    state.winner = 'home';
    return true;
  }
  return false;
}

function transitionHalfInning(state: MatchState): void {
  ensureInningSlot(getBattingTeam(state), state.inning);
  state.balls = 0;
  state.strikes = 0;
  state.outs = 0;
  state.bases = [null, null, null];
  state.plateAppearancesInHalf = 0;

  if (state.mode === 'practice_bat' || state.mode === 'practice_pitch') {
    // Practice modes loop endlessly without ending the game
    state.inning += 1;
    return;
  }

  if (state.half === 'top') {
    // If home is already ahead after top of final/extra inning, game over!
    if (state.inning >= state.regulationInnings && state.home.totalRuns > state.away.totalRuns) {
      state.isGameOver = true;
      state.winner = 'home';
      state.lastEvent = `Game over! ${state.home.name} wins ${state.home.totalRuns}-${state.away.totalRuns}`;
      return;
    }
    state.half = 'bottom';
  } else {
    if (state.inning >= state.regulationInnings && state.away.totalRuns !== state.home.totalRuns) {
      state.isGameOver = true;
      state.winner = state.home.totalRuns > state.away.totalRuns ? 'home' : 'away';
      state.lastEvent = `Game over! Final ${state.away.totalRuns}-${state.home.totalRuns}`;
      return;
    }
    // In 3-inning mode, if still tied after completing the 4th-inning bases-loaded tie-breaker, enter MLB All-Star HR Derby
    if (
      state.regulationInnings === 3 &&
      state.inning >= state.regulationInnings + 1 &&
      state.away.totalRuns === state.home.totalRuns
    ) {
      state.derby = {
        active: true,
        round: 1,
        half: 'away',
        pitchesPerSide: 5,
        awayPitchesLeft: 5,
        homePitchesLeft: 5,
        awayHR: 0,
        homeHR: 0,
      };
      state.half = 'top';
      state.lastEvent = 'Tie-breaker tied! Entering MLB All-Star 5-Pitch Home Run Derby!';
      return;
    }
    state.inning += 1;
    state.half = 'top';
  }

  // Extra-inning tie-breaker per rule 7.01(A)(3) note: 1 out, bases loaded!
  if (state.inning > state.regulationInnings) {
    const team = getBattingTeam(state);
    const len = team.lineup.length;
    const cur = team.batterIndex % len;
    state.outs = 1;
    state.bases = [
      team.lineup[(cur - 1 + len) % len].id,
      team.lineup[(cur - 2 + len) % len].id,
      team.lineup[(cur - 3 + len) % len].id,
    ];
    state.lastEvent = `Extra inning ${state.inning} (${state.half}): Tie-breaker 1 out, bases loaded`;
  }
}

function recordOut(state: MatchState, reason: string): void {
  state.outs += 1;
  advanceBatter(state);
  state.lastEvent = reason;
  if (state.outs >= 3) {
    transitionHalfInning(state);
  }
}

/**
 * Apply a pitch outcome (ball, strike, uncaught 3rd strike, or wild pitch).
 * For contacted pitches, call `applyBattedOutcome` after simulating the batted cap.
 */
export function applyPitchResult(
  state: MatchState,
  input: Omit<PitchJudgeInput, 'currentStrikes' | 'runnersOnBase'>,
): void {
  if (state.isGameOver) return;

  const runnersOnBase = state.bases.some((b) => b !== null);
  const result = judgePitch({
    ...input,
    currentStrikes: state.strikes,
    runnersOnBase,
  });

  state.stats.totalPitches += 1;
  getFieldingTeam(state).pitchesThrown += 1;

  if (result.call === 'IN_PLAY') {
    state.lastEvent = 'Ball in play';
    return;
  }

  const batter = getCurrentBatter(state);
  const battingTeam = getBattingTeam(state);

  if (result.isWildPitch) {
    state.stats.wildPitches += 1;
    advanceAllRunnersOneBase(state);
  }

  if (result.call === 'UNCAUGHT_THIRD_STRIKE') {
    state.stats.uncaughtThirdStrikes += 1;
    battingTeam.strikeouts += 1;
    advanceForcedChain(state, batter.id);
    advanceBatter(state);
    state.lastEvent = `${batter.name} reaches 1B on uncaught 3rd strike!`;
    checkWalkOff(state);
    return;
  }

  if (result.isStrike) {
    state.strikes += 1;
    if (state.strikes >= 3) {
      battingTeam.strikeouts += 1;
      recordOut(state, `${batter.name} strikes out`);
    } else {
      state.lastEvent = result.isWildPitch ? 'Strike + Wild Pitch!' : 'Strike';
      checkWalkOff(state);
    }
    return;
  }

  // Ball
  state.balls += 1;
  if (state.balls >= 4) {
    battingTeam.walks += 1;
    advanceForcedChain(state, batter.id);
    advanceBatter(state);
    state.lastEvent = `${batter.name} walks`;
    checkWalkOff(state);
  } else {
    state.lastEvent = result.isWildPitch ? 'Ball + Wild Pitch!' : 'Ball';
    checkWalkOff(state);
  }
}

/**
 * Apply a batted cap simulation result (or explicit outcome) to the match state.
 */
export function applyBattedOutcome(
  state: MatchState,
  simOrOutcome: BattedCapResult | BattedOutcome,
  options?: { caughtInAir?: boolean },
): BattedOutcome {
  if (state.isGameOver) return 'OUT';

  const outcome: BattedOutcome =
    typeof simOrOutcome === 'string'
      ? simOrOutcome
      : judgeBattedCap(simOrOutcome, options);

  const batter = getCurrentBatter(state);
  const battingTeam = getBattingTeam(state);

  if (outcome === 'FOUL') {
    // Foul ball caps strikes at 2 (5.06 A)
    if (state.strikes < 2) {
      state.strikes += 1;
    }
    state.lastEvent = 'Foul ball';
    return outcome;
  }

  if (outcome === 'OUT') {
    recordOut(state, `${batter.name} out`);
    return outcome;
  }

  const basesMap: Record<'1B' | '2B' | '3B' | 'HR', 1 | 2 | 3 | 4> = {
    '1B': 1,
    '2B': 2,
    '3B': 3,
    HR: 4,
  };
  const n = basesMap[outcome];
  battingTeam.hits += 1;
  if (outcome === 'HR') {
    state.stats.homeRuns += 1;
  }
  const runs = advanceOnHit(state, batter.id, n);
  advanceBatter(state);
  state.lastEvent =
    runs > 0
      ? `${batter.name} hits ${outcome}! (${runs} RBI)`
      : `${batter.name} hits ${outcome}!`;
  checkWalkOff(state);
  return outcome;
}

/**
 * Rule 5.01(D): Intentional walk (敬遠).
 * Disallowed if it would be game-ending (walk-off) or exceeds max batters in the inning.
 */
export function canIntentionalWalk(state: MatchState): boolean {
  if (state.isGameOver) return false;
  if (state.plateAppearancesInHalf + 1 >= state.maxBattersPerInning) {
    return false;
  }
  // Would a walk force in the game-ending run?
  const basesLoaded =
    state.bases[0] !== null && state.bases[1] !== null && state.bases[2] !== null;
  const isWalkOff =
    state.inning >= state.regulationInnings &&
    state.half === 'bottom' &&
    state.home.totalRuns === state.away.totalRuns &&
    basesLoaded;
  return !isWalkOff;
}

export function applyIntentionalWalk(state: MatchState): boolean {
  if (!canIntentionalWalk(state)) return false;
  const batter = getCurrentBatter(state);
  getBattingTeam(state).walks += 1;
  advanceForcedChain(state, batter.id);
  advanceBatter(state);
  state.lastEvent = `${batter.name} intentionally walked`;
  checkWalkOff(state);
  return true;
}

/** Official Pitch Clock duration: 15s bases empty (or HR Derby), 20s with runners on base. */
export function getPitchClockSeconds(state: MatchState): number {
  if (state.derby.active) return 15;
  return state.bases.some((b) => b !== null) ? 20 : 15;
}

/** Apply a pitcher Pitch Clock violation: automatic ball (or walk on ball 4; forfeited pitch in HR Derby). */
export function applyPitchClockViolation(state: MatchState): { applied: boolean; walked: boolean } {
  if (state.isGameOver) return { applied: false, walked: false };
  state.lastChallenge = null;
  if (state.derby.active) {
    applyDerbySwingResult(state, false);
    state.lastEvent = 'Pitch clock violation (Derby pitch forfeited)';
    return { applied: true, walked: false };
  }
  const batter = getCurrentBatter(state);
  state.balls += 1;
  if (state.balls >= 4) {
    getBattingTeam(state).walks += 1;
    advanceForcedChain(state, batter.id);
    advanceBatter(state);
    state.lastEvent = `${batter.name} walks on pitch clock violation`;
    checkWalkOff(state);
    return { applied: true, walked: true };
  }
  state.lastEvent = `Pitch clock violation — automatic ball (${state.balls}-${state.strikes})`;
  return { applied: true, walked: false };
}

export function captureAbsPreSnapshot(state: MatchState): AbsPreSnapshot {
  return {
    balls: state.balls,
    strikes: state.strikes,
    outs: state.outs,
    inning: state.inning,
    half: state.half,
    bases: [...state.bases] as [string | null, string | null, string | null],
    awayRuns: state.away.totalRuns,
    homeRuns: state.home.totalRuns,
    awayBatterIdx: state.away.batterIndex,
    homeBatterIdx: state.home.batterIndex,
    awayWalks: state.away.walks,
    homeWalks: state.home.walks,
    awayStrikeouts: state.away.strikeouts,
    homeStrikeouts: state.home.strikeouts,
    isGameOver: state.isGameOver,
    winner: state.winner,
  };
}

export function recordChallengeableCall(
  state: MatchState,
  info: {
    pitchSeq: number;
    plateX: number;
    plateY: number;
    trueCall: 'strike' | 'ball';
    umpireCall: 'strike' | 'ball';
    marginM: number;
    preSnapshot: AbsPreSnapshot;
    caughtByCatcher?: boolean;
    reachesPassLine?: boolean;
  },
): void {
  const battingSide: 'away' | 'home' = info.preSnapshot.half === 'top' ? 'away' : 'home';
  const pitchingSide: 'away' | 'home' = info.preSnapshot.half === 'top' ? 'home' : 'away';
  const eligibleSide = info.umpireCall === 'strike' ? battingSide : pitchingSide;
  state.lastChallenge = {
    pitchSeq: info.pitchSeq,
    plateX: info.plateX,
    plateY: info.plateY,
    trueCall: info.trueCall,
    umpireCall: info.umpireCall,
    marginCm: Math.round(info.marginM * 1000) / 10,
    challenged: false,
    eligibleSide,
    caughtByCatcher: info.caughtByCatcher,
    reachesPassLine: info.reachesPassLine,
    preSnapshot: info.preSnapshot,
  };
}

export interface AbsChallengeResult {
  ok: boolean;
  overturned: boolean;
  trueCall: 'strike' | 'ball';
  umpireCall: 'strike' | 'ball';
  marginCm: number;
  plateX: number;
  plateY: number;
  challengerSide: 'away' | 'home';
}

export function applyAbsChallenge(
  state: MatchState,
  challengerSide: 'away' | 'home',
): AbsChallengeResult {
  const lc = state.lastChallenge;
  if (
    !lc ||
    lc.challenged ||
    lc.eligibleSide !== challengerSide ||
    state.absChallenges[challengerSide] <= 0
  ) {
    return {
      ok: false,
      overturned: false,
      trueCall: lc?.trueCall ?? 'ball',
      umpireCall: lc?.umpireCall ?? 'ball',
      marginCm: lc?.marginCm ?? 0,
      plateX: lc?.plateX ?? 0,
      plateY: lc?.plateY ?? 0,
      challengerSide,
    };
  }

  lc.challenged = true;
  const overturned = lc.trueCall !== lc.umpireCall;

  if (overturned) {
    const snap = lc.preSnapshot;
    const awayDelta = state.away.totalRuns - snap.awayRuns;
    const homeDelta = state.home.totalRuns - snap.homeRuns;

    state.balls = snap.balls;
    state.strikes = snap.strikes;
    state.outs = snap.outs;
    state.inning = snap.inning;
    state.half = snap.half;
    state.bases = [...snap.bases] as [string | null, string | null, string | null];
    state.away.totalRuns = snap.awayRuns;
    state.home.totalRuns = snap.homeRuns;
    if (awayDelta > 0 && state.away.runsByInning.length >= snap.inning) {
      state.away.runsByInning[snap.inning - 1] = Math.max(
        0,
        state.away.runsByInning[snap.inning - 1] - awayDelta,
      );
    }
    if (homeDelta > 0 && state.home.runsByInning.length >= snap.inning) {
      state.home.runsByInning[snap.inning - 1] = Math.max(
        0,
        state.home.runsByInning[snap.inning - 1] - homeDelta,
      );
    }
    state.away.batterIndex = snap.awayBatterIdx;
    state.home.batterIndex = snap.homeBatterIdx;
    state.away.walks = snap.awayWalks;
    state.home.walks = snap.homeWalks;
    state.away.strikeouts = snap.awayStrikeouts;
    state.home.strikeouts = snap.homeStrikeouts;
    state.isGameOver = snap.isGameOver;
    state.winner = snap.winner;

    // Avoid double-counting pitch stats when re-applying the true call
    state.stats.totalPitches = Math.max(0, state.stats.totalPitches - 1);
    const fieldingTeam = getFieldingTeam(state);
    fieldingTeam.pitchesThrown = Math.max(0, fieldingTeam.pitchesThrown - 1);

    applyPitchResult(state, {
      plateX: lc.plateX,
      plateY: lc.plateY,
      swung: false,
      contacted: false,
      caughtByCatcher: lc.caughtByCatcher ?? true,
      reachesPassLine: lc.reachesPassLine ?? false,
      forceCall: lc.trueCall,
    });
    state.lastEvent = `ABS Challenge OVERTURNED! Call changed to ${lc.trueCall.toUpperCase()}`;
  } else {
    state.absChallenges[challengerSide] = Math.max(0, state.absChallenges[challengerSide] - 1);
    state.lastEvent = `ABS Challenge UPHELD (${lc.umpireCall.toUpperCase()}). ${state.absChallenges[challengerSide]} challenge(s) left`;
  }

  return {
    ok: true,
    overturned,
    trueCall: lc.trueCall,
    umpireCall: lc.umpireCall,
    marginCm: lc.marginCm,
    plateX: lc.plateX,
    plateY: lc.plateY,
    challengerSide,
  };
}

export function applyDerbySwingResult(state: MatchState, isHomeRun: boolean): void {
  if (!state.derby.active || state.isGameOver) return;
  const d = state.derby;
  state.stats.totalPitches += 1;
  getFieldingTeam(state).pitchesThrown += 1;

  if (d.half === 'away') {
    if (isHomeRun) {
      d.awayHR += 1;
      state.stats.homeRuns += 1;
      state.lastEvent = `HR Derby (Round ${d.round}): Away hits a HOME RUN! (${d.awayHR}-${d.homeHR})`;
    } else {
      state.lastEvent = `HR Derby (Round ${d.round}): Away no HR (${d.awayHR}-${d.homeHR})`;
    }
    d.awayPitchesLeft = Math.max(0, d.awayPitchesLeft - 1);
    advanceBatter(state);

    if (d.awayPitchesLeft === 0) {
      d.half = 'home';
      state.half = 'bottom';
    }
    return;
  }

  // Home half of HR Derby
  if (isHomeRun) {
    d.homeHR += 1;
    state.stats.homeRuns += 1;
    state.lastEvent = `HR Derby (Round ${d.round}): Home hits a HOME RUN! (${d.awayHR}-${d.homeHR})`;
  } else {
    state.lastEvent = `HR Derby (Round ${d.round}): Home no HR (${d.awayHR}-${d.homeHR})`;
  }
  d.homePitchesLeft = Math.max(0, d.homePitchesLeft - 1);
  advanceBatter(state);

  // Walk-off win for Home
  if (d.homeHR > d.awayHR) {
    state.isGameOver = true;
    state.winner = 'home';
    state.lastEvent = `HR Derby Walk-Off! ${state.home.name} wins ${d.homeHR}-${d.awayHR}!`;
    return;
  }

  // Early clinch for Away (Home cannot catch up)
  if (d.homeHR + d.homePitchesLeft < d.awayHR) {
    state.isGameOver = true;
    state.winner = 'away';
    state.lastEvent = `HR Derby! ${state.away.name} clinches ${d.awayHR}-${d.homeHR}!`;
    return;
  }

  if (d.homePitchesLeft === 0) {
    if (d.awayHR !== d.homeHR) {
      state.isGameOver = true;
      state.winner = d.homeHR > d.awayHR ? 'home' : 'away';
      state.lastEvent = `HR Derby Final! ${d.awayHR}-${d.homeHR}`;
    } else {
      // Sudden death round
      d.round += 1;
      d.pitchesPerSide = 1;
      d.awayPitchesLeft = 1;
      d.homePitchesLeft = 1;
      d.half = 'away';
      state.half = 'top';
      state.lastEvent = `HR Derby Sudden Death Round ${d.round}!`;
    }
  }
}
