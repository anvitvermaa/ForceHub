// options.js — ForceHub setup & settings page.
// Runs in a real browser tab (not a popup), so it survives focus changes —
// the user can freely switch to codeforces.com/settings/api to copy their
// key/secret and come back without losing their progress.
//
// XSS note: all dynamic data is set via textContent, never innerHTML.

import {
  startGitHubOAuth,
  getStoredGitHubToken,
  getStoredGitHubUser,
  setStoredGitHubUser,
  disconnectGitHub,
  getCfHandle,
  getCfCredentials,
  setCfCredentials,
  disconnectCodeforces,
  getSettings,
  updateSettings,
} from "../lib/auth.js";
import { getAuthenticatedUser, listUserRepos, createRepo, GitHubError } from "../lib/github.js";
import { getUserInfo, verifyOwnershipWithApiKey, CodeforcesError } from "../lib/codeforces.js";

// ── element refs ──────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);

const prog = [el("prog1"), el("prog2"), el("prog3"), el("prog4")];

// step cards
const cardCf     = el("cardCf");
const cardGithub = el("cardGithub");
const cardRepo   = el("cardRepo");
const doneBanner = el("doneBanner");
const cardSettings = el("cardSettings");

// CF step
const cfForm          = el("cfForm");
const cfConnectedBadge = el("cfConnectedBadge");
const cfConnectedName  = el("cfConnectedName");
const cfHandle        = el("cfHandle");
const cfApiKey        = el("cfApiKey");
const cfApiSecret     = el("cfApiSecret");
const cfVerifyBtn     = el("cfVerifyBtn");
const cfStatus        = el("cfStatus");
const cfChangeBtn     = el("cfChangeBtn");

// GitHub step
const ghForm          = el("ghForm");
const ghConnectedBadge = el("ghConnectedBadge");
const ghConnectedName  = el("ghConnectedName");
const ghConnectBtn    = el("ghConnectBtn");
const ghStatus        = el("ghStatus");
const ghChangeBtn     = el("ghChangeBtn");

// Repo step
const repoSelect      = el("repoSelect");
const repoConfirmBtn  = el("repoConfirmBtn");
const createRepoBtn   = el("createRepoBtn");
const newRepoName     = el("newRepoName");
const repoStatus      = el("repoStatus");
const organizeBy      = el("organizeBy");

// Done banner
const doneHandle = el("doneHandle");
const doneRepo   = el("doneRepo");

// Settings panel
const settingsCfName      = el("settingsCfName");
const settingsGhName      = el("settingsGhName");
const settingsRepo        = el("settingsRepo");
const settingsOrganizeBy  = el("settingsOrganizeBy");
const settingsDisconnectCf = el("settingsDisconnectCf");
const settingsDisconnectGh = el("settingsDisconnectGh");
const settingsChangeRepo   = el("settingsChangeRepo");
const settingsBackfill     = el("settingsBackfill");

// ── helpers ───────────────────────────────────────────────────────────────

function show(el)  { el.classList.remove("hidden"); }
function hide(el)  { el.classList.add("hidden"); }

function setStatus(statusEl, type, text) {
  statusEl.className = `status-msg ${type}`;
  statusEl.textContent = text;
  show(statusEl);
}
function clearStatus(statusEl) {
  statusEl.className = "status-msg hidden";
  statusEl.textContent = "";
}

function updateProgressBar(step) {
  // step: 1 = CF, 2 = GitHub, 3 = Repo, 4 = Done
  prog.forEach((p, i) => {
    p.classList.remove("active", "done");
    if (i + 1 < step) p.classList.add("done");
    else if (i + 1 === step) p.classList.add("active");
  });
}

// ── init ──────────────────────────────────────────────────────────────────

async function init() {
  const [cfCreds, token, ghUser, settings] = await Promise.all([
    getCfCredentials(),
    getStoredGitHubToken(),
    getStoredGitHubUser(),
    getSettings(),
  ]);

  const cfDone    = !!cfCreds;
  const ghDone    = !!token && !!ghUser;
  const repoDone  = !!settings.repoFullName;
  const allDone   = cfDone && ghDone && repoDone;

  // ── Codeforces card ──
  show(cardCf);
  if (cfCreds) {
    cfConnectedName.textContent = `Verified: ${cfCreds.handle}`;
    show(cfConnectedBadge);
    hide(cfForm);
  } else {
    hide(cfConnectedBadge);
    show(cfForm);
  }

  // ── GitHub card ──
  if (cfDone) {
    show(cardGithub);
    if (ghDone) {
      ghConnectedName.textContent = `@${ghUser.login}`;
      show(ghConnectedBadge);
      hide(ghForm);
    } else {
      hide(ghConnectedBadge);
      show(ghForm);
    }
  } else {
    hide(cardGithub);
  }

  // ── Repo card ──
  if (cfDone && ghDone) {
    show(cardRepo);
    const savedOrg = settings.organizeBy || "rating";
    organizeBy.value = savedOrg;
    await loadRepos(token);
  } else {
    hide(cardRepo);
  }

  // ── Done banner + settings ──
  if (allDone) {
    show(doneBanner);
    doneHandle.textContent = cfCreds.handle;
    doneRepo.textContent   = settings.repoFullName;
    updateProgressBar(4);
    await renderSettings(cfCreds, ghUser, settings);
    show(cardSettings);
  } else if (cfDone && ghDone) {
    updateProgressBar(3);
  } else if (cfDone) {
    updateProgressBar(2);
  } else {
    updateProgressBar(1);
  }
}

