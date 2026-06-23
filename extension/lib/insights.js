// insights.js — computes dashboard stats from raw CF API data.

export function computeStreak(acceptedSubmissions) {
  const days = new Set(
    acceptedSubmissions.map((s) => {
      const d = new Date(s.creationTimeSeconds * 1000);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    })
  );

  let current = 0;
  let cursor = new Date();
  const todayKey = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}-${cursor.getUTCDate()}`;
  // Don't zero out the streak at midnight before the user has solved today
  if (!days.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (true) {
    const key = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}-${cursor.getUTCDate()}`;
    if (!days.has(key)) break;
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let longest = 0, run = 0;
  const sortedDays = [...days]
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return Math.floor(new Date(Date.UTC(y, m, d)).getTime() / 86400000);
    })
    .sort((a, b) => a - b);

  for (let i = 0; i < sortedDays.length; i++) {
    run = (i === 0 || sortedDays[i] - sortedDays[i - 1] === 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  return { current, longest, activeDays: days.size };
}

export function computeRatingHistogram(acceptedByProblem) {
  const buckets = {};
  for (const s of acceptedByProblem) {
    const rating = s.problem.rating || 0;
    const bucket = rating === 0 ? "Unrated" : String(Math.floor(rating / 100) * 100);
    buckets[bucket] = (buckets[bucket] || 0) + 1;
  }
  return buckets;
}

export function computeLanguageBreakdown(acceptedSubmissions) {
  const counts = {};
  for (const s of acceptedSubmissions) {
    const lang = simplifyLanguageName(s.programmingLanguage);
    counts[lang] = (counts[lang] || 0) + 1;
  }
  return counts;
}

function simplifyLanguageName(lang) {
  if (/c\+\+|g\+\+/i.test(lang)) return "C++";
  if (/pypy|python/i.test(lang)) return "Python";
  if (/java(?!script)/i.test(lang)) return "Java";
  if (/kotlin/i.test(lang)) return "Kotlin";
  if (/rust/i.test(lang)) return "Rust";
  if (/^go\b/i.test(lang)) return "Go";
  if (/c#/i.test(lang)) return "C#";
  if (/javascript/i.test(lang)) return "JavaScript";
  return lang.split(" ")[0];
}

export function computeSolveTimeHeatmap(acceptedSubmissions) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of acceptedSubmissions) {
    const d = new Date(s.creationTimeSeconds * 1000);
    grid[d.getUTCDay()][d.getUTCHours()]++;
  }
  return grid;
}

export function buildRatingProgressSeries(ratingHistory) {
  return ratingHistory.map((change) => ({
    date: change.ratingUpdateTimeSeconds * 1000,
    rating: change.newRating,
    contestName: change.contestName,
  }));
}

export function dedupeLatestPerProblem(acceptedSubmissions) {
  const byProblem = new Map();
  for (const s of acceptedSubmissions) {
    const key = `${s.problem.contestId}-${s.problem.index}`;
    if (!byProblem.has(key) || byProblem.get(key).id < s.id) byProblem.set(key, s);
  }
  return [...byProblem.values()];
}
