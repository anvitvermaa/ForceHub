// content.js — injected into every codeforces.com page.
// Runs in the CF page context, so fetch() here automatically includes
// the user's CF session cookies — unlike the service worker which is
// blocked by Cloudflare when making direct requests to codeforces.com.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "FORCEHUB_FETCH_URL") return false;

  const headers = message.json
    ? { Accept: "application/json" }
    : { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

  fetch(message.url, {
    method: "GET",
    credentials: "include",
    headers,
  })
    .then(async (res) => {
      if (!res.ok) return { error: `HTTP_${res.status}` };
      if (message.json) {
        const data = await res.json();
        return { data };
      } else {
        const html = await res.text();
        return { html };
      }
    })
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  return true; // keep message channel open for async response
});