// ── CF step ───────────────────────────────────────────────────────────────

cfVerifyBtn.addEventListener("click", async () => {
  const handle    = cfHandle.value.trim();
  const key       = cfApiKey.value.trim();
  const secret    = cfApiSecret.value.trim();

  // Field validation — clear visual state first
  [cfHandle, cfApiKey, cfApiSecret].forEach(i => i.classList.remove("error", "ok"));

  if (!handle) { cfHandle.classList.add("error"); setStatus(cfStatus, "error", "Enter your Codeforces handle."); return; }
  if (!key)    { cfApiKey.classList.add("error");    setStatus(cfStatus, "error", "Enter your API key."); return; }
  if (!secret) { cfApiSecret.classList.add("error"); setStatus(cfStatus, "error", "Enter your API secret."); return; }

  cfVerifyBtn.disabled = true;
  setStatus(cfStatus, "loading", "Checking handle…");

  try {
    // Step 1: confirm handle exists (gives a clearer error than an auth failure if they typo'd it)
    await getUserInfo(handle);
    setStatus(cfStatus, "loading", "Verifying key/secret ownership…");

    // Step 2: real ownership proof via signed request
    const verified = await verifyOwnershipWithApiKey(handle, key, secret);
    if (!verified) throw new CodeforcesError("Signature check did not pass.", "CF_AUTH_FAILED");

    await setCfCredentials(handle, key, secret);

    cfConnectedName.textContent = `Verified: ${handle}`;
    show(cfConnectedBadge);
    hide(cfForm);
    clearStatus(cfStatus);

    // unlock next step
    show(cardGithub);
    updateProgressBar(2);
    // clear sensitive fields from DOM now that they're saved
    cfApiKey.value = "";
    cfApiSecret.value = "";
  } catch (err) {
    cfHandle.classList.add("error");
    if (err instanceof CodeforcesError && err.code === "CF_AUTH_FAILED") {
      setStatus(cfStatus, "error", "Key/secret don't match this handle. Re-check codeforces.com/settings/api — they must be generated under the same account.");
    } else if (err instanceof CodeforcesError) {
      setStatus(cfStatus, "error", `Handle not found: "${handle}". Double-check the spelling.`);
    } else {
      setStatus(cfStatus, "error", "Network error — check your connection and try again.");
    }
  } finally {
    cfVerifyBtn.disabled = false;
  }
});

cfChangeBtn.addEventListener("click", () => {
  show(cfForm);
  hide(cfConnectedBadge);
  cfHandle.value = "";
  cfApiKey.value = "";
  cfApiSecret.value = "";
  clearStatus(cfStatus);
  cfHandle.focus();
});

// ── GitHub step ───────────────────────────────────────────────────────────

ghConnectBtn.addEventListener("click", async () => {
  ghConnectBtn.disabled = true;
  setStatus(ghStatus, "loading", "Opening GitHub authorisation…");

  try {
    const token  = await startGitHubOAuth();
    const ghUser = await getAuthenticatedUser(token);
    await setStoredGitHubUser({ login: ghUser.login, avatarUrl: ghUser.avatar_url });

    ghConnectedName.textContent = `@${ghUser.login}`;
    show(ghConnectedBadge);
    hide(ghForm);
    clearStatus(ghStatus);

    // unlock repo step
    show(cardRepo);
    updateProgressBar(3);
    await loadRepos(token);
  } catch (err) {
    ghConnectBtn.disabled = false;
    if (err.message?.includes("user cancelled")) {
      setStatus(ghStatus, "info", "Authorisation cancelled — click Connect to try again.");
    } else {
      setStatus(ghStatus, "error", `Connection failed: ${err.message}`);
    }
  }
});

ghChangeBtn.addEventListener("click", async () => {
  const ok = confirm("Disconnect GitHub? Your repo and pushed solutions are untouched — only the connection is removed.");
  if (!ok) return;
  await disconnectGitHub();
  await updateSettings({ repoFullName: null });
  ghConnectedName.textContent = "";
  hide(ghConnectedBadge);
  show(ghForm);
  ghConnectBtn.disabled = false;
  clearStatus(ghStatus);
  hide(cardRepo);
  hide(doneBanner);
  hide(cardSettings);
  updateProgressBar(2);
});

// ── Repo step ─────────────────────────────────────────────────────────────

