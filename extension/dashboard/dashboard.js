import { renderHeatmap } from './heatmap.js';
import { cfFetchSigned } from '../lib/codeforces.js';
import { computeStreak, computeLanguageBreakdown, computeRatingHistogram, dedupeLatestPerProblem } from '../lib/insights.js';

// DOM Elements
const dashboard = document.getElementById('dashboard');
const loading = document.getElementById('loading');
const errorState = document.getElementById('error');
const emptyState = document.getElementById('emptyState');

// Chart Instances
let ratingChartInstance = null;
let diffChartInstance = null;
let speedTrendChartInstance = null;
let cmpDiffChartInstance = null;
let cmpRadarChartInstance = null;

// Current user's processed data (used by Compare tab)
let myProcessedData = null;

// ── Tab Logic ──────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Initialization ─────────────────────────────────────────
async function init() {
  chrome.storage.local.get(['fh_cf_handle', 'fh_cf_api_key', 'fh_cf_api_secret'], async (res) => {
    const handle = res.fh_cf_handle;
    const apiKey = res.fh_cf_api_key;
    const apiSecret = res.fh_cf_api_secret;

    if (!handle || !apiKey || !apiSecret) {
      emptyState.style.display = 'flex';
      loading.style.display = 'none';
      return;
    }
    
    await loadUserDashboard(handle, apiKey, apiSecret);
  });
}

async function loadUserDashboard(handle, apiKey, apiSecret) {
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  dashboard.style.display = 'none';
  loading.style.display = 'flex';
  
  try {
    const [infoData, statusData, ratingData] = await Promise.all([
      cfFetchSigned('user.info', { handles: handle }, apiKey, apiSecret),
      cfFetchSigned('user.status', { handle, count: '1000' }, apiKey, apiSecret),
      cfFetchSigned('user.rating', { handle }, apiKey, apiSecret)
    ]);
    
    renderDashboard(infoData[0], statusData, ratingData || []);
    
    loading.style.display = 'none';
    dashboard.style.display = 'flex';
  } catch (err) {
    console.error(err);
    document.getElementById('errorDesc').textContent = err.message || "Failed to load Codeforces data securely.";
    loading.style.display = 'none';
    errorState.style.display = 'flex';
  }
}

  // 1. Basic Info
  document.getElementById('userHandle').textContent = user.handle;

  // Fix protocol-relative avatar URLs (CF sometimes returns //userpic.codeforces.org/...)
  const rawAvatar = user.titlePhoto || user.avatar || '';
  const avatarEl = document.getElementById('userAvatar');
  avatarEl.src = rawAvatar.startsWith('//') ? 'https:' + rawAvatar : rawAvatar;
  avatarEl.onerror = () => { avatarEl.style.display = 'none'; };

  // Rank badge — only show if rated
  const rankEl = document.getElementById('userRank');
  if (user.rank) {
    rankEl.textContent = user.rank;
    rankEl.style.display = '';
  } else {
    rankEl.textContent = 'Unrated';
    rankEl.style.display = '';
  }
  rankEl.style.color = getRatingColor(user.rating);

  // Rating & Max Rating — hide entirely if unrated to avoid double "Unrated"
  const ratingEl    = document.getElementById('userRating');
  const maxRatingEl = document.getElementById('userMaxRating');
  if (user.rating) {
    ratingEl.textContent    = `Rating: ${user.rating}`;
    ratingEl.style.display  = '';
  } else {
    ratingEl.style.display  = 'none';
  }
  if (user.maxRating) {
    maxRatingEl.textContent   = `Max: ${user.maxRating}`;
    maxRatingEl.style.display = '';
  } else {
    maxRatingEl.style.display = 'none';
  }

  // 2. Filter & dedupe
  const allAccepted = submissions.filter(s => s.verdict === 'OK');
  const uniqueAccepted = dedupeLatestPerProblem(allAccepted);
  
  document.getElementById('totalSolved').textContent = uniqueAccepted.length;
  document.getElementById('totalSubmissions').textContent = submissions.length;

  // 3. Streak
  const streakInfo = computeStreak(allAccepted);
  document.getElementById('currentStreak').textContent = streakInfo.current;
  document.getElementById('longestStreak').textContent = streakInfo.longest;
  document.getElementById('activeDays').textContent = streakInfo.activeDays;

  // 4. Topics & Languages
  const topics = computeTopics(uniqueAccepted);
  document.getElementById('totalTopics').textContent = Object.keys(topics).length;
  const langs = computeLanguageBreakdown(allAccepted);

  // 5. Avg Rating
  const ratedProblems = uniqueAccepted.filter(s => s.problem.rating);
  const avg = ratedProblems.length > 0
    ? Math.round(ratedProblems.reduce((sum, s) => sum + s.problem.rating, 0) / ratedProblems.length)
    : 0;
  document.getElementById('avgRating').textContent = avg;

  // 6. Overview Tab
  renderHeatmap(uniqueAccepted, document.getElementById('heatmap'));
  renderRatingChart(ratingHistory);
  const hist = computeRatingHistogram(uniqueAccepted);
  renderDifficultyChartFromHist(hist);

  // 7. Topics & Languages Tab
  renderList('topicsList', topics, uniqueAccepted.length);
  renderList('langList', langs, allAccepted.length);

  // 8. Solve Speed Tab
  renderSolveSpeedTable(submissions, ratingHistory);

  // 9. Time Heatmap Tab
  renderTimeHeatmap(allAccepted);

  // Store for Compare tab
  myProcessedData = { user, uniqueAccepted, allAccepted, ratingHistory };
}

