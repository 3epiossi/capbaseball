import { parentPort } from 'node:worker_threads';
import { evaluateSwingResolution, type SwingMode, type SwingResolution } from '../src/physics/contact';
import { solvePitchTrajectory, type PitchId, type PitchTrajectoryResult } from '../src/physics/pitches';
import type { V3 } from '../src/physics/vector';

export interface ServerPitchSummary {
  hitPlanePos: V3;
  hitPlaneTimeSec: number;
  plateCrossPos: V3;
  breakDelta: V3;
  reachesPassLine: boolean;
  flightTimeSec: number;
}

export type PhysicsWorkerRequest =
  | {
      id: number;
      kind: 'solve_pitch';
      pitchId: PitchId;
      speedKmh: number;
      targetX: number;
      targetY: number;
      errorX: number;
      errorY: number;
      outputHz: number;
      seed: number;
    }
  | {
      id: number;
      kind: 'eval_swing';
      hitPlanePos: V3;
      hitPlaneTimeSec: number;
      flightTimeSec: number;
      batX: number;
      batY: number;
      swingMode: SwingMode;
      batterSide: 'R' | 'L';
      seed: number;
    };

export type PhysicsWorkerResponse =
  | { id: number; ok: true; kind: 'solve_pitch'; solveMs: number; result: ServerPitchSummary }
  | { id: number; ok: true; kind: 'eval_swing'; solveMs: number; result: SwingResolution }
  | { id: number; ok: false; error: string };

if (parentPort) {
  parentPort.on('message', (req: PhysicsWorkerRequest) => {
    const t0 = performance.now();
    try {
      if (req.kind === 'solve_pitch') {
        const traj = solvePitchTrajectory(req.pitchId, req.speedKmh, req.targetX, req.targetY, {
          errorY: req.errorX,
          errorZ: req.errorY,
          outputHz: req.outputHz,
          seed: req.seed,
        });
        const result: ServerPitchSummary = {
          hitPlanePos: traj.hitPlanePos,
          hitPlaneTimeSec: traj.hitPlaneTimeSec,
          plateCrossPos: traj.plateCrossPos,
          breakDelta: traj.breakDelta,
          reachesPassLine: traj.reachesPassLine,
          flightTimeSec: traj.flightTimeSec,
        };
        const resp: PhysicsWorkerResponse = {
          id: req.id,
          ok: true,
          kind: 'solve_pitch',
          solveMs: performance.now() - t0,
          result,
        };
        parentPort!.postMessage(resp);
        return;
      }

      if (req.kind === 'eval_swing') {
        const resolution = evaluateSwingResolution({
          trajectory: {
            hitPlanePos: req.hitPlanePos,
            hitPlaneTimeSec: req.hitPlaneTimeSec,
          } as PitchTrajectoryResult,
          flightTimeSec: req.flightTimeSec,
          batX: req.batX,
          batY: req.batY,
          swingMode: req.swingMode,
          batterSide: req.batterSide,
          seed: req.seed,
        });

        // Strip unused frames array before structured-clone postMessage
        const compactRes: SwingResolution = resolution.contact
          ? {
              ...resolution,
              battedResult: {
                ...resolution.battedResult,
                frames: [],
              },
            }
          : resolution;

        const resp: PhysicsWorkerResponse = {
          id: req.id,
          ok: true,
          kind: 'eval_swing',
          solveMs: performance.now() - t0,
          result: compactRes,
        };
        parentPort!.postMessage(resp);
        return;
      }
    } catch (err) {
      const resp: PhysicsWorkerResponse = {
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      parentPort!.postMessage(resp);
    }
  });
}
