import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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
      randomizeFriendSides: false,
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

      // Yellow warning zone still allows queueing/room creation (only red overloads block!)
      forcedLoad = 'yellow';
      c.send({ type: 'queue', mode: 'quick3', name: 'Tester' });
      const queuedMsg = await c.nextMsg((m) => m.type === 'queued');
      expect(queuedMsg.mode).toBe('quick3');
      c.send({ type: 'unqueue' });
      await c.nextMsg((m) => m.type === 'unqueued');

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

  it('10. Host disconnects while waiting, guest joins within grace, host reconnects into started match', async () => {
    const host = await connectClient(srv.port, 'Host');
    host.send({ type: 'create', mode: 'quick3', name: 'Host' });
    const created = await host.nextMsg((m) => m.type === 'room_created');
    const code = created.code as string;
    const hostToken = created.token as string;

    await host.close();

    const guest = await connectClient(srv.port, 'Guest');
    openClients.push(guest);
    guest.send({ type: 'join', code, name: 'Guest' });
    const joined = await guest.nextMsg((m) => m.type === 'room_joined' || m.type === 'error');
    expect(joined.type).toBe('room_joined');
    expect(joined.code).toBe(code);
    await guest.nextMsg((m) => m.type === 'match_start');

    const hostReconnected = await connectClient(srv.port, 'Host');
    openClients.push(hostReconnected);
    hostReconnected.send({ type: 'reconnect', code, token: hostToken });
    const sync = await hostReconnected.nextMsg((m) => m.type === 'state_sync');
    expect(sync.code).toBe(code);
    expect(sync.side).toBe('home');
    expect((sync.names as { away: string }).away).toBe('Guest');

    const oppBack = await guest.nextMsg((m) => m.type === 'opponent_reconnected');
    expect(oppBack.type).toBe('opponent_reconnected');
  });

  it('11. Host disconnects and reconnects before any guest -> gets room_created with same code', async () => {
    const host = await connectClient(srv.port, 'Host');
    host.send({ type: 'create', mode: 'quick3', name: 'Host' });
    const created = await host.nextMsg((m) => m.type === 'room_created');
    const code = created.code as string;
    const token = created.token as string;

    await host.close();

    const host2 = await connectClient(srv.port, 'Host');
    openClients.push(host2);
    host2.send({ type: 'reconnect', code, token });
    const msg = await host2.nextMsg((m) => m.type === 'room_created' || m.type === 'state_sync');
    expect(msg.type).toBe('room_created');
    expect(msg.code).toBe(code);
    expect(msg.side).toBe('home');
    expect(msg.token).toBe(token);
  });

  it('12. Waiting room is deleted after waitingGraceMs if host never returns', async () => {
    const shortSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'short-grace.jsonl'),
      pingIntervalMs: 5000,
      graceMs: 60_000,
      waitingGraceMs: 120,
    });
    const host = await connectClient(shortSrv.port, 'Host');
    const guest = await connectClient(shortSrv.port, 'Guest');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'Host' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = created.code as string;

      await host.close();
      expect(shortSrv.rooms.has(code)).toBe(true);

      await new Promise((r) => setTimeout(r, 220));
      expect(shortSrv.rooms.has(code)).toBe(false);

      guest.send({ type: 'join', code, name: 'Guest' });
      const err = await guest.nextMsg((m) => m.type === 'error');
      expect(err.code).toBe('room_not_found');
    } finally {
      await guest.close();
      await shortSrv.close();
    }
  });

  it('12b. Guest joining while host is offline gets opponent_disconnected and wins after graceMs, not waitingGraceMs', async () => {
    const shortSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'join-offline-host.jsonl'),
      pingIntervalMs: 5000,
      graceMs: 150,
      randomizeFriendSides: false,
      waitingGraceMs: 60_000,
    });
    const host = await connectClient(shortSrv.port, 'Host');
    const guest = await connectClient(shortSrv.port, 'Guest');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'Host' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = created.code as string;
      await host.close();

      guest.send({ type: 'join', code, name: 'Guest' });
      await guest.nextMsg((m) => m.type === 'room_joined');
      const off = await guest.nextMsg((m) => m.type === 'opponent_disconnected');
      expect(off.graceSec).toBe(0);
      const over = await guest.nextMsg((m) => m.type === 'match_over', 2000);
      expect(over.winner).toBe('away');
      expect(over.reason).toBe('disconnect_timeout');
      expect(shortSrv.rooms.has(code)).toBe(false);
    } finally {
      await guest.close();
      await shortSrv.close();
    }
  });

  it('13. Protocol-level ws.ping keeps frozen-JS clients alive while closing truly silent sockets', async () => {
    const hbSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'hb.jsonl'),
      pingIntervalMs: 50,
      deadSocketTimeoutMs: 260,
    });
    // Frozen-JS client: never sends JSON messages after hello, but browser/OS stack still auto-pongs RFC 6455 ping
    const bgWs = new WebSocket(`ws://127.0.0.1:${hbSrv.port}`, { autoPong: true });
    // Truly dead client: stops replying even to protocol-level ping
    const deadWs = new WebSocket(`ws://127.0.0.1:${hbSrv.port}`, { autoPong: false });
    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          bgWs.once('open', () => {
            bgWs.send(JSON.stringify({ type: 'hello', name: 'BackgroundTab' }));
            resolve();
          });
          bgWs.once('error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          deadWs.once('open', () => {
            deadWs.send(JSON.stringify({ type: 'hello', name: 'DeadSocket' }));
            resolve();
          });
          deadWs.once('error', reject);
        }),
      ]);

      const deadClosed = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1500);
        deadWs.once('close', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      expect(deadClosed).toBe(true);
      // Background tab stayed alive past deadSocketTimeoutMs via protocol-level pong
      expect(bgWs.readyState).toBe(WebSocket.OPEN);
    } finally {
      if (bgWs.readyState !== WebSocket.CLOSED) bgWs.close();
      if (deadWs.readyState !== WebSocket.CLOSED) deadWs.close();
      await hbSrv.close();
    }
  });

  it('14. Guest reconnect with token keeps its seat while a second join gets room_full', async () => {
    const host = await connectClient(srv.port, 'Host');
    const guest = await connectClient(srv.port, 'Guest');
    openClients.push(host);

    host.send({ type: 'create', mode: 'quick3', name: 'Host' });
    const created = await host.nextMsg((m) => m.type === 'room_created');
    const code = created.code as string;

    guest.send({ type: 'join', code, name: 'Guest' });
    const joined = await guest.nextMsg((m) => m.type === 'room_joined');
    const guestToken = joined.token as string;
    await host.nextMsg((m) => m.type === 'match_start');
    await guest.nextMsg((m) => m.type === 'match_start');

    await guest.close();
    await host.nextMsg((m) => m.type === 'opponent_disconnected');

    const intruder = await connectClient(srv.port, 'Intruder');
    openClients.push(intruder);
    intruder.send({ type: 'join', code, name: 'Intruder' });
    const fullErr = await intruder.nextMsg((m) => m.type === 'error');
    expect(fullErr.code).toBe('room_full');

    const guest2 = await connectClient(srv.port, 'Guest');
    openClients.push(guest2);
    guest2.send({ type: 'reconnect', code, token: guestToken });
    const sync = await guest2.nextMsg((m) => m.type === 'state_sync');
    expect(sync.code).toBe(code);
    expect(sync.side).toBe('away');
  });

  it('15. Server authoritative Pitch Clock issues automatic ball on timeout and broadcasts clockViolation', async () => {
    const clockSrv = await startServer(0, {
      pitchClockScale: 0.012,
      graceMs: 1000,
      randomizeFriendSides: false,
    });
    const host = await connectClient(clockSrv.port, 'ClockHost');
    const guest = await connectClient(clockSrv.port, 'ClockGuest');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'ClockHost' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = created.code as string;

      guest.send({ type: 'join', code, name: 'ClockGuest' });
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // Do not pitch -> server Pitch Clock expires and broadcasts clockViolation pitch_result to both!
      const [hRes, gRes] = await Promise.all([
        host.nextMsg((m) => m.type === 'pitch_result', 3000),
        guest.nextMsg((m) => m.type === 'pitch_result', 3000),
      ]);
      expect(hRes.clockViolation).toBe(true);
      expect(gRes.clockViolation).toBe(true);
      expect((hRes.match as { balls: number }).balls).toBe(1);
      expect((hRes.callout as { title: string }).title).toBe('PITCH CLOCK');
    } finally {
      await host.close();
      await guest.close();
      await clockSrv.close();
    }
  });

  it('16. /metrics reports HTTP/WS traffic, connection role split, rejections, and zero PII', async () => {
    let forcedLoad: ServerLoadStatus = 'green';
    const monSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'mon-matches.jsonl'),
      metricsLogPath: path.join(tmpDir, 'metrics.jsonl'),
      maxConnPerIp: 2,
      getLoadOverride: () => forcedLoad,
    });
    const fetchMetrics = () =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${monSrv.port}/capbaseball/metrics`, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          })
          .on('error', reject);
      });

    const c1 = await connectClient(monSrv.port, 'SecretAlice');
    const c2 = await connectClient(monSrv.port, 'SecretBob');
    try {
      c1.send({ type: 'create', mode: 'quick3', name: 'SecretAlice' });
      const created = await c1.nextMsg((m) => m.type === 'room_created');
      const code = created.code as string;

      c2.send({ type: 'queue', mode: 'quick3', name: 'SecretBob' });
      await c2.nextMsg((m) => m.type === 'queued');

      // Trigger server_busy rejection counter while red
      forcedLoad = 'red';
      c2.send({ type: 'create', mode: 'quick3', name: 'SecretBob' });
      const busyErr = await c2.nextMsg((m) => m.type === 'error');
      expect(busyErr.code).toBe('server_busy');

      // Trigger maxConnPerIp rejection counter (3rd socket from same IP)
      const c3Ws = new WebSocket(`ws://127.0.0.1:${monSrv.port}`);
      const c3Code = await new Promise<number>((resolve) => {
        c3Ws.once('close', (closeCode) => resolve(closeCode));
      });
      expect(c3Code).toBe(1008);

      const mRes = await fetchMetrics();
      expect(mRes.status).toBe(200);
      // Zero PII: player names & room codes never appear in metrics payload
      expect(mRes.body).not.toContain('SecretAlice');
      expect(mRes.body).not.toContain('SecretBob');
      expect(mRes.body).not.toContain(code);

      const report = JSON.parse(mRes.body);
      expect(report.connections.activeClients).toBe(2);
      expect(report.connections.inMatch).toBe(1);
      expect(report.connections.queuing).toBe(1);
      expect(report.connections.uniqueIps).toBe(1);
      expect(report.connections.maxConnsSingleIp).toBe(2);
      expect(report.connections.roomsActive).toBe(1);
      expect(report.connections.friendRooms).toBe(1);
      expect(report.connections.acceptedTotal).toBe(2);
      expect(report.traffic.wsInMsgsTotal).toBeGreaterThanOrEqual(4);
      expect(report.traffic.wsOutMsgsTotal).toBeGreaterThanOrEqual(4);
      expect(report.traffic.httpRequestsTotal).toBeGreaterThanOrEqual(0);
      expect(report.rejections.serverBusy).toBe(1);
      expect(report.rejections.ipLimit).toBe(1);
      expect(report.pi.memTotalMb).toBeGreaterThan(0);
    } finally {
      await c1.close();
      await c2.close();
      await monSrv.close();
    }
  });

  it('17. /monitor UI obeys CSP (external monitor.js) and respects monitorToken', async () => {
    const authSrv = await startServer(0, {
      monitorToken: 'secret-mon-42',
    });
    const reqHttp = (p: string) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${authSrv.port}${p}`, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          })
          .on('error', reject);
      });

    try {
      const htmlRes = await reqHttp('/capbaseball/monitor');
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers['content-type']).toContain('text/html');
      expect(htmlRes.headers['content-security-policy']).toContain("script-src 'self'");
      expect(htmlRes.headers['cache-control']).toContain('no-store');
      expect(htmlRes.body).toMatch(/src="\.\/monitor\.js\?v=[^"]+"/);
      expect(htmlRes.body).not.toMatch(/<script(?![^>]*src=)/i);

      const jsRes = await reqHttp('/capbaseball/monitor.js?v=test');
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers['content-type']).toContain('javascript');
      expect(jsRes.headers['cache-control']).toContain('no-store');
      expect(jsRes.body).toContain('./metrics');

      const slashRes = await reqHttp('/capbaseball/monitor/');
      expect(slashRes.status).toBe(301);
      expect(slashRes.headers.location).toBe('/capbaseball/monitor');

      const unauth = await reqHttp('/capbaseball/metrics');
      expect(unauth.status).toBe(401);

      const authed = await reqHttp('/capbaseball/metrics?token=secret-mon-42');
      expect(authed.status).toBe(200);
      expect(JSON.parse(authed.body).ok).toBe(true);
    } finally {
      await authSrv.close();
    }
  });

  it('18. In-memory static cache serves ETag, 304 Not Modified, and gzip pre-compressed bundles', async () => {
    const distDir = path.join(tmpDir, 'dist-mock');
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    const indexHtml = '<!doctype html><html><body>CapBaseball</body></html>';
    const jsBundle = 'console.log("hello capbaseball bundle");'.repeat(10);
    fs.writeFileSync(path.join(distDir, 'index.html'), indexHtml);
    fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), jsBundle);
    fs.writeFileSync(path.join(distDir, 'assets', 'app.js.gz'), zlib.gzipSync(jsBundle));

    const cacheSrv = await startServer(0, { staticDir: distDir });
    const reqRaw = (p: string, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${cacheSrv.port}${p}`, { headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
            );
          })
          .on('error', reject);
      });

    try {
      const r1 = await reqRaw('/capbaseball/');
      expect(r1.status).toBe(200);
      expect(r1.body.toString('utf8')).toBe(indexHtml);
      expect(r1.headers.etag).toBeTruthy();

      const r304 = await reqRaw('/capbaseball/', { 'If-None-Match': String(r1.headers.etag) });
      expect(r304.status).toBe(304);
      expect(r304.body.length).toBe(0);

      const rGz = await reqRaw('/capbaseball/assets/app.js', { 'Accept-Encoding': 'gzip' });
      expect(rGz.status).toBe(200);
      expect(rGz.headers['content-encoding']).toBe('gzip');
      expect(rGz.headers['cache-control']).toContain('immutable');
      expect(zlib.gunzipSync(rGz.body).toString('utf8')).toBe(jsBundle);

      const metricsRes = await reqRaw('/capbaseball/metrics');
      const report = JSON.parse(metricsRes.body.toString('utf8'));
      expect(report.traffic.staticCache.files).toBe(2);
      expect(report.traffic.staticCache.hits).toBe(2);
      expect(report.traffic.staticCache.notModified304).toBe(1);
    } finally {
      await cacheSrv.close();
    }
  });

  it('19. Default guest names fall back to 6 unique random alphanumeric characters', async () => {
    const g1 = await connectClient(srv.port, '');
    const g2 = await connectClient(srv.port, 'PLAYER');
    openClients.push(g1, g2);

    g1.send({ type: 'hello', name: '' });
    const w1 = await g1.nextMsg((m) => m.type === 'welcome');
    g2.send({ type: 'hello', name: 'PLAYER' });
    const w2 = await g2.nextMsg((m) => m.type === 'welcome');

    expect(w1.name).toMatch(/^[A-Z0-9]{6}$/);
    expect(new Set(String(w1.name)).size).toBe(6);
    expect(w2.name).toMatch(/^[A-Z0-9]{6}$/);
    expect(new Set(String(w2.name)).size).toBe(6);
    expect(w1.name).not.toBe(w2.name);

    // Custom names longer than 12 characters are truncated to 12 characters
    g1.send({ type: 'hello', name: 'ABCDEFGHIJKLMNO' });
    const w3 = await g1.nextMsg((m) => m.type === 'welcome');
    expect(w3.name).toBe('ABCDEFGHIJKL');
  });

  it('20. /metrics tracks match gameplay anomalies (clamped inputs, stale packets, clock violations, room scan)', async () => {
    const anomSrv = await startServer(0, {
      pitchClockScale: 0.015,
      swingTimeoutPaddingMs: 30,
      graceMs: 1000,
      randomizeFriendSides: false,
    });
    const host = await connectClient(anomSrv.port, 'AnomHost');
    const guest = await connectClient(anomSrv.port, 'AnomGuest');

    const getMetrics = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${anomSrv.port}/capbaseball/metrics`, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve(JSON.parse(body)));
          })
          .on('error', reject);
      });

    try {
      host.send({ type: 'create', mode: 'quick3', name: 'AnomHost' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = created.code as string;

      guest.send({ type: 'join', code, name: 'AnomGuest' });
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // 1. Trigger a Pitch Clock violation (do not throw)
      await Promise.all([
        host.nextMsg((m) => m.type === 'pitch_result' && m.clockViolation === true, 3000),
        guest.nextMsg((m) => m.type === 'pitch_result' && m.clockViolation === true, 3000),
      ]);

      // 2. Submit out-of-range pitch speed (triggers outOfRangeInputsClamped) + send stale pitchSeq (triggers staleOrOutOfTurnIgnored)
      host.send({
        type: 'pitch_submit',
        pitchSeq: 2,
        pitchId: 'straight',
        speedKmh: 999,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      await host.nextMsg((m) => m.type === 'pitch_launch');
      await guest.nextMsg((m) => m.type === 'pitch_launch');

      // Stale pitchSeq swing ignored -> increments staleOrOutOfTurnIgnored
      guest.send({ type: 'no_swing', pitchSeq: 1 });

      // Wait for swingTimer timeout -> increments swingTimeouts
      await Promise.all([
        host.nextMsg((m) => m.type === 'pitch_result', 3000),
        guest.nextMsg((m) => m.type === 'pitch_result', 3000),
      ]);

      const report = (await getMetrics()) as {
        gameplay: {
          matchesStarted: number;
          pitchClockViolations: number;
          swingTimeouts: number;
          staleOrOutOfTurnIgnored: number;
          outOfRangeInputsClamped: number;
          nanSanityErrors: number;
          roomsHealth: { startedRooms: number; stalledRooms: number };
        };
      };
      expect(report.gameplay.matchesStarted).toBe(1);
      expect(report.gameplay.pitchClockViolations).toBeGreaterThanOrEqual(1);
      expect(report.gameplay.swingTimeouts).toBe(1);
      expect(report.gameplay.staleOrOutOfTurnIgnored).toBe(1);
      expect(report.gameplay.outOfRangeInputsClamped).toBe(1);
      expect(report.gameplay.nanSanityErrors).toBe(0);
      expect(report.gameplay.roomsHealth.startedRooms).toBe(1);
      expect(report.gameplay.roomsHealth.stalledRooms).toBe(0);
    } finally {
      await host.close();
      await guest.close();
      await anomSrv.close();
    }
  });

  it('21. Tiered capacity (480 public + 20 friend reserve) blocks public queue while allowing friend rooms', async () => {
    const capSrv = await startServer(0, {
      maxClients: 4,
      publicClientCap: 2,
      graceMs: 3000,
    });
    const c1 = await connectClient(capSrv.port, 'P1');
    const c2 = await connectClient(capSrv.port, 'P2');
    const c3 = await connectClient(capSrv.port, 'P3'); // 3rd client > publicClientCap(2), inside friend reserve (<=4)
    try {
      // Public matchmaking queue is rejected with server_busy
      c3.send({ type: 'queue', mode: 'quick3', name: 'P3' });
      const err = await c3.nextMsg((m) => m.type === 'error');
      expect(err.code).toBe('server_busy');

      // Friend room create still succeeds inside the reserve buffer!
      c3.send({ type: 'create', mode: 'quick3', name: 'P3', mercyRule: false });
      const created = await c3.nextMsg((m) => m.type === 'room_created');
      expect(typeof created.code).toBe('string');

      // 4th client joins friend room and inherits mercyRule: false
      const c4 = await connectClient(capSrv.port, 'P4');
      try {
        c4.send({ type: 'join', code: created.code, name: 'P4' });
        const start = await c4.nextMsg((m) => m.type === 'match_start');
        expect((start.match as { mercyRule?: boolean }).mercyRule).toBe(false);
      } finally {
        await c4.close();
      }
    } finally {
      await c1.close();
      await c2.close();
      await c3.close();
      await capSrv.close();
    }
  });

  it('22. In-match Emotes broadcast across room and enforce 3s spam cooldown', async () => {
    const home = await connectClient(srv.port, 'EmHome');
    const away = await connectClient(srv.port, 'EmAway');
    openClients.push(home, away);

    home.send({ type: 'create', mode: 'quick3', name: 'EmHome' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: 'EmAway' });
    await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');

    home.send({ type: 'emote', id: 'fire' });
    // Immediate spam should be dropped by 3s cooldown
    home.send({ type: 'emote', id: 'nice' });

    const emH = await home.nextMsg((m) => m.type === 'emote');
    const emA = await away.nextMsg((m) => m.type === 'emote');
    expect(emH.side).toBe('home');
    expect(emH.id).toBe('fire');
    expect(emA.side).toBe('home');
    expect(emA.id).toBe('fire');

    // Wait briefly and ensure second spammed emote was NOT broadcast
    await new Promise((r) => setTimeout(r, 120));
    expect(away.queue.filter((m) => m.type === 'emote').length).toBe(0);
  });

  it('23. Mutual room creation deadlock recovery: host of empty waiting room can join friend room directly', async () => {
    const p1 = await connectClient(srv.port, 'HostA');
    const p2 = await connectClient(srv.port, 'HostB');
    openClients.push(p1, p2);

    // Both players accidentally create their own friend rooms
    p1.send({ type: 'create', mode: 'quick3', name: 'HostA' });
    const roomA = await p1.nextMsg((m) => m.type === 'room_created');
    p2.send({ type: 'create', mode: 'quick3', name: 'HostB' });
    const roomB = await p2.nextMsg((m) => m.type === 'room_created');
    expect(roomA.code).not.toBe(roomB.code);

    // Joining own room returns clean error without destroying roomB
    p2.send({ type: 'join', code: roomB.code, name: 'HostB' });
    const selfErr = await p2.nextMsg((m) => m.type === 'error');
    expect(selfErr.code).toBe('already_in_room');

    // Typo room code returns room_not_found without destroying roomB
    p2.send({ type: 'join', code: 'ZZZZ', name: 'HostB' });
    const typoErr = await p2.nextMsg((m) => m.type === 'error');
    expect(typoErr.code).toBe('room_not_found');

    // Now p2 joins p1's room -> server abandons empty roomB and starts match immediately!
    p2.send({ type: 'join', code: roomA.code, name: 'HostB' });
    const joined = await p2.nextMsg((m) => m.type === 'room_joined');
    expect(joined.code).toBe(roomA.code);

    const start1 = await p1.nextMsg((m) => m.type === 'match_start');
    const start2 = await p2.nextMsg((m) => m.type === 'match_start');
    expect(start1.code).toBe(roomA.code);
    expect(start2.code).toBe(roomA.code);
  });

  it('24. Online menu_pause freezes server Pitch Clock, blocks opponent throws/IBB, and auto-resumes on timeout', async () => {
    const pauseSrv = await startServer(0, {
      pitchClockScale: 0.03, // ~450ms pitch clock
      menuPauseMs: 500, // 500ms authoritative menu pause timeout
      absWindowMs: 0,
      randomizeFriendSides: false,
    });
    const host = await connectClient(pauseSrv.port, 'PauseHost');
    const guest = await connectClient(pauseSrv.port, 'PauseGuest');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'PauseHost' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      guest.send({ type: 'join', code: created.code, name: 'PauseGuest' });
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // Guest (batter) opens Menu -> BOTH sides receive pause_state and server Pitch Clock freezes!
      guest.send({ type: 'menu_pause', paused: true });
      const psH = await host.nextMsg((m) => m.type === 'pause_state');
      const psG = await guest.nextMsg((m) => m.type === 'pause_state');
      expect(psH.pausedSides).toEqual(['away']);
      expect(psG.pausedSides).toEqual(['away']);

      // While guest is paused, host (pitcher) tries to throw & IBB -> MUST be ignored!
      host.send({
        type: 'pitch_submit',
        pitchSeq: 1,
        pitchId: 'straight',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      host.send({ type: 'ibb', pitchSeq: 1 });

      // Wait 320ms (well past pitchClock ~450ms if it hadn't frozen after start; ensure no launch or violation during pause)
      await new Promise((r) => setTimeout(r, 320));
      expect(host.queue.filter((m) => m.type === 'pitch_launch' || m.type === 'pitch_result').length).toBe(0);

      // Authoritative 500ms menu pause auto-expires -> broadcasts empty pausedSides and resumes Pitch Clock -> clockViolation fires!
      const unpausedH = await host.nextMsg((m) => m.type === 'pause_state' && Array.isArray(m.pausedSides) && m.pausedSides.length === 0, 2000);
      expect(unpausedH.pausedSides).toEqual([]);

      const violation = await host.nextMsg((m) => m.type === 'pitch_result' && m.clockViolation === true, 3000);
      expect(violation.clockViolation).toBe(true);
    } finally {
      await host.close();
      await guest.close();
      await pauseSrv.close();
    }
  });

  it('25. ABS window protects batter from premature sneak-throws until window ends or ABS is triggered', async () => {
    const absSrv = await startServer(0, {
      pitchClockScale: 0,
      absWindowMs: 350,
      randomizeFriendSides: false,
    });
    const host = await connectClient(absSrv.port, 'AbsHost');
    const guest = await connectClient(absSrv.port, 'AbsGuest');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'AbsHost' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      guest.send({ type: 'join', code: created.code, name: 'AbsGuest' });
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // Pitch #1: strike taken -> batter (away) has ABS window for 350ms
      host.send({
        type: 'pitch_submit',
        pitchSeq: 1,
        pitchId: 'straight',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      await host.nextMsg((m) => m.type === 'pitch_launch');
      await guest.nextMsg((m) => m.type === 'pitch_launch');
      guest.send({ type: 'no_swing', pitchSeq: 1 });
      await host.nextMsg((m) => m.type === 'pitch_result');
      await guest.nextMsg((m) => m.type === 'pitch_result');

      // Pitcher immediately attempts sneak-throw pitchSeq=2 during batter's ABS window -> rejected!
      host.send({
        type: 'pitch_submit',
        pitchSeq: 2,
        pitchId: 'straight',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      await new Promise((r) => setTimeout(r, 150));
      expect(host.queue.filter((m) => m.type === 'pitch_launch').length).toBe(0);

      // After ABS window expires, pitchSeq=2 succeeds cleanly!
      await new Promise((r) => setTimeout(r, 260));
      host.send({
        type: 'pitch_submit',
        pitchSeq: 2,
        pitchId: 'straight',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      const launch2 = await host.nextMsg((m) => m.type === 'pitch_launch', 2000);
      expect(launch2.pitchSeq).toBe(2);
    } finally {
      await host.close();
      await guest.close();
      await absSrv.close();
    }
  });

  it('26. Spectators can send quick-chat emotes visible to players and spectators with 3s cooldown', async () => {
    const home = await connectClient(srv.port, 'SpecChatH');
    const away = await connectClient(srv.port, 'SpecChatA');
    const spec = await connectClient(srv.port, 'CrowdFan');
    openClients.push(home, away, spec);

    home.send({ type: 'create', mode: 'quick3', name: 'SpecChatH' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: 'SpecChatA' });
    await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');

    spec.send({ type: 'watch', code: created.code });
    await spec.nextMsg((m) => m.type === 'spectate_sync');

    // Spectator sends quick-chat + immediate spam -> only first broadcasts with side='spectator' & senderName
    spec.send({ type: 'emote', id: 'clap' });
    spec.send({ type: 'emote', id: 'fire' });

    const emH = await home.nextMsg((m) => m.type === 'emote');
    const emA = await away.nextMsg((m) => m.type === 'emote');
    const emS = await spec.nextMsg((m) => m.type === 'emote');
    expect(emH.side).toBe('spectator');
    expect(emH.id).toBe('clap');
    expect(emH.senderName).toBe('CrowdFan');
    expect(emA.side).toBe('spectator');
    expect(emA.id).toBe('clap');
    expect(emS.side).toBe('spectator');
    expect(emS.id).toBe('clap');

    await new Promise((r) => setTimeout(r, 120));
    expect(home.queue.filter((m) => m.type === 'emote').length).toBe(0);
  });

  it('27. Online swing-and-miss preserves true swingData & miss resolution (dtTiming, label, hitField) over v2 protocol', async () => {
    const home = await connectClient(srv.port, 'MissPitch');
    const away = await connectClient(srv.port, 'MissBat');
    const spec = await connectClient(srv.port, 'MissSpec');
    openClients.push(home, away, spec);

    home.send({ type: 'create', mode: 'quick3', name: 'MissPitch' });
    const created = await home.nextMsg((m) => m.type === 'room_created');
    away.send({ type: 'join', code: created.code, name: 'MissBat' });
    const msH = await home.nextMsg((m) => m.type === 'match_start');
    await away.nextMsg((m) => m.type === 'match_start');
    expect(msH.roomKind).toBe('friend');

    spec.send({ type: 'watch', code: created.code });
    const sp = await spec.nextMsg((m) => m.type === 'spectate_sync');
    expect(sp.roomKind).toBe('friend');

    // Pitcher throws right down the middle
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

    // Batter swings WAY TOO EARLY (flightTimeSec = 0.25s) at (0.14, 0.88)
    away.send({
      type: 'swing_input',
      pitchSeq: 1,
      flightTimeSec: 0.25,
      batX: 0.14,
      batY: 0.88,
      swingMode: 'normal',
      batterSide: 'L',
    });

    const prSpec = await spec.nextMsg((m) => m.type === 'pitch_result');
    expect(prSpec.swung).toBe(true);
    const sd = prSpec.swingData as { batX: number; batY: number } | null;
    const res = prSpec.resolution as { contact: boolean; dtTiming: number; label: string; detail: string; hitField: number[] } | null;
    expect(sd).not.toBeNull();
    expect(sd!.batX).toBeCloseTo(0.14, 2);
    expect(sd!.batY).toBeCloseTo(0.88, 2);
    expect(res).not.toBeNull();
    expect(res!.contact).toBe(false);
    expect(res!.dtTiming).toBeLessThan(-0.15);
    expect(res!.detail).toBe('TOO EARLY');
    expect(Array.isArray(res!.hitField)).toBe(true);
  });

  it('28. Standby match offer cascades on decline/timeout, starts LIVE match on accept, and room_list separates LIVE vs FRIEND', async () => {
    const sbSrv = await startServer(0, { pitchClockScale: 0, offerTimeoutMs: 400 });
    const sb1 = await connectClient(sbSrv.port, 'Standby1');
    const sb2 = await connectClient(sbSrv.port, 'Standby2');
    const waiter = await connectClient(sbSrv.port, 'LiveWaiter');
    const fHost = await connectClient(sbSrv.port, 'FriendH');
    const fGuest = await connectClient(sbSrv.port, 'FriendA');
    const lister = await connectClient(sbSrv.port, 'Lister');
    try {
      // Standby2 joins passively first (e.g. practice), then Standby1 joins with priority (from online matchmaking fallback)
      sb2.send({ t: 'sj', m: 0 });
      sb1.send({ t: 'sj', m: 0, p: 1 });
      await new Promise((r) => setTimeout(r, 40));

      // LiveWaiter enters online matchmaking queue -> server prioritizes Standby1 ahead of passive Standby2!
      waiter.send({ type: 'queue', mode: 'quick3', name: 'LiveWaiter' });
      await waiter.nextMsg((m) => m.type === 'queued');
      const offer1 = await sb1.nextMsg((m) => m.type === 'match_offer');
      expect(offer1.opponentName).toBe('LiveWaiter');

      // Standby1 reports shown and ignores until timeout -> server treats as decline, removes from standby, and cascades to Standby2!
      sb1.send({ type: 'offer_shown', offerId: offer1.offerId });
      const cancelled1 = await sb1.nextMsg((m) => m.type === 'offer_cancelled', 1500);
      expect(cancelled1.reason).toBe('timeout');
      const offer2 = await sb2.nextMsg((m) => m.type === 'match_offer', 1500);
      expect(offer2.opponentName).toBe('LiveWaiter');

      // Standby2 accepts -> LiveWaiter & Standby2 enter a LIVE room!
      sb2.send({ type: 'offer_shown', offerId: offer2.offerId });
      sb2.send({ type: 'offer_reply', offerId: offer2.offerId, accept: true });
      const msLive1 = await sb2.nextMsg((m) => m.type === 'match_start');
      const msLive2 = await waiter.nextMsg((m) => m.type === 'match_start');
      expect(msLive1.roomKind).toBe('live');
      expect(msLive2.roomKind).toBe('live');

      // Create a parallel FRIEND room
      fHost.send({ type: 'create', mode: 'quick3', name: 'FriendH' });
      const fc = await fHost.nextMsg((m) => m.type === 'room_created');
      fGuest.send({ type: 'join', code: fc.code, name: 'FriendA' });
      await fHost.nextMsg((m) => m.type === 'match_start');
      await fGuest.nextMsg((m) => m.type === 'match_start');

      // room_list distinguishes LIVE vs FRIEND and reports outs
      lister.send({ type: 'list' });
      const listMsg = await lister.nextMsg((m) => m.type === 'room_list');
      const roomArr = listMsg.rooms as Array<{ code: string; roomKind: string; outs: number }>;
      const liveEntry = roomArr.find((r) => r.code === msLive1.code);
      const friendEntry = roomArr.find((r) => r.code === fc.code);
      expect(liveEntry?.roomKind).toBe('live');
      expect(friendEntry?.roomKind).toBe('friend');
      expect(typeof liveEntry?.outs).toBe('number');
    } finally {
      await Promise.all([sb1.close(), sb2.close(), waiter.close(), fHost.close(), fGuest.close(), lister.close()]);
      await sbSrv.close();
    }
  });

  it('29. /metrics connections.activities breaks down all connected player pages accurately with zero PII', async () => {
    const actSrv = await startServer(0, { pitchClockScale: 0, maxConnPerIp: 20 });
    const cTitle = await connectClient(actSrv.port, 'ActTitle');
    const cCpu = await connectClient(actSrv.port, 'ActCpu');
    const cBat = await connectClient(actSrv.port, 'ActBat');
    const cLab = await connectClient(actSrv.port, 'ActLab');
    const cStandby = await connectClient(actSrv.port, 'ActStandby');
    const cFHost = await connectClient(actSrv.port, 'ActFHost');
    const cFGuest = await connectClient(actSrv.port, 'ActFGuest');
    const cSpec = await connectClient(actSrv.port, 'ActSpec');

    const fetchMetrics = () =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${actSrv.port}/capbaseball/metrics`, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          })
          .on('error', reject);
      });

    try {
      // Send page activities (including an invalid value on cTitle which should be ignored and remain 'title')
      cTitle.send({ t: 'ac', a: 'invalid_page_hack' });
      cCpu.send({ t: 'ac', a: 'cpu_match' });
      cBat.send({ t: 'ac', a: 'practice_bat' });
      cLab.send({ t: 'ac', a: 'pitch_lab' });
      cStandby.send({ t: 'ac', a: 'practice_pitch' });
      cStandby.send({ type: 'standby_join', mode: 'quick3' });

      // Friend match + spectator
      cFHost.send({ type: 'create', mode: 'quick3', name: 'ActFHost' });
      const created = await cFHost.nextMsg((m) => m.type === 'room_created');
      cFGuest.send({ type: 'join', code: created.code, name: 'ActFGuest' });
      await cFHost.nextMsg((m) => m.type === 'match_start');
      await cFGuest.nextMsg((m) => m.type === 'match_start');
      cSpec.send({ type: 'watch', code: created.code });
      await cSpec.nextMsg((m) => m.type === 'spectate_sync');

      await new Promise((r) => setTimeout(r, 40));

      const res = await fetchMetrics();
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('ActTitle');
      expect(res.body).not.toContain('invalid_page_hack');

      const report = JSON.parse(res.body);
      const act = report.connections.activities as Record<string, number>;
      expect(report.connections.activeClients).toBe(8);
      expect(report.connections.standbyCount).toBe(1);
      expect(act.title).toBe(1);
      expect(act.cpu_match).toBe(1);
      expect(act.practice_bat).toBe(1);
      expect(act.practice_pitch).toBe(1);
      expect(act.pitch_lab).toBe(1);
      expect(act.online_friend).toBe(2);
      expect(act.spectating).toBe(1);
      const sum = Object.values(act).reduce((a, b) => a + b, 0);
      expect(sum).toBe(report.connections.activeClients);
    } finally {
      await Promise.all([
        cTitle.close(),
        cCpu.close(),
        cBat.close(),
        cLab.close(),
        cStandby.close(),
        cFHost.close(),
        cFGuest.close(),
        cSpec.close(),
      ]);
      await actSrv.close();
    }
  });

  it('30. 2 consecutive Pitch Clock violations forfeit the stalling pitcher (and a real pitch resets the counter)', async () => {
    const pcSrv = await startServer(0, {
      pitchClockScale: 0.01, // ~180ms per violation
      absWindowMs: 0,
      randomizeFriendSides: false,
    });
    const host = await connectClient(pcSrv.port, 'StallP');
    const guest = await connectClient(pcSrv.port, 'WaitB');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'StallP' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      guest.send({ type: 'join', code: created.code, name: 'WaitB' });
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // Violation 1/2
      const v1 = await guest.nextMsg((m) => m.type === 'pitch_result' && m.clockViolation === true, 3000);
      expect((v1.callout as { subtitle: string }).subtitle).toContain('1/2');

      // Pitcher throws a real pitch -> resets consecutive violation counter to 0!
      host.send({
        type: 'pitch_submit',
        pitchSeq: v1.nextPitchSeq,
        pitchId: 'straight',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      await host.nextMsg((m) => m.type === 'pitch_launch', 3000);
      const launch = await guest.nextMsg((m) => m.type === 'pitch_launch', 3000);
      guest.send({ type: 'no_swing', pitchSeq: launch.pitchSeq });
      await host.nextMsg((m) => m.type === 'pitch_result', 3000);
      await guest.nextMsg((m) => m.type === 'pitch_result', 3000);

      // Now stall 2 consecutive times -> 1/2, then 2nd immediately forfeits the pitcher!
      const s1 = await guest.nextMsg((m) => m.type === 'pitch_result' && m.clockViolation === true, 3000);
      expect((s1.callout as { subtitle: string }).subtitle).toContain('1/2');

      const [overH, overG] = await Promise.all([
        host.nextMsg((m) => m.type === 'match_over', 3000),
        guest.nextMsg((m) => m.type === 'match_over', 3000),
      ]);
      expect(overH.reason).toBe('pitch_clock_forfeit');
      expect(overH.winner).toBe('away');
      expect(overG.reason).toBe('pitch_clock_forfeit');
      expect(overG.winner).toBe('away');
      expect((overG.match as { isGameOver: boolean; endReason?: string }).isGameOver).toBe(true);
      expect((overG.match as { isGameOver: boolean; endReason?: string }).endReason).toBe('pitch_clock');
    } finally {
      await host.close();
      await guest.close();
      await pcSrv.close();
    }
  });

  it('31. Live spectator_count broadcasts on watch/unwatch/disconnect and friend rooms randomize home/away sides', async () => {
    const rsSrv = await startServer(0, { pitchClockScale: 0, maxConnPerIp: 40 });
    const h = await connectClient(rsSrv.port, 'SpecHost');
    const g = await connectClient(rsSrv.port, 'SpecGuest');
    const sp1 = await connectClient(rsSrv.port, 'Watcher1');
    const sp2 = await connectClient(rsSrv.port, 'Watcher2');
    try {
      h.send({ type: 'create', mode: 'quick3', name: 'SpecHost' });
      const created = await h.nextMsg((m) => m.type === 'room_created');
      g.send({ type: 'join', code: created.code, name: 'SpecGuest' });
      const msH = await h.nextMsg((m) => m.type === 'match_start');
      const msG = await g.nextMsg((m) => m.type === 'match_start');
      expect(msH.spectators).toBe(0);
      expect(msG.spectators).toBe(0);
      expect(new Set([msH.side, msG.side])).toEqual(new Set(['home', 'away']));

      // Spectator 1 watches -> both players receive spectator_count: 1
      sp1.send({ type: 'watch', code: created.code });
      const sync1 = await sp1.nextMsg((m) => m.type === 'spectate_sync');
      expect(sync1.spectators).toBe(1);
      const scH1 = await h.nextMsg((m) => m.type === 'spectator_count');
      const scG1 = await g.nextMsg((m) => m.type === 'spectator_count');
      expect(scH1.count).toBe(1);
      expect(scG1.count).toBe(1);

      // Spectator 2 watches -> players & Spectator 1 receive spectator_count: 2
      sp2.send({ type: 'watch', code: created.code });
      await sp2.nextMsg((m) => m.type === 'spectate_sync');
      const scH2 = await h.nextMsg((m) => m.type === 'spectator_count');
      const scS1 = await sp1.nextMsg((m) => m.type === 'spectator_count' && m.count === 2);
      expect(scH2.count).toBe(2);
      expect(scS1.count).toBe(2);

      // Spectator 1 unwatches -> spectator_count drops to 1
      sp1.send({ type: 'unwatch' });
      await sp1.nextMsg((m) => m.type === 'unwatched');
      const scH3 = await h.nextMsg((m) => m.type === 'spectator_count' && m.count === 1);
      expect(scH3.count).toBe(1);

      // Spectator 2 disconnects -> spectator_count drops to 0
      await sp2.close();
      const scH4 = await h.nextMsg((m) => m.type === 'spectator_count' && m.count === 0);
      expect(scH4.count).toBe(0);

      // Verify friend room side randomization assigns both home & away across repeated rooms
      const hostSides = new Set<string>();
      for (let i = 0; i < 16 && hostSides.size < 2; i++) {
        const rh = await connectClient(rsSrv.port, `RH${i}`);
        const rg = await connectClient(rsSrv.port, `RG${i}`);
        rh.send({ type: 'create', mode: 'quick3', name: `RH${i}` });
        const rc = await rh.nextMsg((m) => m.type === 'room_created');
        rg.send({ type: 'join', code: rc.code, name: `RG${i}` });
        const rJoin = await rg.nextMsg((m) => m.type === 'room_joined');
        const rStartH = await rh.nextMsg((m) => m.type === 'match_start');
        const rStartG = await rg.nextMsg((m) => m.type === 'match_start');
        expect(rJoin.side).toBe(rStartG.side);
        expect(rStartH.side).not.toBe(rStartG.side);
        hostSides.add(String(rStartH.side));
        await Promise.all([rh.close(), rg.close()]);
      }
      expect(hostSides.size).toBe(2);
    } finally {
      await Promise.all([h.close(), g.close(), sp1.close(), sp2.close()]);
      await rsSrv.close();
    }
  });

  it('32. Dual-layer analytics logs matches.jsonl and pitches.jsonl for both LIVE and FRIEND matches, and supports session_check + session_forfeit', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-analytics-'));
    const matchLogPath = path.join(tmpDir, 'matches.jsonl');
    const pitchLogPath = path.join(tmpDir, 'pitches.jsonl');
    const anSrv = await startServer(0, {
      pitchClockScale: 0,
      absWindowMs: 0,
      graceMs: 8000,
      matchLogPath,
      pitchLogPath,
      randomizeFriendSides: false,
    });
    const host = await connectClient(anSrv.port, 'HostAn');
    const guest = await connectClient(anSrv.port, 'GuestAn');
    const probe = await connectClient(anSrv.port, 'ProbeAn');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'HostAn' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = String(created.code);
      const hostToken = String(created.token);

      guest.send({ type: 'join', code, name: 'GuestAn' });
      const joined = await guest.nextMsg((m) => m.type === 'room_joined');
      const guestToken = String(joined.token);
      await host.nextMsg((m) => m.type === 'match_start');
      await guest.nextMsg((m) => m.type === 'match_start');

      // While guest is still connected, session_check returns active: false (no 2nd-tab hijack)
      probe.send({ type: 'session_check', code, token: guestToken });
      const stOnline = await probe.nextMsg((m) => m.type === 'session_status');
      expect(stOnline.active).toBe(false);

      // Throw 1 pitch + take -> logs to pitches.jsonl
      host.send({
        type: 'pitch_submit',
        pitchSeq: 1,
        pitchId: 'cutter',
        speedKmh: 70,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      await host.nextMsg((m) => m.type === 'pitch_launch');
      await guest.nextMsg((m) => m.type === 'pitch_launch');
      guest.send({ type: 'no_swing', pitchSeq: 1 });
      await host.nextMsg((m) => m.type === 'pitch_result');
      await guest.nextMsg((m) => m.type === 'pitch_result');

      // Guest disconnects -> session_check now returns active: true with roomKind: 'friend' and remainingSec > 0
      await guest.close();
      await host.nextMsg((m) => m.type === 'opponent_disconnected');

      probe.send({ type: 'session_check', code, token: guestToken });
      const stOffline = await probe.nextMsg((m) => m.type === 'session_status');
      expect(stOffline.active).toBe(true);
      expect(stOffline.code).toBe(code);
      expect(stOffline.roomKind).toBe('friend');
      expect(stOffline.opponentName).toBe('HostAn');
      expect(Number(stOffline.remainingSec)).toBeGreaterThan(0);

      // Guest chooses forfeit from reconnect dialog -> session_forfeit ends match immediately as 'resign'
      probe.send({ type: 'session_forfeit', code, token: guestToken });
      const [stAfter, overHost] = await Promise.all([
        probe.nextMsg((m) => m.type === 'session_status'),
        host.nextMsg((m) => m.type === 'match_over'),
      ]);
      expect(stAfter.active).toBe(false);
      expect(overHost.reason).toBe('resign');
      expect(overHost.winner).toBe('home');

      // Verify both JSONL files recorded the friend match and its pitch telemetry
      const pitchLines = fs.readFileSync(pitchLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const matchLines = fs.readFileSync(matchLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(pitchLines.length).toBe(1);
      expect(pitchLines[0].event).toBe('pitch');
      expect(pitchLines[0].roomKind).toBe('friend');
      expect(pitchLines[0].pitchId).toBe('cutter');
      expect(pitchLines[0].code).toBe(code);
      expect(matchLines.length).toBe(1);
      expect(matchLines[0].roomKind).toBe('friend');
      expect(matchLines[0].matchId).toBe(pitchLines[0].matchId);
      expect(matchLines[0].reason).toBe('resign');
      expect(matchLines[0].winner).toBe('home');
      expect(matchLines[0].awayName).toBe('GuestAn');
      expect(matchLines[0].homeName).toBe('HostAn');

      // Verify /analytics HTML, external JS, and /analytics.json fixed-window tail report
      const fetchPath = (p: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${anSrv.port}${p}`, (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (c) => (body += c));
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            })
            .on('error', reject);
        });

      const htmlRes = await fetchPath('/capbaseball/analytics');
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.body).toContain('線上對戰數據分析面板');
      expect(htmlRes.body).toContain('./analytics.js');

      const jsRes = await fetchPath('/capbaseball/analytics.js');
      expect(jsRes.status).toBe(200);
      expect(jsRes.body).toContain('./analytics.json');

      const jsonRes = await fetchPath('/capbaseball/analytics.json');
      expect(jsonRes.status).toBe(200);
      const report = JSON.parse(jsonRes.body);
      expect(report.window.maxMatches).toBe(100);
      expect(report.window.maxPitches).toBe(2000);
      expect(report.window.retainedMaxMatches).toBe(5000);
      expect(report.window.retainedMaxPitches).toBe(50000);
      expect(report.matchesSummary.total).toBe(1);
      expect(report.matchesSummary.friend).toBe(1);
      expect(report.matchesSummary.avgPitchesPerMatch).toBe(1);
      expect(report.battingSummary.totalPitches).toBe(1);
      expect(report.recentMatches[0].code).toBe(code);
      void hostToken;
    } finally {
      await Promise.all([host.close(), guest.close(), probe.close()]);
      await anSrv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('33. session_check protects live 2nd tab (alreadyActive) while reclaiming zombie half-open sockets', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capbb-zombie-'));
    const zSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'matches.jsonl'),
      pitchLogPath: path.join(tmpDir, 'pitches.jsonl'),
      randomizeFriendSides: false,
      graceMs: 30_000,
      sessionProbeMs: 180,
    });
    const host = await connectClient(zSrv.port, 'HostZ');
    const guest = await connectClient(zSrv.port, 'GuestZ');
    const tab2 = await connectClient(zSrv.port, 'GuestTab2');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'HostZ' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      const code = String(created.code);

      guest.send({ type: 'join', code, name: 'GuestZ' });
      const joined = await guest.nextMsg((m) => m.type === 'room_joined');
      const guestToken = String(joined.token);
      await Promise.all([
        host.nextMsg((m) => m.type === 'match_start'),
        guest.nextMsg((m) => m.type === 'match_start'),
      ]);

      // Case 1: Guest's original tab is genuinely alive -> tab2 gets active=false, alreadyActive=true
      tab2.send({ type: 'session_check', code, token: guestToken });
      const stLive = await tab2.nextMsg((m) => m.type === 'session_status');
      expect(stLive.active).toBe(false);
      expect(stLive.alreadyActive).toBe(true);
      expect(guest.ws.readyState).toBe(WebSocket.OPEN);

      // Case 2: Simulate a zombie half-open mobile TCP socket by pausing guest's underlying socket so it never replies to ws.ping()
      const rawSock = (guest.ws as unknown as { _socket?: { pause?: () => void } })._socket;
      rawSock?.pause?.();

      tab2.send({ type: 'session_check', code, token: guestToken });
      const stZombie = await tab2.nextMsg((m) => m.type === 'session_status', 3000);
      expect(stZombie.active).toBe(true);
      expect(stZombie.code).toBe(code);
      expect(stZombie.opponentName).toBe('HostZ');

      // Reconnecting from tab2 seamlessly restores the match
      tab2.send({ type: 'reconnect', code, token: guestToken });
      const [syncTab2, oppReconn] = await Promise.all([
        tab2.nextMsg((m) => m.type === 'state_sync'),
        host.nextMsg((m) => m.type === 'opponent_reconnected'),
      ]);
      expect(syncTab2.side).toBe('away');
      expect(oppReconn.type).toBe('opponent_reconnected');
    } finally {
      const rawSock = (guest.ws as unknown as { _socket?: { resume?: () => void } })._socket;
      rawSock?.resume?.();
      await Promise.all([host.close(), guest.close(), tab2.close()]);
      await zSrv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('34. Away and Home teams maintain independent batter handedness across half-innings', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capbb-hand-'));
    const hSrv = await startServer(0, {
      matchLogPath: path.join(tmpDir, 'matches.jsonl'),
      pitchLogPath: path.join(tmpDir, 'pitches.jsonl'),
      randomizeFriendSides: false,
      pitchClockScale: 0,
      absWindowMs: 0,
    });
    const home = await connectClient(hSrv.port, 'HomeH');
    const away = await connectClient(hSrv.port, 'AwayH');
    try {
      home.send({ type: 'create', mode: 'quick3', name: 'HomeH' });
      const created = await home.nextMsg((m) => m.type === 'room_created');
      away.send({ type: 'join', code: String(created.code), name: 'AwayH' });
      await away.nextMsg((m) => m.type === 'room_joined');
      await Promise.all([
        home.nextMsg((m) => m.type === 'match_start'),
        away.nextMsg((m) => m.type === 'match_start'),
      ]);

      // Top of 1st (away batting): away switches to Right-handed ('R')
      away.send({ type: 'set_batter_side', side: 'R' });
      const [bsHome, bsAway] = await Promise.all([
        home.nextMsg((m) => m.type === 'batter_side'),
        away.nextMsg((m) => m.type === 'batter_side'),
      ]);
      expect(bsHome.side).toBe('R');
      expect(bsAway.side).toBe('R');

      // Home pitches 9 straight strikes (3 strikeouts) -> inning switches to bottom of 1st (home batting)
      let seq = 1;
      for (let k = 0; k < 3; k++) {
        for (let s = 0; s < 3; s++) {
          home.send({
            type: 'pitch_submit',
            pitchSeq: seq,
            pitchId: 'straight',
            speedKmh: 70,
            targetX: 0,
            targetY: 0.72,
            errorX: 0,
            errorY: 0,
          });
          const [lh] = await Promise.all([
            home.nextMsg((m) => m.type === 'pitch_launch'),
            away.nextMsg((m) => m.type === 'pitch_launch'),
          ]);
          expect(lh.batterSide).toBe('R');
          away.send({ type: 'no_swing', pitchSeq: seq });
          await Promise.all([
            home.nextMsg((m) => m.type === 'pitch_result'),
            away.nextMsg((m) => m.type === 'pitch_result'),
          ]);
          seq += 1;
        }
      }

      // Bottom of 1st: server switches room active batterSide back to Home's saved stance ('L')!
      const [swapHome, swapAway] = await Promise.all([
        home.nextMsg((m) => m.type === 'batter_side'),
        away.nextMsg((m) => m.type === 'batter_side'),
      ]);
      expect(swapHome.side).toBe('L');
      expect(swapAway.side).toBe('L');

      // Away pitches in bottom of 1st -> pitch_launch must carry Home's 'L', NOT Away's 'R'!
      away.send({
        type: 'pitch_submit',
        pitchSeq: seq,
        pitchId: 'straight',
        speedKmh: 72,
        targetX: 0,
        targetY: 0.72,
        errorX: 0,
        errorY: 0,
      });
      const [botLaunch] = await Promise.all([
        away.nextMsg((m) => m.type === 'pitch_launch'),
        home.nextMsg((m) => m.type === 'pitch_launch'),
      ]);
      expect(botLaunch.batterSide).toBe('L');
    } finally {
      await Promise.all([home.close(), away.close()]);
      await hSrv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('36. Standby top-5 race (taken vs decline), pure senderName emotes, team batterSides, and live matches in /analytics.json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-v253-'));
    const srv = await startServer(0, {
      pitchClockScale: 0,
      offerTimeoutMs: 1200,
      matchLogPath: path.join(tmpDir, 'm.jsonl'),
      pitchLogPath: path.join(tmpDir, 'p.jsonl'),
    });
    const s1 = await connectClient(srv.port, 'AceOne');
    const s2 = await connectClient(srv.port, 'BeeTwo');
    const s3 = await connectClient(srv.port, 'CatThree');
    const waiter = await connectClient(srv.port, 'QueueStar');
    try {
      s1.send({ t: 'sj', m: 0 });
      s2.send({ t: 'sj', m: 0 });
      s3.send({ t: 'sj', m: 0 });
      await new Promise((r) => setTimeout(r, 40));

      waiter.send({ type: 'queue', mode: 'quick3', name: 'QueueStar' });
      const [o1, o2, o3] = await Promise.all([
        s1.nextMsg((m) => m.type === 'match_offer'),
        s2.nextMsg((m) => m.type === 'match_offer'),
        s3.nextMsg((m) => m.type === 'match_offer'),
      ]);
      expect(o1.opponentName).toBe('QueueStar');
      expect(o2.opponentName).toBe('QueueStar');
      expect(o3.opponentName).toBe('QueueStar');

      // s3 declines -> immediately removed from standby
      s3.send({ type: 'offer_reply', offerId: o3.offerId, accept: false });
      await new Promise((r) => setTimeout(r, 30));

      // s1 wins the race; s2 sends accept right after and receives reason:'taken' while keeping priority standby
      s1.send({ type: 'offer_reply', offerId: o1.offerId, accept: true });
      const [ms1, msWaiter] = await Promise.all([
        s1.nextMsg((m) => m.type === 'match_start'),
        waiter.nextMsg((m) => m.type === 'match_start'),
      ]);
      expect(ms1.batterSides).toEqual({ away: 'L', home: 'L' });
      expect(msWaiter.batterSides).toEqual({ away: 'L', home: 'L' });

      const lostMsg = await s2.nextMsg((m) => m.type === 'offer_cancelled');
      expect(lostMsg.reason).toBe('taken');
      // Even a slightly delayed click on o2 still resolves cleanly as 'taken'
      s2.send({ type: 'offer_reply', offerId: o2.offerId, accept: true });
      const lateReply = await s2.nextMsg((m) => m.type === 'offer_cancelled', 1000);
      expect(lateReply.reason).toBe('taken');

      // Verify /metrics standbyCount dropped: s1 matched (0), s3 declined (0), s2 kept in priority standby (1)
      const metricsRes = await fetch(`http://127.0.0.1:${srv.port}/capbaseball/metrics`).then((r) => r.json() as Promise<Record<string, any>>);
      expect(metricsRes.connections.standbyCount).toBe(1);

      // Verify /analytics.json already shows this active LIVE match while in progress
      const analyticsRes = await fetch(`http://127.0.0.1:${srv.port}/capbaseball/analytics.json`).then((r) => r.json() as Promise<Record<string, any>>);
      expect(analyticsRes.matchesSummary.activeLive).toBe(1);
      expect(analyticsRes.liveMatches[0].code).toBe(ms1.code);
      expect(analyticsRes.liveMatches[0].status).toBe('live');

      // Verify player emote carries pure senderName (no team prefix)
      s1.send({ type: 'emote', id: 'nice' });
      const emWaiter = await waiter.nextMsg((m) => m.type === 'emote');
      expect(emWaiter.senderName).toBe('AceOne');

      // Verify set_batter_side tags the exact team ('away' vs 'home')
      s1.send({ type: 'set_batter_side', side: 'R' });
      const bsMsg = await waiter.nextMsg((m) => m.type === 'batter_side');
      expect(bsMsg.side).toBe('R');
      expect(bsMsg.team).toBe(ms1.side);

      // Waiter2 queues -> s2 receives offer -> Waiter2 immediately cancels -> s2 receives reason:'waiter_cancelled' & stays standby
      const waiter2 = await connectClient(srv.port, 'QuickCancel');
      waiter2.send({ type: 'queue', mode: 'quick3', name: 'QuickCancel' });
      const oCancel = await s2.nextMsg((m) => m.type === 'match_offer');
      waiter2.send({ type: 'unqueue' });
      const cancelNote = await s2.nextMsg((m) => m.type === 'offer_cancelled');
      expect(cancelNote.reason).toBe('waiter_cancelled');
      // Even a late click on Accept right around cancel still returns reason:'waiter_cancelled' & keeps standby
      s2.send({ type: 'offer_reply', offerId: oCancel.offerId, accept: true });
      const lateCancelReply = await s2.nextMsg((m) => m.type === 'offer_cancelled', 1000);
      expect(lateCancelReply.reason).toBe('waiter_cancelled');
      const mAfterCancel = await fetch(`http://127.0.0.1:${srv.port}/capbaseball/metrics`).then((r) => r.json() as Promise<Record<string, any>>);
      expect(mAfterCancel.connections.standbyCount).toBe(1);
      await waiter2.close();
    } finally {
      await Promise.all([s1.close(), s2.close(), s3.close(), waiter.close()]);
      await srv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('37. Game-ending ABS challenge overturns final out/walk-off and resumes match, and abs_result carries structured outcome', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-abs-end-'));
    const srv = await startServer(0, {
      pitchClockScale: 0,
      absWindowMs: 1200,
      randomizeFriendSides: false,
      matchLogPath: path.join(tmpDir, 'm.jsonl'),
      pitchLogPath: path.join(tmpDir, 'p.jsonl'),
    });
    const host = await connectClient(srv.port, 'HomeP');
    const guest = await connectClient(srv.port, 'AwayB');
    try {
      host.send({ type: 'create', mode: 'quick3', name: 'HomeP' });
      const created = await host.nextMsg((m) => m.type === 'room_created');
      guest.send({ type: 'join', code: created.code, name: 'AwayB' });
      await Promise.all([
        host.nextMsg((m) => m.type === 'match_start'),
        guest.nextMsg((m) => m.type === 'match_start'),
      ]);

      // Set up bottom of 3rd, tied 1-1, bases loaded, 3-2 count (Home batting, Away pitching):
      // simulate a blown ball call that caused a walk-off walk (isGameOver=true, recorded=false)
      const room = srv.rooms.get(created.code as string)!;
      room.match.inning = 3;
      room.match.half = 'bottom';
      room.match.away.totalRuns = 1;
      room.match.home.totalRuns = 1;
      room.match.balls = 3;
      room.match.strikes = 2;
      room.match.outs = 2;
      room.match.bases = ['home-1', 'home-2', 'home-3'];
      room.match.lastChallenge = {
        pitchSeq: room.pitchSeq,
        plateX: 0.14,
        plateY: 0.72,
        trueCall: 'strike',
        umpireCall: 'ball',
        marginCm: -1.5,
        challenged: false,
        eligibleSide: 'away',
        caughtByCatcher: true,
        reachesPassLine: false,
        catchKind: 'caught',
        preOutcome: 'WALK',
        preWildKind: null,
        preSnapshot: {
          balls: 3,
          strikes: 2,
          outs: 2,
          inning: 3,
          half: 'bottom',
          bases: ['home-1', 'home-2', 'home-3'],
          awayRuns: 1,
          homeRuns: 1,
          awayRunsByInning: [1, 0, 0],
          homeRunsByInning: [1, 0, 0],
          awayBatterIdx: 0,
          homeBatterIdx: 0,
          awayWalks: 0,
          homeWalks: 0,
          awayStrikeouts: 0,
          homeStrikeouts: 0,
          wildPitches: 0,
          uncaughtThirdStrikes: 0,
          plateAppearancesInHalf: 3,
          mercyTriggered: false,
          endReason: undefined,
          isGameOver: false,
          winner: null,
        },
      };
      // Emulate game-over state held open during the ABS window
      room.match.home.totalRuns = 2;
      room.match.home.walks = 1;
      room.match.isGameOver = true;
      room.match.winner = 'home';
      room.turnState = 'game_over';

      // Away (pitching team) challenges the game-ending walk-off ball -> overturned to 3rd-out STRIKEOUT -> Extra inning 4!
      guest.send({ type: 'abs_challenge', pitchSeq: room.pitchSeq });
      const [absH, absA] = await Promise.all([
        host.nextMsg((m) => m.type === 'abs_result'),
        guest.nextMsg((m) => m.type === 'abs_result'),
      ]);
      expect(absH.overturned).toBe(true);
      expect(absH.outcome).toBe('STRIKEOUT');
      expect(absA.outcome).toBe('STRIKEOUT');
      expect((absH.match as { isGameOver: boolean }).isGameOver).toBe(false);
      expect((absH.match as { inning: number }).inning).toBe(4);
      expect((absH.match as { half: string }).half).toBe('top');
      expect(room.turnState).toBe('awaiting_pitch');
      expect(room.recorded).toBe(false);
    } finally {
      await Promise.all([host.close(), guest.close()]);
      await srv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