// ── Solve Speed ────────────────────────────────────────────
function renderSolveSpeedTable(submissions, ratingHistory) {
  // Build a map: contestId → startTimeSeconds
  const contestStarts = {};
  for (const r of ratingHistory) {
    // ratingHistory has ratingUpdateTimeSeconds — we need contest start.
    // We'll use submission creationTimeSeconds - relativeTimeSeconds as contest start.
  }

  // Filter contest submissions with relativeTimeSeconds (only in-contest subs have this > 0)
  const contestSubs = submissions.filter(s =>
    s.verdict === 'OK' &&
    s.author && s.author.participantType === 'CONTESTANT' &&
    typeof s.relativeTimeSeconds === 'number' &&
    s.relativeTimeSeconds >= 0 &&
    s.relativeTimeSeconds < 86400 // within 24h of contest start
  );

  const tbody = document.getElementById('speedTableBody');
  
  if (contestSubs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888;padding:2rem;">
      No in-contest accepted submissions found.<br>
      <small style="color:#aaa;">Only submissions made during live contests are tracked here.</small>
    </td></tr>`;
    renderSpeedTrendChart([]);
    return;
  }

  // Sort by fastest first
  const sorted = [...contestSubs].sort((a, b) => a.relativeTimeSeconds - b.relativeTimeSeconds);

  tbody.innerHTML = '';
  for (const s of sorted.slice(0, 100)) {
    const mins = Math.round(s.relativeTimeSeconds / 60);
    const rating = s.problem.rating || null;
    const tags = (s.problem.tags || []).slice(0, 3).join(', ') || '—';
    const problemName = `${s.problem.contestId}${s.problem.index}. ${s.problem.name}`;

    let speedClass = 'speed-slow';
    let speedLabel = `${mins}m`;
    if (mins < 20) { speedClass = 'speed-fast'; }
    else if (mins < 60) { speedClass = 'speed-med'; }

    const ratingColor = rating ? getRatingColor(rating) : '#999';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="https://codeforces.com/contest/${s.problem.contestId}/problem/${s.problem.index}" 
            target="_blank" style="color:#000080;text-decoration:none;font-weight:600;"
            title="${problemName}">${problemName.length > 40 ? problemName.slice(0, 40) + '…' : problemName}</a></td>
      <td style="color:#555;">#${s.problem.contestId}</td>
      <td style="font-size:12px;color:#444;">${tags}</td>
      <td><span class="rating-chip" style="background:${ratingColor};">${rating || 'N/A'}</span></td>
      <td><span class="speed-pill ${speedClass}">${speedLabel}</span></td>
    `;
    tbody.appendChild(tr);
  }

  // Speed trend: avg solve time per month
  renderSpeedTrendChart(contestSubs);
}

