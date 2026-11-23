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
import {
  BAT_PCI_NORMAL,
  BAT_PCI_POWER,
  buildFullDefense,
  CONTACT_BALL_RADIUS_M,
  evaluateSwingResolution,
  simulateDeterministicCatch,
  simulateOutfieldGroundBlock,
  type OutfielderInit,
} from '../src/physics/contact';
import { createOutfielders, createPitcherFielder, updateOutfielders } from '../src/ai/cpu';
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

    // 1. Straight: ~12 o'clock high-spin rising hop (|dx| < 0.06m, dy > +0.50m)
    expect(Math.abs(straight.breakDelta[1])).toBeLessThan(0.06);
    expect(straight.breakDelta[2]).toBeGreaterThan(0.50);

    // 2. Cutter: sharp right-cutting break (dx >= 0.30m)
    expect(cutter.breakDelta[1]).toBeGreaterThanOrEqual(0.30);
    expect(cutter.breakDelta[1]).toBeLessThanOrEqual(0.65);

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

  it('enforces per-pitch ceiling, floor, and lateral flight envelopes on extreme aims', { timeout: 15000 }, () => {
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

  it('models 2D catcher-view horizontal cylinder barrel boundary and 3D cylindrical exit speed & launch angle', () => {
    const traj = solvePitchTrajectory('straight', PITCH_SPECS.straight.defaultSpeedKmh, 0, 0.72, {
      seed: 77,
    });
    const hit = simToField(traj.hitPlanePos);

    // 1. Rectangular barrel aspect ratio: wider horizontally than vertically, Power tighter than Normal
    expect(BAT_PCI_NORMAL.halfW).toBeGreaterThan(BAT_PCI_NORMAL.halfH * 2);
    expect(BAT_PCI_POWER.halfW).toBeLessThan(BAT_PCI_NORMAL.halfW);
    expect(BAT_PCI_POWER.halfH).toBeLessThan(BAT_PCI_NORMAL.halfH);

    // 2. Horizontal contact inside halfW hits fairly, while equivalent vertical offset misses cleanly
    const horizHit = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0] - 0.11, // within halfW=0.128
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    expect(horizHit.contact).toBe(true);
    if (horizHit.contact) {
      expect(horizHit.outcome).not.toBe('FOUL');
    }

    const vertMiss = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0],
      batY: hit[1] - 0.115, // outside halfH(0.050) + R_ball(0.038) + graze(0.016) = 0.104m
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    expect(vertMiss.contact).toBe(false);

    // 2b. Ball-radius Minkowski contact: ball center slightly above top barrel line
    //     still visibly overlaps barrel (d_edge <= R_ball) => MUST make weak pop-up contact!
    const ballEdgeOverlap = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0],
      batY: hit[1] - (BAT_PCI_NORMAL.halfH + CONTACT_BALL_RADIUS_M * 0.72),
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    expect(ballEdgeOverlap.contact).toBe(true);
    if (ballEdgeOverlap.contact) {
      expect(ballEdgeOverlap.outcome).not.toBe('FOUL');
      expect(ballEdgeOverlap.launchAngleDeg!).toBeGreaterThan(55);
    }

    // 3. Curved "(" ")" parenthesis corner check: outside rounded tip by R_ball + 0.008m -> FOUL TIP
    const tipX = BAT_PCI_NORMAL.halfW * (1 - BAT_PCI_NORMAL.bracketCurveFrac);
    const cornerDelta = (CONTACT_BALL_RADIUS_M + 0.008) * Math.SQRT1_2;
    const cornerGraze = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0] - (tipX + cornerDelta),
      batY: hit[1] - (BAT_PCI_NORMAL.halfH + cornerDelta),
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    expect(cornerGraze.contact).toBe(true);
    if (cornerGraze.contact) {
      expect(cornerGraze.outcome).toBe('FOUL');
      expect(cornerGraze.label).toBe('FOUL TIP');
    }

    // 4. 3D Cylinder-Sphere normal projection: moving vertically across R_eff = halfH + R_ball
    //    monotonically lowers exit speed and deflects launch angle sharply up (+u_y) or down (-u_y)
    const sampleY = (uY: number, mode: 'normal' | 'power' = 'normal') => {
      const pci = mode === 'power' ? BAT_PCI_POWER : BAT_PCI_NORMAL;
      const effHalfH = pci.halfH + CONTACT_BALL_RADIUS_M;
      const res = evaluateSwingResolution({
        trajectory: traj,
        flightTimeSec: traj.hitPlaneTimeSec,
        batX: hit[0],
        batY: hit[1] - uY * effHalfH,
        swingMode: mode,
        batterSide: 'R',
        seed: 77,
      });
      if (!res.contact) throw new Error(`Expected contact at uY=${uY}`);
      return res;
    };

    const topEdge = sampleY(0.9);
    const upperMid = sampleY(0.45);
    const center = sampleY(0);
    const lowerMid = sampleY(-0.45);
    const botEdge = sampleY(-0.9);

    // Exit speed peaks at cylinder centerline and drops sharply toward edges via cos(phi)^p
    expect(center.exitSpeedKmh).toBeGreaterThan(upperMid.exitSpeedKmh);
    expect(upperMid.exitSpeedKmh).toBeGreaterThan(topEdge.exitSpeedKmh);
    expect(center.exitSpeedKmh).toBeGreaterThan(lowerMid.exitSpeedKmh);
    expect(lowerMid.exitSpeedKmh).toBeGreaterThan(botEdge.exitSpeedKmh);
    expect(topEdge.exitSpeedKmh).toBe(botEdge.exitSpeedKmh); // symmetric vertical cos(phi) projection

    // Launch angle monotonically increases from lower edge (grounder) to upper edge (pop-up)
    expect(botEdge.launchAngleDeg!).toBeLessThan(lowerMid.launchAngleDeg!);
    expect(lowerMid.launchAngleDeg!).toBeLessThan(center.launchAngleDeg!);
    expect(center.launchAngleDeg!).toBeLessThan(upperMid.launchAngleDeg!);
    expect(upperMid.launchAngleDeg!).toBeLessThan(topEdge.launchAngleDeg!);
    expect(botEdge.launchAngleDeg!).toBeLessThan(-20);
    expect(topEdge.launchAngleDeg!).toBeGreaterThan(55);
    expect(topEdge.rawQuality).toBeLessThan(0.4); // dull edge-graze sound, never hard crack

    // 5. Horizontal barrel taper: off-sweet-spot |u_x| monotonically reduces exit speed
    const x0 = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0],
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    const xMid = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0] - 0.5 * BAT_PCI_NORMAL.halfW,
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    const xEnd = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0] - 0.95 * BAT_PCI_NORMAL.halfW,
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      seed: 77,
    });
    expect(x0.contact && xMid.contact && xEnd.contact).toBe(true);
    if (x0.contact && xMid.contact && xEnd.contact) {
      expect(x0.exitSpeedKmh).toBeGreaterThan(xMid.exitSpeedKmh);
      expect(xMid.exitSpeedKmh).toBeGreaterThan(xEnd.exitSpeedKmh);
    }

    // 6. Power swing center barrel produces higher peak exit velocity than Normal swing
    const powerCenter = sampleY(0, 'power');
    expect(powerCenter.exitSpeedKmh).toBeGreaterThan(center.exitSpeedKmh);

    // 7. Batter swing speed (batSpeedMs) directly drives peak exit velocity via BBS formula
    const slowBatter = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0],
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      batSpeedMs: 15.0,
      seed: 77,
    });
    const fastBatter = evaluateSwingResolution({
      trajectory: traj,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: hit[0],
      batY: hit[1],
      swingMode: 'normal',
      batterSide: 'R',
      batSpeedMs: 21.0,
      seed: 77,
    });
    expect(slowBatter.contact && fastBatter.contact).toBe(true);
    if (slowBatter.contact && fastBatter.contact) {
      expect(fastBatter.exitSpeedKmh).toBeGreaterThan(center.exitSpeedKmh);
      expect(center.exitSpeedKmh).toBeGreaterThan(slowBatter.exitSpeedKmh);
    }
  });

  it('allows Pitcher & forward-charging fielders to stop infield grounders for OUT and physically arrive at interceptPos', () => {
    const fullDef = buildFullDefense();

    // 1. Screaming hard comebacker up the middle (25 m/s) reaches mound before Pitcher's 0.48s post-throw
    //    recovery delay -> shoots right past Pitcher into outfield (NOT blocked by P)!
    const rocketComebacker = simulateBattedCap({
      position: [0, 0.65, -0.22],
      velocity: [0.1, 0.2, -25.0],
      seed: 19,
    });
    const rocketBlk = simulateOutfieldGroundBlock(rocketComebacker, fullDef);
    expect(rocketBlk.fielderId).not.toBe('P');

    // 2. Medium/slow grounder right up the middle reaches mound after 0.48s -> Pitcher recovers & blocks for OUT!
    const comebacker = simulateBattedCap({
      position: [0, 0.55, -0.22],
      velocity: [0.35, -1.8, -14.5],
      seed: 19,
    });
    expect(comebacker.hitOutfield).toBe(true); // without pitcher fielding, it escapes into outfield!

    const block = simulateOutfieldGroundBlock(comebacker, fullDef);
    expect(block.blocked).toBe(true);
    expect(block.fielderId).toBe('P');
    expect(block.blockPos).not.toBeNull();
    expect(block.blockTimeSec).not.toBeNull();
    expect(block.blockTimeSec!).toBeGreaterThanOrEqual(0.58);
    expect(judgeBattedCap(block.battedResult, { caughtInAir: false })).toBe('OUT');

    // Verify visual fielder animation physically runs right onto blockPos by blockTimeSec (zero 隔山打牛)
    const pActor = createPitcherFielder();
    const ofActors = createOutfielders();
    const actors = [...ofActors, pActor];
    const dt = 1 / 60;
    for (let t = 0; t <= block.blockTimeSec! + dt; t += dt) {
      updateOutfielders(
        actors,
        dt,
        block.blockPos,
        block.blockPos,
        false,
        false,
        t,
        {
          fielderId: 'P',
          targetPos: block.blockPos!,
          targetTimeSec: block.blockTimeSec!,
          isBlock: true,
        },
      );
    }
    const visualGap = Math.hypot(
      pActor.pos[0] - block.blockPos![0],
      pActor.pos[2] - block.blockPos![2],
    );
    expect(visualGap).toBeLessThan(0.15);

    // Defenders can freely cross into foul territory to catch foul pop-ups (OUT) or stop foul rollers (FOUL)
    const foulPop = simulateBattedCap({
      position: [0, 0.85, -0.22],
      velocity: [2.2, 6.8, -0.6], // pops up in 1B foul territory right near Catcher (x ~ +1.8, z ~ -0.7)
      seed: 12,
    });
    let foulCaught = false;
    for (let s = 1; s <= 15; s++) {
      const cRes = simulateDeterministicCatch(foulPop, fullDef, {
        exitSpeedMs: 7.2,
        launchAngleDeg: 70,
        seed: s,
      });
      if (cRes.caught) {
        foulCaught = true;
        expect(cRes.fielderId).toBe('C');
        expect(judgeBattedCap(foulPop, { caughtInAir: true })).toBe('OUT');
        break;
      }
    }
    expect(foulCaught).toBe(true);

    // Uniform speed verification on foul balls (both un-intercepted across bounce & intercepted into foul territory)
    const lfActors = createOutfielders();
    const lf = lfActors[0];
    const foulLand: [number, number, number] = [-6.5, 0, -5.5];
    const foulFinal: [number, number, number] = [-9.8, 0, -6.2];
    const speeds: number[] = [];
    for (let step = 0; step < 60; step++) {
      const t = 0.2 + step * dt;
      const airborne = t < 0.65;
      const capPos: [number, number, number] = airborne ? [-5.0, 1.2, -5.0] : [-7.0 - (t - 0.65) * 1.2, 0.02, -5.8];
      const prevX = lf.pos[0];
      const prevZ = lf.pos[2];
      updateOutfielders(lfActors, dt, capPos, foulLand, airborne, false, t, null, foulFinal);
      const spd = Math.hypot(lf.pos[0] - prevX, lf.pos[2] - prevZ) / dt;
      if (lf.anim === 'run') speeds.push(spd);
    }
    expect(speeds.length).toBeGreaterThan(20);
    // Speed must stay strictly constant across the airborne -> bounce transition (zero slowdown/pause/restart!)
    const minSpd = Math.min(...speeds);
    const maxSpd = Math.max(...speeds);
    expect(maxSpd - minSpd).toBeLessThan(0.05);

    // Intercepted foul ball also glides at exact constant speed all the way to arrival (no fast-start/brake-early)
    const rfActors = createOutfielders();
    const rf = rfActors[1];
    const foulTarget: [number, number, number] = [9.2, 0, -7.2];
    const targetT = 1.6;
    const intSpeeds: number[] = [];
    for (let t = 0.18 + dt; t < targetT - dt; t += dt) {
      const prevX = rf.pos[0];
      const prevZ = rf.pos[2];
      updateOutfielders(
        rfActors,
        dt,
        foulTarget,
        foulTarget,
        true,
        false,
        t,
        { fielderId: 'RF', targetPos: foulTarget, targetTimeSec: targetT, isBlock: false },
        foulTarget,
      );
      intSpeeds.push(Math.hypot(rf.pos[0] - prevX, rf.pos[2] - prevZ) / dt);
    }
    expect(intSpeeds.length).toBeGreaterThan(40);
    expect(Math.max(...intSpeeds) - Math.min(...intSpeeds)).toBeLessThan(0.05);
  });

  it('allows defenders (C/P/LF/RF) to catch high foul pop-ups from evaluateSwingResolution as FOUL OUT', () => {
    const traj = solvePitchTrajectory('straight', PITCH_SPECS.straight.defaultSpeedKmh, 0, 0.72, {
      seed: 42,
    });
    const hit = simToField(traj.hitPlanePos);
    const effHalfH = BAT_PCI_NORMAL.halfH + CONTACT_BALL_RADIUS_M;
    let caughtCount = 0;
    const catchers = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const res = evaluateSwingResolution({
        trajectory: traj,
        flightTimeSec: traj.hitPlaneTimeSec - 0.095, // early foul timing band (|dt| in (0.068, 0.145])
        batX: hit[0],
        batY: hit[1] - 0.65 * effHalfH, // undercut pop-up (uY = +0.65)
        swingMode: 'normal',
        batterSide: s % 2 === 0 ? 'R' : 'L',
        seed: s,
      });
      expect(res.contact).toBe(true);
      if (res.contact && res.catchInfo.caught) {
        caughtCount += 1;
        expect(res.outcome).toBe('OUT');
        expect(res.detail).toContain('FOUL OUT');
        if (res.catchInfo.fielderId) catchers.add(res.catchInfo.fielderId);
      }
    }
    expect(caughtCount).toBeGreaterThan(0);
    expect(catchers.size).toBeGreaterThan(0);
  });
});
