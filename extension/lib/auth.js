// auth.js — GitHub OAuth + credential storage.
// SECURITY NOTES:
// - chrome.storage.local is sandboxed per-extension, never exposed to web pages.
// - We never store client_secret here — it lives only in the Cloudflare Worker.
// - Tokens are never logged anywhere in this codebase.

import { CONFIG } from "./config.js";

const STORAGE_KEYS = {
  GITHUB_TOKEN: "fh_github_token",
  GITHUB_USER: "fh_github_user",
  CF_HANDLE: "fh_cf_handle",
  CF_API_KEY: "fh_cf_api_key",
  CF_API_SECRET: "fh_cf_api_secret",
  SETTINGS: "fh_settings",
};

export async function startGitHubOAuth() {
  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID(); // CSRF protection

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", CONFIG.GITHUB_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "repo");
  authUrl.searchParams.set("state", state);

  const resultUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const params = new URL(resultUrl).searchParams;
  if (params.get("state") !== state) {
    throw new Error("OAuth state mismatch — possible CSRF attempt, aborting.");
  }
  const code = params.get("code");
  if (!code) throw new Error("GitHub did not return an authorization code.");

  const token = await exchangeCodeForToken(code, redirectUri);
  await chrome.storage.local.set({ [STORAGE_KEYS.GITHUB_TOKEN]: token });
  return token;
}

async function exchangeCodeForToken(code, redirectUri) {
  const res = await fetch(CONFIG.TOKEN_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error("Token exchange failed — please try connecting again.");
  const data = await res.json();
  if (!data.access_token) throw new Error("Token exchange did not return an access token.");
  return data.access_token;
}

export async function getStoredGitHubToken() {
  const { [STORAGE_KEYS.GITHUB_TOKEN]: token } = await chrome.storage.local.get(STORAGE_KEYS.GITHUB_TOKEN);
  return token || null;
}

export async function disconnectGitHub() {
  await chrome.storage.local.remove([STORAGE_KEYS.GITHUB_TOKEN, STORAGE_KEYS.GITHUB_USER]);
}

export async function setStoredGitHubUser(user) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GITHUB_USER]: user });
}

export async function getStoredGitHubUser() {
  const { [STORAGE_KEYS.GITHUB_USER]: user } = await chrome.storage.local.get(STORAGE_KEYS.GITHUB_USER);
  return user || null;
}

export async function setCfCredentials(handle, apiKey, apiSecret) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.CF_HANDLE]: handle.trim(),
    [STORAGE_KEYS.CF_API_KEY]: apiKey.trim(),
    [STORAGE_KEYS.CF_API_SECRET]: apiSecret.trim(),
  });
}

export async function getCfHandle() {
  const { [STORAGE_KEYS.CF_HANDLE]: handle } = await chrome.storage.local.get(STORAGE_KEYS.CF_HANDLE);
  return handle || null;
}

export async function getCfCredentials() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CF_HANDLE,
    STORAGE_KEYS.CF_API_KEY,
    STORAGE_KEYS.CF_API_SECRET,
  ]);
  if (!data[STORAGE_KEYS.CF_HANDLE] || !data[STORAGE_KEYS.CF_API_KEY] || !data[STORAGE_KEYS.CF_API_SECRET]) {
    return null;
  }
  return {
    handle: data[STORAGE_KEYS.CF_HANDLE],
    apiKey: data[STORAGE_KEYS.CF_API_KEY],
    apiSecret: data[STORAGE_KEYS.CF_API_SECRET],
  };
}

export async function disconnectCodeforces() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.CF_HANDLE,
    STORAGE_KEYS.CF_API_KEY,
    STORAGE_KEYS.CF_API_SECRET,
  ]);
}

export async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return settings || {
    repoFullName: null,
    defaultBranch: "main",
    organizeBy: "rating",
    backfillEnabled: false,
  };
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

export { STORAGE_KEYS };
