import fs from 'node:fs';

export const MAX_RETAINED_MATCHES = 5000;
export const MAX_RETAINED_PITCHES = 50000;
export const ANALYTICS_WINDOW_MATCHES = 100;
export const ANALYTICS_WINDOW_PITCHES = 2000;

/**
 * Rolling disk retention cap: keeps up to `maxLines` in a JSONL file when its size exceeds
 * `byteThreshold` (e.g., ~2.5 MB for matches.jsonl / ~20 MB for pitches.jsonl), preserving
 * thousands of games for balance analysis while bounding Raspberry Pi storage forever.
 */
export async function trimJsonlFileIfNeeded(
  logPath: string,
  maxLines: number,
  byteThreshold: number,
): Promise<void> {
  try {
    const st = await fs.promises.stat(logPath);
    if (st.size <= byteThreshold) return;
    const raw = await fs.promises.readFile(logPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) return;
    const kept = lines.slice(-maxLines).join('\n') + '\n';
    await fs.promises.writeFile(logPath, kept, 'utf8');
  } catch {
    // ignore missing file or transient IO errors
  }
}

/**
 * Fast tail-chunk JSONL reader: reads at most the last `tailBytes` of `logPath` and parses
 * the last `maxLines` JSON objects without scanning the entire historical file from byte 0.
 */
export function readJsonlTail<T = Record<string, unknown>>(
  logPath: string,
  maxLines: number,
  tailBytes: number,
): { rows: T[]; fileBytes: number } {
  try {
    if (!fs.existsSync(logPath)) return { rows: [], fileBytes: 0 };
    const st = fs.statSync(logPath);
    if (st.size === 0) return { rows: [], fileBytes: 0 };
    const readLen = Math.min(st.size, tailBytes);
    const startOffset = st.size - readLen;
    const buf = Buffer.alloc(readLen);
    const fd = fs.openSync(logPath, 'r');
    try {
      fs.readSync(fd, buf, 0, readLen, startOffset);
    } finally {
      fs.closeSync(fd);
    }
    let text = buf.toString('utf8');
    if (startOffset > 0) {
      const firstNl = text.indexOf('\n');
      text = firstNl >= 0 ? text.slice(firstNl + 1) : '';
    }
    const rawLines = text.split('\n');
    const rows: T[] = [];
    for (let i = rawLines.length - 1; i >= 0 && rows.length < maxLines; i--) {
      const line = rawLines[i].trim();
      if (!line) continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // skip malformed line
      }
    }
    rows.reverse();
    return { rows, fileBytes: st.size };
  } catch {
    return { rows: [], fileBytes: 0 };
  }
}

interface MatchRecord {
  ts?: string;
  matchId?: string;
  code?: string;
  roomKind?: 'live' | 'friend';
  mode?: string;
  durationSec?: number;
  reason?: string;
  endReason?: string;
  winner?: 'away' | 'home' | null;
  innings?: number;
  inningsPlayed?: number;
  awayName?: string;
  homeName?: string;
  awayRuns?: number;
  homeRuns?: number;
  awayScore?: number;
  homeScore?: number;
  awayHits?: number;
  homeHits?: number;
  awayWalks?: number;
  homeWalks?: number;
  awayStrikeouts?: number;
  homeStrikeouts?: number;
  awayPitches?: number;
  homePitches?: number;
  pitches?: number;
  totalPitches?: number;
  absUsedAway?: number;
  absUsedHome?: number;
  spectatorsPeak?: number;
}

interface PitchRecord {
  ts?: string;
  matchId?: string;
  code?: string;
  roomKind?: 'live' | 'friend';
  event?: 'pitch' | 'ibb' | 'pitch_clock' | 'abs_challenge';
  pitchId?: 'straight' | 'cutter' | 'fork' | 'changeup' | 'knuckle';
  speedKmh?: number;
  breakCm?: number;
  trueCall?: 'strike' | 'ball';
  umpireCall?: 'strike' | 'ball';
  swung?: boolean;
  powerSwing?: boolean;
  contact?: boolean;
  exitSpeedKmh?: number | null;
  launchAngleDeg?: number | null;
  distanceM?: number | null;
  outcome?: string;
  isFoulFlyOut?: boolean;
  overturned?: boolean;
}

