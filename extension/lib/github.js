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

export async function upsertFile(token, owner, repo, path, content, message, branch) {
  let sha;
  try {
    const existing = await ghFetch(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
      token
    );
    sha = existing.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  return ghFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
