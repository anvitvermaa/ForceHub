// config.js — central constants. No secrets live here.
// GitHub client_secret NEVER goes in extension code — it lives only in the
// serverless relay (see /server). This file only holds public, non-sensitive IDs.
// ⚠️  Replace GITHUB_CLIENT_ID and TOKEN_EXCHANGE_URL with your own values.

export const CONFIG = {
  GITHUB_CLIENT_ID: "Ov23liOko9ijU3FSGchB",
  TOKEN_EXCHANGE_URL: "https://forcehub-auth.forcehub.workers.dev",
  CF_API_BASE: "https://codeforces.com/api",
  GITHUB_API_BASE: "https://api.github.com",
  POLL_INTERVAL_MINUTES: 0.5,
  CONTEST_POLL_INTERVAL_MINUTES: 0.25,
  MAX_RETRY_ATTEMPTS: 5,
  RETRY_BACKOFF_BASE_MS: 1500,
};

export const LANGUAGE_EXTENSIONS = {
  "GNU GCC C11 5.1.0": "c",
  "GNU G++17 9.2.0 (64 bit, msys 2)": "cpp",
  "GNU G++20 13.2 (64 bit, winlibs)": "cpp",
  "GNU G++14 6.4.0": "cpp",
  "GNU G++17 7.3.0": "cpp",
  "Python 3.8.10": "py",
  "PyPy 3.10 (7.3.15, 64bit)": "py",
  "Java 21": "java",
  "Java 8": "java",
  "Kotlin 1.9": "kt",
  "Go": "go",
  "Rust 2021": "rs",
  "JavaScript": "js",
  "C# 10": "cs",
  "Ruby 3": "rb",
  "PHP": "php",
};

export function extensionForLanguage(lang) {
  if (LANGUAGE_EXTENSIONS[lang]) return LANGUAGE_EXTENSIONS[lang];
  const l = lang.toLowerCase();
  if (l.includes("c++") || l.includes("g++")) return "cpp";
  if (l.includes("python") || l.includes("pypy")) return "py";
  if (l.includes("java") && !l.includes("script")) return "java";
  if (l.includes("kotlin")) return "kt";
  if (l.includes("rust")) return "rs";
  if (l.includes("go")) return "go";
  if (l.includes("c#")) return "cs";
  if (l.includes("javascript")) return "js";
  if (l.includes("typescript")) return "ts";
  if (l.includes("ruby")) return "rb";
  if (l.includes("php")) return "php";
  if (l.includes(" c ") || l.endsWith(" c") || l.startsWith("c ")) return "c";
  return "txt";
}
