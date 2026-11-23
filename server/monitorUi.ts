export const MONITOR_HTML = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cap Baseball · Server Monitor</title>
  <style>
    :root {
      --bg: #070b14;
      --card: #0e1628;
      --border: #2a3a5c;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --gold: #f4c41c;
      --cyan: #38bdf8;
      --green: #22c55e;
      --red: #f43f5e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 16px;
      background: var(--card);
      border: 2px solid var(--border);
      border-top: 3px solid var(--gold);
      margin-bottom: 14px;
    }
    h1 { margin: 0; font-size: 16px; color: var(--gold); letter-spacing: 0.04em; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      font-weight: 700;
      border: 1.5px solid var(--green);
      color: #86efac;
      background: rgba(34, 197, 94, 0.14);
    }
    .badge[data-status="yellow"] { border-color: var(--gold); color: var(--gold); background: rgba(244, 196, 28, 0.14); }
    .badge[data-status="red"] { border-color: var(--red); color: #fda4af; background: rgba(244, 63, 94, 0.16); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      padding: 12px 14px;
    }
    .card h2 {
      margin: 0 0 8px;
      font-size: 12px;
      color: var(--cyan);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #1e2d4a;
      padding-bottom: 5px;
    }
    .kv { display: flex; justify-content: space-between; padding: 3px 0; }
    .kv span { color: var(--muted); }
    .kv strong { color: var(--text); }
    .warn-val { color: var(--red) !important; }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    svg.spark {
      width: 100%;
      height: 110px;
      background: #080d19;
      border: 1px solid #1f2e4d;
      display: block;
    }
    .alerts {
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.45;
    }
    .alert-row { padding: 4px 0; border-bottom: 1px solid #19243b; }
    .alert-crit { color: #fda4af; }
    .alert-warn { color: var(--gold); }
    .act-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px 14px; }
    .act-row { display: flex; flex-direction: column; gap: 3px; }
    .act-head { display: flex; justify-content: space-between; font-size: 12px; }
    .act-lbl { color: #cbd5e1; }
    .act-cnt { font-weight: 700; font-variant-numeric: tabular-nums; }
    .act-track { height: 6px; background: #0d162c; border-radius: 3px; overflow: hidden; }
    .act-fill { height: 100%; border-radius: 3px; transition: width 0.25s ease; }
    .muted { color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>CAP BASEBALL · PI LIVE TELEMETRY &amp; TRAFFIC MONITOR</h1>
      <div class="muted" id="meta-line">Loading metrics...</div>
    </div>
    <div id="status-badge" class="badge" data-status="green">LOADING</div>
  </header>

  <section class="grid">
    <div class="card">
      <h2>Connections &amp; Rooms</h2>
      <div class="kv"><span>Active Clients</span><strong id="c-active">-</strong></div>
      <div class="kv"><span>In Match / Queue / Spec</span><strong id="c-split">-</strong></div>
      <div class="kv"><span>Rooms (Match / Friend)</span><strong id="c-rooms">-</strong></div>
      <div class="kv"><span>Unique IPs / Max per IP</span><strong id="c-ips">-</strong></div>
      <div class="kv"><span>Total Accepted / Closed</span><strong id="c-churn">-</strong></div>
    </div>

    <div class="card">
      <h2>Live Traffic &amp; Throughput</h2>
      <div class="kv"><span>WS In / Out (msg/s)</span><strong id="t-ws-rate">-</strong></div>
      <div class="kv"><span>WS In / Out (KB/s)</span><strong id="t-ws-kb">-</strong></div>
      <div class="kv"><span>HTTP Req/s &amp; KB/s</span><strong id="t-http-rate">-</strong></div>
      <div class="kv"><span>Static RAM Cache (Hits/304)</span><strong id="t-cache">-</strong></div>
      <div class="kv"><span>Total WS Out / HTTP Out</span><strong id="t-totals">-</strong></div>
    </div>

    <div class="card">
      <h2>Node.js &amp; Raspberry Pi</h2>
      <div class="kv"><span>Event Loop p95 Lag</span><strong id="r-lag">-</strong></div>
      <div class="kv"><span>Node CPU / RSS / Heap</span><strong id="r-mem">-</strong></div>
      <div class="kv"><span>Pi Load Avg (1m / 5m)</span><strong id="r-piload">-</strong></div>
      <div class="kv"><span>Pi Avail Mem / Temp</span><strong id="r-temp">-</strong></div>
      <div class="kv"><span>Physics Solve (avg / max)</span><strong id="r-phys">-</strong></div>
    </div>

    <div class="card">
      <h2>Rejections &amp; Fault Counters</h2>
      <div class="kv"><span>Rejected: Server Busy</span><strong id="f-busy">-</strong></div>
      <div class="kv"><span>Rejected: IP Limit (1008)</span><strong id="f-ip">-</strong></div>
      <div class="kv"><span>Rejected: Rate Limit</span><strong id="f-rate">-</strong></div>
      <div class="kv"><span>Dead Pong (Match / Idle)</span><strong id="f-dead">-</strong></div>
      <div class="kv"><span>HTTP 4xx / 5xx</span><strong id="f-http">-</strong></div>
    </div>

    <div class="card">
      <h2>Match Lifecycle &amp; Live Scan</h2>
      <div class="kv"><span>Started / Completed / Rematch</span><strong id="g-started">-</strong></div>
      <div class="kv"><span>Resigned / DC Timeout / Wait Exp</span><strong id="g-ended">-</strong></div>
      <div class="kv"><span>ABS Challenge (Overturned)</span><strong id="g-abs">-</strong></div>
      <div class="kv"><span>Oldest Room / Avg Pitches</span><strong id="g-age">-</strong></div>
      <div class="kv"><span>High Inning (8+) / Diff (15+)</span><strong id="g-extreme">-</strong></div>
    </div>

    <div class="card">
      <h2>Gameplay Anomalies &amp; Sync</h2>
      <div class="kv"><span>Stalled (&gt;45s) / DC Wait Rooms</span><strong id="g-stalled">-</strong></div>
      <div class="kv"><span>Pitch Clock / Swing Timeouts</span><strong id="g-clocks">-</strong></div>
      <div class="kv"><span>Stale / Out-of-Turn Ignored</span><strong id="g-stale">-</strong></div>
      <div class="kv"><span>In-Match DC / Reconn OK / Fail</span><strong id="g-reconn">-</strong></div>
      <div class="kv"><span>Clamped Inputs / NaN Physics</span><strong id="g-integrity">-</strong></div>
    </div>
  </section>

  <section class="card" style="margin-bottom: 12px;">
    <h2>Live Player Pages &amp; Activity Breakdown (玩家所在頁面即時分布)</h2>
    <div id="activity-grid" class="act-grid muted">Loading...</div>
  </section>

  <section class="charts">
    <div class="card">
      <h2>Online Clients &amp; Rooms (Last 10m)</h2>
      <svg id="chart-clients" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
    <div class="card">
      <h2>WS Throughput (msg/s &amp; KB/s)</h2>
      <svg id="chart-ws" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
    <div class="card">
      <h2>Event Loop Lag (ms) &amp; CPU (%)</h2>
      <svg id="chart-lag" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <h2>Top WebSocket Packet Types (In / Out)</h2>
      <div id="top-packets" class="muted">-</div>
    </div>
    <div class="card">
      <h2>Recent System Alerts</h2>
      <div id="alerts-box" class="alerts muted">No alerts recorded.</div>
    </div>
  </section>

  <script src="./monitor.js"></script>
</body>
</html>
`;

export const MONITOR_JS = `(() => {
  const $ = (id) => document.getElementById(id);

  function setText(id, val, warn) {
    const el = $(id);
    if (!el) return;
    el.textContent = String(val);
    el.classList.toggle('warn-val', Boolean(warn));
  }

  function renderSpark(svgId, seriesA, colorA, seriesB, colorB, unit) {
    const svg = $(svgId);
    if (!svg) return;
    svg.replaceChildren();
    const n = seriesA.length;
    if (n < 2) return;
    const maxVal = Math.max(1, ...seriesA, ...(seriesB || [0]));
    const W = 360;
    const H = 110;
    const padY = 12;

    const makePath = (arr, color, width) => {
      const pts = arr
        .map((v, i) => {
          const x = (i / Math.max(1, n - 1)) * W;
          const y = H - padY - (v / maxVal) * (H - padY * 2);
          return x.toFixed(1) + ',' + y.toFixed(1);
        })
        .join(' ');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', color);
      poly.setAttribute('stroke-width', String(width));
      poly.setAttribute('points', pts);
      svg.appendChild(poly);
    };

    if (seriesB) makePath(seriesB, colorB, 1.5);
    makePath(seriesA, colorA, 2);

    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', '6');
    lbl.setAttribute('y', '13');
    lbl.setAttribute('fill', '#94a3b8');
    lbl.setAttribute('font-size', '10');
    lbl.textContent = 'peak ' + maxVal.toFixed(maxVal >= 10 ? 0 : 1) + unit + ' · now ' + seriesA[n - 1] + unit;
    svg.appendChild(lbl);
  }

  async function poll() {
    try {
      const token = new URLSearchParams(window.location.search).get('token');
      const url = './metrics' + (token ? '?token=' + encodeURIComponent(token) : '');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        $('meta-line').textContent = 'Metrics HTTP ' + res.status;
        return;
      }
      const d = await res.json();
      const badge = $('status-badge');
      badge.dataset.status = d.load.status;
      badge.textContent = d.load.status.toUpperCase() + (d.draining ? ' (DRAINING)' : '');
      $('meta-line').textContent =
        'Version ' + (d.version || 'dev') + ' · Uptime ' + d.uptimeSec + 's · Updated ' + d.timestamp;

      const c = d.connections;
      const pubCap = d.load.publicClientCap || d.load.maxClients;
      const reserveTag = d.load.friendReserveActive ? ' [FRIEND RESERVE]' : '';
      setText(
        'c-active',
        c.activeClients + ' / ' + pubCap + '+' + Math.max(0, d.load.maxClients - pubCap) + reserveTag,
        c.activeClients >= pubCap
      );
      setText('c-split', c.inMatch + ' / ' + c.queuing + ' / ' + c.spectating);
      setText('c-rooms', c.roomsActive + ' (' + c.matchmakingRooms + ' / ' + c.friendRooms + ')');
      setText('c-ips', c.uniqueIps + ' / ' + c.maxConnsSingleIp);
      setText('c-churn', c.acceptedTotal + ' / ' + c.closedTotal);

      const actEl = $('activity-grid');
      if (actEl) {
        const acts = c.activities || {};
        const total = Math.max(1, c.activeClients || 0);
        const defs = [
          ['online_live', '線上配對對戰 (LIVE)', '#fb7185'],
          ['online_friend', '好友房對戰 (FRIEND)', '#38bdf8'],
          ['online_queue', '線上配對排隊中', '#facc15'],
          ['friend_wait', '好友房等待加入', '#60a5fa'],
          ['spectating', '即時觀戰中', '#c084fc'],
          ['cpu_standby', 'CPU 對戰 (線上候補中)', '#fb923c'],
          ['cpu_match', 'CPU 三局對戰', '#4ade80'],
          ['practice_bat', '打擊練習', '#34d399'],
          ['practice_pitch', '投球練習', '#2dd4bf'],
          ['pitch_lab', '3D 投球實驗室', '#f4c41c'],
          ['title', '主畫面大廳', '#94a3b8'],
        ];
        actEl.replaceChildren();
        for (const [key, label, color] of defs) {
          const n = Number(acts[key] || 0);
          const pct = c.activeClients > 0 ? Math.round((n / total) * 100) : 0;
          const row = document.createElement('div');
          row.className = 'act-row';
          const head = document.createElement('div');
          head.className = 'act-head';
          const lbl = document.createElement('span');
          lbl.className = 'act-lbl';
          lbl.textContent = label;
          const cnt = document.createElement('span');
          cnt.className = 'act-cnt';
          cnt.style.color = n > 0 ? color : '#64748b';
          cnt.textContent = n + ' (' + pct + '%)';
          head.append(lbl, cnt);
          const track = document.createElement('div');
          track.className = 'act-track';
          const fill = document.createElement('div');
          fill.className = 'act-fill';
          fill.style.background = color;
          fill.style.width = (n > 0 ? Math.max(4, pct) : 0) + '%';
          track.appendChild(fill);
          row.append(head, track);
          actEl.appendChild(row);
        }
      }

      const r = d.rates;
      const tr = d.traffic;
      setText('t-ws-rate', r.wsInPerSec + ' / ' + r.wsOutPerSec);
      setText('t-ws-kb', r.wsInKbPerSec + ' / ' + r.wsOutKbPerSec);
      setText('t-http-rate', r.httpReqPerSec + ' req/s · ' + r.httpOutKbPerSec + ' KB/s');
      setText('t-cache', tr.staticCache.files + ' files (' + tr.staticCache.hits + ' / ' + tr.staticCache.notModified304 + ')');
      setText('t-totals', tr.wsOutMbTotal + ' MB / ' + tr.httpOutMbTotal + ' MB');

      const rt = d.runtime;
      const pi = d.pi;
      setText('r-lag', rt.eventLoopLagMs + ' ms', rt.eventLoopLagMs >= 40);
      setText('r-mem', rt.cpuPct + '% · ' + rt.rssMb + 'MB · ' + rt.heapUsedMb + 'MB');
      setText('r-piload', pi.load1m + ' / ' + pi.load5m);
      setText(
        'r-temp',
        pi.memAvailMb + ' MB · ' + (pi.cpuTempC !== null ? pi.cpuTempC + '°C' : 'N/A'),
        pi.cpuTempC !== null && pi.cpuTempC >= 75
      );
      setText(
        'r-phys',
        rt.physicsAvgMs + ' / ' + rt.physicsMaxMs + ' ms (' + (rt.physicsWorkerCount > 0 ? rt.physicsWorkerCount + 'w' : 'inline') + ')'
      );

      const fj = d.rejections;
      setText('f-busy', fj.serverBusy, fj.serverBusy > 0);
      setText('f-ip', fj.ipLimit, fj.ipLimit > 0);
      setText('f-rate', fj.rateLimit, fj.rateLimit > 0);
      setText('f-dead', fj.deadPongTimeout + ' / ' + (fj.idleClosed || 0), fj.deadPongTimeout >= 10);
      setText('f-http', tr.httpStatuses['4xx'] + ' / ' + tr.httpStatuses['5xx']);

      const gp = d.gameplay || {};
      const rh = gp.roomsHealth || {};
      setText('g-started', (gp.matchesStarted || 0) + ' / ' + (gp.matchesCompleted || 0) + ' / ' + (gp.rematchesStarted || 0));
      setText('g-ended', (gp.matchesResigned || 0) + ' / ' + (gp.matchesDisconnectTimeout || 0) + ' / ' + (gp.waitingExpired || 0));
      setText('g-abs', (gp.absChallengesTotal || 0) + ' (' + (gp.absOverturned || 0) + ')');
      setText('g-age', (rh.oldestRoomAgeMin || 0) + 'm / ' + (rh.avgMatchPitches || 0) + 'p (max ' + (rh.maxMatchRuns || 0) + 'r)');
      setText(
        'g-extreme',
        (rh.highInningRooms || 0) + ' / ' + (rh.extremeRunDiffRooms || 0),
        (rh.highInningRooms || 0) > 0 || (rh.extremeRunDiffRooms || 0) > 0
      );
      setText(
        'g-stalled',
        (rh.stalledRooms || 0) + ' / ' + (rh.disconnectedRooms || 0),
        (rh.stalledRooms || 0) > 0
      );
      setText('g-clocks', (gp.pitchClockViolations || 0) + ' / ' + (gp.swingTimeouts || 0));
      setText('g-stale', gp.staleOrOutOfTurnIgnored || 0, (gp.staleOrOutOfTurnIgnored || 0) >= 20);
      setText('g-reconn', (gp.disconnectsInMatch || 0) + ' / ' + (gp.reconnectsSucceeded || 0) + ' / ' + (gp.reconnectsFailed || 0), (gp.reconnectsFailed || 0) > 0);
      setText(
        'g-integrity',
        (gp.outOfRangeInputsClamped || 0) + ' / ' + (gp.nanSanityErrors || 0),
        (gp.outOfRangeInputsClamped || 0) > 0 || (gp.nanSanityErrors || 0) > 0
      );

      const hist = d.history || [];
      renderSpark('chart-clients', hist.map((x) => x.clients), '#38bdf8', hist.map((x) => x.rooms), '#f4c41c', '');
      renderSpark('chart-ws', hist.map((x) => x.wsOutPerSec), '#22c55e', hist.map((x) => x.wsInPerSec), '#38bdf8', '/s');
      renderSpark('chart-lag', hist.map((x) => x.lagMs), '#f43f5e', hist.map((x) => x.cpuPct), '#f4c41c', '');

      const topEl = $('top-packets');
      topEl.replaceChildren();
      const fmtList = (label, arr) => {
        const div = document.createElement('div');
        div.textContent = label + ': ' + arr.map((x) => x.type + '=' + x.count).join(', ');
        return div;
      };
      topEl.append(fmtList('IN', tr.topInTypes || []), fmtList('OUT', tr.topOutTypes || []));

      const alertsEl = $('alerts-box');
      alertsEl.replaceChildren();
      if (!d.alerts || d.alerts.length === 0) {
        alertsEl.textContent = 'All clear — zero alerts recorded.';
      } else {
        for (const a of d.alerts) {
          const row = document.createElement('div');
          row.className = 'alert-row ' + (a.level === 'crit' ? 'alert-crit' : 'alert-warn');
          row.textContent = '[' + a.ts.slice(11, 19) + '] [' + a.code + '] ' + a.message;
          alertsEl.appendChild(row);
        }
      }
    } catch (e) {
      $('meta-line').textContent = 'Monitor fetch error: ' + String(e);
    }
  }

  poll();
  setInterval(poll, 2000);
})();
`;
