// background.js — MV3 service worker. Stateless alarm-based polling.

import { runSync } from "../lib/sync.js";
import { CONFIG } from "../lib/config.js";

const ALARM_NAME = "forcehub-sync";
let syncInFlight = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES,
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const result = await runSync();
    await chrome.storage.local.set({ fh_last_sync_result: { ...result, ranAt: Date.now() } });
  } catch (err) {
    await chrome.storage.local.set({
      fh_last_sync_result: { error: err.message, ranAt: Date.now() },
    });
  } finally {
    syncInFlight = false;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FORCEHUB_MANUAL_SYNC") {
    (async () => {
      if (syncInFlight) {
        sendResponse({ ok: false, reason: "A sync is already running." });
        return;
      }
      syncInFlight = true;
      try {
        const result = await runSync();
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, reason: err.message });
      } finally {
        syncInFlight = false;
      }
    })();
    return true;
  }
});
