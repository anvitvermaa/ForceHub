// sync.js — core sync engine.
// Fixes the two documented failure modes of existing tools:
//   1. Contest submissions stuck in checking phase → queued and retried automatically
//   2. Silent push failures → every outcome written to a visible sync log

import { getUserSubmissions, getSubmissionSource, getContestPhase, CodeforcesError } from "./codeforces.js";
import { upsertFile, GitHubError } from "./github.js";
import { getStoredGitHubToken, getCfCredentials, getSettings } from "./auth.js";
import { extensionForLanguage } from "./config.js";
import { trackUserSync } from "./db.js";

const SYNC_STATE_KEY = "fh_sync_state";
const PENDING_QUEUE_KEY = "fh_pending_queue";
const SYNC_LOG_KEY = "fh_sync_log";
const MAX_PENDING_RETRIES = 10; // drop a stuck submission after this many failures

async function getSyncState() {
  const { [SYNC_STATE_KEY]: state } = await chrome.storage.local.get(SYNC_STATE_KEY);
  return state || { lastSyncedSubmissionId: 0 };
}

async function setSyncState(state) {
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: state });
}

async function getPendingQueue() {
  const { [PENDING_QUEUE_KEY]: q } = await chrome.storage.local.get(PENDING_QUEUE_KEY);
  return q || [];
}

async function setPendingQueue(q) {
  await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: q });
}

async function appendSyncLog(entry) {
  const { [SYNC_LOG_KEY]: log } = await chrome.storage.local.get(SYNC_LOG_KEY);
  const updated = [{ ...entry, timestamp: Date.now() }, ...(log || [])].slice(0, 50);
  await chrome.storage.local.set({ [SYNC_LOG_KEY]: updated });
}

export async function getSyncLog() {
  const { [SYNC_LOG_KEY]: log } = await chrome.storage.local.get(SYNC_LOG_KEY);
  return log || [];
}

function buildPath(submission, organizeBy) {
  const ext = extensionForLanguage(submission.programmingLanguage);
  const problem = submission.problem;
  const safeIndex = (problem.index || "X").replace(/[^A-Za-z0-9]/g, "");
  const safeName = (problem.name || "untitled")
    .replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-");

  switch (organizeBy) {
    case "contest":
      return `${problem.contestId || "gym"}/${safeIndex}-${safeName}/solution.${ext}`;
    case "topic": {
      const tag = (problem.tags && problem.tags[0]) || "misc";
      const safeTag = tag.replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "-");
      return `${safeTag}/${problem.rating || "unrated"}/${safeIndex}-${safeName}/solution.${ext}`;
    }
    case "rating":
    default:
      return `${problem.rating || "unrated"}/${safeIndex}-${safeName}/solution.${ext}`;
  }
}

export async function runSync() {
  const token = await getStoredGitHubToken();
  const cfCreds = await getCfCredentials();
  const settings = await getSettings();

  if (!token || !cfCreds || !settings.repoFullName) {
    return { skipped: true, reason: "Not fully configured yet." };
  }

  const { handle } = cfCreds;
  const [owner, repo] = settings.repoFullName.split("/");
  const state = await getSyncState();

  let submissions;
  try {
    submissions = await getUserSubmissions(handle, 100);
  } catch (err) {
    await appendSyncLog({ level: "error", message: `Could not fetch submissions: ${err.message}` });
    return { error: err.message };
  }

  const accepted = submissions.filter((s) => s.verdict === "OK");
  const newOnes = accepted.filter((s) => s.id > state.lastSyncedSubmissionId);

  const pending = await getPendingQueue();
  const stillPending = [];
  let pushedCount = 0;

  for (const sub of [...pending, ...newOnes].sort((a, b) => a.id - b.id)) {
    const result = await tryPushSubmission(sub, token, owner, repo, settings);
    if (result.status === "pushed") {
      pushedCount++;
      state.lastSyncedSubmissionId = Math.max(state.lastSyncedSubmissionId, sub.id);
      
      // Delay 1000ms between successful pushes to respect GitHub secondary rate limits
      await new Promise(r => setTimeout(r, 1000));
    } else if (result.status === "pending_contest" || result.status === "error") {
      const retries = (sub._retries || 0) + 1;
      if (retries < MAX_PENDING_RETRIES) {
        stillPending.push({ ...sub, _retries: retries });
      } else {
        await appendSyncLog({
          level: "warning",
          message: `Giving up on ${sub.problem?.name || sub.id} after ${retries} failed attempts`,
        });
      }
    }
  }

  await setPendingQueue(stillPending);
  await setSyncState(state);

  if (pushedCount > 0) {
    await regenerateReadme(token, owner, repo, settings, accepted);
  }

  // Analytics: Track active users in Firebase Firestore using the REST API
  await trackUserSync(handle, settings.repoFullName, accepted.length);

  return { pushedCount, pendingCount: stillPending.length };
}

