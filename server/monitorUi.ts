export const MONITOR_HTML = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>瓶蓋棒球 · 伺服器即時監控面板</title>
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
    .nav-link {
      color: var(--cyan);
      text-decoration: none;
      padding: 4px 10px;
      border: 1px solid var(--border);
      background: #0a1020;
      font-weight: 700;
    }
    .nav-link:hover { border-color: var(--cyan); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
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
    .kv { display: flex; justify-content: space-between; padding: 3px 0; gap: 8px; }
    .kv span { color: var(--muted); }
    .kv strong { color: var(--text); text-align: right; }
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
    }
    .alert-row {
      padding: 5px 8px;
      border-bottom: 1px solid #18233a;
    }
    .alert-crit { color: #fda4af; background: rgba(244, 63, 94, 0.12); }
    .alert-warn { color: #fde047; }
    .act-title-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #1e2d4a; padding-bottom: 6px; margin-bottom: 10px; }
    .act-title-bar h2 { border-bottom: none; padding-bottom: 0; margin: 0; }
    .standby-pill { font-size: 11px; font-weight: 700; color: var(--gold); background: rgba(244, 196, 28, 0.14); border: 1px solid rgba(244, 196, 28, 0.5); padding: 2px 8px; border-radius: 999px; }
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
      <h1>瓶蓋棒球 · 伺服器即時監控面板</h1>
      <div class="muted" id="meta-line">載入監控數據中...</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <a class="nav-link" href="./analytics">對戰數據分析</a>
      <a class="nav-link" href="./">返回遊戲</a>
      <div id="status-badge" class="badge" data-status="green">載入中</div>
    </div>
  </header>

  <section class="grid">
    <div class="card">
      <h2>連線與房間狀態</h2>
      <div class="kv"><span>目前在線人數</span><strong id="c-active">-</strong></div>
      <div class="kv"><span>對戰中 / 排隊 / 觀戰</span><strong id="c-split">-</strong></div>
      <div class="kv"><span>活躍房間（隨機 / 好友）</span><strong id="c-rooms">-</strong></div>
      <div class="kv"><span>獨立 IP 數 / 單 IP 上限</span><strong id="c-ips">-</strong></div>
      <div class="kv"><span>累計連線 / 累計離線</span><strong id="c-churn">-</strong></div>
    </div>

    <div class="card">
      <h2>即時網路流量與吞吐</h2>
      <div class="kv"><span>WS 收發速率（封包/秒）</span><strong id="t-ws-rate">-</strong></div>
      <div class="kv"><span>WS 頻寬（收 / 發 KB/s）</span><strong id="t-ws-kb">-</strong></div>
      <div class="kv"><span>HTTP 請求與流量</span><strong id="t-http-rate">-</strong></div>
      <div class="kv"><span>記憶體靜態快取（命中/304）</span><strong id="t-cache">-</strong></div>
      <div class="kv"><span>累計總流量（WS / HTTP）</span><strong id="t-totals">-</strong></div>
    </div>

    <div class="card">
      <h2>Node.js 與伺服器硬體</h2>
      <div class="kv"><span>事件迴圈延遲 (p95)</span><strong id="r-lag">-</strong></div>
      <div class="kv"><span>CPU / 常駐記憶體 / 堆積</span><strong id="r-mem">-</strong></div>
      <div class="kv"><span>伺服器系統負載 (1分 / 5分)</span><strong id="r-piload">-</strong></div>
      <div class="kv"><span>伺服器可用記憶體 / 溫度</span><strong id="r-temp">-</strong></div>
      <div class="kv"><span>物理引擎耗時（平均 / 最大）</span><strong id="r-phys">-</strong></div>
    </div>

    <div class="card">
      <h2>伺服器儲存空間健康度</h2>
      <div class="kv"><span>健康狀態與裝置</span><strong id="s-health">-</strong></div>
      <div class="kv"><span>可用空間 / 使用率</span><strong id="s-space">-</strong></div>
      <div class="kv"><span>掛載讀寫狀態</span><strong id="s-mount">-</strong></div>
      <div class="kv"><span>開機寫入量 / 即時寫入</span><strong id="s-writes">-</strong></div>
      <div class="kv"><span>寫入延遲 / 檔案系統錯誤</span><strong id="s-errors">-</strong></div>
    </div>

    <div class="card">
      <h2>防護攔截與錯誤統計</h2>
      <div class="kv"><span>伺服器滿載拒連</span><strong id="f-busy">-</strong></div>
      <div class="kv"><span>單 IP 超限拒連 (1008)</span><strong id="f-ip">-</strong></div>
      <div class="kv"><span>訊息頻率超限攔截</span><strong id="f-rate">-</strong></div>
      <div class="kv"><span>逾時斷線（對戰 / 閒置）</span><strong id="f-dead">-</strong></div>
      <div class="kv"><span>HTTP 異常（4xx / 5xx）</span><strong id="f-http">-</strong></div>
    </div>
  </section>

  <section class="card" style="margin-bottom: 12px;">
    <div class="act-title-bar">
      <h2>玩家所在頁面即時分布</h2>
      <span id="standby-pill" class="standby-pill">線上候補名單：0 人</span>
    </div>
    <div id="activity-grid" class="act-grid muted">載入中...</div>
  </section>

  <section class="charts">
    <div class="card">
      <h2>在線人數與活躍房間趨勢（近 10 分鐘）</h2>
      <svg id="chart-clients" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
    <div class="card">
      <h2>WebSocket 封包吞吐趨勢（封包/秒）</h2>
      <svg id="chart-ws" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
    <div class="card">
      <h2>事件迴圈延遲 (ms) 與 CPU 使用率 (%)</h2>
      <svg id="chart-lag" class="spark" viewBox="0 0 360 110" preserveAspectRatio="none"></svg>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <h2>熱門 WebSocket 封包類型統計（收 / 發）</h2>
      <div id="top-packets" class="muted">-</div>
    </div>
    <div class="card">
      <h2>近期系統警報紀錄</h2>
      <div id="alerts-box" class="alerts muted">目前無任何異常警報。</div>
    </div>
  </section>

  <script src="./monitor.js"></script>
</body>
</html>
`;

export const MONITOR_JS = `(() => {
  const $ = (id) => document.getElementById(id);

  const STATUS_LABELS = {
    green: '正常運作',
    yellow: '負載偏高',
    red: '負載危急',
  };

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
    lbl.textContent = '峰值 ' + maxVal.toFixed(maxVal >= 10 ? 0 : 1) + unit + ' · 目前 ' + seriesA[n - 1] + unit;
    svg.appendChild(lbl);
  }

  async function poll() {
    try {
      const token = new URLSearchParams(window.location.search).get('token');
      const url = './metrics' + (token ? '?token=' + encodeURIComponent(token) : '');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        $('meta-line').textContent = '監控資料讀取失敗 HTTP ' + res.status;
        return;
      }
      const d = await res.json();
      const badge = $('status-badge');
      badge.dataset.status = d.load.status;
      const stLabel = STATUS_LABELS[d.load.status] || d.load.status.toUpperCase();
      badge.textContent = stLabel + (d.draining ? '（準備更新中）' : '');
      $('meta-line').textContent =
        '版本 ' + (d.version || '開發版') + ' · 已運行 ' + d.uptimeSec + ' 秒 · 更新時間 ' + d.timestamp.slice(11, 19);

      const c = d.connections;
      const pubCap = d.load.publicClientCap || d.load.maxClients;
      const reserveTag = d.load.friendReserveActive ? ' [好友房保留席啟用]' : '';
      setText(
        'c-active',
        c.activeClients + ' / ' + pubCap + '+' + Math.max(0, d.load.maxClients - pubCap) + reserveTag,
        c.activeClients >= pubCap
      );
      setText('c-split', c.inMatch + ' / ' + c.queuing + ' / ' + c.spectating);
      setText('c-rooms', c.roomsActive + '（隨機 ' + c.matchmakingRooms + ' / 好友 ' + c.friendRooms + '）');
      setText('c-ips', c.uniqueIps + ' / ' + c.maxConnsSingleIp);
      setText('c-churn', c.acceptedTotal + ' / ' + c.closedTotal);

      const standbyPill = $('standby-pill');
      if (standbyPill) {
        const sbCount = Number(c.standbyCount || 0);
        standbyPill.textContent = '線上候補名單：' + sbCount + ' 人';
      }

      const actEl = $('activity-grid');
      if (actEl) {
        const acts = c.activities || {};
        const total = Math.max(1, c.activeClients || 0);
        const defs = [
          ['online_live', '線上隨機對戰', '#fb7185'],
          ['online_friend', '好友房對戰', '#38bdf8'],
          ['online_queue', '線上配對排隊中', '#facc15'],
          ['friend_wait', '好友房等待加入', '#60a5fa'],
          ['spectating', '即時觀戰中', '#c084fc'],
          ['cpu_match', 'CPU 三局對戰', '#4ade80'],
          ['practice_bat', '打擊練習', '#34d399'],
          ['practice_pitch', '投球練習', '#2dd4bf'],
          ['pitch_lab', '3D 投球實驗室', '#f4c41c'],
          ['title', '主畫面大廳', '#94a3b8'],
        ];
        actEl.classList.remove('muted');
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
          cnt.textContent = n + ' 人 (' + pct + '%)';
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
      setText('t-http-rate', r.httpReqPerSec + ' 次/秒 · ' + r.httpOutKbPerSec + ' KB/s');
      setText('t-cache', tr.staticCache.files + ' 檔（命中 ' + tr.staticCache.hits + ' / 304 ' + tr.staticCache.notModified304 + '）');
      setText('t-totals', tr.wsOutMbTotal + ' MB / ' + tr.httpOutMbTotal + ' MB');

      const rt = d.runtime;
      const pi = d.pi;
      setText('r-lag', rt.eventLoopLagMs + ' ms', rt.eventLoopLagMs >= 40);
      setText('r-mem', rt.cpuPct + '% · ' + rt.rssMb + 'MB · ' + rt.heapUsedMb + 'MB');
      setText('r-piload', pi.load1m + ' / ' + pi.load5m);
      setText(
        'r-temp',
        pi.memAvailMb + ' MB · ' + (pi.cpuTempC !== null ? pi.cpuTempC + '°C' : '無感測器'),
        pi.cpuTempC !== null && pi.cpuTempC >= 75
      );
      setText(
        'r-phys',
        rt.physicsAvgMs + ' / ' + rt.physicsMaxMs + ' ms（' + (rt.physicsWorkerCount > 0 ? rt.physicsWorkerCount + ' 執行緒' : '主執行緒') + '）'
      );

      const st = d.storage || (pi && pi.storage) || {};
      const stHealthMap = { green: '良好', yellow: '注意', red: '危急' };
      const stHealthTxt = (stHealthMap[st.status] || '良好') + (st.device ? ' (' + st.device + ' · ' + (st.fsType || '-') + ')' : '');
      setText('s-health', stHealthTxt, st.status === 'red' || st.status === 'yellow');
      setText(
        's-space',
        (st.availGb ?? '-') + ' GB 可用 / ' + (st.totalGb ?? '-') + ' GB (' + (st.usedPct ?? 0) + '%)',
        (st.usedPct || 0) >= 82
      );
      setText(
        's-mount',
        st.readOnly ? '異常唯讀 (RO)！' : '正常讀寫 (RW)' + (st.hwLifeInfo ? ' · 壽命 ' + st.hwLifeInfo : ''),
        Boolean(st.readOnly)
      );
      setText(
        's-writes',
        (st.writtenGbBoot !== null && st.writtenGbBoot !== undefined ? st.writtenGbBoot + ' GB' : '系統未提供') +
          ' · ' + (st.writeKbPerSec || 0) + ' KB/s'
      );
      setText(
        's-errors',
        (st.avgWriteAwaitMs || 0) + ' ms · ' + (st.fsErrorsCount || 0) + ' 次錯誤',
        (st.fsErrorsCount || 0) > 0 || (st.avgWriteAwaitMs || 0) >= 50
      );

      const fj = d.rejections;
      setText('f-busy', fj.serverBusy, fj.serverBusy > 0);
      setText('f-ip', fj.ipLimit, fj.ipLimit > 0);
      setText('f-rate', fj.rateLimit, fj.rateLimit > 0);
      setText('f-dead', fj.deadPongTimeout + ' / ' + (fj.idleClosed || 0), fj.deadPongTimeout >= 10);
      setText('f-http', tr.httpStatuses['4xx'] + ' / ' + tr.httpStatuses['5xx']);

      const hist = d.history || [];
      renderSpark('chart-clients', hist.map((x) => x.clients), '#38bdf8', hist.map((x) => x.rooms), '#f4c41c', '');
      renderSpark('chart-ws', hist.map((x) => x.wsOutPerSec), '#22c55e', hist.map((x) => x.wsInPerSec), '#38bdf8', '/秒');
      renderSpark('chart-lag', hist.map((x) => x.lagMs), '#f43f5e', hist.map((x) => x.cpuPct), '#f4c41c', '');

      const topEl = $('top-packets');
      topEl.replaceChildren();
      const fmtList = (label, arr) => {
        const div = document.createElement('div');
        div.textContent = label + '：' + (arr.length > 0 ? arr.map((x) => x.type + '=' + x.count).join(', ') : '無');
        return div;
      };
      topEl.append(fmtList('接收', tr.topInTypes || []), fmtList('發送', tr.topOutTypes || []));

      const alertsEl = $('alerts-box');
      alertsEl.replaceChildren();
      if (!d.alerts || d.alerts.length === 0) {
        alertsEl.textContent = '系統運作正常 — 目前無任何異常警報。';
      } else {
        for (const a of d.alerts) {
          const row = document.createElement('div');
          row.className = 'alert-row ' + (a.level === 'crit' ? 'alert-crit' : 'alert-warn');
          row.textContent = '[' + a.ts.slice(11, 19) + '] [' + a.code + '] ' + a.message;
          alertsEl.appendChild(row);
        }
      }
    } catch (e) {
      $('meta-line').textContent = '監控連線錯誤：' + String(e);
    }
  }

  poll();
  setInterval(poll, 2000);
})();
`;
