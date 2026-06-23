// codeforces.js — official Codeforces REST API client + signed-request auth.
// Docs: https://codeforces.com/apiHelp

import { CONFIG } from "./config.js";

export class CodeforcesError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function cfFetch(endpoint, params = {}) {
  const url = new URL(`${CONFIG.CF_API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  let lastErr;
  for (let attempt = 0; attempt < CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url.toString(), { method: "GET" });
      if (res.status === 429 || res.status >= 500) {
        throw new CodeforcesError(`CF API transient error: ${res.status}`, res.status);
      }
      const data = await res.json();
      if (data.status !== "OK") {
        throw new CodeforcesError(data.comment || "Codeforces API returned FAILED", "CF_FAILED");
      }
      return data.result;
    } catch (err) {
      lastErr = err;
      if (err.code === "CF_FAILED") throw err;
      const backoff = CONFIG.RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/**
 * Signed request per the official CF API auth scheme:
 *   apiSig = rand + sha512Hex(rand/method?sortedParams#secret)
 * Only the real key+secret owner can produce a valid signature —
 * the secret itself never leaves the device.
 */
async function cfFetchSigned(endpoint, params, apiKey, apiSecret) {
  const time = Math.floor(Date.now() / 1000);
  const rand = String(Math.floor(100000 + Math.random() * 900000));

  const allParams = { ...params, apiKey, time: String(time) };
  const sortedEntries = Object.entries(allParams).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sortedQuery = sortedEntries.map(([k, v]) => `${k}=${v}`).join("&");

  const toHash = `${rand}/${endpoint}?${sortedQuery}#${apiSecret}`;
  const hashHex = await sha512Hex(toHash);
  const apiSig = `${rand}${hashHex}`;

  const url = new URL(`${CONFIG.CF_API_BASE}/${endpoint}`);
  sortedEntries.forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apiSig", apiSig);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json();
  if (data.status !== "OK") {
    throw new CodeforcesError(data.comment || "Codeforces API auth failed", "CF_AUTH_FAILED");
  }
  return data.result;
}

async function sha512Hex(message) {
  const bytes = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", bytes);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Proves account ownership via a signed API call — only works with the real key+secret. */
export async function verifyOwnershipWithApiKey(handle, apiKey, apiSecret) {
  const result = await cfFetchSigned("user.status", { handle, from: "1", count: "1" }, apiKey, apiSecret);
  return Array.isArray(result);
}

export async function getUserSubmissions(handle, count = 50) {
  return cfFetch("user.status", { handle, from: 1, count });
}

export async function getUserInfo(handle) {
  const result = await cfFetch("user.info", { handles: handle });
  return result[0];
}

export async function getUserRatingHistory(handle) {
  return cfFetch("user.rating", { handle });
}

export async function getContestPhase(contestId) {
  try {
    const result = await cfFetch("contest.standings", { contestId, from: 1, count: 1 });
    return result.contest.phase;
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Fetch submission source from the submission page HTML.
 * NOTE: No official CF API endpoint exists for source code. Every tool in
 * this space uses this same method. We minimize footprint: exact submission
 * ID only, no cookies, never executed — parsed as plain text only.
 */
export async function getSubmissionSource(submission) {
  const url = `https://codeforces.com/contest/${submission.contestId}/submission/${submission.id}`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new CodeforcesError(`Could not fetch submission ${submission.id}`, res.status);
  }
  const html = await res.text();
  const match = html.match(/<pre[^>]*id=["']?program-source-text["']?[^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) {
    throw new CodeforcesError(
      `Source not yet available for submission ${submission.id} (contest may still be checking)`,
      "SOURCE_PENDING"
    );
  }
  return decodeHtmlEntities(match[1]);
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}
