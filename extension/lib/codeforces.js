// codeforces.js — Codeforces API client.
// ALL requests are routed through a content script running in an open
// codeforces.com tab. This is required because Cloudflare blocks direct
// fetch() calls from the MV3 service worker with a JS challenge, but
// content scripts run inside the CF page context and send session cookies
// automatically, bypassing the challenge entirely.
// Docs: https://codeforces.com/apiHelp

import { CONFIG } from "./config.js";

export class CodeforcesError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// ─── Tab-based fetch helpers ──────────────────────────────────────────────────

/**
 * Send a fetch request through a content script running in a CF tab.
 * Content scripts share the page's cookie context, so CF cookies are sent.
 * Used for CF API (JSON) calls only — HTML page fetching uses navigateAndExtract.
 */
async function fetchViaCfTab(url, json = false) {
  // 1. Find an already-open CF tab
  const tabs = await chrome.tabs.query({ url: "https://codeforces.com/*" });

  if (tabs.length > 0) {
    try {
      return await sendToTab(tabs[0].id, url, json);
    } catch (err) {
      // Content script may not be loaded in this tab (e.g. after extension reload).
      // Re-inject it and retry once.
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["lib/content.js"],
      });
      return sendToTab(tabs[0].id, url, json);
    }
  }

  // 2. No CF tab — open one in the background, fetch, then close it
  const tab = await chrome.tabs.create({ url: "https://codeforces.com/", active: false });
  await waitForTabLoad(tab.id);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/content.js"],
    });
    return await sendToTab(tab.id, url, json);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Navigate a real browser tab to the submission page and extract the source
 * code directly from the DOM. This bypasses Cloudflare completely because
 * Chrome renders the page fully (including JS challenges) just like a human
 * would. No fetch() — the source is read straight from #program-source-text.
 */
async function navigateAndExtract(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForTabLoad(tab.id);
  // Give CF's JS an extra moment to render the source element
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.getElementById("program-source-text");
        if (!el) {
          const title = (document.title || "").toLowerCase();
          if (title.includes("login") || title.includes("enter") || title.includes("sign")) {
            return { error: "NOT_LOGGED_IN", title: document.title };
          }
          return { error: "SOURCE_PENDING", title: document.title, url: location.href };
        }
        return { source: el.textContent };
      },
    });
    if (!result || result.result.error) {
      const detail = result?.result;
      throw new CodeforcesError(
        detail?.error === "NOT_LOGGED_IN"
          ? "Please log in to Codeforces in Chrome first"
          : `Source element not found on page (title: "${detail?.title}", url: ${detail?.url})`,
        detail?.error || "SOURCE_PENDING"
      );
    }
    return result.result.source;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function waitForTabLoad(tabId) {
  // Check current status first to avoid race condition where tab loads
  // before we add the listener (in which case the event never fires).
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current && current.status === "complete") return;

  return new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 15000); // safety timeout
  });
}

function sendToTab(tabId, url, json) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "FORCEHUB_FETCH_URL", url, json }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response || response.error) {
        return reject(new Error(response?.error || "No response from content script"));
      }
      resolve(json ? response.data : response.html);
    });
  });
}

// ─── CF API calls (all routed via content script) ────────────────────────────

async function cfFetch(endpoint, params = {}) {
  const url = new URL(`${CONFIG.CF_API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const urlStr = url.toString();

  let lastErr;
  for (let attempt = 0; attempt < CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const data = await cfApiRequest(urlStr);
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
 * Try a direct fetch to the CF API first (works in extension pages like popup/options
 * because they send the user's CF cookies, and in the service worker when Warp is on).
 * If Cloudflare returns an HTML challenge page instead of JSON, fall back to the
 * content script approach which runs inside a real CF browser tab.
 */
async function cfApiRequest(url) {
  try {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    const text = await res.text();
    // If CF responds with HTML it's a Cloudflare challenge — use content script
    if (text.trimStart().startsWith("<")) {
      return fetchViaCfTab(url, true);
    }
    return JSON.parse(text);
  } catch (err) {
    // Network/parse error on direct fetch — try content script as fallback
    return fetchViaCfTab(url, true);
  }
}

/**
 * Signed request per the official CF API auth scheme:
 *   apiSig = rand + sha512Hex(rand/method?sortedParams#secret)
 * Only the real key+secret owner can produce a valid signature —
 * the secret itself never leaves the device.
 */
export async function cfFetchSigned(endpoint, params, apiKey, apiSecret) {
  let lastErr;
  for (let attempt = 0; attempt < CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
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

      const data = await cfApiRequest(url.toString());
      if (data.status !== "OK") {
        throw new CodeforcesError(data.comment || "Codeforces API auth failed", "CF_AUTH_FAILED");
      }
      return data.result;
    } catch (err) {
      lastErr = err;
      if (err.code === "CF_AUTH_FAILED") throw err;
      const backoff = CONFIG.RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
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

// ─── Submission source fetching ───────────────────────────────────────────────

/**
 * Fetch submission source by navigating a real browser tab to the submission
 * page and extracting the source directly from the DOM element.
 * This is the only approach that reliably bypasses Cloudflare — Chrome renders
 * the page fully (including JS challenges) the same way a human would.
 */
export async function getSubmissionSource(submission) {
  const url = `https://codeforces.com/contest/${submission.contestId}/submission/${submission.id}`;
  try {
    return await navigateAndExtract(url);
  } catch (err) {
    if (err instanceof CodeforcesError) throw err;
    throw new CodeforcesError(
      `Could not fetch submission ${submission.id}: ${err.message}`,
      "FETCH_ERROR"
    );
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}
