import { describe, expect, it } from 'vitest';
import {
  PITCH_IDS,
  PITCH_SPECS,
  solvePitchTrajectory,
} from '../src/physics/pitches';
import {
  fieldToSim,
  simToField,
  simulateBattedCap,
} from '../src/physics/batted';
import { simulateOutfieldGroundBlock, type OutfielderInit } from '../src/physics/contact';
import { judgeBattedCap } from '../src/rules/judge';

describe('6-DOF Cap Flight Physics & Pitch Types', () => {
  const TARGET_Y = 0.0;
  const TARGET_Z = 0.72; // middle of strike zone [0.42, 1.02]

  it('runs all 4 signature pitch types cleanly without NaN and solves within 0.025m', () => {
    expect(PITCH_IDS).toEqual(['straight', 'cutter', 'fork', 'changeup']);
    for (const id of PITCH_IDS) {
      const spec = PITCH_SPECS[id];
      const res = solvePitchTrajectory(id, spec.defaultSpeedKmh, TARGET_Y, TARGET_Z, {
        seed: 12345,
      });

      expect(res.frames.length).toBeGreaterThan(10);
      for (const f of res.frames) {
        expect(f.y.every(Number.isFinite)).toBe(true);
      }

      const err = Math.hypot(
        res.hitPlanePos[1] - TARGET_Y,
        res.hitPlanePos[2] - TARGET_Z,
      );
      expect(
        err,
        `${id} hit=${res.hitPlanePos.map((n) => n.toFixed(3)).join(',')} az=${res.launchAzimuthDeg.toFixed(2)} el=${res.launchElevationDeg.toFixed(2)} reason=${res.simResult.terminationReason}`,
      ).toBeLessThan(0.025);

      // sampleAt interpolator works smoothly
      const mid = res.sampleAt(res.hitPlaneTimeSec * 0.5);
      expect(mid.y.every(Number.isFinite)).toBe(true);
      expect(mid.y[0]).toBeGreaterThan(0.35);
      expect(mid.y[0]).toBeLessThan(9.0);
    }
  }, 15_000);

  it('exhibits exact clock-face induced break directions for straight, cutter, fork, and changeup', () => {
    const straight = solvePitchTrajectory('straight', PITCH_SPECS.straight.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const cutter = solvePitchTrajectory('cutter', PITCH_SPECS.cutter.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const fork = solvePitchTrajectory('fork', PITCH_SPECS.fork.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const changeup = solvePitchTrajectory('changeup', PITCH_SPECS.changeup.defaultSpeedKmh, TARGET_Y, TARGET_Z);

    // 1. Straight: ~12 o'clock slight rising hop (|dx| < 0.04m, dy > +0.06m)
    expect(Math.abs(straight.breakDelta[1])).toBeLessThan(0.04);
    expect(straight.breakDelta[2]).toBeGreaterThan(0.06);

    // 2. Cutter: ~4 o'clock break (dx in [0.15, 0.32], dy in [-0.24, -0.08])
    expect(cutter.breakDelta[1]).toBeGreaterThanOrEqual(0.15);
    expect(cutter.breakDelta[1]).toBeLessThanOrEqual(0.32);
    expect(cutter.breakDelta[2]).toBeGreaterThanOrEqual(-0.24);
    expect(cutter.breakDelta[2]).toBeLessThanOrEqual(-0.08);

    // 3. Fork: ~6 o'clock sharp drop (|dx| < 0.05m, dy <= -0.35m)
    expect(Math.abs(fork.breakDelta[1])).toBeLessThan(0.05);
    expect(fork.breakDelta[2]).toBeLessThanOrEqual(-0.35);

    // 4. Changeup: face-on high-drag drop & fade (dx < -0.10, dy < -0.10)
    expect(changeup.breakDelta[1]).toBeLessThan(-0.10);
    expect(changeup.breakDelta[2]).toBeLessThan(-0.10);
  }, 15_000);

  it('exposes authentic 3D cap orientations (normalWorld & quaternion q) at release for all 4 pitches', () => {
    const straight = solvePitchTrajectory('straight', PITCH_SPECS.straight.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const cutter = solvePitchTrajectory('cutter', PITCH_SPECS.cutter.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const fork = solvePitchTrajectory('fork', PITCH_SPECS.fork.defaultSpeedKmh, TARGET_Y, TARGET_Z);
    const changeup = solvePitchTrajectory('changeup', PITCH_SPECS.changeup.defaultSpeedKmh, TARGET_Y, TARGET_Z);

    // Exact cap-flight-sim changeup parameters
    expect(PITCH_SPECS.changeup.baseAttitude).toBe('edge_on');
    expect(PITCH_SPECS.changeup.bankRightDeg).toBe(-90);
    expect(PITCH_SPECS.changeup.noseUpDeg).toBe(75);
    expect(PITCH_SPECS.changeup.yawLeftDeg).toBe(5);
    expect(PITCH_SPECS.changeup.rpm).toBe(0);

    // Straight: flat horizontal disc (|normalWorld[2]| > 0.85)
    expect(Math.abs(straight.frames[0].normalWorld[2])).toBeGreaterThan(0.85);
    // Cutter: tilted diagonally right (normalWorld[1] > 0.45)
    expect(cutter.frames[0].normalWorld[1]).toBeGreaterThan(0.45);
    // Fork: 90-deg edge-on vertical disc (|normalWorld[1]| > 0.85)
    expect(Math.abs(fork.frames[0].normalWorld[1])).toBeGreaterThan(0.85);
    // Changeup: cap circular face points almost straight at the catcher (|nx| > 0.85)
    expect(Math.abs(changeup.frames[0].normalWorld[0])).toBeGreaterThan(0.85);

    for (const res of [straight, cutter, fork, changeup]) {
      const f0 = res.frames[0];
      expect(f0.q).toEqual(f0.y.slice(6, 10));
      const qNorm = Math.hypot(f0.q[0], f0.q[1], f0.q[2], f0.q[3]);
      expect(qNorm).toBeCloseTo(1, 5);
      const mid = res.sampleAt(res.hitPlaneTimeSec * 0.5);
      const midQNorm = Math.hypot(mid.q[0], mid.q[1], mid.q[2], mid.q[3]);
      expect(midQNorm).toBeCloseTo(1, 5);
    }
  });

  it('converts coordinates consistently between sim FLU and Field3D', () => {
    const moundSim = [0, 0, 1.0] as const;
    const moundField = simToField(moundSim);
    expect(moundField[0]).toBeCloseTo(0);
    expect(moundField[1]).toBeCloseTo(1.0);
    expect(moundField[2]).toBeCloseTo(-9.22);

    const roundTrip = fieldToSim(moundField);
    expect(roundTrip[0]).toBeCloseTo(moundSim[0]);
    expect(roundTrip[1]).toBeCloseTo(moundSim[1]);
    expect(roundTrip[2]).toBeCloseTo(moundSim[2]);
  });

  it('simulates batted cap flight, bounces, and fence interactions', () => {
    const hr = simulateBattedCap({
      position: [0, 0.85, -0.2],
      velocity: [0, 8.5, -26.0],
    });
    expect(hr.overFence).toBe(true);
    expect(hr.bouncesBeforeFence).toBe(0);
    expect(hr.maxDistanceM).toBeGreaterThan(13.0);

    const grounder = simulateBattedCap({
      position: [0, 0.5, -0.2],
      velocity: [0.5, -1.5, -7.0],
    });
    expect(grounder.bounces).toBeGreaterThanOrEqual(1);
    expect(grounder.stoppedPos[1]).toBeLessThan(0.05);
  });

  it('enforces per-pitch ceiling, floor, and lateral flight envelopes on extreme aims', () => {
    const extremeAims: Array<[number, number]> = [
      [0, 1.35],
      [0, 0.12],
      [-0.42, 0.72],
      [0.42, 0.72],
      [-0.4, 1.35],
      [0.4, 0.15],
    ];
    for (const id of PITCH_IDS) {
      const env = PITCH_SPECS[id].envelope;
      const spd = PITCH_SPECS[id].defaultSpeedKmh;
      for (const [tx, ty] of extremeAims) {
        const res = solvePitchTrajectory(id, spd, tx, ty, { outputHz: 90, seed: 7 });
        for (const f of res.frames) {
          if (f.y[0] > 8.87) break; // mound-to-plate flight envelope
          expect(f.y[2]).toBeLessThanOrEqual(env.maxFlightZ + 0.03);
          expect(f.y[2]).toBeGreaterThanOrEqual(env.minFlightZ - 0.03);
          expect(Math.abs(f.y[1])).toBeLessThanOrEqual(env.maxAbsFlightY + 0.03);
        }
      }
    }
  });

  it('allows LF/RF outfielders to cutoff/block bouncing outfield grounders and hold them to 1B', () => {
    const fielders: OutfielderInit[] = [
      { id: 'LF', homePos: [-4.2, 0, -9.8], pos: [-4.2, 0, -9.8] },
      { id: 'RF', homePos: [4.2, 0, -9.8], pos: [4.2, 0, -9.8] },
    ];
    // Hard bouncing grounder hit directly through LF zone toward the outfield wall
    const sprayRad = (-22 * Math.PI) / 180;
    const speed = 19.5;
    const elevRad = (3 * Math.PI) / 180;
    const horiz = speed * Math.cos(elevRad);
    const raw = simulateBattedCap({
      position: [0, 0.55, -0.2],
      velocity: [horiz * Math.sin(sprayRad), speed * Math.sin(elevRad), -horiz * Math.cos(sprayRad)],
      seed: 11,
    });
    expect(raw.bounces).toBeGreaterThanOrEqual(1);
    const block = simulateOutfieldGroundBlock(raw, fielders);
    expect(block.blocked).toBe(true);
    expect(block.fielderId).toBe('LF');
    expect(block.battedResult.hitFence).toBe(false);
    expect(judgeBattedCap(block.battedResult, { caughtInAir: false })).toBe('1B');
  });
});