async function loadRepos(token) {
  clearStatus(repoStatus);
  repoConfirmBtn.disabled = true;

  // clear and reset select
  while (repoSelect.firstChild) repoSelect.removeChild(repoSelect.firstChild);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Loading your repositories…";
  repoSelect.appendChild(placeholder);

  try {
    const repos = await listUserRepos(token);
    while (repoSelect.firstChild) repoSelect.removeChild(repoSelect.firstChild);

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select a repository…";
    repoSelect.appendChild(ph);

    const settings = await getSettings();
    for (const repo of repos) {
      const opt = document.createElement("option");
      opt.value = repo.fullName;
      opt.textContent = repo.fullName + (repo.private ? " 🔒" : "");
      opt.dataset.branch = repo.defaultBranch;
      if (repo.fullName === settings.repoFullName) opt.selected = true;
      repoSelect.appendChild(opt);
    }

    // re-enable confirm if something is selected
    if (repoSelect.value) repoConfirmBtn.disabled = false;
  } catch (err) {
    setStatus(repoStatus, "error", `Could not load repos: ${err.message}`);
  }
}

repoSelect.addEventListener("change", () => {
  repoConfirmBtn.disabled = !repoSelect.value;
  clearStatus(repoStatus);
});

repoConfirmBtn.addEventListener("click", async () => {
  const selected = repoSelect.selectedOptions[0];
  if (!selected?.value) return;
  await confirmRepo(selected.value, selected.dataset.branch || "main");
});

createRepoBtn.addEventListener("click", async () => {
  const name = newRepoName.value.trim();
  if (!name) { setStatus(repoStatus, "error", "Enter a repository name."); return; }

  createRepoBtn.disabled = true;
  setStatus(repoStatus, "loading", `Creating ${name}…`);

  const token = await getStoredGitHubToken();
  try {
    const repo = await createRepo(token, name, false);
    await confirmRepo(repo.full_name, repo.default_branch);
  } catch (err) {
    const msg = err instanceof GitHubError ? err.message : "Could not create repo.";
    setStatus(repoStatus, "error", `Repo creation failed: ${msg}`);
    createRepoBtn.disabled = false;
  }
});

organizeBy.addEventListener("change", async () => {
  await updateSettings({ organizeBy: organizeBy.value });
});

async function confirmRepo(fullName, branch) {
  const org = organizeBy.value || "rating";
  await updateSettings({ repoFullName: fullName, defaultBranch: branch, organizeBy: org });

  // Show done state
  const [cfCreds, ghUser] = await Promise.all([getCfCredentials(), getStoredGitHubUser()]);
  doneHandle.textContent = cfCreds?.handle || "";
  doneRepo.textContent   = fullName;
  show(doneBanner);

  hide(cardRepo);
  hide(cardGithub);
  hide(cardCf);

  updateProgressBar(4);

  const settings = await getSettings();
  await renderSettings(cfCreds, ghUser, settings);
  show(cardSettings);
}

// ── Settings panel ────────────────────────────────────────────────────────

async function renderSettings(cfCreds, ghUser, settings) {
  settingsCfName.textContent    = cfCreds ? `Verified: ${cfCreds.handle}` : "Not connected";
  settingsGhName.textContent    = ghUser  ? `@${ghUser.login}` : "Not connected";
  settingsRepo.textContent      = settings.repoFullName || "Not set";
  settingsOrganizeBy.value      = settings.organizeBy || "rating";
}

settingsOrganizeBy.addEventListener("change", async () => {
  await updateSettings({ organizeBy: settingsOrganizeBy.value });
});

settingsDisconnectCf.addEventListener("click", async () => {
  const ok = confirm("Disconnect Codeforces? Syncing will pause until you re-verify.");
  if (!ok) return;
  await disconnectCodeforces();
  // restart the full flow
  location.reload();
});

settingsDisconnectGh.addEventListener("click", async () => {
  const ok = confirm("Disconnect GitHub? Your repo and solutions are untouched — only the connection is removed.");
  if (!ok) return;
  await disconnectGitHub();
  await updateSettings({ repoFullName: null });
  location.reload();
});

settingsChangeRepo.addEventListener("click", async () => {
  hide(doneBanner);
  hide(cardSettings);
  show(cardCf);
  show(cardGithub);
  show(cardRepo);
  updateProgressBar(3);
  const token = await getStoredGitHubToken();
  if (token) await loadRepos(token);
  cardRepo.scrollIntoView({ behavior: "smooth" });
});

settingsBackfill.addEventListener("click", async () => {
  const ok = confirm("This will push every past Accepted solution not yet synced. It may take a while for large histories. Continue?");
  if (!ok) return;
  await updateSettings({ backfillEnabled: true });
  settingsBackfill.disabled = true;
  settingsBackfill.textContent = "Backfill triggered — check the popup sync log…";
  chrome.runtime.sendMessage({ type: "FORCEHUB_MANUAL_SYNC" }, (response) => {
    settingsBackfill.textContent = response?.ok ? "✓ Backfill complete" : "Backfill failed — check sync log";
    settingsBackfill.disabled = false;
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────
init();
