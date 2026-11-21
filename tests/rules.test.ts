import { describe, expect, it } from 'vitest';
import { simulateBattedCap, simToField, type BattedCapResult } from '../src/physics/batted';
import {
  evaluateSwingResolution,
  simulateDeterministicCatch,
  type OutfielderInit,
} from '../src/physics/contact';
import { solvePitchTrajectory } from '../src/physics/pitches';
import { createOutfielders, updateOutfielders } from '../src/ai/cpu';
import {
  FENCE_DIST,
  PLATE_WIDTH,
  isFair,
  isInStrikeZone,
  isInfield,
  isOutfield,
  isPastFenceExtension,
} from '../src/rules/field';
import {
  computeStrikeZoneMarginM,
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
  getPitchClockSeconds,
  canIntentionalWalk,
  captureAbsPreSnapshot,
  createMatch,
  recordChallengeableCall,
} from '../src/rules/match';

function makeBattedStub(overrides: Partial<BattedCapResult>): BattedCapResult {
  const bounces = overrides.bounces ?? 1;
  return {
    frames: [],
    flightTimeSec: 1.0,
    bounces,
    bouncesBeforeFence: overrides.bouncesBeforeFence ?? bounces,
    firstLandingPos: [0, 0, -10],
    stoppedPos: [0, 0, -11],
    hitInfield: false,
    hitOutfield: true,
    hitFence: false,
    overFence: false,
    crossedFenceExtension: false,
    maxHeightM: 2.0,
    maxDistanceM: 11.0,
    ...overrides,
  };
}

