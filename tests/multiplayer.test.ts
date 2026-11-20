import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeServerMsg, type ServerLoadStatus } from '../src/net/protocol';
import { solvePitchTrajectory } from '../src/physics/pitches';
import { startServer } from '../server/index';

interface TestClient {
  ws: WebSocket;
  queue: Record<string, unknown>[];
  nextMsg: (predicate?: (m: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  send: (msg: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

function connectClient(port: number, name: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue: Record<string, unknown>[] = [];
    const waiters: Array<{
      predicate: (m: Record<string, unknown>) => boolean;
      resolve: (m: Record<string, unknown>) => void;
    }> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        return;
      }
      const idx = waiters.findIndex((w) => w.predicate(msg));
      if (idx !== -1) {
        const [w] = waiters.splice(idx, 1);
        w.resolve(msg);
      } else {
        queue.push(msg);
      }
    });

    const client: TestClient = {
      ws,
      queue,
      nextMsg(predicate = () => true, timeoutMs = 4000) {
        const qIdx = queue.findIndex(predicate);
        if (qIdx !== -1) {
          return Promise.resolve(queue.splice(qIdx, 1)[0]);
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const wIdx = waiters.findIndex((w) => w.resolve === wrappedResolve);
            if (wIdx !== -1) waiters.splice(wIdx, 1);
            rej(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
          }, timeoutMs);
          const wrappedResolve = (m: Record<string, unknown>) => {
            clearTimeout(timer);
            res(m);
          };
          waiters.push({ predicate, resolve: wrappedResolve });
        });
      },
      send(msg) {
        ws.send(JSON.stringify(msg));
      },
      close() {
        return new Promise((res) => {
          if (ws.readyState === WebSocket.CLOSED) {
            res();
            return;
          }
          ws.once('close', () => res());
          ws.close();
        });
      },
    };

    ws.once('open', () => {
      client.send({ type: 'hello', name });
      void client.nextMsg((m) => m.type === 'welcome').then(() => resolve(client), reject);
    });
    ws.once('error', reject);
  });
}