async function tryPushSubmission(submission, token, owner, repo, settings) {
  try {
    if (submission.contestId) {
      const phase = await getContestPhase(submission.contestId);
      if (phase !== "FINISHED" && phase !== "UNKNOWN") {
        return { status: "pending_contest" };
      }
    }

    const source = await getSubmissionSource(submission);
    const path = buildPath(submission, settings.organizeBy);
    const commitMessage = `Solved: ${submission.problem.name} (${submission.problem.contestId || ""}${submission.problem.index || ""})`;

    await upsertFile(token, owner, repo, path, source, commitMessage, settings.defaultBranch || "main", submission.creationTimeSeconds);
    await appendSyncLog({ level: "success", message: `Pushed ${submission.problem.name} → ${path}` });
    return { status: "pushed" };
  } catch (err) {
    if (err instanceof CodeforcesError && err.code === "SOURCE_PENDING") {
      return { status: "pending_contest" };
    }
    const msg = err instanceof GitHubError ? `GitHub error: ${err.message}` : err.message;
    await appendSyncLog({ level: "error", message: `Failed to push ${submission.problem?.name || submission.id}: ${msg}` });
    return { status: "error" };
  }
}

async function regenerateReadme(token, owner, repo, settings, acceptedSubmissions) {
  const byProblem = new Map();
  for (const s of acceptedSubmissions) {
    const key = `${s.problem.contestId}-${s.problem.index}`;
    if (!byProblem.has(key) || byProblem.get(key).id < s.id) byProblem.set(key, s);
  }

  const byTag = new Map();
  for (const s of byProblem.values()) {
    const tags = s.problem.tags?.length ? s.problem.tags : ["untagged"];
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(s);
    }
  }

  const sortedTags = [...byTag.keys()].sort();
  let md = `# Codeforces Solutions\n\nSynced by [ForceHub](https://github.com/) — ${byProblem.size} problems solved.\n\n`;
  md += `| Topic | Count |\n|---|---|\n`;
  for (const tag of sortedTags) {
    md += `| ${tag} | ${byTag.get(tag).length} |\n`;
  }
  md += `\n---\n\n`;
  for (const tag of sortedTags) {
    md += `## ${tag}\n\n`;
    const problems = byTag.get(tag).sort((a, b) => (a.problem.rating || 0) - (b.problem.rating || 0));
    for (const s of problems) {
      const path = buildPath(s, settings.organizeBy);
      md += `- [${s.problem.contestId}${s.problem.index} — ${s.problem.name}](${path}) ${s.problem.rating ? `\`${s.problem.rating}\`` : ""}\n`;
    }
    md += `\n`;
  }

  try {
    await upsertFile(token, owner, repo, "README.md", md, "Update README: topic-wise problem index", settings.defaultBranch || "main");
  } catch (err) {
    await appendSyncLog({ level: "warning", message: `README update failed: ${err.message}` });
  }
}
