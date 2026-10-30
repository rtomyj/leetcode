const assert = require("assert");
const { PROBLEMS } = require("./problems.js");
const S = require("./srs.js");
const D = S.DAY_MS, t0 = Date.parse("2026-01-01");
const at = (d) => new Date(t0 + d * D).toISOString();

assert.strictEqual(Object.keys(PROBLEMS).length, 150, "150 problems");
assert.strictEqual(S.gradeAttempt(10, true, "Easy"), "clean");
assert.strictEqual(S.gradeAttempt(20, true, "Easy"), "slow");
assert.strictEqual(S.gradeAttempt(5, false, "Easy"), "failed");

// Score is 90% exactly at the due date.
const one = S.analyze([{ date: at(0), minutes: 10, solved: true }], "Easy", t0 + 3 * D);
assert(Math.abs(one.score - 0.9) < 1e-9);

// Clean on-time reviews grow the interval; a fail collapses it.
const clean = S.analyze([0, 3, 10].map((d) => ({ date: at(d), minutes: 10, solved: true })), "Easy", t0 + 10 * D);
assert(clean.stability > 15, "intervals grow: " + clean.stability);
const failed = S.analyze([{ date: at(0), minutes: 10, solved: true }, { date: at(3), minutes: 30, solved: false }], "Easy", t0 + 3 * D);
assert(failed.stability < 1.5);

// Slow-but-solved reviews still grow the interval (slower than clean), so a
// problem you keep solving slowly doesn't come back every couple of days forever.
let slowState = S.applyAttempt(null, "slow", t0);
for (let i = 0; i < 6; i++) slowState = S.applyAttempt(slowState, "slow", slowState.lastReview + slowState.stability * D);
assert(slowState.stability > 10, "slow reviews escape the short loop: " + slowState.stability);
const afterSlow = S.applyAttempt({ stability: 3, ease: 2.5, lastReview: t0 }, "slow", t0 + 3 * D);
const afterClean = S.applyAttempt({ stability: 3, ease: 2.5, lastReview: t0 }, "clean", t0 + 3 * D);
assert(afterSlow.stability < afterClean.stability, "slow grows less than clean");

// Harder problems decay faster after the same solve, so they come due sooner.
const solvedOnce = (difficulty) => S.analyze([{ date: at(0), minutes: 1, solved: true }], difficulty, t0 + 2 * D);
assert(solvedOnce("Hard").score < solvedOnce("Medium").score, "hard decays faster than medium");
assert(solvedOnce("Medium").score < solvedOnce("Easy").score, "medium decays faster than easy");
assert.strictEqual(solvedOnce("Hard").dueAt, t0 + 1.5 * D);
// Reviewing a hard problem on its own, shorter schedule still earns full growth.
const hardOnTime = S.analyze([0, 1.5].map((d) => ({ date: at(d), minutes: 1, solved: true })), "Hard", t0 + 1.5 * D);
assert(Math.abs(hardOnTime.stability - 3.75) < 1e-9, "on-time hard review: " + hardOnTime.stability);
// A first-try fail keeps the half-day floor rather than dropping below it.
assert.strictEqual(S.analyze([{ date: at(0), minutes: 1, solved: false }], "Hard", t0).stability, 0.5);

// Bigger rotations decay slower: same history, higher score, later due date.
const startedAt = (n, day = 0) => Array(n).fill(t0 + day * D);
const withRotation = (size) => S.analyze([{ date: at(0), minutes: 1, solved: true }], "Easy", t0 + 5 * D, S.DEFAULT_SETTINGS, startedAt(size));
assert(withRotation(150).score > withRotation(50).score, "150 in rotation decays slower than 50");
assert(withRotation(150).dueAt > withRotation(50).dueAt, "150 in rotation comes due later than 50");
// Small rotations are unaffected.
assert.strictEqual(withRotation(5).score, withRotation(0).score);
assert.strictEqual(withRotation(10).dueAt, t0 + 3 * D);
// The score is still exactly 90% at the stretched due date.
const STRETCH_150 = Math.sqrt(15);
const big = S.analyze([{ date: at(0), minutes: 1, solved: true }], "Easy", t0 + 3 * STRETCH_150 * D, S.DEFAULT_SETTINGS, startedAt(150));
assert(Math.abs(big.score - 0.9) < 1e-9, "90% at stretched due date: " + big.score);
// Problems not started yet don't count toward the rotation.
assert.strictEqual(S.analyze([{ date: at(0), minutes: 1, solved: true }], "Easy", t0, S.DEFAULT_SETTINGS, startedAt(150, 1)).dueAt, t0 + 3 * D);
// Reviewing early on a stretched schedule earns less than reviewing when due.
const reviewedOn = (day) => S.analyze([0, day].map((d) => ({ date: at(d), minutes: 1, solved: true })), "Easy", t0 + day * D, S.DEFAULT_SETTINGS, startedAt(150));
assert(reviewedOn(3).stability < reviewedOn(3 * STRETCH_150).stability, "early review earns less: " + reviewedOn(3).stability);
assert(Math.abs(reviewedOn(3 * STRETCH_150).stability - 7.5 * STRETCH_150) < 1e-6, "on-time review earns full growth");
// A review that was on time when the rotation was small keeps full credit as it grows.
const grewLater = S.analyze([0, 3].map((d) => ({ date: at(d), minutes: 1, solved: true })), "Easy", t0 + 10 * D, S.DEFAULT_SETTINGS, [...startedAt(5), ...startedAt(145, 5)]);
assert(Math.abs(grewLater.stability - 7.5 * STRETCH_150) < 1e-9, "past credit survives growth: " + grewLater.stability);

// Reviewing early earns less than reviewing on time.
const early = S.analyze([0, 0.5].map((d) => ({ date: at(d), minutes: 10, solved: true })), "Easy", t0 + D);
assert(early.stability < 4, "early review barely grows: " + early.stability);

// A recently failed problem outranks a stale clean one at the same score.
assert(S.priority({ score: 0.8, lastGrade: "failed" }) > S.priority({ score: 0.8, lastGrade: "clean" }));

// Session picks spread across topics.
const items = ["A", "A", "A", "B"].map((topic, i) => ({ topic, info: { score: 0.5 + i * 0.1, lastGrade: "clean" } }));
assert.deepStrictEqual(S.pickSession(items, 2).map((x) => x.topic), ["A", "B"]);

// A session only holds due problems, even if that leaves it short of full or
// repeats a topic; it falls back to the whole rotation only when nothing is due.
const entry = (slug, topic, score, isDue) => ({ slug, topic, info: { score, isDue, lastGrade: "clean" } });
const dueA1 = entry("a1", "A", 0.7, true), dueA2 = entry("a2", "A", 0.8, true);
const notDueB = entry("b", "B", 0.95, false), notDueC = entry("c", "C", 0.96, false);
assert.deepStrictEqual(
  S.pickSession(S.sessionPool([notDueB, dueA1, notDueC, dueA2]), 3).map((x) => x.slug), ["a1", "a2"],
  "not-due problems never fill a session that has due ones");
assert.deepStrictEqual(
  S.pickSession(S.sessionPool([notDueB, notDueC]), 3).map((x) => x.slug), ["b", "c"],
  "nothing due falls back to the closest problems");
console.log("all tests pass; 3 clean reviews ->", clean.stability.toFixed(1), "day stability");