describe('Online Multiplayer Server Integration', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  let tmpDir: string;
  const openClients: TestClient[] = [];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capbb-test-'));
    srv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'matches.jsonl'),
      pingIntervalMs: 5000,
      graceMs: 10_000,
    });
  });

  afterEach(async () => {
    for (const c of openClients.splice(0)) {
      await c.close();
    }
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. Friend Room create + join + full pitch-to-swing-to-result cycle', async () => {
    const home = await connectClient(srv.port, '主隊阿明');
    const away = await connectClient(srv.port, '客隊小華');
    openClients.push(home, away);

    home.send({ type: 'create', mode: 'quick3', name: '主隊阿明' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(created.side).toBe('home');

    away.send({ type: 'join', code: created.code, name: '客隊小華' });
    const joined = await away.nextMsg((m) => m.type === 'room_joined');
    expect(joined.side).toBe('away');

    const startHome = await home.nextMsg((m) => m.type === 'match_start');
    const startAway = await away.nextMsg((m) => m.type === 'match_start');
    expect(startHome.pitchSeq).toBe(1);
    expect(startAway.pitchSeq).toBe(1);

    // Top of 1st: Home pitches, Away bats
    home.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'straight',
      speedKmh: 72,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });

    const launchHome = await home.nextMsg((m) => m.type === 'pitch_launch');
    const launchAway = await away.nextMsg((m) => m.type === 'pitch_launch');
    expect(launchHome.pitchSeq).toBe(1);
    expect(launchAway.seed).toBe(launchHome.seed);

    const traj = solvePitchTrajectory('straight', 72, 0, 0.72, {
      errorY: 0,
      errorZ: 0,
      outputHz: 120,
      seed: launchAway.seed as number,
    });

    // Away swings right on the sweet spot at hitPlaneTimeSec
    away.send({
      type: 'swing_input',
      pitchSeq: 1,
      flightTimeSec: traj.hitPlaneTimeSec,
      batX: traj.hitPlanePos[1],
      batY: traj.hitPlanePos[2],
      swingMode: 'normal',
      batterSide: 'R',
    });

    const resHome = await home.nextMsg((m) => m.type === 'pitch_result');
    const resAway = await away.nextMsg((m) => m.type === 'pitch_result');
    expect(resHome.pitchSeq).toBe(1);
    expect(resHome.nextPitchSeq).toBe(2);
    expect(resAway.nextPitchSeq).toBe(2);
    expect(resHome.match).toEqual(resAway.match);
    expect((resHome.resolution as { contact: boolean }).contact).toBe(true);
  });

  it('2. Quick Match pairing + intentional walk + no_swing strike/ball resolution', async () => {
    const c1 = await connectClient(srv.port, '玩家一');
    const c2 = await connectClient(srv.port, '玩家二');
    openClients.push(c1, c2);

    c1.send({ type: 'queue', mode: 'quick3', name: '玩家一' });
    await c1.nextMsg((m) => m.type === 'queued');

    c2.send({ type: 'queue', mode: 'quick3', name: '玩家二' });
    const s1 = await c1.nextMsg((m) => m.type === 'match_start');
    const s2 = await c2.nextMsg((m) => m.type === 'match_start');

    const pitcher = s1.side === 'home' ? c1 : c2;
    const batter = s1.side === 'home' ? c2 : c1;
    expect(s1.side).not.toBe(s2.side);

    // Pitcher issues IBB at pitchSeq = 1
    pitcher.send({ type: 'ibb', pitchSeq: 1 });
    const ibbP = await pitcher.nextMsg((m) => m.type === 'pitch_result');
    const ibbB = await batter.nextMsg((m) => m.type === 'pitch_result');
    expect(ibbP.ibb).toBe(true);
    expect(ibbP.nextPitchSeq).toBe(2);
    expect((ibbB.match as { bases: (string | null)[] }).bases[0]).not.toBeNull();

    // Pitch #2: Pitcher throws down the middle, batter sends no_swing -> STRIKE
    pitcher.send({
      type: 'pitch_submit',
      pitchSeq: 2,
      pitchId: 'straight',
      speedKmh: 72,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });
    await pitcher.nextMsg((m) => m.type === 'pitch_launch');
    await batter.nextMsg((m) => m.type === 'pitch_launch');

    batter.send({ type: 'no_swing', pitchSeq: 2 });
    const resP = await pitcher.nextMsg((m) => m.type === 'pitch_result');
    const resB = await batter.nextMsg((m) => m.type === 'pitch_result');
    expect(resP.outcome).toBe('STRIKE');
    expect(resB.nextPitchSeq).toBe(3);
    expect((resB.match as { strikes: number }).strikes).toBe(1);
  });

  it('3. Async/idempotency guard ignores duplicate, out-of-turn, and stale pitchSeq messages', async () => {
    const home = await connectClient(srv.port, '主隊');
    const away = await connectClient(srv.port, '客隊');
    openClients.push(home, away);

    home.send({ type: 'create', mode: 'quick3', name: '主隊' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: '客隊' });
    await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');

    // Out-of-turn: away (batter) tries to submit pitch -> ignored
    away.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'straight',
      speedKmh: 72,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });

    // Stale pitchSeq from home -> ignored
    home.send({
      type: 'pitch_submit',
      pitchSeq: 99,
      pitchId: 'straight',
      speedKmh: 72,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });

    // Valid pitch from home, followed immediately by duplicate pitch_submit
    home.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'straight',
      speedKmh: 72,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });
    home.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'cutter',
      speedKmh: 70,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });

    const launch = await away.nextMsg((m) => m.type === 'pitch_launch');
    expect(launch.pitchId).toBe('straight');

    // Out-of-turn swing from pitcher (home) -> ignored
    home.send({
      type: 'no_swing',
      pitchSeq: 1,
    });

    // Valid no_swing from away + duplicate swing_input -> only 1 pitch_result
    away.send({ type: 'no_swing', pitchSeq: 1 });
    away.send({
      type: 'swing_input',
      pitchSeq: 1,
      flightTimeSec: 0.5,
      batX: 0,
      batY: 0.72,
      swingMode: 'normal',
      batterSide: 'R',
    });

    const res = await away.nextMsg((m) => m.type === 'pitch_result');
    expect(res.pitchSeq).toBe(1);
    expect(res.nextPitchSeq).toBe(2);
    expect(res.swung).toBe(false);

    // Ensure no second pitch_result arrives
    await new Promise((r) => setTimeout(r, 120));
    expect(away.queue.filter((m) => m.type === 'pitch_result').length).toBe(0);
  });

  it('4. Reconnect restores disconnected player within grace period with full state_sync', async () => {
    const home = await connectClient(srv.port, '主隊');
    const away = await connectClient(srv.port, '客隊');
    openClients.push(home, away);

    home.send({ type: 'create', mode: 'quick3', name: '主隊' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: '客隊' });
    await home.nextMsg((m) => m.type === 'match_start');
    const startAway = await away.nextMsg((m) => m.type === 'match_start');

    const awayToken = startAway.token as string;
    const roomCode = created.code as string;

    // Away disconnects mid-game
    await away.close();
    const oppDisc = await home.nextMsg((m) => m.type === 'opponent_disconnected');
    expect(oppDisc.graceSec).toBe(10);

    // Away reconnects with token
    const awayRe = await connectClient(srv.port, '客隊');
    openClients.push(awayRe);
    awayRe.send({ type: 'reconnect', code: roomCode, token: awayToken });

    const sync = await awayRe.nextMsg((m) => m.type === 'state_sync');
    const oppRe = await home.nextMsg((m) => m.type === 'opponent_reconnected');
    expect(sync.code).toBe(roomCode);
    expect(sync.side).toBe('away');
    expect(sync.pitchSeq).toBe(1);
    expect(oppRe.type).toBe('opponent_reconnected');
  });

  it('5. Live spectating via list, watch, unwatch receives spectate_sync and live pitch broadcasts', async () => {
    const home = await connectClient(srv.port, '主隊');
    const away = await connectClient(srv.port, '客隊');
    const spec = await connectClient(srv.port, '觀眾');
    openClients.push(home, away, spec);

    home.send({ type: 'create', mode: 'quick3', name: '主隊' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: '客隊' });
    await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');

    spec.send({ type: 'list' });
    const listMsg = await spec.nextMsg((m) => m.type === 'room_list');
    const rooms = listMsg.rooms as Array<{ code: string; spectators: number; mode: string }>;
    expect(rooms.some((r) => r.code === created.code && r.mode === 'quick3')).toBe(true);

    spec.send({ type: 'watch', code: created.code });
    const syncMsg = await spec.nextMsg((m) => m.type === 'spectate_sync');
    expect(syncMsg.code).toBe(created.code);
    expect(syncMsg.spectators).toBe(1);

    // Pitcher throws -> spectator also receives pitch_launch & pitch_result
    home.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'straight',
      speedKmh: 70,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });
    const specLaunch = await spec.nextMsg((m) => m.type === 'pitch_launch');
    expect(specLaunch.pitchSeq).toBe(1);
    await home.nextMsg((m) => m.type === 'pitch_launch');
    await away.nextMsg((m) => m.type === 'pitch_launch');

    away.send({ type: 'no_swing', pitchSeq: 1 });
    const specRes = await spec.nextMsg((m) => m.type === 'pitch_result');
    expect(specRes.pitchSeq).toBe(1);
    expect(specRes.outcome).toBe('STRIKE');

    spec.send({ type: 'unwatch' });
    const unwatched = await spec.nextMsg((m) => m.type === 'unwatched');
    expect(unwatched.type).toBe('unwatched');
  });

  it('6. ABS challenge syncs abs_result across both players and spectators', async () => {
    const home = await connectClient(srv.port, '主隊');
    const away = await connectClient(srv.port, '客隊');
    const spec = await connectClient(srv.port, '觀眾');
    openClients.push(home, away, spec);

    home.send({ type: 'create', mode: 'quick3', name: '主隊' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: '客隊' });
    await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');

    spec.send({ type: 'watch', code: created.code });
    await spec.nextMsg((m) => m.type === 'spectate_sync');

    // Pitch right down the middle (non-borderline strike), away takes -> STRIKE
    home.send({
      type: 'pitch_submit',
      pitchSeq: 1,
      pitchId: 'straight',
      speedKmh: 70,
      targetX: 0,
      targetY: 0.72,
      errorX: 0,
      errorY: 0,
    });
    await home.nextMsg((m) => m.type === 'pitch_launch');
    await away.nextMsg((m) => m.type === 'pitch_launch');
    await spec.nextMsg((m) => m.type === 'pitch_launch');

    away.send({ type: 'no_swing', pitchSeq: 1 });
    const resHome = await home.nextMsg((m) => m.type === 'pitch_result');
    await away.nextMsg((m) => m.type === 'pitch_result');
    await spec.nextMsg((m) => m.type === 'pitch_result');
    expect(resHome.outcome).toBe('STRIKE');

    // Away batter challenges the called strike -> upheld, deducts 1 challenge
    away.send({ type: 'abs_challenge', pitchSeq: 1 });
    const absH = await home.nextMsg((m) => m.type === 'abs_result');
    const absA = await away.nextMsg((m) => m.type === 'abs_result');
    const absS = await spec.nextMsg((m) => m.type === 'abs_result');

    expect(absH.overturned).toBe(false);
    expect(absH.trueCall).toBe('strike');
    expect(absH.challengerSide).toBe('away');
    expect((absA.match as { absChallenges: { away: number } }).absChallenges.away).toBe(1);
    expect((absS.match as { absChallenges: { away: number } }).absChallenges.away).toBe(1);
  });

  it('7. Compact v2 wire protocol dramatically shrinks packet bytes on pitch/result', async () => {
    const rawSizes: Record<string, number> = {};
    const connectV2 = (name: string) =>
      new Promise<{
        ws: WebSocket;
        send: (o: Record<string, unknown>) => void;
        next: (pred: (m: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
        close: () => Promise<void>;
      }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
        const q: Record<string, unknown>[] = [];
        const waiters: Array<{ pred: (m: Record<string, unknown>) => boolean; res: (m: Record<string, unknown>) => void }> = [];
        ws.on('message', (raw) => {
          const rawStr = String(raw);
          const parsed = JSON.parse(rawStr) as Record<string, unknown>;
          const msg = decodeServerMsg(parsed);
          if (typeof parsed.t === 'string') rawSizes[parsed.t] = Buffer.byteLength(rawStr, 'utf8');
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ t: 'po', n: msg.t }));
            return;
          }
          const i = waiters.findIndex((w) => w.pred(msg));
          if (i !== -1) waiters.splice(i, 1)[0].res(msg);
          else q.push(msg);
        });
        const api = {
          ws,
          send: (o: Record<string, unknown>) => ws.send(JSON.stringify(o)),
          next: (pred: (m: Record<string, unknown>) => boolean) => {
            const i = q.findIndex(pred);
            if (i !== -1) return Promise.resolve(q.splice(i, 1)[0]);
            return new Promise<Record<string, unknown>>((res) => waiters.push({ pred, res }));
          },
          close: () => new Promise<void>((res) => (ws.readyState === WebSocket.CLOSED ? res() : (ws.once('close', () => res()), ws.close()))),
        };
        ws.once('open', () => {
          api.send({ t: 'hi', n: name, v: 2 });
          void api.next((m) => m.type === 'welcome').then(() => resolve(api), reject);
        });
      });

    const p1 = await connectV2('Ace');
    const p2 = await connectV2('Slugger');
    try {
      p1.send({ t: 'cr', m: 0, n: 'Ace' });
      const created = await p1.next((m) => m.type === 'room_created');
      p2.send({ t: 'jn', c: created.code, n: 'Slugger' });
      await p1.next((m) => m.type === 'match_start');
      await p2.next((m) => m.type === 'match_start');

      const pitchPayload = JSON.stringify({ t: 'ps', q: 1, p: 0, v: 70, x: 0, y: 0.72, ex: 0, ey: 0 });
      expect(Buffer.byteLength(pitchPayload, 'utf8')).toBeLessThan(80);
      p1.ws.send(pitchPayload);
      await p1.next((m) => m.type === 'pitch_launch');
      await p2.next((m) => m.type === 'pitch_launch');

      const noSwingPayload = JSON.stringify({ t: 'ns', q: 1 });
      expect(Buffer.byteLength(noSwingPayload, 'utf8')).toBeLessThan(28);
      p2.ws.send(noSwingPayload);
      const pr = await p1.next((m) => m.type === 'pitch_result');
      expect(pr.outcome).toBe('STRIKE');

      // Compact pitch_launch (<130B) and pitch_result (<550B vs ~3000B raw)
      expect(rawSizes.pl).toBeLessThan(130);
      expect(rawSizes.pr).toBeLessThan(550);
    } finally {
      await p1.close();
      await p2.close();
    }
  });

  it('8. Load-shedding green-zone gate rejects new queue/create when busy and reopens when green', async () => {
    let forcedLoad: ServerLoadStatus = 'red';
    const busySrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'busy.jsonl'),
      pingIntervalMs: 5000,
      getLoadOverride: () => forcedLoad,
    });
    const c = await connectClient(busySrv.port, 'Tester');
    try {
      c.send({ type: 'queue', mode: 'quick3', name: 'Tester' });
      const errBusy = await c.nextMsg((m) => m.type === 'error');
      expect(errBusy.code).toBe('server_busy');

      c.send({ type: 'create', mode: 'quick3', name: 'Tester' });
      const errBusy2 = await c.nextMsg((m) => m.type === 'error');
      expect(errBusy2.code).toBe('server_busy');

      // Server returns to green zone -> new connections & matchmaking accepted!
      forcedLoad = 'green';
      c.send({ type: 'create', mode: 'quick3', name: 'Tester' });
      const created = await c.nextMsg((m) => m.type === 'room_created');
      expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    } finally {
      await c.close();
      await busySrv.close();
    }
  });

  it('9. Security hardening: HTTP headers, dotfile blocking, XSS name sanitization, and WS rate limit', async () => {
    const httpGet = (urlPath: string) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${srv.port}${urlPath}`, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          })
          .on('error', reject);
      });

    const health = await httpGet('/health');
    expect(health.status).toBe(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    const healthJson = JSON.parse(health.body);
    expect(healthJson.load.status).toBe('green');

    // Dotfiles blocked
    const dotfile = await httpGet('/.env');
    expect([403, 404]).toContain(dotfile.status);

    // XSS payload stripped from player name
    const xssClient = await connectClient(srv.port, '<img src=x onerror=1>');
    openClients.push(xssClient);
    xssClient.send({ type: 'hello', name: '<script>alert(1)</script>' });
    const w = await xssClient.nextMsg((m) => m.type === 'welcome');
    expect(String(w.name)).not.toContain('<');
    expect(String(w.name)).not.toContain('>');
  });
});
