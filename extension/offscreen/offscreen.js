// offscreen.js — fetches Codeforces pages with the user's session cookies.
//
// WHY THIS EXISTS:
// MV3 service workers are isolated from the browser's cookie store.
// fetch() with credentials:"include" in a service worker does NOT send
// the user's codeforces.com cookies — so CF rejects the request with 403/redirect.
// Extension "pages" (like this offscreen document) run in a full browser context
// and CAN send cookies via credentials:"include", just like a regular browser tab.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "FETCH_CF_SUBMISSION") {
    fetchCfPage(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
});

async function fetchCfPage(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include", // sends CF session cookies — works here unlike in service worker
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    return { error: `HTTP_${res.status}` };
  }

  const html = await res.text();
  return { html };
}