function renderSpeedTrendChart(contestSubs) {
  const ctx = document.getElementById('speedTrendChart').getContext('2d');
  if (speedTrendChartInstance) speedTrendChartInstance.destroy();

  if (!contestSubs.length) return;

  // Group by month
  const byMonth = {};
  for (const s of contestSubs) {
    const d = new Date(s.creationTimeSeconds * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(Math.round(s.relativeTimeSeconds / 60));
  }

  const labels = Object.keys(byMonth).sort();
  const data = labels.map(k => {
    const arr = byMonth[k];
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  });

  speedTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg mins to AC',
        data,
        borderColor: '#000080',
        backgroundColor: 'rgba(0,0,128,0.08)',
        fill: true,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#000080',
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y} min avg`
          }
        }
      },
      scales: {
        x: { ticks: { color: '#333' }, grid: { color: '#eee' } },
        y: {
          ticks: { color: '#333', callback: v => `${v}m` },
          grid: { color: '#eee' },
          title: { display: true, text: 'Minutes', color: '#555' }
        }
      }
    }
  });
}

// ── Time Heatmap ───────────────────────────────────────────
function renderTimeHeatmap(acceptedSubs) {
  // By hour of day (0–23)
  const hourCounts = Array(24).fill(0);
  // By day of week (0=Sun) × hour
  const dayHourCounts = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const s of acceptedSubs) {
    const d = new Date(s.creationTimeSeconds * 1000);
    const h = d.getHours();
    const dow = d.getDay();
    hourCounts[h]++;
    dayHourCounts[dow][h]++;
  }

  const maxHour = Math.max(...hourCounts, 1);
  const maxDayHour = Math.max(...dayHourCounts.flat(), 1);

  // Hour grid
  const hourGrid = document.getElementById('hourGrid');
  const hourLabels = document.getElementById('hourLabels');
  hourGrid.innerHTML = '';
  hourLabels.innerHTML = '';

  for (let h = 0; h < 24; h++) {
    const count = hourCounts[h];
    const intensity = count / maxHour;
    const cell = document.createElement('div');
    cell.className = 'hour-cell';
    cell.style.background = intensityToColor(intensity);
    cell.title = `${h}:00 — ${count} solves`;
    hourGrid.appendChild(cell);

    const lbl = document.createElement('span');
    lbl.textContent = h % 3 === 0 ? `${h}h` : '';
    hourLabels.appendChild(lbl);
  }

  // Day × Hour grid
  const dayHourGrid = document.getElementById('dayHourGrid');
  dayHourGrid.innerHTML = '';

  for (let dow = 0; dow < 7; dow++) {
    const row = document.createElement('div');
    row.className = 'day-heatmap-row';

    const lbl = document.createElement('div');
    lbl.className = 'day-label';
    lbl.textContent = dayNames[dow];
    row.appendChild(lbl);

    const cells = document.createElement('div');
    cells.className = 'day-cells';

    for (let h = 0; h < 24; h++) {
      const count = dayHourCounts[dow][h];
      const intensity = count / maxDayHour;
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.style.background = intensityToColor(intensity);
      cell.title = `${dayNames[dow]} ${h}:00 — ${count} solves`;
      cells.appendChild(cell);
    }

    row.appendChild(cells);
    dayHourGrid.appendChild(row);
  }
}

function intensityToColor(t) {
  // GitHub-style green ramp
  if (t === 0) return '#ebedf0';
  if (t < 0.25) return '#9be9a8';
  if (t < 0.5)  return '#40c463';
  if (t < 0.75) return '#30a14e';
  return '#216e39';
}

// ── Helpers ────────────────────────────────────────────────
function computeTopics(submissions) {
  const counts = {};
  for (const s of submissions) {
    if (s.problem.tags) {
      for (const tag of s.problem.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
  }
  return counts;
}

function getRatingColor(rating) {
  if (!rating) return '#8b8b9b';
  if (rating < 1200) return '#808080';
  if (rating < 1400) return '#008000';
  if (rating < 1600) return '#03a89e';
  if (rating < 1900) return '#0000ff';
  if (rating < 2100) return '#aa00aa';
  if (rating < 2300) return '#ff8c00';
  if (rating < 2400) return '#ff8c00';
  if (rating < 2600) return '#ff0000';
  if (rating < 3000) return '#ff0000';
  return '#aa0000';
}

function renderList(containerId, dataMap, total) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const sorted = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    const pct = Math.round((count / total) * 100);
    const item = document.createElement('div');
    item.className = 'list-item';
    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = name;
    const barContainer = document.createElement('div');
    barContainer.className = 'item-bar-container';
    const bar = document.createElement('div');
    bar.className = 'item-bar';
    bar.style.width = `${pct}%`;
    barContainer.appendChild(bar);
    const countEl = document.createElement('div');
    countEl.className = 'item-count';
    countEl.textContent = String(count);
    item.appendChild(nameEl);
    item.appendChild(barContainer);
    item.appendChild(countEl);
    container.appendChild(item);
  }
}

function renderRatingChart(history) {
  const ctx = document.getElementById('ratingChart').getContext('2d');
  if (ratingChartInstance) ratingChartInstance.destroy();
  if (!history || history.length === 0) return;
  const data = history.map(h => ({ x: h.ratingUpdateTimeSeconds * 1000, y: h.newRating }));
  ratingChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Rating',
        data,
        borderColor: '#00d4aa',
        backgroundColor: 'rgba(0,212,170,0.1)',
        fill: true, borderWidth: 2, tension: 0.1, pointRadius: 2, pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'time', time: { unit: 'month' }, grid: { color: '#cccccc' }, ticks: { color: '#000000' } },
        y: { grid: { color: '#cccccc' }, ticks: { color: '#000000', stepSize: 1 } }
      }
    }
  });
}

function renderDifficultyChartFromHist(hist) {
  const ctx = document.getElementById('difficultyChart').getContext('2d');
  if (diffChartInstance) diffChartInstance.destroy();
  const sortedKeys = Object.keys(hist).sort((a, b) => {
    if (a === "Unrated") return -1;
    if (b === "Unrated") return 1;
    return parseInt(a) - parseInt(b);
  });
  diffChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedKeys,
      datasets: [{ label: 'Solved', data: sortedKeys.map(k => hist[k]), backgroundColor: '#ff6b35', borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#000000' } },
        y: { grid: { color: '#cccccc' }, ticks: { color: '#000000', stepSize: 1 } }
      }
    }
  });
}

// ── Compare Tab ───────────────────────────────────────────

// Wire up Compare button
document.getElementById('compareBtn').addEventListener('click', runComparison);
document.getElementById('peerHandleInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') runComparison();
});

async function cfFetchPublic(method, params) {
  const url = new URL(`https://codeforces.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(json.comment || 'CF API error');
  return json.result;
}

