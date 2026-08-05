// popup.js — dashboard only.
// Setup (CF verify, GitHub connect, repo pick) lives in options/options.html,
// a real browser tab that doesn't close when the user switches tabs.
//
// XSS note: all dynamic data rendered via textContent / createElement only.

import { getStoredGitHubToken, getCfHandle, getSettings } from "../lib/auth.js";
import { getUserSubmissions, getUserInfo } from "../lib/codeforces.js";
import { getSyncLog } from "../lib/sync.js";
import {
  computeStreak, computeRatingHistogram, computeLanguageBreakdown,
  computeSolveTimeHeatmap, dedupeLatestPerProblem,
} from "../lib/insights.js";

const $ = (id) => document.getElementById(id);

const setupPromptView = $("setupPromptView");
const dashboardView   = $("dashboardView");
const openSetupBtn    = $("openSetupBtn");
const settingsBtn     = $("settingsBtn");
const manualSyncBtn   = $("manualSyncBtn");
const statusText      = $("statusText");
const streakValue     = $("streakValue");
const solvedValue     = $("solvedValue");
const ratingValue     = $("ratingValue");
const rankLabel       = $("rankLabel");
const ratingHistogram = $("ratingHistogram");
const languageBars    = $("languageBars");
const solveHeatmap    = $("solveHeatmap");
const syncLog         = $("syncLog");
const pendingBadge    = $("pendingBadge");

function showView(view) {
  [setupPromptView, dashboardView].forEach(v => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── init ──────────────────────────────────────────────────────────────────

async function init() {
  const [token, handle, settings] = await Promise.all([
    getStoredGitHubToken(),
    getCfHandle(),
    getSettings(),
  ]);

  const ready = token && handle && settings.repoFullName;

  if (ready) {
    showView(dashboardView);
    await renderDashboard(handle);
  } else {
    showView(setupPromptView);
  }
}

// ── open setup / settings ─────────────────────────────────────────────────

function openOptions() {
  chrome.runtime.openOptionsPage();
}

openSetupBtn.addEventListener("click", openOptions);
settingsBtn.addEventListener("click",  openOptions);

const openDashboardBtn = $("openDashboardBtn");
if (openDashboardBtn) {
  openDashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  });
}

// ── manual sync ───────────────────────────────────────────────────────────

manualSyncBtn.addEventListener("click", async () => {
  manualSyncBtn.disabled = true;
  manualSyncBtn.textContent = "Syncing…";
  statusText.textContent = "Sync in progress…";

  chrome.runtime.sendMessage({ type: "FORCEHUB_MANUAL_SYNC" }, async (response) => {
    manualSyncBtn.disabled = false;
    manualSyncBtn.textContent = "Sync now";

    // Handle the case where the service worker was unreachable
    if (chrome.runtime.lastError) {
      statusText.textContent = "Sync failed — background worker unavailable, please try again.";
      return;
    }

    if (response?.ok) {
      const { pushedCount = 0, pendingCount = 0 } = response.result || {};
      statusText.textContent = pushedCount > 0
        ? `Pushed ${pushedCount} new solve${pushedCount === 1 ? "" : "s"}`
        : "Up to date";
      pendingBadge.textContent = pendingCount > 0 ? `${pendingCount} waiting on contest` : "";
    } else {
      statusText.textContent = response?.reason || "Sync failed — see log below";
    }

    const handle = await getCfHandle();
    if (handle) await renderDashboard(handle);
  });
});

// ── dashboard rendering ───────────────────────────────────────────────────

async function renderDashboard(handle) {
  let submissions = [], userInfo = null;
  try {
    [submissions, userInfo] = await Promise.all([
      getUserSubmissions(handle, 200),
      getUserInfo(handle),
    ]);
  } catch (err) {
    statusText.textContent = `CF unreachable: ${err.message}`;
    console.error("[ForceHub] renderDashboard error:", err);
  }

  const accepted      = submissions.filter(s => s.verdict === "OK");
  const uniqueProblems = dedupeLatestPerProblem(accepted);
  const streak        = computeStreak(accepted);

  streakValue.textContent = String(streak.current);
  solvedValue.textContent = String(uniqueProblems.length);
  if (userInfo) {
    ratingValue.textContent = userInfo.rating ?? "—";
    rankLabel.textContent   = userInfo.rank || "unrated";
  }

  renderHistogram(computeRatingHistogram(uniqueProblems));
  renderLanguages(computeLanguageBreakdown(accepted));
  renderHeatmap(computeSolveTimeHeatmap(accepted));
  await renderSyncLog();
}

function renderHistogram(buckets) {
  clearChildren(ratingHistogram);
  const entries = Object.entries(buckets).sort((a, b) => {
    if (a[0] === "Unrated") return 1;
    if (b[0] === "Unrated") return -1;
    return Number(a[0]) - Number(b[0]);
  });
  const max = Math.max(1, ...entries.map(([, v]) => v));

  for (const [bucket, count] of entries) {
    const bar = document.createElement("div");
    bar.className = "histogram-bar";
    bar.style.height = `${Math.max(4, (count / max) * 52)}px`;
    bar.title = `${bucket}: ${count}`;

    const label = document.createElement("span");
    label.className = "histogram-bar-label";
    label.textContent = bucket;
    bar.appendChild(label);
    ratingHistogram.appendChild(bar);
  }
}

function renderLanguages(counts) {
  clearChildren(languageBars);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  for (const [lang, count] of entries) {
    const row  = document.createElement("div"); row.className = "lang-row";
    const name = document.createElement("span"); name.className = "lang-name"; name.textContent = lang;
    const track = document.createElement("div"); track.className = "lang-track";
    const fill  = document.createElement("div"); fill.className  = "lang-fill";
    fill.style.width = `${(count / max) * 100}%`;
    track.appendChild(fill);
    const cnt = document.createElement("span"); cnt.className = "lang-count"; cnt.textContent = String(count);
    row.appendChild(name); row.appendChild(track); row.appendChild(cnt);
    languageBars.appendChild(row);
  }
}

function renderHeatmap(grid) {
  clearChildren(solveHeatmap);
  const flat = grid.flat();
  const max = Math.max(1, ...flat);
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const intensity = grid[day][hour] / max;
      if (intensity > 0) {
        cell.style.background = `rgba(255, 123, 84, ${0.15 + intensity * 0.85})`;
      }
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      cell.title = `${days[day]} ${String(hour).padStart(2,"0")}:00 — ${grid[day][hour]} solve${grid[day][hour] === 1 ? "" : "s"}`;
      solveHeatmap.appendChild(cell);
    }
  }
}

async function renderSyncLog() {
  const log = await getSyncLog();
  clearChildren(syncLog);
  if (log.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "No activity yet — solve something!";
    syncLog.appendChild(empty);
    return;
  }
  for (const entry of log.slice(0, 15)) {
    const row  = document.createElement("div"); row.className = "log-entry";
    const icon = document.createElement("span");
    icon.className = `log-icon ${entry.level}`;
    icon.textContent = entry.level === "success" ? "✓" : entry.level === "error" ? "✗" : "!";
    const msg = document.createElement("span"); msg.className = "log-message";
    msg.textContent = entry.message; // textContent — safe even if message contains markup
    row.appendChild(icon); row.appendChild(msg);
    syncLog.appendChild(row);
  }
}

init();