export function buildAnalyticsReport(
  matchLogPath: string,
  pitchLogPath: string,
  liveGameplay?: Record<string, unknown>,
) {
  const matchTail = readJsonlTail<MatchRecord>(matchLogPath, ANALYTICS_WINDOW_MATCHES, 192 * 1024);
  const pitchTail = readJsonlTail<PitchRecord>(pitchLogPath, ANALYTICS_WINDOW_PITCHES, 1280 * 1024);

  const matches = matchTail.rows;
  const events = pitchTail.rows;

  let liveMatches = 0;
  let friendMatches = 0;
  let awayWins = 0;
  let homeWins = 0;
  let totalDurationSec = 0;
  let totalRuns = 0;
  let totalHits = 0;
  let totalWalks = 0;
  let totalStrikeouts = 0;
  let totalMatchPitches = 0;
  let maxMatchRuns = 0;
  let highInningMatches = 0;
  let extremeRunDiffMatches = 0;
  const reasons: Record<string, number> = {};

  for (const m of matches) {
    if (m.roomKind === 'friend') friendMatches += 1;
    else liveMatches += 1;
    if (m.winner === 'away') awayWins += 1;
    else if (m.winner === 'home') homeWins += 1;
    totalDurationSec += Number(m.durationSec) || 0;
    const awaySc = Number(m.awayRuns ?? m.awayScore) || 0;
    const homeSc = Number(m.homeRuns ?? m.homeScore) || 0;
    const matchRuns = awaySc + homeSc;
    totalRuns += matchRuns;
    if (matchRuns > maxMatchRuns) maxMatchRuns = matchRuns;
    if (Math.abs(awaySc - homeSc) >= 15) extremeRunDiffMatches += 1;
    if ((Number(m.innings ?? m.inningsPlayed) || 0) >= 8) highInningMatches += 1;
    totalMatchPitches += Number(m.pitches ?? m.totalPitches) || 0;
    totalHits += (Number(m.awayHits) || 0) + (Number(m.homeHits) || 0);
    totalWalks += (Number(m.awayWalks) || 0) + (Number(m.homeWalks) || 0);
    totalStrikeouts += (Number(m.awayStrikeouts) || 0) + (Number(m.homeStrikeouts) || 0);
    const r = String(m.reason || m.endReason || 'normal');
    reasons[r] = (reasons[r] || 0) + 1;
  }

  const pitchStats: Record<
    string,
    {
      count: number;
      speedSum: number;
      breakSum: number;
      strikes: number;
      swings: number;
      whiffs: number;
      contacts: number;
      hits: number;
      outsInPlay: number;
    }
  > = {
    straight: { count: 0, speedSum: 0, breakSum: 0, strikes: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0, outsInPlay: 0 },
    cutter: { count: 0, speedSum: 0, breakSum: 0, strikes: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0, outsInPlay: 0 },
    fork: { count: 0, speedSum: 0, breakSum: 0, strikes: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0, outsInPlay: 0 },
    changeup: { count: 0, speedSum: 0, breakSum: 0, strikes: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0, outsInPlay: 0 },
    knuckle: { count: 0, speedSum: 0, breakSum: 0, strikes: 0, swings: 0, whiffs: 0, contacts: 0, hits: 0, outsInPlay: 0 },
  };

  let totalThrownPitches = 0;
  let totalSwings = 0;
  let totalContacts = 0;
  let evSum = 0;
  let laSum = 0;
  let maxHrDistM = 0;
  let foulBalls = 0;
  let foulFlyOuts = 0;
  let singles = 0;
  let doubles = 0;
  let triples = 0;
  let homeRuns = 0;
  let outsInPlay = 0;
  let ibbCount = 0;
  let clockViolations = 0;
  let absChallenges = 0;
  let absOverturned = 0;
  let umpireZoneDisagreements = 0;
  let takenPitches = 0;

  for (const ev of events) {
    if (ev.event === 'ibb') {
      ibbCount += 1;
      continue;
    }
    if (ev.event === 'pitch_clock') {
      clockViolations += 1;
      continue;
    }
    if (ev.event === 'abs_challenge') {
      absChallenges += 1;
      if (ev.overturned) absOverturned += 1;
      continue;
    }

    totalThrownPitches += 1;
    const pid = ev.pitchId && pitchStats[ev.pitchId] ? ev.pitchId : 'straight';
    const ps = pitchStats[pid];
    ps.count += 1;
    ps.speedSum += Number(ev.speedKmh) || 0;
    ps.breakSum += Number(ev.breakCm) || 0;

    const out = String(ev.outcome || '');
    const isStrikeOutcome =
      ev.swung ||
      out === 'STRIKE' ||
      out === 'SWINGING_STRIKE' ||
      out === 'FOUL' ||
      out === 'UNCAUGHT_THIRD_STRIKE' ||
      ev.umpireCall === 'strike';
    if (isStrikeOutcome) ps.strikes += 1;

    if (!ev.swung && ev.trueCall && ev.umpireCall) {
      takenPitches += 1;
      if (ev.trueCall !== ev.umpireCall) umpireZoneDisagreements += 1;
    }

    if (ev.swung) {
      totalSwings += 1;
      ps.swings += 1;
      if (ev.contact) {
        totalContacts += 1;
        ps.contacts += 1;
        evSum += Number(ev.exitSpeedKmh) || 0;
        laSum += Number(ev.launchAngleDeg) || 0;
        if (out === '1B') {
          singles += 1;
          ps.hits += 1;
        } else if (out === '2B') {
          doubles += 1;
          ps.hits += 1;
        } else if (out === '3B') {
          triples += 1;
          ps.hits += 1;
        } else if (out === 'HR') {
          homeRuns += 1;
          ps.hits += 1;
          const d = Number(ev.distanceM) || 0;
          if (d > maxHrDistM) maxHrDistM = d;
        } else if (out === 'FOUL') {
          foulBalls += 1;
        } else if (out === 'OUT') {
          outsInPlay += 1;
          ps.outsInPlay += 1;
          if (ev.isFoulFlyOut) foulFlyOuts += 1;
        }
      } else {
        ps.whiffs += 1;
      }
    }
  }

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
  const avg = (sum: number, den: number) => (den > 0 ? Math.round((sum / den) * 10) / 10 : 0);

  const pitchRepertoire = (['straight', 'cutter', 'fork', 'changeup', 'knuckle'] as const).map((id) => {
    const s = pitchStats[id];
    return {
      pitchId: id,
      count: s.count,
      usagePct: pct(s.count, totalThrownPitches),
      avgSpeedKmh: avg(s.speedSum, s.count),
      avgBreakCm: avg(s.breakSum, s.count),
      strikePct: pct(s.strikes, s.count),
      swingPct: pct(s.swings, s.count),
      whiffPct: pct(s.whiffs, s.swings),
      hitPct: pct(s.hits, s.contacts),
    };
  });

  return {
    ts: new Date().toISOString(),
    window: {
      maxMatches: ANALYTICS_WINDOW_MATCHES,
      maxPitches: ANALYTICS_WINDOW_PITCHES,
      retainedMaxMatches: MAX_RETAINED_MATCHES,
      retainedMaxPitches: MAX_RETAINED_PITCHES,
      matchesAnalyzed: matches.length,
      eventsAnalyzed: events.length,
      pitchesAnalyzed: totalThrownPitches,
      matchFileKb: Math.round((matchTail.fileBytes / 1024) * 10) / 10,
      pitchFileKb: Math.round((pitchTail.fileBytes / 1024) * 10) / 10,
    },
    matchesSummary: {
      total: matches.length,
      live: liveMatches,
      friend: friendMatches,
      awayWins,
      homeWins,
      avgDurationSec: matches.length > 0 ? Math.round(totalDurationSec / matches.length) : 0,
      avgRunsPerMatch: avg(totalRuns, matches.length),
      avgPitchesPerMatch: avg(totalMatchPitches, matches.length),
      maxMatchRuns,
      highInningMatches,
      extremeRunDiffMatches,
      avgHitsPerMatch: avg(totalHits, matches.length),
      avgStrikeoutsPerMatch: avg(totalStrikeouts, matches.length),
      avgWalksPerMatch: avg(totalWalks, matches.length),
      reasons,
    },
    battingSummary: {
      totalPitches: totalThrownPitches,
      swings: totalSwings,
      swingPct: pct(totalSwings, totalThrownPitches),
      contacts: totalContacts,
      contactPct: pct(totalContacts, totalSwings),
      whiffPct: pct(totalSwings - totalContacts, totalSwings),
      avgExitSpeedKmh: avg(evSum, totalContacts),
      avgLaunchAngleDeg: avg(laSum, totalContacts),
      maxHrDistM: Math.round(maxHrDistM * 10) / 10,
      outcomes: {
        singles,
        doubles,
        triples,
        homeRuns,
        outsInPlay,
        foulBalls,
        foulFlyOuts,
        ibbCount,
        clockViolations,
      },
      abs: {
        takenPitches,
        umpireBorderlineDiffs: umpireZoneDisagreements,
        challenges: absChallenges,
        overturned: absOverturned,
        overturnPct: pct(absOverturned, absChallenges),
      },
    },
    pitchRepertoire,
    gameplay: liveGameplay ?? {},
    recentMatches: [...matches].reverse(),
  };
}

