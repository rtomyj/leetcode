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

// Reviewing early earns less than reviewing on time.
const early = S.analyze([0, 0.5].map((d) => ({ date: at(d), minutes: 10, solved: true })), "Easy", t0 + D);
assert(early.stability < 4, "early review barely grows: " + early.stability);

// A recently failed problem outranks a stale clean one at the same score.
assert(S.priority({ score: 0.8, lastGrade: "failed" }) > S.priority({ score: 0.8, lastGrade: "clean" }));

// Session picks spread across topics.
const items = ["A", "A", "A", "B"].map((topic, i) => ({ topic, info: { score: 0.5 + i * 0.1, lastGrade: "clean" } }));
assert.deepStrictEqual(S.pickSession(items, 2).map((x) => x.topic), ["A", "B"]);
console.log("all tests pass; 3 clean reviews ->", clean.stability.toFixed(1), "day stability");
