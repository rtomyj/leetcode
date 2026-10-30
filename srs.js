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
// Harder problems start less stable, so they decay faster and come due sooner.
// Growth multiplies from this start, so the shorter schedule carries forward.
const DIFFICULTY_STABILITY = { Easy: 1, Medium: 0.75, Hard: 0.5 };
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
// Rotation size at or below which decay runs at its normal speed.
const ROTATION_BASELINE = 10;

function gradeAttempt(minutes, solved, difficulty, settings = DEFAULT_SETTINGS) {
  if (!solved) return "failed";
  const limit = settings.slowMinutes[difficulty] ?? DEFAULT_SETTINGS.slowMinutes[difficulty];
  return minutes > limit ? "slow" : "clean";
}

// Decay slows as the rotation grows, since there's more to get through.
function rotationStretch(rotationSize) {
  return Math.max(1, Math.sqrt(rotationSize / ROTATION_BASELINE));
}

// Rotation size at time `t`, from each problem's first-attempt time. Past sizes
// are derived this way, so each review is judged by the schedule in force at the
// time and later growth can't turn an on-time review into an early one.
function rotationSizeAt(rotationStarts, t) {
  return rotationStarts.filter((start) => start <= t).length;
}

function recall(stability, daysSince) {
  if (!(stability > 0)) return 0;
  return Math.pow(TARGET_RECALL, Math.max(0, daysSince) / stability);
}

// Fold one graded attempt into a problem's memory state.
// `state` is { stability, ease, lastReview } or null for a first solve.
function applyAttempt(state, grade, when, difficulty, rotationSize = 0) {
  const t = new Date(when).getTime();
  if (!state) {
    const stability = Math.max(0.5, INITIAL_STABILITY[grade] * (DIFFICULTY_STABILITY[difficulty] ?? 1));
    return { stability, ease: INITIAL_EASE, lastReview: t };
  }
  const days = (t - state.lastReview) / DAY_MS;
  const r = recall(state.stability * rotationStretch(rotationSize), days);
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
function memoryState(attempts, difficulty, settings = DEFAULT_SETTINGS, rotationStarts = []) {
  let state = null;
  const sorted = [...attempts].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const a of sorted) {
    const size = rotationSizeAt(rotationStarts, new Date(a.date).getTime());
    state = applyAttempt(state, gradeAttempt(a.minutes, a.solved, difficulty, settings), a.date, difficulty, size);
  }
  return state;
}

// Everything the UI needs about one problem at time `now`.
function analyze(attempts, difficulty, now = Date.now(), settings = DEFAULT_SETTINGS, rotationStarts = []) {
  const state = memoryState(attempts, difficulty, settings, rotationStarts);
  if (!state) return null;
  const stability = state.stability * rotationStretch(rotationSizeAt(rotationStarts, now));
  const daysSince = (now - state.lastReview) / DAY_MS;
  const score = recall(stability, daysSince);
  const sorted = [...attempts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  const lastGrade = gradeAttempt(last.minutes, last.solved, difficulty, settings);
  return {
    ...state,
    stability,
    score,
    daysSince,
    dueAt: state.lastReview + stability * DAY_MS,
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

// What a session may draw from: only due problems, or the whole rotation as
// optional extra practice when nothing is due.
function sessionPool(items) {
  const due = items.filter((it) => it.info.isDue);
  return due.length ? due : items;
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
  module.exports = { DEFAULT_SETTINGS, DAY_MS, gradeAttempt, rotationStretch, recall, applyAttempt, memoryState, analyze, priority, sessionPool, pickSession };
}