export const ANALYTICS_HTML = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>瓶蓋棒球 · 線上對戰數據分析面板</title>
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
    .nav-links { display: flex; align-items: center; gap: 10px; }
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
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
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
    .table-wrap {
      overflow-x: auto;
      margin-bottom: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      padding: 7px 10px;
      border-bottom: 1px solid #1e2d4a;
      white-space: nowrap;
    }
    th {
      color: var(--gold);
      font-weight: 700;
      background: #0a1020;
    }
    .tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
    }
    .tag-live { background: rgba(34, 197, 94, 0.18); color: #86efac; border: 1px solid var(--green); }
    .tag-friend { background: rgba(56, 189, 248, 0.18); color: #7dd3fc; border: 1px solid var(--cyan); }
    .meta { color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>瓶蓋棒球 · 線上對戰數據分析面板</h1>
      <div class="meta" id="meta-line">載入近期統計資料中...</div>
    </div>
    <div class="nav-links">
      <a class="nav-link" href="./monitor">伺服器監控</a>
      <a class="nav-link" href="./">返回遊戲</a>
    </div>
  </header>

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
      <h2>勝負判定、規則與 ABS 挑戰</h2>
      <div class="kv"><span>正常完賽 / 提前結束</span><strong id="r-normal">--</strong></div>
      <div class="kv"><span>投降 / 斷線 / 超時判負 / 候房逾時</span><strong id="r-early">--</strong></div>
      <div class="kv"><span>故意四壞 / 投球計時違規</span><strong id="r-ibb-clock">--</strong></div>
      <div class="kv"><span>ABS 挑戰次數（翻盤率）</span><strong id="r-abs">--</strong></div>
      <div class="kv"><span>紀錄檔容量（對局 / 投球）</span><strong id="r-disk">--</strong></div>
    </div>

    <div class="card">
      <h2>對局同步與異常監測</h2>
      <div class="kv"><span>進行中對戰 / 等待房 / 最久房齡</span><strong id="a-rooms">--</strong></div>
      <div class="kv"><span>停滯房(&gt;45秒) / 斷線等待房</span><strong id="a-stalled">--</strong></div>
      <div class="kv"><span>投球計時超時 / 揮棒同步逾時</span><strong id="a-clocks">--</strong></div>
      <div class="kv"><span>對戰斷線 / 重連成功 / 失敗</span><strong id="a-reconn">--</strong></div>
      <div class="kv"><span>過期封包忽略 / 參數修正 / NaN</span><strong id="a-integrity">--</strong></div>
    </div>
  </div>

  <div class="card table-wrap">
    <h2>球種表現分析（最近 2,000 球）</h2>
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
    <h2>近期線上與好友對戰紀錄（最新 100 場）</h2>
    <table>
      <thead>
        <tr>
          <th>結束時間</th>
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
          <th>結束原因</th>
        </tr>
      </thead>
      <tbody id="matches-tbody"></tbody>
    </table>
  </div>

  <script src="./analytics.js"></script>
</body>
</html>`;

export const ANALYTICS_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const PITCH_NAMES = {
    straight: '直球 (4SFB)',
    cutter: '卡特 (CUT)',
    fork: '指叉 (FORK)',
    changeup: '變速 (CH)',
    knuckle: '蝴蝶 (KNU)',
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
  };

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = String(txt);
  }

  function td(text, cls) {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    cell.textContent = String(text);
    return cell;
  }

  async function poll() {
    try {
      const url = new URL('./analytics.json', window.location.href);
      if (token) url.searchParams.set('token', token);
      url.searchParams.set('_t', String(Date.now()));
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        setText('meta-line', '讀取失敗 HTTP ' + res.status + '（若伺服器設有 MONITOR_TOKEN 請於網址加上 ?token=...）');
        return;
      }
      const d = await res.json();
      const w = d.window;
      const ms = d.matchesSummary;
      const bs = d.battingSummary;
      const out = bs.outcomes;
      const abs = bs.abs;

      setText(
        'meta-line',
        '統計範圍：最近 ' + w.matchesAnalyzed + '/' + w.maxMatches + ' 場對戰、' +
        w.pitchesAnalyzed + '/' + w.maxPitches + ' 顆投球（伺服器硬碟保留上限：' +
        w.retainedMaxMatches + ' 場 / ' + w.retainedMaxPitches + ' 球）· 更新於 ' +
        d.ts.slice(11, 19)
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
      setText('r-disk', w.matchFileKb + ' KB / ' + w.pitchFileKb + ' KB');

      setText(
        'a-rooms',
        (rh.startedRooms || 0) + ' 間 / ' + (rh.waitingRooms || 0) + ' 間 / ' + (rh.oldestRoomAgeMin || 0) + ' 分鐘'
      );
      setText('a-stalled', (rh.stalledRooms || 0) + ' 間 / ' + (rh.disconnectedRooms || 0) + ' 間');
      setText('a-clocks', (gp.pitchClockViolations || out.clockViolations || 0) + ' / ' + (gp.swingTimeouts || 0));
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

      const mBody = $('matches-tbody');
      mBody.replaceChildren();
      const recent = d.recentMatches || [];
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

          const tsStr = typeof m.ts === 'string' ? m.ts.replace('T', ' ').slice(5, 19) : '--';
          const rKey = m.reason || m.endReason || 'normal';
          tr.append(
            td(tsStr),
            typeTd,
            td(m.code || '--'),
            td(m.awayName || '--'),
            td((m.awayRuns ?? m.awayScore ?? 0) + ' - ' + (m.homeRuns ?? m.homeScore ?? 0)),
            td(m.homeName || '--'),
            td(m.innings ?? m.inningsPlayed ?? '--'),
            td((m.awayHits ?? 0) + '/' + (m.homeHits ?? 0)),
            td((m.awayStrikeouts ?? 0) + '/' + (m.homeStrikeouts ?? 0)),
            td((m.awayWalks ?? 0) + '/' + (m.homeWalks ?? 0)),
            td(m.pitches ?? m.totalPitches ?? '--'),
            td((m.durationSec ?? 0) + '秒'),
            td(REASON_NAMES[rKey] || rKey)
          );
          mBody.appendChild(tr);
        }
      }
    } catch (e) {
      setText('meta-line', '分析資料讀取錯誤：' + String(e));
    }
  }

  poll();
  setInterval(poll, 5000);
})();
`;
