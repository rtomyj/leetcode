// Spaced-repetition model. Pure functions, no DOM — testable with `node test.js`.
//
// Each completed problem carries a "stability" S (days): the time until the
// chance you can still solve it decays to 90%. Recall decays as
//   R(t) = 0.9 ^ (t / S)
// R is the understanding score, and the review queue is sorted by lowest R.

const DAY_MS = 86400000;
const TARGET_RECALL = 0.9;

const DEFAULT_SETTINGS = {
  // Minutes above which a correct solve counts as "slow" (a partial struggle).
  slowMinutes: { Easy: 15, Medium: 25, Hard: 40 },
  sessionSize: 3,
};

// Starting stability (days) after the first logged solve.
const INITIAL_STABILITY = { clean: 3, slow: 1.5, failed: 0.5 };
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

function gradeAttempt(minutes, solved, difficulty, settings = DEFAULT_SETTINGS) {
  if (!solved) return "failed";
  const limit = settings.slowMinutes[difficulty] ?? DEFAULT_SETTINGS.slowMinutes[difficulty];
  return minutes > limit ? "slow" : "clean";
}

function recall(stability, daysSince) {
  if (!(stability > 0)) return 0;
  return Math.pow(TARGET_RECALL, Math.max(0, daysSince) / stability);
}

// Fold one graded attempt into a problem's memory state.
// `state` is { stability, ease, lastReview } or null for a first solve.
function applyAttempt(state, grade, when) {
  const t = new Date(when).getTime();
  if (!state) {
    return { stability: INITIAL_STABILITY[grade], ease: INITIAL_EASE, lastReview: t };
  }
  const days = (t - state.lastReview) / DAY_MS;
  const r = recall(state.stability, days);
  // How much you'd forgotten, scaled so reviewing right at the due date (R=0.9)
  // earns full credit and reviewing early earns proportionally less.
  const forgotten = Math.min(1, (1 - r) / (1 - TARGET_RECALL));

  let { stability, ease } = state;
  if (grade === "clean") {
    stability = stability * (1 + (ease - 1) * forgotten);
    ease = Math.min(MAX_EASE, ease + 0.1);
  } else if (grade === "slow") {
    // Solved, just over time: half the clean growth, ease unchanged. Shrinking
    // ease here would trap a consistently slow problem in a ~2-day loop.
    stability = stability * (1 + (ease - 1) * 0.5 * forgotten);
  } else {
    stability = Math.max(0.5, stability * 0.3);
    ease = Math.max(MIN_EASE, ease - 0.3);
  }
  return { stability, ease, lastReview: t };
}

// Replay a problem's full attempt history. Recomputing from the log (rather than
// storing derived state) means changing thresholds or deleting an attempt just works.
function memoryState(attempts, difficulty, settings = DEFAULT_SETTINGS) {
  let state = null;
  const sorted = [...attempts].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const a of sorted) {
    state = applyAttempt(state, gradeAttempt(a.minutes, a.solved, difficulty, settings), a.date);
  }
  return state;
}

// Everything the UI needs about one problem at time `now`.
function analyze(attempts, difficulty, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const state = memoryState(attempts, difficulty, settings);
  if (!state) return null;
  const daysSince = (now - state.lastReview) / DAY_MS;
  const score = recall(state.stability, daysSince);
  const sorted = [...attempts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  const lastGrade = gradeAttempt(last.minutes, last.solved, difficulty, settings);
  return {
    ...state,
    score,
    daysSince,
    dueAt: state.lastReview + state.stability * DAY_MS,
    isDue: score <= TARGET_RECALL,
    lastGrade,
    reviews: attempts.length,
  };
}

// Higher = review sooner. Lowest recall first, with a nudge for a recent struggle
// so a problem you just failed outranks one that merely aged to the same score.
function priority(info) {
  const struggleBoost = info.lastGrade === "failed" ? 0.08 : info.lastGrade === "slow" ? 0.04 : 0;
  return (1 - info.score) + struggleBoost;
}

// Pick a review session: highest priority first, at most one problem per topic
// until every topic in the pool is used, so a session isn't three graph problems.
function pickSession(items, size) {
  const ranked = [...items].sort((a, b) => priority(b.info) - priority(a.info));
  const picked = [];
  const topics = new Set();
  for (const it of ranked) {
    if (picked.length >= size) break;
    if (!topics.has(it.topic)) { picked.push(it); topics.add(it.topic); }
  }
  for (const it of ranked) {
    if (picked.length >= size) break;
    if (!picked.includes(it)) picked.push(it);
  }
  return picked;
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_SETTINGS, DAY_MS, gradeAttempt, recall, applyAttempt, memoryState, analyze, priority, pickSession };
}
