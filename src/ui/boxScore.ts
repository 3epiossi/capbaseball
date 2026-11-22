import type { MatchState } from '../rules/match';

export interface BoxScoreLabels {
  team?: string;
  r?: string;
  h?: string;
  k?: string;
  bb?: string;
  pitches?: string;
  hr?: string;
  diff10?: string;
  coldGameLabel?: string;
  disconnectWinLabel?: string;
  disconnectTag?: string;
  resignWinLabel?: string;
  resignTag?: string;
  mvpLabel?: string;
}

/**
 * Broadcast-style Box Score + Match MVP renderer (zero innerHTML, 100% safe DOM construction).
 */
export function renderBoxScore(
  container: HTMLElement,
  match: MatchState,
  opts?: BoxScoreLabels,
): void {
  container.replaceChildren();

  const inningsCount = Math.max(
    match.regulationInnings,
    match.away.runsByInning.length,
    match.home.runsByInning.length,
  );

  const lTeam = opts?.team ?? 'TEAM';
  const lR = opts?.r ?? 'R';
  const lH = opts?.h ?? 'H';
  const lK = opts?.k ?? 'K';
  const lBb = opts?.bb ?? 'BB';
  const lPitches = opts?.pitches ?? 'PITCHES';
  const lHr = opts?.hr ?? 'HR';
  const lDiff10 = opts?.diff10 ?? '10+ DIFF';

  // 1. Line Score Table
  const table = document.createElement('table');
  table.className = 'boxscore-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  const headers = [lTeam];
  for (let i = 1; i <= inningsCount; i++) headers.push(String(i));
  headers.push(lR, lH, lK, lBb);
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const rows: Array<{ team: MatchState['away']; accent: string }> = [
    { team: match.away, accent: 'bs-away' },
    { team: match.home, accent: 'bs-home' },
  ];
  for (const { team, accent } of rows) {
    const tr = document.createElement('tr');
    tr.className = accent;
    const nameTd = document.createElement('td');
    nameTd.className = 'bs-team';
    nameTd.textContent = team.name;
    tr.appendChild(nameTd);

    for (let i = 0; i < inningsCount; i++) {
      const td = document.createElement('td');
      const v = team.runsByInning[i];
      td.textContent = typeof v === 'number' ? String(v) : '-';
      tr.appendChild(td);
    }

    const rTd = document.createElement('td');
    rTd.className = 'bs-runs';
    rTd.textContent = String(team.totalRuns);
    const hTd = document.createElement('td');
    hTd.textContent = String(team.hits);
    const kTd = document.createElement('td');
    kTd.textContent = String(team.strikeouts);
    const bbTd = document.createElement('td');
    bbTd.textContent = String(team.walks);
    tr.append(rTd, hTd, kTd, bbTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // 2. Match Summary Pills + Cold Game Badge
  const metaRow = document.createElement('div');
  metaRow.className = 'boxscore-meta';

  const addPill = (label: string, val = '', highlight = false) => {
    const pill = document.createElement('span');
    pill.className = highlight ? 'bs-pill hi' : 'bs-pill';
    pill.textContent = val ? `${label} ${val}` : label;
    metaRow.appendChild(pill);
  };

  addPill(lPitches, String(match.stats.totalPitches));
  addPill(lHr, String(match.stats.homeRuns));
  if (match.endReason === 'disconnect') {
    addPill(opts?.disconnectWinLabel || 'OPPONENT DISCONNECTED', '', true);
  } else if (match.endReason === 'resign') {
    addPill(opts?.resignWinLabel || 'OPPONENT FORFEITED', '', true);
  } else if (match.mercyTriggered || match.endReason === 'mercy') {
    addPill(opts?.coldGameLabel || 'COLD GAME', lDiff10, true);
  }
  container.appendChild(metaRow);

  // 3. Match MVP Spotlight
  const winTeam = match.winner === 'away' ? match.away : match.home;
  const loseTeam = match.winner === 'away' ? match.home : match.away;
  const pitchHero = winTeam.pitchesThrown > 0 && loseTeam.strikeouts >= Math.max(3, winTeam.hits);
  const mvpSlot = pitchHero
    ? winTeam.lineup[0]
    : winTeam.lineup[Math.max(0, (winTeam.batterIndex - 1 + winTeam.lineup.length) % winTeam.lineup.length)];

  const mvpCard = document.createElement('div');
  mvpCard.className = 'mvp-card';
  const mvpTag = document.createElement('span');
  mvpTag.className = 'mvp-tag';
  mvpTag.textContent = opts?.mvpLabel || 'MATCH MVP';
  const mvpName = document.createElement('strong');
  mvpName.className = 'mvp-name';
  mvpName.textContent = `${winTeam.name} · ${mvpSlot?.name ?? 'ACE'}`;
  const mvpStat = document.createElement('span');
  mvpStat.className = 'mvp-stat';
  mvpStat.textContent = pitchHero
    ? `${winTeam.pitchesThrown}P · ${loseTeam.strikeouts}K`
    : `${winTeam.totalRuns}R · ${winTeam.hits}H`;
  mvpCard.append(mvpTag, mvpName, mvpStat);
  container.appendChild(mvpCard);
}
