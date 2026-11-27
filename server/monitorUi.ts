export const MONITOR_HTML = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>瓶蓋棒球 · 伺服器監控與數據中心</title>
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
      --orange: #f97316;
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
      margin-bottom: 12px;
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
    .tab-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .tab-btn {
      background: #0b1222;
      color: var(--muted);
      border: 2px solid var(--border);
      padding: 8px 16px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .tab-btn:hover { color: var(--text); border-color: var(--cyan); }
    .tab-btn.active {
      background: #172544;
      color: var(--gold);
      border-color: var(--gold);
    }
    .tab-panel[hidden] { display: none; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
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
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
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
    .alerts { max-height: 220px; overflow-y: auto; font-size: 12px; }
    .alert-row { padding: 5px 8px; border-bottom: 1px solid #18233a; }
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
    .table-wrap { overflow-x: auto; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1e2d4a; white-space: nowrap; }
    th { color: var(--gold); font-weight: 700; background: #0a1020; }
    .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 11px; }
    .tag-live { background: rgba(34, 197, 94, 0.18); color: #86efac; border: 1px solid var(--green); }
    .tag-friend { background: rgba(56, 189, 248, 0.18); color: #7dd3fc; border: 1px solid var(--cyan); }
    .tag-playing { background: rgba(244, 196, 28, 0.22); color: var(--gold); border: 1px solid var(--gold); margin-left: 4px; }
    .dev-pill {
      display: inline-block;
      margin-left: 5px;
      padding: 0 4px;
      border-radius: 3px;
      font-size: 10px;
      color: var(--muted);
      border: 1px solid #2b3c5e;
      background: #0a1120;
    }
    .bar-row { display: grid; grid-template-columns: 112px 1fr 78px; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; }
    .bar-track { height: 12px; background: #0a1020; border: 1px solid #1e2d4a; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); width: 0%; }
    .bar-fill.gold { background: linear-gradient(90deg, #ca8a04, #f4c41c); }
    .bar-fill.green { background: linear-gradient(90deg, #16a34a, #4ade80); }
    .bar-fill.orange { background: linear-gradient(90deg, #ea580c, #fb923c); }
    .zone-controls { display: flex; gap: 6px; flex-wrap: wrap; }
    .zone-mode-btn {
      background: #0a1020;
      color: var(--muted);
      border: 1px solid var(--border);
      padding: 3px 8px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    .zone-mode-btn.active { color: var(--gold); border-color: var(--gold); background: #172544; }
    .zone-layout { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 8px; }
    .zone-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      width: 100%;
      max-width: 320px;
      padding: 6px;
      background: #090e1c;
      border: 2px solid #cbd5e1;
    }
    .zone-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 62px;
      padding: 6px 4px;
      border: 1px solid #2b3c5e;
      text-align: center;
    }
    .zone-val { font-size: 15px; font-weight: 800; color: #fff; }
    .zone-sub { font-size: 10px; color: #cbd5e1; margin-top: 2px; }
    .zone-outside {
      width: 100%;
      max-width: 320px;
      padding: 8px 10px;
      border: 1px dashed #475569;
      background: #0a1020;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>瓶蓋棒球 · 伺服器監控與數據中心</h1>
      <div class="muted" id="meta-line">載入監控與統計數據中...</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <a class="nav-link" href="./">返回遊戲</a>
      <div id="status-badge" class="badge" data-status="green">連線中</div>
    </div>
  </header>

  <nav class="tab-bar" role="tablist">
    <button type="button" class="tab-btn active" data-tab="monitor">伺服器監控</button>
    <button type="button" class="tab-btn" data-tab="overview">對戰總覽</button>
    <button type="button" class="tab-btn" data-tab="balance">球路與平衡</button>
    <button type="button" class="tab-btn" data-tab="devices">裝置與跨平台</button>
  </nav>

  <!-- TAB 1: SERVER MONITOR -->
  <section class="tab-panel" id="tab-monitor">
    <section class="grid">
      <div class="card">
        <h2>連線與房間狀態</h2>
        <div class="kv"><span>目前在線人數</span><strong id="c-active">-</strong></div>
        <div class="kv"><span>對戰中 / 排隊 / 觀戰</span><strong id="c-split">-</strong></div>
        <div class="kv"><span>活躍房間（隨機 / 好友）</span><strong id="c-rooms">-</strong></div>
        <div class="kv"><span>房間 3局 / 1局 / 6局</span><strong id="c-rooms-mode">-</strong></div>
        <div class="kv"><span>排隊 3局 / 1局 / 6局</span><strong id="c-queue-mode">-</strong></div>
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
  </section>

  <!-- TAB 2: OVERVIEW -->
  <section class="tab-panel" id="tab-overview" hidden>
    <div class="grid">
      <div class="card">
        <h2>近期對戰總覽（最近 100 場）</h2>
        <div class="kv"><span>完賽場數（隨機 / 好友 / 再戰）</span><strong id="m-counts">--</strong></div>
        <div class="kv"><span>勝場分佈（先攻黑 / 後攻黃）</span><strong id="m-wins">--</strong></div>
        <div class="kv"><span>平均時長 / 場均球數（最高分）</span><strong id="m-dur">--</strong></div>
        <div class="kv"><span>場均得分 / 安打 / 三振 / 四壞</span><strong id="m-hkb">--</strong></div>
        <div class="kv"><span>延長賽(8局+) / 大比分差(15+)</span><strong id="m-extreme">--</strong></div>
      </div>

      <div class="card">
        <h2>打擊與擊球品質（最近 2,000 球）</h2>
        <div class="kv"><span>總投球數 / 揮棒數（揮棒率）</span><strong id="b-swings">--</strong></div>
        <div class="kv"><span>擊中率 / 揮空率</span><strong id="b-contact">--</strong></div>
        <div class="kv"><span>平均初速 / 仰角 / 最遠全壘打</span><strong id="b-evla">--</strong></div>
        <div class="kv"><span>一安 / 二安 / 三安 / 全壘打</span><strong id="b-hits">--</strong></div>
        <div class="kv"><span>場內出局 / 界外 / 界外飛球接殺</span><strong id="b-outs">--</strong></div>
      </div>

      <div class="card">
        <h2>勝負判定、規則與 SD 卡空間</h2>
        <div class="kv"><span>正常完賽 / 提前結束</span><strong id="r-normal">--</strong></div>
        <div class="kv"><span>投降 / 斷線 / 超時判負 / 候房逾時</span><strong id="r-early">--</strong></div>
        <div class="kv"><span>故意四壞 / 投球計時違規</span><strong id="r-ibb-clock">--</strong></div>
        <div class="kv"><span>ABS 挑戰次數（翻盤率）</span><strong id="r-abs">--</strong></div>
        <div class="kv"><span>日誌容量（對局 / 投球 / 裝置）</span><strong id="r-disk">--</strong></div>
      </div>

      <div class="card">
        <h2>對局同步與異常監測</h2>
        <div class="kv"><span>進行中對戰 / 等待房 / 最久房齡</span><strong id="a-rooms">--</strong></div>
        <div class="kv"><span>停滯房(&gt;45秒) / 斷線等待房</span><strong id="a-stalled">--</strong></div>
        <div class="kv"><span>投球計時超時 / 揮棒同步逾時</span><strong id="a-clocks">--</strong></div>
        <div class="kv"><span>對戰斷線 / 重連成功 / 失敗</span><strong id="a-reconn">--</strong></div>
        <div class="kv"><span>斷線判負原因</span><strong id="a-dccause">--</strong></div>
        <div class="kv"><span>過期封包忽略 / 參數修正 / NaN</span><strong id="a-integrity">--</strong></div>
      </div>
    </div>

    <div class="card table-wrap">
      <h2>近期線上與好友對戰紀錄（進行中 + 最新 100 場）</h2>
      <table>
        <thead>
          <tr>
            <th>時間 (台北)</th>
            <th>類型</th>
            <th>房號</th>
            <th>先攻（中正黑）</th>
            <th>比數</th>
            <th>後攻（中正黃）</th>
            <th>局數</th>
            <th>安打 (黑/黃)</th>
            <th>三振 (黑/黃)</th>
            <th>四壞 (黑/黃)</th>
            <th>總球數</th>
            <th>時長</th>
            <th>狀態 / 原因</th>
          </tr>
        </thead>
        <tbody id="matches-tbody"></tbody>
      </table>
    </div>
  </section>

  <!-- TAB 3: PITCH & BALANCE -->
  <section class="tab-panel" id="tab-balance" hidden>
    <div class="card table-wrap">
      <h2>6 球種攻防表現（最近 2,000 球）</h2>
      <table>
        <thead>
          <tr>
            <th>球種</th>
            <th>投球數</th>
            <th>使用率</th>
            <th>平均球速</th>
            <th>平均變化量</th>
            <th>好球率</th>
            <th>誘揮率</th>
            <th>揮空率</th>
            <th>擊中安打率</th>
          </tr>
        </thead>
        <tbody id="pitch-tbody"></tbody>
      </table>
    </div>

    <div class="card table-wrap">
      <h2>左右打對位矩陣（左打 LHB vs 右打 RHB）</h2>
      <table>
        <thead>
          <tr>
            <th>球種</th>
            <th>對左打球數</th>
            <th>左打揮空率</th>
            <th>左打安打率</th>
            <th>對右打球數</th>
            <th>右打揮空率</th>
            <th>右打安打率</th>
          </tr>
        </thead>
        <tbody id="hand-tbody"></tbody>
      </table>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>
          <span>好球帶 9 宮格熱區（捕手視角）</span>
          <span class="zone-controls" id="zone-controls">
            <button type="button" class="zone-mode-btn active" data-zmode="pitches">投球量</button>
            <button type="button" class="zone-mode-btn" data-zmode="swingPct">揮棒率</button>
            <button type="button" class="zone-mode-btn" data-zmode="hitPct">安打率</button>
            <button type="button" class="zone-mode-btn" data-zmode="errorPct">誤判率</button>
          </span>
        </h2>
        <div class="zone-layout">
          <div class="zone-grid" id="zone-grid"></div>
          <div class="zone-outside" id="zone-outside">
            <span>帶外壞球區</span>
            <strong id="zone-outside-val">--</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>捕手與特殊規則事件率</h2>
        <div class="kv"><span>暴投 WP（佔未擊球）</span><strong id="sp-wp">--</strong></div>
        <div class="kv"><span>捕逸 PB（佔未擊球）</span><strong id="sp-pb">--</strong></div>
        <div class="kv"><span>不死三振 D3S（佔總球數）</span><strong id="sp-d3s">--</strong></div>
        <div class="kv"><span>界外飛球接殺（佔所有界外）</span><strong id="sp-foulfly">--</strong></div>
        <div class="kv"><span>空中接殺出局（佔擊中球）</span><strong id="sp-air">--</strong></div>
        <div class="kv"><span>守備漏接 / 失誤（佔擊中球）</span><strong id="sp-bobble">--</strong></div>
        <div class="kv"><span>滾地球攔截（佔擊中球）</span><strong id="sp-block">--</strong></div>
        <h2 style="margin-top:12px;">各守位表現（接殺 / 攔截 / 漏接）</h2>
        <div class="kv"><span>左外野 LF</span><strong id="sp-f-LF">--</strong></div>
        <div class="kv"><span>右外野 RF</span><strong id="sp-f-RF">--</strong></div>
        <div class="kv"><span>投手 P</span><strong id="sp-f-P">--</strong></div>
        <div class="kv"><span>捕手 C</span><strong id="sp-f-C">--</strong></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>投手彈簧蓄力品質（SOFT / BEST / OVER）</h2>
        <div id="spring-bars"></div>
      </div>

      <div class="card">
        <h2>打者揮棒時機分佈（dtTiming）</h2>
        <div id="timing-bars"></div>
      </div>
    </div>
  </section>

  <!-- TAB 4: DEVICES & CROSS-PLATFORM -->
  <section class="tab-panel" id="tab-devices" hidden>
    <div class="card table-wrap">
      <h2>跨平台公平性分析（手機觸控 vs 桌機滑鼠）</h2>
      <div class="kv" style="margin-bottom:8px;">
        <span>正面交鋒（觸控 vs 滑鼠分出勝負場次）</span>
        <strong id="cp-h2h">--</strong>
      </div>
      <table>
        <thead>
          <tr>
            <th>操作平台</th>
            <th>完賽場次</th>
            <th>總勝率</th>
            <th>投球 BEST 率</th>
            <th>揮棒率</th>
            <th>揮空率</th>
            <th>擊中安打率</th>
            <th>強振比例</th>
            <th>平均擊球初速</th>
          </tr>
        </thead>
        <tbody id="cp-tbody"></tbody>
      </table>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>裝置類型與輸入環境（每分頁工作階段僅回報 1 次）</h2>
        <div class="kv"><span>統計樣本工作階段數</span><strong id="dev-total">--</strong></div>
        <div class="kv"><span>PWA 主畫面安裝比例</span><strong id="dev-pwa">--</strong></div>
        <h2 style="margin-top:10px;">裝置類型</h2>
        <div id="bars-device"></div>
        <h2 style="margin-top:10px;">螢幕方向 / 輸入方式 / 語系</h2>
        <div id="bars-env"></div>
      </div>

      <div class="card">
        <h2>作業系統與瀏覽器（含 LINE / IG / FB 內建）</h2>
        <h2 style="margin-top:4px;">作業系統 OS</h2>
        <div id="bars-os"></div>
        <h2 style="margin-top:10px;">瀏覽器分佈</h2>
        <div id="bars-browser"></div>
      </div>
    </div>
  </section>

  <script src="./monitor.js"></script>
</body>
</html>
`;

export const MONITOR_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const VALID_TABS = new Set(['monitor', 'overview', 'balance', 'devices']);
  const urlTab = params.get('tab');
  const defaultTab = /\\/analytics\\/?$/i.test(window.location.pathname) ? 'overview' : 'monitor';
  let activeTab = urlTab && VALID_TABS.has(urlTab) ? urlTab : defaultTab;
  let zoneMode = 'pitches';
  let lastAnalytics = null;
  let pollTimer = null;

  const STATUS_LABELS = {
    green: '正常運作',
    yellow: '負載偏高',
    red: '負載危急',
  };

  const PITCH_NAMES = {
    straight: '直球 (4SFB)',
    cutter: '卡特 (CUT)',
    fork: '指叉 (FORK)',
    changeup: '變速 (CH)',
    knuckle: '蝴蝶 (KNU)',
    shuuto: '噴射 (SHU)',
  };

  const REASON_NAMES = {
    completed: '正常完賽',
    normal: '正常完賽',
    mercy: '提前結束',
    resign: '投降棄權',
    disconnect: '斷線判負',
    disconnect_timeout: '斷線判負',
    pitch_clock: '超時判負',
    pitch_clock_forfeit: '超時判負',
    in_progress: '對戰進行中',
  };

  const DC_NAMES = { network_lost: '網路中斷', page_left: '離開頁面', client_closed: '主動關閉', dead_pong: '無回應', unknown: '未知' };
  const dcName = (k) => DC_NAMES[k] || (k.startsWith('code_') ? '關閉碼 ' + k.slice(5) : k);

  const DEVICE_BADGE = {
    mobile: '手機',
    tablet: '平板',
    desktop: '桌機',
  };

  function setText(id, val, warn) {
    const el = $(id);
    if (!el) return;
    el.textContent = String(val);
    el.classList.toggle('warn-val', Boolean(warn));
  }

  function td(text, cls) {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    cell.textContent = String(text);
    return cell;
  }

  function tdWithDevice(name, device) {
    const cell = document.createElement('td');
    cell.textContent = String(name || '--');
    if (device && DEVICE_BADGE[device]) {
      const pill = document.createElement('span');
      pill.className = 'dev-pill';
      pill.textContent = DEVICE_BADGE[device];
      cell.appendChild(pill);
    }
    return cell;
  }

  function fmtTaipei(isoStr, full) {
    if (typeof isoStr !== 'string' || !isoStr) return '--';
    const ms = Date.parse(isoStr);
    if (!Number.isFinite(ms)) return isoStr.replace('T', ' ').slice(5, 19);
    const tpe = new Date(ms + 8 * 3600 * 1000).toISOString();
    return full ? tpe.slice(11, 19) : tpe.replace('T', ' ').slice(5, 19);
  }

  function applyTabUi() {
    for (const b of document.querySelectorAll('.tab-btn')) {
      b.classList.toggle('active', b.dataset.tab === activeTab);
    }
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.hidden = p.id !== 'tab-' + activeTab;
    }
  }

  function schedulePoll(immediate) {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    const run = async () => {
      if (activeTab === 'monitor') {
        await pollMetrics();
      } else {
        await pollAnalytics();
      }
      const nextMs = activeTab === 'monitor' ? 1500 : 5000;
      pollTimer = setTimeout(run, nextMs);
    };
    if (immediate) {
      void run();
    } else {
      const nextMs = activeTab === 'monitor' ? 1500 : 5000;
      pollTimer = setTimeout(run, nextMs);
    }
  }

  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tab || 'monitor';
      if (!VALID_TABS.has(next)) return;
      activeTab = next;
      applyTabUi();
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('tab', activeTab);
        window.history.replaceState(null, '', u.toString());
      } catch {}
      schedulePoll(true);
    });
  }

  for (const btn of document.querySelectorAll('.zone-mode-btn')) {
    btn.addEventListener('click', () => {
      zoneMode = btn.dataset.zmode || 'pitches';
      for (const b of document.querySelectorAll('.zone-mode-btn')) {
        b.classList.toggle('active', b === btn);
      }
      if (lastAnalytics) renderStrikeZone(lastAnalytics.strikeZoneGrid);
    });
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

  function renderBars(containerId, items, fillClass) {
    const el = $(containerId);
    if (!el) return;
    el.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const lbl = document.createElement('span');
      lbl.textContent = item.label;
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill' + (fillClass ? ' ' + fillClass : '');
      fill.style.width = Math.max(0, Math.min(100, item.pct)) + '%';
      track.appendChild(fill);
      const val = document.createElement('strong');
      val.textContent = item.rightText;
      val.style.textAlign = 'right';
      row.append(lbl, track, val);
      el.appendChild(row);
    }
  }

  function heatBg(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    if (r < 0.01) return 'rgba(15, 23, 42, 0.9)';
    if (r < 0.5) {
      const a = 0.16 + r * 0.5;
      return 'rgba(56, 189, 248, ' + a.toFixed(2) + ')';
    }
    const t = (r - 0.5) * 2;
    const red = Math.round(234 + (244 - 234) * t);
    const green = Math.round(179 - 116 * t);
    const blue = Math.round(8 + 86 * t);
    return 'rgba(' + red + ',' + green + ',' + blue + ',' + (0.35 + t * 0.35).toFixed(2) + ')';
  }

  function renderStrikeZone(gridData) {
    const wrap = $('zone-grid');
    if (!wrap || !gridData) return;
    wrap.replaceChildren();
    const cells = gridData.cells || [];
    let maxVal = 1;
    for (const c of cells) {
      const v = zoneMode === 'pitches' ? c.pitches : (c[zoneMode] || 0);
      if (v > maxVal) maxVal = v;
    }
    for (const c of cells) {
      const cell = document.createElement('div');
      cell.className = 'zone-cell';
      const raw = zoneMode === 'pitches' ? c.pitches : (c[zoneMode] || 0);
      const ratio = zoneMode === 'pitches' ? raw / maxVal : raw / Math.max(25, maxVal);
      cell.style.background = heatBg(ratio);

      const main = document.createElement('div');
      main.className = 'zone-val';
      main.textContent = zoneMode === 'pitches' ? c.pitches + '球' : raw + '%';

      const sub = document.createElement('div');
      sub.className = 'zone-sub';
      if (zoneMode === 'pitches') sub.textContent = c.pitchPct + '%';
      else if (zoneMode === 'swingPct') sub.textContent = c.swings + '/' + c.pitches + '球';
      else if (zoneMode === 'hitPct') sub.textContent = c.hits + '/' + c.contacts + '擊中';
      else sub.textContent = c.umpireErrors + '/' + c.taken + '未揮';

      cell.append(main, sub);
      wrap.appendChild(cell);
    }
    const out = gridData.outside;
    if (out) {
      const txt =
        zoneMode === 'pitches'
          ? out.pitches + ' 球 (' + out.pitchPct + '%)'
          : zoneMode === 'swingPct'
            ? out.swingPct + '% (' + out.swings + '/' + out.pitches + ')'
            : zoneMode === 'hitPct'
              ? out.hitPct + '% (' + out.hits + '/' + out.contacts + ')'
              : out.errorPct + '% (' + out.umpireErrors + '/' + out.taken + ')';
      setText('zone-outside-val', txt);
    }
  }

  async function pollMetrics() {
    try {
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
        '版本 ' + (d.version || '開發版') + ' · 已運行 ' + d.uptimeSec + ' 秒 · 更新於 ' + fmtTaipei(d.timestamp, true) + ' (台北時間)';

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
      const rm = c.roomsByMode || {};
      const qm = c.queuesByMode || {};
      setText('c-rooms-mode', (rm.quick3 || 0) + ' / ' + (rm.tiebreak || 0) + ' / ' + (rm.official6 || 0));
      setText('c-queue-mode', (qm.quick3 || 0) + ' / ' + (qm.tiebreak || 0) + ' / ' + (qm.official6 || 0));
      setText('c-ips', c.uniqueIps + ' / ' + c.maxConnsSingleIp);
      setText('c-churn', c.acceptedTotal + ' / ' + c.closedTotal);

      const standbyPill = $('standby-pill');
      if (standbyPill) {
        standbyPill.textContent = '線上候補名單：' + Number(c.standbyCount || 0) + ' 人';
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
          ['cpu_match', 'CPU 對戰', '#4ade80'],
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
          row.textContent = '[' + fmtTaipei(a.ts, true) + '] [' + a.code + '] ' + a.message;
          alertsEl.appendChild(row);
        }
      }
    } catch (e) {
      $('meta-line').textContent = '監控連線錯誤：' + String(e);
    }
  }

  async function pollAnalytics() {
    try {
      const url = new URL('./analytics.json', window.location.href);
      if (token) url.searchParams.set('token', token);
      url.searchParams.set('_t', String(Date.now()));
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        setText('meta-line', '分析讀取失敗 HTTP ' + res.status + '（若設有 MONITOR_TOKEN 請加上 ?token=...）');
        return;
      }
      const d = await res.json();
      lastAnalytics = d;
      const w = d.window;
      const ms = d.matchesSummary;
      const bs = d.battingSummary;
      const out = bs.outcomes;
      const abs = bs.abs;

      setText(
        'meta-line',
        '統計範圍：最近 ' + w.matchesAnalyzed + '/' + w.maxMatches + ' 場（進行中 ' +
        (ms.activeLive || 0) + ' 場）、' +
        w.pitchesAnalyzed + '/' + w.maxPitches + ' 球、' +
        (w.sessionsAnalyzed || 0) + ' 次裝置連線 · 日誌 ' + (w.totalDiskKb || 0) + '/' + (w.maxDiskKb || 14000) + ' KB · 更新於 ' +
        fmtTaipei(d.ts, true) + ' (台北時間)'
      );

      const gp = d.gameplay || {};
      const rh = gp.roomsHealth || {};

      setText(
        'm-counts',
        ms.total + ' 場（隨機 ' + ms.live + ' / 好友 ' + ms.friend + ' / 再戰 ' + (gp.rematchesStarted || 0) + '）'
      );
      setText('m-wins', ms.awayWins + ' 勝 / ' + ms.homeWins + ' 勝');
      setText(
        'm-dur',
        ms.avgDurationSec + ' 秒 · ' + (ms.avgPitchesPerMatch || 0) + ' 球（最高 ' + (ms.maxMatchRuns || 0) + ' 分）'
      );
      setText(
        'm-hkb',
        ms.avgRunsPerMatch + ' 分 / ' + ms.avgHitsPerMatch + ' 安 / ' + ms.avgStrikeoutsPerMatch + ' K / ' + ms.avgWalksPerMatch + ' BB'
      );
      setText(
        'm-extreme',
        (ms.highInningMatches || 0) + ' 場 / ' + (ms.extremeRunDiffMatches || 0) + ' 場（目前活躍 ' +
          (rh.highInningRooms || 0) + ' / ' + (rh.extremeRunDiffRooms || 0) + '）'
      );

      setText('b-swings', bs.totalPitches + ' 球 / ' + bs.swings + ' 揮 (' + bs.swingPct + '%)');
      setText('b-contact', bs.contactPct + '% / ' + bs.whiffPct + '%');
      setText('b-evla', bs.avgExitSpeedKmh + ' km/h · ' + bs.avgLaunchAngleDeg + '° · ' + bs.maxHrDistM + 'm');
      setText('b-hits', out.singles + ' / ' + out.doubles + ' / ' + out.triples + ' / ' + out.homeRuns);
      setText('b-outs', out.outsInPlay + ' / ' + out.foulBalls + ' / ' + out.foulFlyOuts);

      const rs = ms.reasons || {};
      setText('r-normal', ((rs.completed || 0) + (rs.normal || 0)) + ' / ' + (rs.mercy || 0));
      setText(
        'r-early',
        (rs.resign || 0) + ' / ' +
          (rs.disconnect_timeout || rs.disconnect || 0) + ' / ' +
          (rs.pitch_clock_forfeit || rs.pitch_clock || 0) + ' / ' +
          (gp.waitingExpired || 0)
      );
      setText('r-ibb-clock', out.ibbCount + ' / ' + out.clockViolations);
      setText('r-abs', abs.challenges + ' 次（翻盤 ' + abs.overturned + ' 次 · ' + abs.overturnPct + '%）');
      setText('r-disk', w.matchFileKb + ' / ' + w.pitchFileKb + ' / ' + (w.sessionFileKb || 0) + ' KB');

      setText(
        'a-rooms',
        (rh.startedRooms || 0) + ' 間 / ' + (rh.waitingRooms || 0) + ' 間 / ' + (rh.oldestRoomAgeMin || 0) + ' 分鐘'
      );
      setText('a-stalled', (rh.stalledRooms || 0) + ' 間 / ' + (rh.disconnectedRooms || 0) + ' 間');
      setText('a-clocks', (gp.pitchClockViolations || out.clockViolations || 0) + ' / ' + (gp.swingTimeouts || 0));
      setText(
        'a-dccause',
        Object.entries(gp.disconnectCauses || {}).map(([k, v]) => dcName(k) + ' ' + v).join(' / ') || '0'
      );
      setText(
        'a-reconn',
        (gp.disconnectsInMatch || 0) + ' / ' + (gp.reconnectsSucceeded || 0) + ' / ' + (gp.reconnectsFailed || 0)
      );
      setText(
        'a-integrity',
        (gp.staleOrOutOfTurnIgnored || 0) + ' / ' + (gp.outOfRangeInputsClamped || 0) + ' / ' + (gp.nanSanityErrors || 0)
      );

      const ptBody = $('pitch-tbody');
      ptBody.replaceChildren();
      for (const p of d.pitchRepertoire || []) {
        const tr = document.createElement('tr');
        tr.append(
          td(PITCH_NAMES[p.pitchId] || p.pitchId),
          td(p.count),
          td(p.usagePct + '%'),
          td(p.avgSpeedKmh + ' km/h'),
          td(p.avgBreakCm + ' cm'),
          td(p.strikePct + '%'),
          td(p.swingPct + '%'),
          td(p.whiffPct + '%'),
          td(p.hitPct + '%')
        );
        ptBody.appendChild(tr);
      }

      const hBody = $('hand-tbody');
      hBody.replaceChildren();
      for (const h of d.handednessMatrix || []) {
        const tr = document.createElement('tr');
        tr.append(
          td(PITCH_NAMES[h.pitchId] || h.pitchId),
          td(h.L.pitches),
          td(h.L.whiffPct + '%'),
          td(h.L.hitPct + '%'),
          td(h.R.pitches),
          td(h.R.whiffPct + '%'),
          td(h.R.hitPct + '%')
        );
        hBody.appendChild(tr);
      }

      renderStrikeZone(d.strikeZoneGrid);

      const sp = d.specialEvents || {};
      setText('sp-wp', (sp.wildPitches || 0) + ' 次 (' + (sp.wildPitchPct || 0) + '%)');
      setText('sp-pb', (sp.passedBalls || 0) + ' 次 (' + (sp.passedBallPct || 0) + '%)');
      setText('sp-d3s', (sp.droppedThirdStrikes || 0) + ' 次 (' + (sp.droppedThirdStrikePct || 0) + '%)');
      setText('sp-foulfly', (sp.foulFlyOuts || 0) + ' 次 (' + (sp.foulFlyOutPct || 0) + '%)');
      setText('sp-air', (sp.airCatches || 0) + ' 次 (' + (sp.airCatchPct || 0) + '%)');
      setText('sp-bobble', (sp.fielderBobbles || 0) + ' 次 (' + (sp.fielderBobblePct || 0) + '%)');
      setText('sp-block', (sp.groundBlocks || 0) + ' 次 (' + (sp.groundBlockPct || 0) + '%)');
      const bf = sp.byFielder || {};
      for (const fid of ['LF', 'RF', 'P', 'C']) {
        const f = bf[fid] || { catches: 0, blocks: 0, bobbles: 0 };
        setText('sp-f-' + fid, f.catches + ' / ' + f.blocks + ' / ' + f.bobbles);
      }

      const mech = d.mechanics || {};
      renderBars(
        'spring-bars',
        (mech.spring || []).map((s) => ({
          label: s.zone + ' (' + s.avgSpeedKmh + 'k)',
          pct: s.pct,
          rightText: s.pct + '% · 好球' + s.strikePct + '%',
        })),
        'gold'
      );
      renderBars(
        'timing-bars',
        (mech.timing || []).map((t) => ({
          label: t.label,
          pct: t.pct,
          rightText: t.pct + '% · 安' + t.hitPct + '%',
        })),
        'green'
      );

      const cp = d.crossPlatform || {};
      const h2h = cp.headToHead || { totalMatches: 0, touchWins: 0, mouseWins: 0, touchWinPct: 0 };
      setText(
        'cp-h2h',
        h2h.totalMatches > 0
          ? '共 ' + h2h.totalMatches + ' 場 · 觸控 ' + h2h.touchWins + ' 勝 (' + h2h.touchWinPct + '%) vs 滑鼠 ' + h2h.mouseWins + ' 勝'
          : '尚無跨平台正面交鋒樣本'
      );
      const cpBody = $('cp-tbody');
      cpBody.replaceChildren();
      for (const [label, row] of [
        ['手機 / 平板觸控', cp.touch],
        ['桌機滑鼠', cp.mouse],
      ]) {
        if (!row) continue;
        const tr = document.createElement('tr');
        tr.append(
          td(label),
          td(row.matches),
          td(row.winPct + '%'),
          td(row.bestSpringPct + '%'),
          td(row.swingPct + '%'),
          td(row.whiffPct + '%'),
          td(row.hitPct + '%'),
          td(row.powerSwingPct + '%'),
          td(row.avgExitSpeedKmh + ' km/h')
        );
        cpBody.appendChild(tr);
      }

      const dev = d.devices || {};
      const totS = dev.totalSessions || 0;
      const pctS = (n) => (totS > 0 ? Math.round((n / totS) * 1000) / 10 : 0);
      setText('dev-total', totS + ' 次');
      setText('dev-pwa', (dev.pwaCount || 0) + ' 次 (' + (dev.pwaPct || 0) + '%)');

      const bd = dev.byDevice || {};
      renderBars('bars-device', [
        { label: '手機 Mobile', pct: pctS(bd.mobile || 0), rightText: (bd.mobile || 0) + ' (' + pctS(bd.mobile || 0) + '%)' },
        { label: '桌機 Desktop', pct: pctS(bd.desktop || 0), rightText: (bd.desktop || 0) + ' (' + pctS(bd.desktop || 0) + '%)' },
        { label: '平板 Tablet', pct: pctS(bd.tablet || 0), rightText: (bd.tablet || 0) + ' (' + pctS(bd.tablet || 0) + '%)' },
      ]);

      const bo = dev.byOrient || {};
      const bi = dev.byInput || {};
      const bl = dev.byLocale || {};
      renderBars(
        'bars-env',
        [
          { label: '橫屏 Landscape', pct: pctS(bo.landscape || 0), rightText: (bo.landscape || 0) + ' (' + pctS(bo.landscape || 0) + '%)' },
          { label: '直屏 Portrait', pct: pctS(bo.portrait || 0), rightText: (bo.portrait || 0) + ' (' + pctS(bo.portrait || 0) + '%)' },
          { label: '觸控 Touch', pct: pctS(bi.touch || 0), rightText: (bi.touch || 0) + ' (' + pctS(bi.touch || 0) + '%)' },
          { label: '滑鼠 Mouse', pct: pctS(bi.mouse || 0), rightText: (bi.mouse || 0) + ' (' + pctS(bi.mouse || 0) + '%)' },
          { label: '繁中 / EN / JA', pct: pctS(bl['zh-TW'] || 0), rightText: (bl['zh-TW'] || 0) + ' / ' + (bl.en || 0) + ' / ' + (bl.ja || 0) },
        ],
        'green'
      );

      const bos = dev.byOs || {};
      renderBars(
        'bars-os',
        [
          { label: 'iOS', pct: pctS(bos.ios || 0), rightText: (bos.ios || 0) + ' (' + pctS(bos.ios || 0) + '%)' },
          { label: 'Android', pct: pctS(bos.android || 0), rightText: (bos.android || 0) + ' (' + pctS(bos.android || 0) + '%)' },
          { label: 'Windows', pct: pctS(bos.windows || 0), rightText: (bos.windows || 0) + ' (' + pctS(bos.windows || 0) + '%)' },
          { label: 'macOS', pct: pctS(bos.macos || 0), rightText: (bos.macos || 0) + ' (' + pctS(bos.macos || 0) + '%)' },
          { label: 'Linux / 其他', pct: pctS((bos.linux || 0) + (bos.other || 0)), rightText: ((bos.linux || 0) + (bos.other || 0)) + '' },
        ],
        'gold'
      );

      const bbr = dev.byBrowser || {};
      renderBars(
        'bars-browser',
        [
          { label: 'Chrome', pct: pctS(bbr.chrome || 0), rightText: (bbr.chrome || 0) + ' (' + pctS(bbr.chrome || 0) + '%)' },
          { label: 'Safari', pct: pctS(bbr.safari || 0), rightText: (bbr.safari || 0) + ' (' + pctS(bbr.safari || 0) + '%)' },
          { label: 'LINE 內建', pct: pctS(bbr.line || 0), rightText: (bbr.line || 0) + ' (' + pctS(bbr.line || 0) + '%)' },
          { label: 'IG / FB 內建', pct: pctS((bbr.ig || 0) + (bbr.fb || 0)), rightText: ((bbr.ig || 0) + (bbr.fb || 0)) + ' (' + pctS((bbr.ig || 0) + (bbr.fb || 0)) + '%)' },
          { label: 'Edge / Firefox', pct: pctS((bbr.edge || 0) + (bbr.firefox || 0)), rightText: ((bbr.edge || 0) + (bbr.firefox || 0)) + '' },
        ],
        'orange'
      );

      const mBody = $('matches-tbody');
      mBody.replaceChildren();
      const liveList = Array.isArray(d.liveMatches) ? d.liveMatches : [];
      const recent = [...liveList, ...(d.recentMatches || [])];
      if (recent.length === 0) {
        const tr = document.createElement('tr');
        const cell = td('目前尚無對戰紀錄。');
        cell.colSpan = 13;
        tr.appendChild(cell);
        mBody.appendChild(tr);
      } else {
        for (const m of recent) {
          const tr = document.createElement('tr');
          const typeTd = document.createElement('td');
          const badge = document.createElement('span');
          const isFriend = m.roomKind === 'friend';
          badge.className = 'tag ' + (isFriend ? 'tag-friend' : 'tag-live');
          badge.textContent = isFriend ? '好友' : '隨機';
          typeTd.appendChild(badge);
          if (m.status === 'live') {
            const liveBadge = document.createElement('span');
            liveBadge.className = 'tag tag-playing';
            liveBadge.textContent = '進行中';
            typeTd.appendChild(liveBadge);
          }

          const tsStr = fmtTaipei(m.ts, false);
          const rKey = m.reason || m.endReason || 'normal';
          const innLabel =
            m.status === 'live'
              ? (m.innings ?? 1) + (m.half === 'bottom' ? '下' : '上') + '·' + (m.outs ?? 0) + '出'
              : (m.innings ?? m.inningsPlayed ?? '--');
          tr.append(
            td(tsStr),
            typeTd,
            td(m.code || '--'),
            tdWithDevice(m.awayName, m.awayDevice),
            td((m.awayRuns ?? m.awayScore ?? 0) + ' - ' + (m.homeRuns ?? m.homeScore ?? 0)),
            tdWithDevice(m.homeName, m.homeDevice),
            td(innLabel),
            td((m.awayHits ?? 0) + '/' + (m.homeHits ?? 0)),
            td((m.awayStrikeouts ?? 0) + '/' + (m.homeStrikeouts ?? 0)),
            td((m.awayWalks ?? 0) + '/' + (m.homeWalks ?? 0)),
            td(m.pitches ?? m.totalPitches ?? '--'),
            td((m.durationSec ?? 0) + '秒'),
            td((REASON_NAMES[rKey] || rKey) + (m.disconnectCause ? '（' + dcName(m.disconnectCause) + '）' : ''))
          );
          mBody.appendChild(tr);
        }
      }
    } catch (e) {
      setText('meta-line', '分析資料讀取錯誤：' + String(e));
    }
  }

  applyTabUi();
  if (activeTab !== 'monitor') void pollMetrics();
  schedulePoll(true);
})();
`;