async function runComparison() {
  const peerHandle = document.getElementById('peerHandleInput').value.trim();
  if (!peerHandle) return;

  const loading = document.getElementById('cmpLoading');
  const error   = document.getElementById('cmpError');
  const results = document.getElementById('cmpResults');

  results.style.display = 'none';
  error.style.display   = 'none';
  loading.style.display = 'block';

  try {
    const [peerInfoData, peerStatusData, peerRatingData] = await Promise.all([
      cfFetchPublic('user.info',   { handles: peerHandle }),
      cfFetchPublic('user.status', { handle: peerHandle, count: '1000' }),
      cfFetchPublic('user.rating', { handle: peerHandle }).catch(() => [])
    ]);

    const peerUser          = peerInfoData[0];
    const peerAllAccepted   = peerStatusData.filter(s => s.verdict === 'OK');
    const peerUnique        = dedupeLatestPerProblem(peerAllAccepted);

    loading.style.display = 'none';
    renderComparison(
      myProcessedData,
      { user: peerUser, uniqueAccepted: peerUnique, allAccepted: peerAllAccepted, ratingHistory: peerRatingData || [] }
    );
  } catch (err) {
    loading.style.display = 'none';
    error.textContent     = `Could not load peer: ${err.message}`;
    error.style.display   = 'block';
  }
}