describe('2025-02 Cap Baseball Rules Engine', () => {
  it('validates field geometry helpers', () => {
    expect(isFair(0, -5)).toBe(true);
    expect(isFair(4, -5)).toBe(true);
    expect(isFair(6, -5)).toBe(false);
    expect(isFair(0, 1)).toBe(false);

    expect(isInfield(0, -5)).toBe(true);
    expect(isInfield(0, -10)).toBe(false);
    expect(isOutfield(0, -10)).toBe(true);
    expect(isOutfield(0, -5)).toBe(false);

    expect(isPastFenceExtension(0, -13.1)).toBe(true);
    expect(isPastFenceExtension(10, -10)).toBe(true); // (10 - (-10))*0.707 = 14.14 >= 13
    expect(isPastFenceExtension(0, -12.0)).toBe(false);

    expect(isInStrikeZone(0, 0.72)).toBe(true);
    expect(isInStrikeZone(0.25, 0.72)).toBe(false);
    expect(isInStrikeZone(0, 0.3)).toBe(false);
  });

  it('judges all batted cap outcomes per rules 5.06 & 5.07', () => {
    // Infield stop = OUT
    expect(
      judgeBattedCap(
        makeBattedStub({
          bounces: 1,
          firstLandingPos: [0, 0, -3],
          stoppedPos: [0, 0, -5],
          hitInfield: true,
          hitOutfield: false,
        }),
      ),
    ).toBe('OUT');

    // Outfield grounder = 1B
    expect(
      judgeBattedCap(
        makeBattedStub({
          bounces: 2,
          firstLandingPos: [1, 0, -6],
          stoppedPos: [2, 0, -11],
          hitInfield: true,
          hitOutfield: true,
        }),
      ),
    ).toBe('1B');

    // Bounce + fence = 2B
    expect(
      judgeBattedCap(
        makeBattedStub({
          bounces: 1,
          hitFence: true,
          firstLandingPos: [0, 0, -10],
          stoppedPos: [0, 0, -FENCE_DIST + 0.1],
        }),
      ),
    ).toBe('2B');

    // Bounce + fence-extension = 2B
    expect(
      judgeBattedCap(
        makeBattedStub({
          bounces: 1,
          crossedFenceExtension: true,
          firstLandingPos: [6, 0, -9],
          stoppedPos: [10, 0, -10],
        }),
      ),
    ).toBe('2B');

    // Fly + fence = 3B
    expect(
      judgeBattedCap(
        makeBattedStub({
          bounces: 0,
          hitFence: true,
          firstLandingPos: [0, 0, -12.5],
          stoppedPos: [0, 0, -12.0],
        }),
      ),
    ).toBe('3B');

    // Fly + over-fence = HR
    const hrSim = simulateBattedCap({
      position: [0, 0.85, -0.2],
      velocity: [0, 8.5, -26.0],
    });
    expect(judgeBattedCap(hrSim)).toBe('HR');

    // Fly catch = OUT
    expect(judgeBattedCap(hrSim, { caughtInAir: true })).toBe('OUT');
  });

  it('caps foul ball strikes at 2 and handles uncaught 3rd strike & wild pitch', () => {
    const match = createMatch('official6');
    applyBattedOutcome(match, 'FOUL');
    expect(match.strikes).toBe(1);
    applyBattedOutcome(match, 'FOUL');
    expect(match.strikes).toBe(2);
    applyBattedOutcome(match, 'FOUL');
    expect(match.strikes).toBe(2); // capped at 2

    // Uncaught 3rd strike at pass line -> batter reaches 1B
    applyPitchResult(match, {
      plateX: 0,
      plateY: 0.72,
      swung: false,
      contacted: false,
      caughtByCatcher: false,
      reachesPassLine: true,
    });
    expect(match.bases[0]).not.toBeNull();
    expect(match.outs).toBe(0);
    expect(match.stats.uncaughtThirdStrikes).toBe(1);

    // Wild pitch advances runner from 1B to 2B
    const wpJudge = judgePitch({
      plateX: 1.0,
      plateY: 0.1,
      swung: false,
      contacted: false,
      caughtByCatcher: false,
      reachesPassLine: true,
      currentStrikes: 0,
      runnersOnBase: true,
    });
    expect(wpJudge.isWildPitch).toBe(true);

    applyPitchResult(match, {
      plateX: 1.0,
      plateY: 0.1,
      swung: false,
      contacted: false,
      caughtByCatcher: false,
      reachesPassLine: true,
    });
    expect(match.bases[0]).toBeNull();
    expect(match.bases[1]).not.toBeNull();
    expect(match.stats.wildPitches).toBe(1);
  });

  it('completes a 6-inning game and triggers extra-inning tie-breaker (1 out, bases loaded)', () => {
    const match = createMatch('official6');

    // Play 6 tied innings (0-0)
    for (let inning = 1; inning <= 6; inning++) {
      expect(match.inning).toBe(inning);
      expect(match.half).toBe('top');
      for (let o = 0; o < 3; o++) applyBattedOutcome(match, 'OUT');
      expect(match.half).toBe('bottom');
      for (let o = 0; o < 3; o++) applyBattedOutcome(match, 'OUT');
    }

    // Now in top of 7th (extra inning): 1 out, bases loaded!
    expect(match.isGameOver).toBe(false);
    expect(match.inning).toBe(7);
    expect(match.half).toBe('top');
    expect(match.outs).toBe(1);
    expect(match.bases.every((b) => b !== null)).toBe(true);

    // Intentional walk is allowed in top of 7th
    expect(canIntentionalWalk(match)).toBe(true);

    // Away fails to score (2 outs)
    applyBattedOutcome(match, 'OUT');
    applyBattedOutcome(match, 'OUT');

    // Bottom of 7th: 1 out, bases loaded, tied 0-0 -> walk-off IBB disallowed per 5.01(D)
    expect(match.half).toBe('bottom');
    expect(match.outs).toBe(1);
    expect(match.bases.every((b) => b !== null)).toBe(true);
    expect(canIntentionalWalk(match)).toBe(false);
    expect(applyIntentionalWalk(match)).toBe(false);

    // Home hits a single to walk it off!
    applyBattedOutcome(match, '1B');
    expect(match.isGameOver).toBe(true);
    expect(match.winner).toBe('home');
    expect(match.home.totalRuns).toBe(1);
  });

  it('enforces weakened outfielder defense rules (exit velocity, launch angle, 3.2m range, deterministic bobbles)', () => {
    const fielders: OutfielderInit[] = [
      { id: 'LF', homePos: [-4.2, 0, -9.8], pos: [-4.2, 0, -9.8] },
      { id: 'RF', homePos: [4.2, 0, -9.8], pos: [4.2, 0, -9.8] },
    ];

    // A reachable fly ball aimed right toward LF (-4.2, 0, -9.8) at ~13 m/s, 28 deg
    const flyAngle = (28 * Math.PI) / 180;
    const flySpd = 13.0;
    const flyDirX = -4.2 / Math.hypot(-4.2, -9.6);
    const flyDirZ = -9.6 / Math.hypot(-4.2, -9.6);
    const reachableFly = simulateBattedCap({
      position: [0, 0.72, -0.22],
      velocity: [
        flySpd * Math.cos(flyAngle) * flyDirX,
        flySpd * Math.sin(flyAngle),
        flySpd * Math.cos(flyAngle) * flyDirZ,
      ],
      seed: 1,
    });

    // 1. High exit velocity (>= 16.5 m/s) cannot be caught
    const rocketCatch = simulateDeterministicCatch(reachableFly, fielders, {
      exitSpeedMs: 16.5,
      launchAngleDeg: 28,
      seed: 1,
    });
    expect(rocketCatch.caught).toBe(false);
    expect(rocketCatch.bobbled).toBe(false);

    // 2. Line drives (LA < 22 deg) cannot be caught
    const linerCatch = simulateDeterministicCatch(reachableFly, fielders, {
      exitSpeedMs: 13.0,
      launchAngleDeg: 20,
      seed: 1,
    });
    expect(linerCatch.caught).toBe(false);
    expect(linerCatch.bobbled).toBe(false);

    // 3. Distant landing (> 2.6m from fielders, e.g. straight center field x=0) cannot be caught
    const centerFly = simulateBattedCap({
      position: [0, 0.72, -0.22],
      velocity: [0, flySpd * Math.sin(flyAngle), -flySpd * Math.cos(flyAngle)],
      seed: 1,
    });
    const centerCatch = simulateDeterministicCatch(centerFly, fielders, {
      exitSpeedMs: 13.0,
      launchAngleDeg: 28,
      seed: 1,
    });
    expect(centerCatch.caught).toBe(false);
    expect(centerCatch.bobbled).toBe(false);

    // 4. Wall-clipping prevention: updateOutfielders strictly clamps r <= FENCE_DIST - 0.55 (12.45m)
    const actors = createOutfielders();
    for (let step = 0; step < 60; step++) {
      updateOutfielders(actors, 0.05, [-6.0, 1.5, -14.0], [-6.0, 0, -14.0], true, false, 1.0);
    }
    for (const f of actors) {
      expect(Math.hypot(f.pos[0], f.pos[2])).toBeLessThanOrEqual(FENCE_DIST - 0.55 + 1e-6);
    }

    // 5. Reachable fly balls have deterministic bobble/drop rate across seeds
    let caughtCount = 0;
    let bobbledCount = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const res = simulateDeterministicCatch(reachableFly, fielders, {
        exitSpeedMs: 13.0,
        launchAngleDeg: 28,
        seed,
      });
      if (res.caught) caughtCount++;
      if (res.bobbled) {
        bobbledCount++;
        expect(res.caught).toBe(false);
        expect(judgeBattedCap(reachableFly, { caughtInAir: res.caught })).not.toBe('OUT');
      }
    }
    expect(caughtCount).toBeGreaterThan(0);
    expect(bobbledCount).toBeGreaterThan(0);
  });

  it('produces foul balls on early/late timing band and PCI-edge grazes instead of pure whiffs', () => {
    const traj = solvePitchTrajectory('straight', 70, 0, 0.72, { seed: 42 });
    const hitField = simToField(traj.hitPlanePos);

    // Early foul band (0.085 < |dt| <= 0.155)
    const earlyFoul = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec - 0.11,
      batX: hitField[0],
      batY: hitField[1],
      swingMode: 'normal',
      batterSide: 'L',
      seed: 101,
    });
    expect(earlyFoul.contact).toBe(true);
    if (earlyFoul.contact) {
      expect(earlyFoul.outcome).toBe('FOUL');
      expect(earlyFoul.label).toBe('EARLY FOUL');
    }

    // Late foul band
    const lateFoul = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec + 0.11,
      batX: hitField[0],
      batY: hitField[1],
      swingMode: 'normal',
      batterSide: 'R',
      seed: 102,
    });
    expect(lateFoul.contact).toBe(true);
    if (lateFoul.contact) {
      expect(lateFoul.outcome).toBe('FOUL');
      expect(lateFoul.label).toBe('LATE FOUL');
    }

    // PCI-edge graze foul (1.0 < radialNorm <= 1.38)
    const grazeFoul = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hitField[0] + 0.13, // meetRadius=0.108 -> radialNorm ~ 1.20
      batY: hitField[1],
      swingMode: 'normal',
      batterSide: 'L',
      seed: 103,
    });
    expect(grazeFoul.contact).toBe(true);
    if (grazeFoul.contact) {
      expect(grazeFoul.outcome).toBe('FOUL');
      expect(grazeFoul.label).toBe('FOUL TIP');
    }
  });

  it('supports ABS challenges in practice_bat and practice_pitch and auto-replenishes on new PA', () => {
    for (const mode of ['practice_bat', 'practice_pitch'] as const) {
      const m = createMatch(mode);
      if (mode === 'practice_bat') m.half = 'bottom';
      const preSnap = captureAbsPreSnapshot(m);
      const forcedCall = mode === 'practice_bat' ? 'strike' : 'ball';
      applyPitchResult(m, {
        plateX: 0.45,
        plateY: 0.72,
        swung: false,
        contacted: false,
        caughtByCatcher: true,
        reachesPassLine: false,
        forceCall: forcedCall,
      });
      recordChallengeableCall(m, {
        pitchSeq: 1,
        plateX: 0.45,
        plateY: 0.72,
        trueCall: forcedCall,
        umpireCall: forcedCall,
        marginM: 0.02,
        preSnapshot: preSnap,
      });
      const res = applyAbsChallenge(m, 'home');
      expect(res.ok).toBe(true);
      expect(m.absChallenges.home).toBe(1);

      // New plate appearance (hit) replenishes ABS challenges back to 2
      applyBattedOutcome(m, '1B');
      expect(m.absChallenges.home).toBe(2);
    }
  });

  it('supports ABS strike-zone margin, human umpire borderline misses, and challenge overturn/upheld', () => {
    // Margin checks (accounting for 0.015m cap radius)
    expect(computeStrikeZoneMarginM(0, 0.72)).toBeLessThan(0);
    expect(computeStrikeZoneMarginM(PLATE_WIDTH * 0.5 + 0.01, 0.72)).toBeLessThanOrEqual(0);
    expect(computeStrikeZoneMarginM(PLATE_WIDTH * 0.5 + 0.03, 0.72)).toBeGreaterThan(0);

    // Non-borderline pitches are never blown
    for (let s = 1; s <= 50; s++) {
      expect(evaluateUmpirePitchCall(0, 0.72, s).blownCall).toBe(false);
      expect(evaluateUmpirePitchCall(0.5, 0.72, s).blownCall).toBe(false);
    }

    // Borderline pitches have ~26% blown calls across seeds
    let blown = 0;
    let blownSeed = -1;
    let cleanSeed = -1;
    for (let s = 1; s <= 200; s++) {
      const ev = evaluateUmpirePitchCall(PLATE_WIDTH * 0.5 + 0.025, 0.72, s);
      if (ev.blownCall) {
        blown++;
        if (blownSeed === -1) blownSeed = s;
      } else if (cleanSeed === -1) {
        cleanSeed = s;
      }
    }
    expect(blown).toBeGreaterThan(25);
    expect(blown).toBeLessThan(80);
    expect(blownSeed).toBeGreaterThan(0);
    expect(cleanSeed).toBeGreaterThan(0);

    // Overturned challenge restores preSnapshot and retains challenge count
    const match = createMatch('quick3');
    expect(match.absChallenges).toEqual({ away: 2, home: 2 });
    match.balls = 3;
    match.strikes = 2;
    match.outs = 2;

    const blownEval = evaluateUmpirePitchCall(PLATE_WIDTH * 0.5 + 0.025, 0.72, blownSeed);
    expect(blownEval.trueCall).toBe('ball');
    expect(blownEval.umpireCall).toBe('strike');
    const preSnap = captureAbsPreSnapshot(match);
    applyPitchResult(match, {
      plateX: PLATE_WIDTH * 0.5 + 0.025,
      plateY: 0.72,
      swung: false,
      contacted: false,
      caughtByCatcher: true,
      reachesPassLine: false,
      forceCall: blownEval.umpireCall,
    });
    // Umpire rung up batter for 3rd out -> inning flipped to bottom 1st
    expect(match.half).toBe('bottom');
    expect(match.outs).toBe(0);

    recordChallengeableCall(match, {
      pitchSeq: 1,
      plateX: PLATE_WIDTH * 0.5 + 0.025,
      plateY: 0.72,
      trueCall: blownEval.trueCall,
      umpireCall: blownEval.umpireCall,
      marginM: blownEval.marginM,
      preSnapshot: preSnap,
      caughtByCatcher: true,
      reachesPassLine: false,
    });

    // Wrong team (home) cannot challenge a called strike against away batter
    expect(applyAbsChallenge(match, 'home').ok).toBe(false);

    // Away batter challenges -> OVERTURNED to Ball 4 walk, stays top 1st with 2 outs, runner on 1B, still 2 challenges!
    const overturn = applyAbsChallenge(match, 'away');
    expect(overturn.ok).toBe(true);
    expect(overturn.overturned).toBe(true);
    expect(match.half).toBe('top');
    expect(match.outs).toBe(2);
    expect(match.bases[0]).not.toBeNull();
    expect(match.away.walks).toBe(1);
    expect(match.absChallenges.away).toBe(2);

    // Upheld challenge deducts 1 challenge
    const cleanEval = evaluateUmpirePitchCall(PLATE_WIDTH * 0.5 + 0.025, 0.72, cleanSeed);
    expect(cleanEval.blownCall).toBe(false);
    expect(cleanEval.umpireCall).toBe('ball');
    const preSnap2 = captureAbsPreSnapshot(match);
    applyPitchResult(match, {
      plateX: PLATE_WIDTH * 0.5 + 0.025,
      plateY: 0.72,
      swung: false,
      contacted: false,
      caughtByCatcher: true,
      reachesPassLine: false,
      forceCall: cleanEval.umpireCall,
    });
    recordChallengeableCall(match, {
      pitchSeq: 2,
      plateX: PLATE_WIDTH * 0.5 + 0.025,
      plateY: 0.72,
      trueCall: cleanEval.trueCall,
      umpireCall: cleanEval.umpireCall,
      marginM: cleanEval.marginM,
      preSnapshot: preSnap2,
    });
    const upheld = applyAbsChallenge(match, 'home');
    expect(upheld.ok).toBe(true);
    expect(upheld.overturned).toBe(false);
    expect(match.absChallenges.home).toBe(1);
  });

  it('escalates quick3 from 3 regulation innings -> 4th bases-loaded tie-breaker -> 5-pitch MLB All-Star HR Derby', () => {
    const match = createMatch('quick3');
    expect(match.regulationInnings).toBe(3);

    // 3 tied innings (0-0)
    for (let inning = 1; inning <= 3; inning++) {
      for (let o = 0; o < 3; o++) applyBattedOutcome(match, 'OUT');
      for (let o = 0; o < 3; o++) applyBattedOutcome(match, 'OUT');
    }

    // 4th inning: bases loaded, 1 out for both top & bottom
    expect(match.inning).toBe(4);
    expect(match.half).toBe('top');
    expect(match.outs).toBe(1);
    expect(match.bases.every((b) => b !== null)).toBe(true);
    applyBattedOutcome(match, 'OUT');
    applyBattedOutcome(match, 'OUT');

    expect(match.half).toBe('bottom');
    expect(match.outs).toBe(1);
    expect(match.bases.every((b) => b !== null)).toBe(true);
    applyBattedOutcome(match, 'OUT');
    applyBattedOutcome(match, 'OUT');

    // Still tied after 4th -> MLB All-Star 5-Pitch HR Derby!
    expect(match.isGameOver).toBe(false);
    expect(match.derby.active).toBe(true);
    expect(match.derby.round).toBe(1);
    expect(match.derby.half).toBe('away');
    expect(match.derby.awayPitchesLeft).toBe(5);
    expect(match.derby.homePitchesLeft).toBe(5);

    // Away hits 2 HRs in 5 swings
    applyDerbySwingResult(match, true);
    applyDerbySwingResult(match, false);
    applyDerbySwingResult(match, true);
    applyDerbySwingResult(match, false);
    applyDerbySwingResult(match, false);
    expect(match.derby.awayHR).toBe(2);
    expect(match.derby.awayPitchesLeft).toBe(0);
    expect(match.derby.half).toBe('home');

    // Home hits 2 HRs in 5 swings -> tied 2-2 -> Sudden Death Round 2!
    applyDerbySwingResult(match, true);
    applyDerbySwingResult(match, false);
    applyDerbySwingResult(match, true);
    applyDerbySwingResult(match, false);
    applyDerbySwingResult(match, false);
    expect(match.isGameOver).toBe(false);
    expect(match.derby.round).toBe(2);
    expect(match.derby.pitchesPerSide).toBe(1);
    expect(match.derby.half).toBe('away');
    expect(match.derby.awayPitchesLeft).toBe(1);
    expect(match.derby.homePitchesLeft).toBe(1);

    // Sudden death: Away hits 0, Home hits HR -> Walk-off win for Home!
    applyDerbySwingResult(match, false);
    expect(match.derby.half).toBe('home');
    applyDerbySwingResult(match, true);
    expect(match.isGameOver).toBe(true);
    expect(match.winner).toBe('home');
  });

  it('enforces Pitch Clock (15s bases empty / 20s runners on base) and walk-off violation walk', () => {
    const match = createMatch('quick3');
    expect(getPitchClockSeconds(match)).toBe(15);

    const v1 = applyPitchClockViolation(match);
    expect(v1.applied).toBe(true);
    expect(v1.walked).toBe(false);
    expect(match.balls).toBe(1);

    applyPitchClockViolation(match);
    applyPitchClockViolation(match);
    const v4 = applyPitchClockViolation(match);
    expect(v4.walked).toBe(true);
    expect(match.balls).toBe(0);
    expect(match.bases[0]).not.toBeNull();
    // Runner on 1B -> clock switches to 20s
    expect(getPitchClockSeconds(match)).toBe(20);

    // Bases loaded, bottom of 3rd tied, 3 balls -> 4th ball clock violation triggers walk-off win!
    match.inning = 3;
    match.half = 'bottom';
    match.away.totalRuns = 1;
    match.home.totalRuns = 1;
    match.bases = ['r1', 'r2', 'r3'];
    match.balls = 3;
    const walkOff = applyPitchClockViolation(match);
    expect(walkOff.walked).toBe(true);
    expect(match.home.totalRuns).toBe(2);
    expect(match.isGameOver).toBe(true);
    expect(match.winner).toBe('home');
  });

  it('triggers Mercy Rule (Cold Game) at >=10 run differential from inning 2 onward when enabled', () => {
    const m = createMatch('quick3', { mercyRule: true });
    // Inning 1: 10-0 should NOT trigger mercy yet
    m.away.totalRuns = 10;
    m.away.runsByInning = [10];
    for (let o = 0; o < 3; o++) applyBattedOutcome(m, 'OUT');
    expect(m.half).toBe('bottom');
    for (let o = 0; o < 3; o++) applyBattedOutcome(m, 'OUT');
    expect(m.inning).toBe(2);
    expect(m.isGameOver).toBe(false);

    // End of inning 2 with away leading 10-0 -> Cold Game!
    for (let o = 0; o < 3; o++) applyBattedOutcome(m, 'OUT');
    expect(m.half).toBe('bottom');
    for (let o = 0; o < 3; o++) applyBattedOutcome(m, 'OUT');
    expect(m.isGameOver).toBe(true);
    expect(m.mercyTriggered).toBe(true);
    expect(m.winner).toBe('away');

    // Bottom of inning 2 walk-off mercy (home goes up by 10 during bottom 2)
    const mWalk = createMatch('quick3', { mercyRule: true });
    mWalk.inning = 2;
    mWalk.half = 'bottom';
    mWalk.away.totalRuns = 0;
    mWalk.home.totalRuns = 9;
    mWalk.home.runsByInning = [5, 4];
    applyBattedOutcome(mWalk, 'HR');
    expect(mWalk.home.totalRuns).toBe(10);
    expect(mWalk.isGameOver).toBe(true);
    expect(mWalk.mercyTriggered).toBe(true);
    expect(mWalk.winner).toBe('home');

    // When mercyRule: false (friend room toggle off), 10-0 after inning 2 continues to inning 3
    const mOff = createMatch('quick3', { mercyRule: false });
    mOff.inning = 2;
    mOff.half = 'bottom';
    mOff.away.totalRuns = 10;
    for (let o = 0; o < 3; o++) applyBattedOutcome(mOff, 'OUT');
    expect(mOff.isGameOver).toBe(false);
    expect(mOff.mercyTriggered).toBe(false);
    expect(mOff.inning).toBe(3);
  });
});
