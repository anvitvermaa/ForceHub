// github.js — GitHub REST API wrapper.
// Minimal OAuth scope: only `repo`. Never requests admin/delete/user.

import { CONFIG } from "./config.js";

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function ghFetch(path, token, options = {}) {
  const res = await fetch(`${CONFIG.GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GitHubError(body.message || `GitHub API error ${res.status}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getAuthenticatedUser(token) {
  return ghFetch("/user", token);
}

export async function listUserRepos(token) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(`/user/repos?per_page=100&page=${page}&sort=updated`, token);
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return repos.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    defaultBranch: r.default_branch,
    private: r.private,
  }));
}

export async function createRepo(token, name, isPrivate = false) {
  return ghFetch("/user/repos", token, {
    method: "POST",
    body: JSON.stringify({
      name,
      private: isPrivate,
      description: "My Codeforces accepted submissions, synced by ForceHub.",
      auto_init: true,
    }),
  });
}

export async function upsertFile(token, owner, repo, path, content, message, branch, solveDate) {
  const dateStr = solveDate
    ? new Date(solveDate * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const committer = { name: "ForceHub", email: "forcehub@users.noreply.github.com", date: dateStr };

  // 1. Get current branch reference
  const ref = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
  const latestCommitSha = ref.object.sha;

  // 2. Get latest commit to find base tree
  const latestCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, token);
  const baseTreeSha = latestCommit.tree.sha;

  // 3. Create blob for file content
  const blob = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
    method: "POST",
    body: JSON.stringify({
      content: utf8ToBase64(content),
      encoding: "base64"
    })
  });

  // 4. Create new tree pointing to the blob (replaces file if exists)
  // Note: Tree API expects raw path, not url-encoded
  const newTree = await ghFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        {
          path: path,
          mode: "100644",
          type: "blob",
          sha: blob.sha
        }
      ]
    })
  });

  // 5. Create new commit with backdated timestamps
  const newCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({
      message,
      author: committer,
      committer: committer,
      parents: [latestCommitSha],
      tree: newTree.sha
    })
  });

  // 6. Update branch pointer
  return ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