function renderComparison(me, peer) {
  const results = document.getElementById('cmpResults');

  // ── Profile cards ──
  const fillCard = (prefix, data) => {
    document.getElementById(`cmp${prefix}Avatar`).src     = data.user.titlePhoto || data.user.avatar || '';
    document.getElementById(`cmp${prefix}Handle`).textContent = data.user.handle;
    document.getElementById(`cmp${prefix}Rank`).textContent   = data.user.rank || 'Unrated';
    const rating = data.user.rating || 0;
    const rEl = document.getElementById(`cmp${prefix}Rating`);
    rEl.textContent  = rating || 'Unrated';
    rEl.style.color  = getRatingColor(rating);
  };
  fillCard('My',   me);
  fillCard('Peer', peer);

  // ── Metrics ──
  const meStreak   = computeStreak(me.allAccepted);
  const peerStreak = computeStreak(peer.allAccepted);

  const meRated   = me.uniqueAccepted.filter(s => s.problem.rating);
  const peerRated = peer.uniqueAccepted.filter(s => s.problem.rating);
  const meAvg   = meRated.length   ? Math.round(meRated.reduce((a,s)=>a+s.problem.rating,0)   / meRated.length)   : 0;
  const peerAvg = peerRated.length ? Math.round(peerRated.reduce((a,s)=>a+s.problem.rating,0) / peerRated.length) : 0;

  const metrics = [
    { label: 'Current Rating',    me: me.user.rating||0,                   peer: peer.user.rating||0,           fmt: v => v || 'Unrated' },
    { label: 'Max Rating',        me: me.user.maxRating||0,                peer: peer.user.maxRating||0,        fmt: v => v || 'Unrated' },
    { label: 'Problems Solved',   me: me.uniqueAccepted.length,            peer: peer.uniqueAccepted.length,    fmt: v => v },
    { label: 'Total Submissions', me: me.allAccepted.length,               peer: peer.allAccepted.length,       fmt: v => v },
    { label: 'Avg Difficulty',    me: meAvg,                               peer: peerAvg,                       fmt: v => v || 'N/A' },
    { label: 'Contests',          me: me.ratingHistory.length,             peer: peer.ratingHistory.length,     fmt: v => v },
    { label: 'Current Streak',    me: meStreak.current,                    peer: peerStreak.current,            fmt: v => `${v} days` },
    { label: 'Active Days',       me: meStreak.activeDays,                 peer: peerStreak.activeDays,         fmt: v => v },
  ];

  let myWins = 0;
  const tbody = document.getElementById('cmpTableBody');
  tbody.innerHTML = '';

  for (const m of metrics) {
    const iWin   = m.me > m.peer;
    const theyWin = m.peer > m.me;
    if (iWin) myWins++;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:10px 16px; text-align:right; font-size:15px; font-weight:${iWin?'700':'400'};
                 background:${iWin?'rgba(0,128,0,0.1)':'transparent'}; color:${iWin?'#006000':'#222'};">
        ${m.fmt(m.me)}
      </td>
      <td style="padding:10px 16px; text-align:center; font-size:12px; font-weight:600; color:#555;
                 border-left:1px solid #ddd; border-right:1px solid #ddd; text-transform:uppercase; letter-spacing:0.5px;">
        ${m.label}
      </td>
      <td style="padding:10px 16px; text-align:left; font-size:15px; font-weight:${theyWin?'700':'400'};
                 background:${theyWin?'rgba(200,0,0,0.08)':'transparent'}; color:${theyWin?'#a00':'#222'};">
        ${m.fmt(m.peer)}
      </td>
    `;
    tr.style.borderBottom = '1px solid #eee';
    tbody.appendChild(tr);
  }

  // Score bar
  const total = metrics.length;
  document.getElementById('cmpScoreYou').textContent   = myWins;
  document.getElementById('cmpScoreTotal').textContent = total;
  document.getElementById('cmpScoreBar').style.width   = `${Math.round((myWins/total)*100)}%`;
  const scoreColor = myWins >= total/2 ? '#008000' : '#a00000';
  document.getElementById('cmpScoreYou').style.color   = scoreColor;
  document.getElementById('cmpScoreBar').style.background = scoreColor;

  // ── Charts ──
  renderCmpDiffChart(me.uniqueAccepted, peer.uniqueAccepted, peer.user.handle);
  renderCmpRadarChart(me.uniqueAccepted, peer.uniqueAccepted, me.user.handle, peer.user.handle);

  results.style.display = 'block';
}

function diffBucket(rating) {
  if (!rating) return 'Unrated';
  if (rating <= 800)  return '≤800';
  if (rating <= 1200) return '801–1200';
  if (rating <= 1600) return '1201–1600';
  if (rating <= 2000) return '1601–2000';
  if (rating <= 2400) return '2001–2400';
  return '2401+';
}

const DIFF_BUCKETS = ['Unrated','≤800','801–1200','1201–1600','1601–2000','2001–2400','2401+'];

function renderCmpDiffChart(mySubs, peerSubs, peerHandle) {
  const ctx = document.getElementById('cmpDiffChart').getContext('2d');
  if (cmpDiffChartInstance) cmpDiffChartInstance.destroy();

  const count = (subs, bucket) => subs.filter(s => diffBucket(s.problem.rating) === bucket).length;

  cmpDiffChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: DIFF_BUCKETS,
      datasets: [
        { label: 'You',       data: DIFF_BUCKETS.map(b => count(mySubs,   b)), backgroundColor: 'rgba(0,0,128,0.7)',  borderRadius: 3 },
        { label: peerHandle, data: DIFF_BUCKETS.map(b => count(peerSubs, b)), backgroundColor: 'rgba(180,0,0,0.6)',  borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { ticks: { color: '#333' }, grid: { display: false } },
        y: { ticks: { color: '#333', stepSize: 1 }, grid: { color: '#eee' } }
      }
    }
  });
}

function renderCmpRadarChart(mySubs, peerSubs, myHandle, peerHandle) {
  const ctx = document.getElementById('cmpRadarChart').getContext('2d');
  if (cmpRadarChartInstance) cmpRadarChartInstance.destroy();

  // Build union of top 10 tags from both users
  const tagCount = subs => {
    const c = {};
    for (const s of subs) for (const t of (s.problem.tags || [])) c[t] = (c[t]||0) + 1;
    return c;
  };
  const myTags   = tagCount(mySubs);
  const peerTags = tagCount(peerSubs);

  // Pick top 10 from combined
  const combined = {};
  for (const [k,v] of Object.entries(myTags))   combined[k] = (combined[k]||0) + v;
  for (const [k,v] of Object.entries(peerTags)) combined[k] = (combined[k]||0) + v;
  const labels = Object.entries(combined).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);

  cmpRadarChartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        { label: myHandle,   data: labels.map(l => myTags[l]||0),   backgroundColor: 'rgba(0,0,180,0.15)', borderColor: '#000080', pointBackgroundColor: '#000080', borderWidth: 2 },
        { label: peerHandle, data: labels.map(l => peerTags[l]||0), backgroundColor: 'rgba(180,0,0,0.12)', borderColor: '#a00',    pointBackgroundColor: '#a00',    borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        r: {
          ticks: { display: false },
          pointLabels: { font: { size: 11 }, color: '#333' },
          grid: { color: '#ddd' },
          angleLines: { color: '#ddd' }
        }
      }
    }
  });
}

// Start
init();
