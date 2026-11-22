import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { evaluateSwingResolution, type SwingMode, type SwingResolution } from '../src/physics/contact';
import { solvePitchTrajectory, type PitchId, type PitchTrajectoryResult } from '../src/physics/pitches';
import type { V3 } from '../src/physics/vector';
import type {
  PhysicsWorkerRequest,
  PhysicsWorkerResponse,
  ServerPitchSummary,
} from './physicsWorker';

export type { ServerPitchSummary } from './physicsWorker';

export interface SolvePitchInput {
  pitchId: PitchId;
  speedKmh: number;
  targetX: number;
  targetY: number;
  errorX: number;
  errorY: number;
  outputHz?: number;
  seed: number;
}

export interface EvalSwingInput {
  hitPlanePos: V3;
  hitPlaneTimeSec: number;
  hitPlaneSpeedMs?: number;
  flightTimeSec: number;
  batX: number;
  batY: number;
  swingMode: SwingMode;
  batterSide: 'R' | 'L';
  seed: number;
}

interface QueuedTask {
  req: PhysicsWorkerRequest;
  resolve: (value: { result: unknown; solveMs: number }) => void;
  reject: (err: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current: QueuedTask | null;
}

export class PhysicsPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: QueuedTask[] = [];
  private readonly workerScriptUrl: URL | null = null;
  private nextId = 1;
  private closed = false;

  readonly mode: 'worker_threads' | 'inline';
  readonly workerCount: number;

  constructor(opts?: { workers?: number; workerUrl?: URL; forceInline?: boolean }) {
    const candidate = opts?.workerUrl ?? new URL('./physics-worker.mjs', import.meta.url);
    const canSpawn = !opts?.forceInline && fs.existsSync(fileURLToPath(candidate));

    if (canSpawn) {
      this.workerScriptUrl = candidate;
      const defaultWorkers = Math.min(3, Math.max(2, (os.cpus().length || 2) - 1));
      const count = Math.max(1, opts?.workers ?? defaultWorkers);
      this.mode = 'worker_threads';
      this.workerCount = count;
      for (let i = 0; i < count; i++) {
        this.spawnSlot();
      }
    } else {
      this.mode = 'inline';
      this.workerCount = 0;
    }
  }

  private spawnSlot(): void {
    if (!this.workerScriptUrl || this.closed) return;
    const worker = new Worker(this.workerScriptUrl, { execArgv: [] });
    const slot: WorkerSlot = { worker, busy: false, current: null };

    worker.on('message', (resp: PhysicsWorkerResponse) => {
      const task = slot.current;
      slot.current = null;
      slot.busy = false;
      if (task && task.req.id === resp.id) {
        if (resp.ok) {
          task.resolve({ result: resp.result, solveMs: resp.solveMs });
        } else {
          task.reject(new Error(resp.error));
        }
      }
      this.dispatch();
    });

    worker.on('error', (err) => {
      const task = slot.current;
      slot.current = null;
      slot.busy = false;
      if (task) task.reject(err instanceof Error ? err : new Error(String(err)));
    });

    worker.on('exit', () => {
      const idx = this.slots.indexOf(slot);
      if (idx !== -1) this.slots.splice(idx, 1);
      const task = slot.current;
      slot.current = null;
      if (task) task.reject(new Error('Physics worker exited unexpectedly'));
      if (!this.closed) {
        this.spawnSlot();
        this.dispatch();
      }
    });

    this.slots.push(slot);
  }

  private dispatch(): void {
    if (this.closed || this.queue.length === 0) return;
    for (const slot of this.slots) {
      if (!slot.busy && this.queue.length > 0) {
        const task = this.queue.shift()!;
        slot.busy = true;
        slot.current = task;
        slot.worker.postMessage(task.req);
      }
    }
  }

  private enqueue<T>(req: PhysicsWorkerRequest): Promise<{ result: T; solveMs: number }> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('PhysicsPool is closed'));
        return;
      }
      this.queue.push({
        req,
        resolve: resolve as (v: { result: unknown; solveMs: number }) => void,
        reject,
      });
      this.dispatch();
    });
  }

  async solvePitch(input: SolvePitchInput): Promise<{ result: ServerPitchSummary; solveMs: number }> {
    const outputHz = input.outputHz ?? 120;
    if (this.mode === 'inline') {
      const t0 = performance.now();
      const traj = solvePitchTrajectory(input.pitchId, input.speedKmh, input.targetX, input.targetY, {
        errorY: input.errorX,
        errorZ: input.errorY,
        outputHz,
        seed: input.seed,
      });
      return {
        solveMs: performance.now() - t0,
        result: {
          hitPlanePos: traj.hitPlanePos,
          hitPlaneTimeSec: traj.hitPlaneTimeSec,
          hitPlaneSpeedMs: traj.hitPlaneSpeedMs,
          plateCrossPos: traj.plateCrossPos,
          breakDelta: traj.breakDelta,
          reachesPassLine: traj.reachesPassLine,
          flightTimeSec: traj.flightTimeSec,
        },
      };
    }

    return this.enqueue<ServerPitchSummary>({
      id: this.nextId++,
      kind: 'solve_pitch',
      pitchId: input.pitchId,
      speedKmh: input.speedKmh,
      targetX: input.targetX,
      targetY: input.targetY,
      errorX: input.errorX,
      errorY: input.errorY,
      outputHz,
      seed: input.seed,
    });
  }

  async evaluateSwing(input: EvalSwingInput): Promise<{ result: SwingResolution; solveMs: number }> {
    if (this.mode === 'inline') {
      const t0 = performance.now();
      const result = evaluateSwingResolution({
        trajectory: {
          hitPlanePos: input.hitPlanePos,
          hitPlaneTimeSec: input.hitPlaneTimeSec,
          hitPlaneSpeedMs: input.hitPlaneSpeedMs,
        } as PitchTrajectoryResult,
        flightTimeSec: input.flightTimeSec,
        batX: input.batX,
        batY: input.batY,
        swingMode: input.swingMode,
        batterSide: input.batterSide,
        seed: input.seed,
      });
      return { solveMs: performance.now() - t0, result };
    }

    return this.enqueue<SwingResolution>({
      id: this.nextId++,
      kind: 'eval_swing',
      hitPlanePos: input.hitPlanePos,
      hitPlaneTimeSec: input.hitPlaneTimeSec,
      hitPlaneSpeedMs: input.hitPlaneSpeedMs,
      flightTimeSec: input.flightTimeSec,
      batX: input.batX,
      batY: input.batY,
      swingMode: input.swingMode,
      batterSide: input.batterSide,
      seed: input.seed,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    while (this.queue.length > 0) {
      const t = this.queue.shift()!;
      t.reject(new Error('PhysicsPool closed'));
    }
    const terminations = this.slots.map((s) => s.worker.terminate());
    this.slots.length = 0;
    await Promise.allSettled(terminations);
  }
}
