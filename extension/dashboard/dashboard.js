import { renderHeatmap } from './heatmap.js';
import { cfFetchSigned } from '../lib/codeforces.js';
import { computeStreak, computeLanguageBreakdown, computeRatingHistogram, computeSolveTimeHeatmap, dedupeLatestPerProblem } from '../lib/insights.js';

// DOM Elements
const dashboard = document.getElementById('dashboard');
const loading = document.getElementById('loading');
const errorState = document.getElementById('error');
const emptyState = document.getElementById('emptyState');

// Chart Instances
let ratingChartInstance = null;
let diffChartInstance = null;

// Initialization
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
  // Reset View
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  dashboard.style.display = 'none';
  loading.style.display = 'flex';
  
  try {
    const [infoData, statusData, ratingData] = await Promise.all([
      cfFetchSigned('user.info', { handles: handle }, apiKey, apiSecret),
      cfFetchSigned('user.status', { handle, count: '500' }, apiKey, apiSecret),
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

function renderDashboard(user, submissions, ratingHistory) {
  // 1. Basic Info
  document.getElementById('userHandle').textContent = user.handle;
  document.getElementById('userAvatar').src = user.titlePhoto || user.avatar || '';
  document.getElementById('userRank').textContent = user.rank || "Unrated";
  document.getElementById('userRating').textContent = user.rating ? `Rating: ${user.rating}` : "Unrated";
  document.getElementById('userMaxRating').textContent = user.maxRating ? `Max: ${user.maxRating}` : "";
  
  // Apply colors based on rating
  document.getElementById('userRank').style.color = getRatingColor(user.rating);

  // 2. Process Submissions (Filter Accepted, Deduplicate)
  const allAccepted = submissions.filter(s => s.verdict === 'OK');
  const uniqueAccepted = dedupeLatestPerProblem(allAccepted);
  
  document.getElementById('totalSolved').textContent = uniqueAccepted.length;
  document.getElementById('totalSubmissions').textContent = submissions.length;

  // 3. Compute Streak using extension's insight module
  const streakInfo = computeStreak(allAccepted);
  document.getElementById('currentStreak').textContent = streakInfo.current;
  document.getElementById('longestStreak').textContent = streakInfo.longest;
  document.getElementById('activeDays').textContent = streakInfo.activeDays;

  // 4. Compute Topics & Languages
  const topics = computeTopics(uniqueAccepted);
  document.getElementById('totalTopics').textContent = Object.keys(topics).length;
  
  const langs = computeLanguageBreakdown(allAccepted);
  
  // 5. Avg Rating Solved
  const ratedProblems = uniqueAccepted.filter(s => s.problem.rating);
  const avg = ratedProblems.length > 0 
    ? Math.round(ratedProblems.reduce((sum, s) => sum + s.problem.rating, 0) / ratedProblems.length)
    : 0;
  document.getElementById('avgRating').textContent = avg;

  // 6. Render Heatmap
  renderHeatmap(uniqueAccepted, document.getElementById('heatmap'));

  // 7. Render Charts
  renderRatingChart(ratingHistory);
  // Re-use computeRatingHistogram
  const hist = computeRatingHistogram(uniqueAccepted);
  renderDifficultyChartFromHist(hist);

  // 8. Render Topic/Lang Lists
  renderList('topicsList', topics, uniqueAccepted.length);
  renderList('langList', langs, allAccepted.length);
}

// --- Stats Logic ---

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

// --- Renderers ---

function getRatingColor(rating) {
  if (!rating) return '#8b8b9b'; // unrated
  if (rating < 1200) return '#cccccc'; // gray
  if (rating < 1400) return '#77ff77'; // green
  if (rating < 1600) return '#77ddbb'; // cyan
  if (rating < 1900) return '#aaaaff'; // blue
  if (rating < 2100) return '#ff88ff'; // purple
  if (rating < 2300) return '#ffcc88'; // orange
  if (rating < 2400) return '#ffbb55'; // orange
  if (rating < 2600) return '#ff7777'; // red
  if (rating < 3000) return '#ff3333'; // red
  return '#aa0000'; // legend
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
    nameEl.textContent = name; // textContent — safe against XSS

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

  const data = history.map(h => ({
    x: h.ratingUpdateTimeSeconds * 1000,
    y: h.newRating
  }));

  ratingChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Rating',
        data: data,
        borderColor: '#00d4aa',
        backgroundColor: 'rgba(0, 212, 170, 0.1)',
        fill: true,
        borderWidth: 2,
        tension: 0.1,
        pointRadius: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month' },
          grid: { color: '#cccccc' },
          ticks: { color: '#000000' }
        },
        y: {
          grid: { color: '#cccccc' },
          ticks: { color: '#000000', stepSize: 1 }
        }
      }
    }
  });
}

function renderDifficultyChartFromHist(hist) {
  const ctx = document.getElementById('difficultyChart').getContext('2d');
  if (diffChartInstance) diffChartInstance.destroy();

  const sortedKeys = Object.keys(hist).sort((a,b) => {
    if (a === "Unrated") return -1;
    if (b === "Unrated") return 1;
    return parseInt(a) - parseInt(b);
  });
  
  diffChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedKeys,
      datasets: [{
        label: 'Solved',
        data: sortedKeys.map(k => hist[k]),
        backgroundColor: '#ff6b35',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#000000' }
        },
        y: {
          grid: { color: '#cccccc' },
          ticks: { color: '#000000', stepSize: 1 }
        }
      }
    }
  });
}

// Start
init();
