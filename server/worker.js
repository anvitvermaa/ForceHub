/**
 * ForceHub auth relay — Cloudflare Worker
 * ----------------------------------------
 * Sole job: swap a GitHub OAuth `code` for an access token using the
 * client_secret, which can never safely live in extension code.
 *
 * Security properties:
 * - STATELESS. No DB, no KV, no logging of code/token/redirect_uri.
 * - CORS locked to chrome-extension:// origins only.
 * - Rejects anything that isn't POST with exactly {code, redirect_uri}.
 * - Per-isolate rate limiting (soft cap, no external store needed).
 * - client_secret lives only in the Worker's encrypted env var.
 * - Returns ONLY the access_token — never the full GitHub response.
 */

const ALLOWED_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-z]{32}$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20; // per origin per window — generous for real use
const buckets = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return false;
  }
  b.count++;
  return b.count > RATE_LIMIT_MAX;
}

function sweep() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > RATE_LIMIT_WINDOW_MS * 2) buckets.delete(k);
  }
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
  if (ALLOWED_ORIGIN_PATTERN.test(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    if (!ALLOWED_ORIGIN_PATTERN.test(origin)) return json({ error: "Forbidden" }, 403, cors);

    if (Math.random() < 0.05) sweep();
    if (isRateLimited(origin)) return json({ error: "Too many requests" }, 429, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON" }, 400, cors); }

    const { code, redirect_uri } = body;
    if (typeof code !== "string" || typeof redirect_uri !== "string" || !code || !redirect_uri) {
      return json({ error: "Missing code or redirect_uri" }, 400, cors);
    }
    if (code.length > 256 || redirect_uri.length > 512) {
      return json({ error: "Malformed request" }, 400, cors);
    }

    try {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.access_token) {
        return json({ error: "Token exchange failed" }, 502, cors);
      }
      return json({ access_token: data.access_token }, 200, cors);
    } catch {
      return json({ error: "Upstream request failed" }, 502, cors);
    }
  },
};
