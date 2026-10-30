// UI for the NeetCode 150 review tracker. Only the raw attempt log is stored;
// scores and due dates are recomputed from it on every render (see srs.js).

const STORE_KEY = "nc150-tracker-v1";
const TIMER_KEY = "nc150-timer";
const TOPICS = Object.keys(NEETCODE_150);
const $ = (sel) => document.querySelector(sel);

// ---------- storage ----------

function emptyStore() {
  // `deleted` holds "slug@isoDate" keys for removed attempts, so merging an older
  // copy (browser storage, another machine's progress.json) can't resurrect them.
  return { version: 1, settings: structuredClone(DEFAULT_SETTINGS), problems: {}, deleted: [], lastExport: null };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw);
    data.settings = { ...structuredClone(DEFAULT_SETTINGS), ...data.settings };
    data.problems ??= {};
    data.deleted ??= [];
    return data;
  } catch (e) {
    console.error("Could not load saved data", e);
    return emptyStore();
  }
}

let store = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    toast("Could not save — export your data now!");
  }
  scheduleFileWrite();
}

const attemptKey = (slug, date) => `${slug}@${new Date(date).toISOString()}`;

function tombstone(slug, attempts) {
  store.deleted.push(...attempts.map((a) => attemptKey(slug, a.date)));
}

// ---------- derived data ----------

function attemptsOf(slug) {
  return store.problems[slug]?.attempts ?? [];
}

function rotationSlugs() {
  return Object.keys(store.problems).filter((slug) => PROBLEMS[slug] && attemptsOf(slug).length);
}

// When each problem in the rotation was first attempted.
function rotationStarts() {
  return rotationSlugs().map((slug) => Math.min(...attemptsOf(slug).map((a) => new Date(a.date).getTime())));
}

function infoFor(slug, now = Date.now(), starts = rotationStarts()) {
  return analyze(attemptsOf(slug), PROBLEMS[slug].difficulty, now, store.settings, starts);
}

function rotation(now = Date.now()) {
  const starts = rotationStarts();
  return rotationSlugs().map((slug) => ({ ...PROBLEMS[slug], info: infoFor(slug, now, starts) }));
}

// ---------- formatting ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x) => Math.round(x * 100) + "%";
const scoreClass = (x) => (x >= 0.85 ? "s-good" : x >= 0.7 ? "s-ok" : "s-bad");
const scoreColor = (x) => `var(--${x >= 0.85 ? "good" : x >= 0.7 ? "ok" : "bad"})`;
const GRADE_LABEL = { clean: "clean", slow: "slow", failed: "failed" };

function ago(days) {
  if (days < 1) return "today";
  const d = Math.floor(days);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function dueText(info) {
  if (info.isDue) {
    const over = (Date.now() - info.dueAt) / DAY_MS;
    return over >= 1 ? `overdue ${Math.floor(over)}d` : "due now";
  }
  const days = Math.ceil((info.dueAt - Date.now()) / DAY_MS);
  return `due in ${days}d`;
}

const lcLink = (p) => `<a class="title" href="https://leetcode.com/problems/${p.slug}/" target="_blank" rel="noopener">${esc(p.title)}</a>`;
const diffChip = (p) => `<span class="chip d-${p.difficulty}">${p.difficulty}</span>`;
const fmtDate = (d) => {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- tabs ----------

let activeTab = "review";

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  for (const t of ["review", "problems", "summary"]) $(`#tab-${t}`).hidden = t !== activeTab;
  render();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// The app-bar search always filters the Problems list, jumping there if needed.
$("#q").addEventListener("input", (e) => {
  filter.q = e.target.value.toLowerCase();
  activeTab === "problems" ? renderProblems() : showTab("problems");
});

function render() {
  const items = rotation();
  const due = items.filter((i) => i.info.isDue).length;
  $("#due-badge").textContent = due || "";
  $("#done-badge").textContent = items.length || "";
  renderBanner();
  if (activeTab === "review") renderReview();
  if (activeTab === "problems") renderProblems();
  if (activeTab === "summary") renderSummary();
}

function renderBanner() {
  const n = Object.keys(store.problems).length;
  const stale = !store.lastExport || Date.now() - store.lastExport > 7 * DAY_MS;
  const banner = (msg, buttons) => `<div class="banner"><span>${msg}</span>${buttons}</div>`;
  let html = "";
  if (fileSync.status === "needs-permission") {
    html = banner(`Reconnect <strong>${esc(fileSync.name)}</strong> to keep saving your progress to it.`,
      `<button class="btn sm primary" data-act="file-reconnect">Reconnect</button>`);
  } else if (fileSync.status === "error") {
    html = banner(`Couldn't read <strong>${esc(fileSync.name)}</strong>, so it was left untouched. Pick a valid progress file.`,
      `<button class="btn sm" data-act="file-open">Open file…</button>`);
  } else if (fileSync.status === "off" && fileSync.supported && n >= 1) {
    html = banner("Your history is only in this browser. Save it to a <strong>progress.json</strong> you can commit.",
      `<button class="btn sm primary" data-act="file-create">Create progress.json</button>
       <button class="btn sm" data-act="file-open">Open existing…</button>`);
  } else if (fileSync.status === "off" && n >= 3 && stale) {
    html = banner("Your history lives only in this browser. Download <strong>progress.json</strong> now and then.",
      `<button class="btn sm" data-act="download-file">Download progress.json</button>`);
  }
  $("#banner").innerHTML = html;
}

// ---------- timer ----------
// A single running stopwatch, persisted so a page refresh doesn't lose it.

let timer = (() => {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { return null; }
})();

function setTimer(t) {
  timer = t;
  try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); } catch {}
}

function timerText() {
  const s = Math.floor((Date.now() - timer.start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

setInterval(() => {
  const el = document.querySelector("[data-timer]");
  if (el && timer) el.textContent = timerText();
}, 1000);

// ---------- review tab ----------

const skipped = new Set();

function renderReview() {
  const el = $("#tab-review");
  const items = rotation();
  if (!items.length) {
    el.innerHTML = `<div class="empty"><p><strong>No problems in your rotation yet.</strong></p>
      <p>Solve a problem on NeetCode, then mark it complete in the <strong>Problems</strong> tab.
      It'll start showing up here for review.</p></div>`;
    return;
  }
  const due = items.filter((i) => i.info.isDue);
  const pool = sessionPool(items).filter((i) => !skipped.has(i.slug));
  const session = pickSession(pool, store.settings.sessionSize);
  const extra = due.length === 0;

  el.innerHTML = `
    <h2>Today's session</h2>
    <p class="muted small">${due.length} due · ${items.length} in rotation${
      extra ? " · nothing is due — these are the closest, if you want extra practice" : ""}</p>
    <div class="grid">${session.map(sessionCard).join("") || `<div class="muted">All skipped. <button class="btn sm" data-act="unskip">Reset</button></div>`}</div>
    <h2>Full queue</h2>
    <div class="card flat table-wrap">
      <table>
        <thead><tr><th>Problem</th><th>Topic</th><th class="num">Score</th><th>Last</th><th>Next</th><th></th></tr></thead>
        <tbody>${[...items].sort((a, b) => priority(b.info) - priority(a.info)).map(queueRow).join("")}</tbody>
      </table>
    </div>`;
}

function sessionCard(p) {
  const i = p.info;
  const running = timer?.slug === p.slug;
  return `<div class="card">
    <div>${lcLink(p)}</div>
    <div class="meta">${diffChip(p)}<span class="chip">${esc(p.topic)}</span></div>
    <div class="big-score score ${scoreClass(i.score)}">${pct(i.score)}</div>
    <div class="meta muted">
      <span>last <span class="g-${i.lastGrade}">${GRADE_LABEL[i.lastGrade]}</span> ${ago(i.daysSince)}</span>
      <span>· ${i.reviews} solve${i.reviews === 1 ? "" : "s"}</span>
    </div>
    ${running ? `<div class="timer" data-timer>${timerText()}</div>` : ""}
    <div class="row-actions">
      ${running
        ? `<button class="btn primary" data-act="stop" data-slug="${p.slug}">Done</button>
           <button class="btn text" data-act="cancel-timer">Cancel timer</button>`
        : `<button class="btn primary" data-act="start" data-slug="${p.slug}">Start timer</button>
           <button class="btn tonal" data-act="log" data-slug="${p.slug}">Log</button>
           <button class="btn text" data-act="skip" data-slug="${p.slug}">Skip</button>`}
    </div>
  </div>`;
}

function queueRow(p) {
  const i = p.info;
  return `<tr>
    <td>${lcLink(p)} <span class="small d-${p.difficulty}">${p.difficulty[0]}</span></td>
    <td class="small muted">${esc(p.topic)}</td>
    <td class="num score ${scoreClass(i.score)}">${pct(i.score)}</td>
    <td class="small"><span class="g-${i.lastGrade}">${GRADE_LABEL[i.lastGrade]}</span> <span class="muted">${ago(i.daysSince)}</span></td>
    <td class="small ${i.isDue ? "s-bad" : "muted"}">${dueText(i)}</td>
    <td><button class="btn sm" data-act="log" data-slug="${p.slug}">Log</button></td>
  </tr>`;
}

// ---------- problems tab ----------

let filter = { q: "", show: "all" };

function renderProblems() {
  const el = $("#tab-problems");
  const done = Object.keys(store.problems).length;
  if (!el.querySelector("#show")) {
    el.innerHTML = `
      <div class="toolbar" style="justify-content:space-between">
        <h2 style="margin:0">All problems <span class="muted small" id="done-count"></span></h2>
        <select id="show">
          <option value="all">All</option>
          <option value="done">Completed</option>
          <option value="todo">Not yet</option>
        </select>
      </div>
      <div id="plist"></div>`;
    $("#show").addEventListener("change", (e) => { filter.show = e.target.value; renderProblems(); });
  }
  $("#done-count").textContent = `· ${done}/150 completed`;

  const now = Date.now();
  const starts = rotationStarts();
  $("#plist").innerHTML = TOPICS.map((topic) => {
    const all = NEETCODE_150[topic].map(([slug]) => PROBLEMS[slug]);
    const doneHere = all.filter((p) => attemptsOf(p.slug).length);
    const avg = doneHere.length ? doneHere.reduce((s, p) => s + infoFor(p.slug, now, starts).score, 0) / doneHere.length : null;
    const visible = all.filter((p) => {
      const isDone = attemptsOf(p.slug).length > 0;
      if (filter.show === "done" && !isDone) return false;
      if (filter.show === "todo" && isDone) return false;
      return !filter.q || p.title.toLowerCase().includes(filter.q);
    });
    if (!visible.length) return "";
    return `<div class="topic">
      <div class="topic-head"><h3>${esc(topic)}</h3>
        <span class="small muted">${doneHere.length}/${all.length}${avg !== null ? ` · <span class="score ${scoreClass(avg)}">${pct(avg)}</span>` : ""}</span></div>
      <div class="card flat">${visible.map((p) => problemRow(p, now, starts)).join("")}</div>
    </div>`;
  }).join("") || `<div class="empty">No matches.</div>`;
}

const openHistory = new Set();

function problemRow(p, now, starts) {
  const attempts = attemptsOf(p.slug);
  if (!attempts.length) {
    return `<div class="prob todo"><span class="dot"></span>
      <span class="name">${lcLink(p)}</span>${diffChip(p)}
      <button class="btn sm" data-act="complete" data-slug="${p.slug}">Mark completed</button></div>`;
  }
  const i = infoFor(p.slug, now, starts);
  const open = openHistory.has(p.slug);
  return `<div class="prob"><span class="dot" style="background:${scoreColor(i.score)}"></span>
    <span class="name">${lcLink(p)}</span>${diffChip(p)}
    <span class="score small ${scoreClass(i.score)}">${pct(i.score)}</span>
    <span class="small muted">${dueText(i)}</span>
    <button class="btn sm" data-act="log" data-slug="${p.slug}">Log review</button>
    <button class="btn sm" data-act="history" data-slug="${p.slug}">${open ? "Hide" : "History"} (${attempts.length})</button>
    ${open ? historyTable(p) : ""}
  </div>`;
}

function historyTable(p) {
  const rows = attemptsOf(p.slug)
    .map((a, idx) => ({ a, idx }))
    .sort((x, y) => new Date(y.a.date) - new Date(x.a.date))
    .map(({ a, idx }) => {
      const g = gradeAttempt(a.minutes, a.solved, p.difficulty, store.settings);
      return `<tr><td>${fmtDate(a.date)}</td><td>${a.minutes} min</td><td class="g-${g}">${GRADE_LABEL[g]}</td>
        <td class="muted">${esc(a.note || "")}</td>
        <td><button class="btn sm danger" data-act="del-attempt" data-slug="${p.slug}" data-idx="${idx}" title="Delete entry">×</button></td></tr>`;
    }).join("");
  return `<div class="history"><table>${rows}</table>
    <button class="btn sm danger" data-act="remove" data-slug="${p.slug}">Remove from rotation</button></div>`;
}

// ---------- summary tab ----------

function summaryStats(now = Date.now()) {
  const items = rotation(now);
  const sum = items.reduce((s, p) => s + p.info.score, 0);
  const allAttempts = items.flatMap((p) => attemptsOf(p.slug).map((a) => ({ ...a, p })));
  const byTopic = TOPICS.map((topic) => {
    const here = items.filter((p) => p.topic === topic);
    return {
      topic,
      total: NEETCODE_150[topic].length,
      done: here.length,
      avg: here.length ? here.reduce((s, p) => s + p.info.score, 0) / here.length : null,
      coverage: here.reduce((s, p) => s + p.info.score, 0) / NEETCODE_150[topic].length,
    };
  });
  const byDiff = ["Easy", "Medium", "Hard"].map((d) => {
    const here = items.filter((p) => p.difficulty === d);
    return { difficulty: d, done: here.length, avg: here.length ? here.reduce((s, p) => s + p.info.score, 0) / here.length : null };
  });
  return {
    items,
    completed: items.length,
    avgScore: items.length ? sum / items.length : 0,
    readiness: sum / 150,
    due: items.filter((p) => p.info.isDue).length,
    struggling: items.filter((p) => p.info.score < 0.7 || p.info.lastGrade === "failed").length,
    reviews7d: allAttempts.filter((a) => now - new Date(a.date) < 7 * DAY_MS).length,
    totalAttempts: allAttempts.length,
    allAttempts,
    byTopic,
    byDiff,
  };
}

function renderSummary() {
  const el = $("#tab-summary");
  const s = summaryStats();
  const weakest = [...s.items].sort((a, b) => a.info.score - b.info.score).slice(0, 8);

  // Reviews per day over the last 30 days.
  const days = Array.from({ length: 30 }, () => 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const a of s.allAttempts) {
    const d = new Date(a.date); d.setHours(0, 0, 0, 0);
    const idx = 29 - Math.round((today - d) / DAY_MS);
    if (idx >= 0 && idx < 30) days[idx]++;
  }
  const maxDay = Math.max(1, ...days);

  const bar = (label, value) => `<div class="barrow">
    <span>${label}</span>
    <div class="track">${value !== null ? `<div class="fill" style="width:${value * 100}%;background:${scoreColor(value)}"></div>` : ""}</div>
    <span class="num small ${value !== null ? "score " + scoreClass(value) : "muted"}" style="text-align:right">${value !== null ? pct(value) : "—"}</span>
  </div>`;

  el.innerHTML = `
    <h2>Summary</h2>
    <div class="tiles">
      <div class="card tile"><div class="num ${s.completed ? scoreClass(s.avgScore) : ""}">${s.completed ? pct(s.avgScore) : "—"}</div><div class="lbl">Avg understanding of what you've done</div></div>
      <div class="card tile"><div class="num">${pct(s.readiness)}</div><div class="lbl">Readiness across all 150</div></div>
      <div class="card tile"><div class="num">${s.completed}<span class="muted" style="font-size:16px">/150</span></div><div class="lbl">Completed</div></div>
      <div class="card tile"><div class="num">${s.due}</div><div class="lbl">Due for review</div></div>
      <div class="card tile"><div class="num">${s.struggling}</div><div class="lbl">Struggling (&lt;70% or last failed)</div></div>
      <div class="card tile"><div class="num">${s.reviews7d}</div><div class="lbl">Solves in last 7 days</div></div>
    </div>
    <p class="small muted">Understanding = estimated chance you'd solve the problem cleanly right now. It drops over time, more slowly the more problems are in rotation, and rebounds when you review.
      Readiness counts problems you haven't done as 0%.</p>

    <h2>By topic</h2>
    <div class="card">
      ${s.byTopic.map((t) => bar(`${esc(t.topic)} <span class="muted small">${t.done}/${t.total}</span>`, t.avg)).join("")}
    </div>

    <h2>By difficulty</h2>
    <div class="card">${s.byDiff.map((d) => bar(`<span class="d-${d.difficulty}">${d.difficulty}</span> <span class="muted small">${d.done}</span>`, d.avg)).join("")}</div>

    ${weakest.length ? `<h2>Weakest problems</h2>
    <div class="card flat table-wrap"><table>
      <thead><tr><th>Problem</th><th>Topic</th><th class="num">Score</th><th>Last</th><th></th></tr></thead>
      <tbody>${weakest.map((p) => `<tr><td>${lcLink(p)}</td><td class="small muted">${esc(p.topic)}</td>
        <td class="num score ${scoreClass(p.info.score)}">${pct(p.info.score)}</td>
        <td class="small g-${p.info.lastGrade}">${GRADE_LABEL[p.info.lastGrade]}</td>
        <td><button class="btn sm" data-act="log" data-slug="${p.slug}">Log</button></td></tr>`).join("")}</tbody>
    </table></div>` : ""}

    <h2>Last 30 days</h2>
    <div class="card">
      <div class="activity">${days.map((n, i) => `<div class="${n ? "" : "zero"}" style="height:${(n / maxDay) * 100}%" title="${n} solve${n === 1 ? "" : "s"}, ${29 - i}d ago"></div>`).join("")}</div>
      <div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>30d ago</span><span>today</span></div>
    </div>

    <h2>Progress file</h2>
    <div class="card">${fileCard()}</div>

    <h2>Export &amp; data</h2>
    <div class="card">
      <div class="toolbar">
        <button class="btn primary" data-act="copy-ai">Copy AI report</button>
        <button class="btn" data-act="download-ai">Download AI report (.md)</button>
        <button class="btn" data-act="export">Export backup (.json)</button>
        <button class="btn" data-act="import">Import .json</button>
      </div>
      <p class="small muted">The AI report is Markdown with your stats, every problem's history and a ready-made prompt. Paste it into Claude or another AI tool.
        The JSON backup is lossless and can be imported back here (merged with what's already here).</p>
      <h3 style="font-size:14px;margin:18px 0 8px">Settings</h3>
      <div class="settings">
        <label>Slow if Easy &gt; (min)<input type="number" min="1" data-set="Easy" value="${store.settings.slowMinutes.Easy}"></label>
        <label>Medium &gt;<input type="number" min="1" data-set="Medium" value="${store.settings.slowMinutes.Medium}"></label>
        <label>Hard &gt;<input type="number" min="1" data-set="Hard" value="${store.settings.slowMinutes.Hard}"></label>
        <label>Session size<input type="number" min="1" max="20" data-set="sessionSize" value="${store.settings.sessionSize}"></label>
        <button class="btn danger" data-act="reset">Erase all data</button>
      </div>
    </div>`;

  el.querySelectorAll("[data-set]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const v = Math.max(1, parseInt(inp.value, 10) || 1);
      if (inp.dataset.set === "sessionSize") store.settings.sessionSize = v;
      else store.settings.slowMinutes[inp.dataset.set] = v;
      save();
      toast("Settings saved, history regraded");
      render();
    })
  );
}

// ---------- export ----------

function exportPayload() {
  const s = summaryStats();
  return {
    app: "neetcode-150-review",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: store.settings,
    summary: {
      completed: s.completed,
      averageUnderstanding: +s.avgScore.toFixed(3),
      readinessAll150: +s.readiness.toFixed(3),
      due: s.due,
      struggling: s.struggling,
      totalSolves: s.totalAttempts,
      byTopic: s.byTopic.map((t) => ({ ...t, avg: t.avg === null ? null : +t.avg.toFixed(3), coverage: +t.coverage.toFixed(3) })),
      byDifficulty: s.byDiff.map((d) => ({ ...d, avg: d.avg === null ? null : +d.avg.toFixed(3) })),
    },
    problems: s.items.map((p) => ({
      slug: p.slug, title: p.title, topic: p.topic, difficulty: p.difficulty,
      understanding: +p.info.score.toFixed(3),
      stabilityDays: +p.info.stability.toFixed(2),
      nextDue: new Date(p.info.dueAt).toISOString(),
      attempts: attemptsOf(p.slug).map((a) => ({ ...a, grade: gradeAttempt(a.minutes, a.solved, p.difficulty, store.settings) })),
    })),
  };
}

function aiReport() {
  const x = exportPayload();
  const s = x.summary;
  const lines = [];
  lines.push(`# NeetCode 150 progress report (${x.exportedAt.slice(0, 10)})`, "");
  lines.push(
    "I'm working through NeetCode 150 and reviewing solved problems with spaced repetition.",
    "Please analyze my progress: identify weak patterns/topics, problems I keep struggling with, what to focus on next,",
    "and anything notable in my solve times or notes. Suggest a concrete plan for the next 2 weeks.",
    ""
  );
  lines.push("## How to read this", "");
  lines.push(
    `- **Understanding** = model-estimated probability I'd solve it cleanly right now (decays over time, more slowly the more problems are in rotation, rises with successful reviews).`,
    `- **Grades**: clean = solved within time limit; slow = solved but over the limit (Easy ${x.settings.slowMinutes.Easy} / Medium ${x.settings.slowMinutes.Medium} / Hard ${x.settings.slowMinutes.Hard} min); failed = couldn't solve without help.`,
    ""
  );
  lines.push("## Overview", "");
  lines.push(
    `- Completed: ${s.completed}/150`,
    `- Average understanding (completed): ${pct(s.averageUnderstanding)}`,
    `- Readiness across all 150 (unsolved = 0): ${pct(s.readinessAll150)}`,
    `- Due for review: ${s.due} · Struggling: ${s.struggling} · Total solves logged: ${s.totalSolves}`,
    ""
  );
  lines.push("## By topic", "", "| Topic | Done | Avg understanding |", "|---|---|---|");
  for (const t of s.byTopic) lines.push(`| ${t.topic} | ${t.done}/${t.total} | ${t.avg === null ? "—" : pct(t.avg)} |`);
  lines.push("", "## By difficulty", "", "| Difficulty | Done | Avg understanding |", "|---|---|---|");
  for (const d of s.byDifficulty) lines.push(`| ${d.difficulty} | ${d.done} | ${d.avg === null ? "—" : pct(d.avg)} |`);
  lines.push("", "## Problems (weakest first)", "");
  lines.push("| Problem | Topic | Diff | Understanding | Solves | Grades (oldest→newest) | Minutes | Notes |", "|---|---|---|---|---|---|---|---|");
  const cell = (str) => String(str).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const p of [...x.problems].sort((a, b) => a.understanding - b.understanding)) {
    const at = [...p.attempts].sort((a, b) => new Date(a.date) - new Date(b.date));
    lines.push(`| ${cell(p.title)} | ${p.topic} | ${p.difficulty[0]} | ${pct(p.understanding)} | ${at.length} | ${at.map((a) => a.grade).join(", ")} | ${at.map((a) => a.minutes).join(", ")} | ${cell(at.map((a) => a.note).filter(Boolean).join(" / "))} |`);
  }
  const notDone = TOPICS.flatMap((t) => NEETCODE_150[t].filter(([slug]) => !attemptsOf(slug).length).map(([, title]) => title));
  lines.push("", `## Not yet attempted (${notDone.length})`, "", notDone.join(", ") || "None 🎉", "");
  return lines.join("\n");
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

// Merge another copy of the history into the store: union of attempts minus the
// union of deletions. Order doesn't matter, so merging the same file twice is a no-op.
function importData(json) {
  // Accept an export payload ({problems: [{slug, attempts}]}) or progress.json / raw store ({problems: {slug: {attempts}}}).
  const list = Array.isArray(json.problems)
    ? json.problems.map((p) => [p.slug, p.attempts])
    : Object.entries(json.problems ?? {}).map(([slug, v]) => [slug, v.attempts]);
  const dead = new Set([...store.deleted, ...(Array.isArray(json.deleted) ? json.deleted : [])]);
  store.deleted = [...dead];
  for (const [slug, p] of Object.entries(store.problems)) {
    p.attempts = p.attempts.filter((a) => !dead.has(attemptKey(slug, a.date)));
    if (!p.attempts.length) delete store.problems[slug];
  }
  let added = 0;
  for (const [slug, attempts] of list) {
    if (!PROBLEMS[slug] || !Array.isArray(attempts)) continue;
    const mine = (store.problems[slug] ??= { attempts: [] }).attempts;
    const seen = new Set(mine.map((a) => new Date(a.date).getTime()));
    for (const a of attempts) {
      const t = new Date(a.date).getTime();
      if (isNaN(t) || seen.has(t) || dead.has(attemptKey(slug, t))) continue;
      mine.push({ date: new Date(t).toISOString(), minutes: +a.minutes || 1, solved: !!a.solved, ...(a.note ? { note: String(a.note) } : {}) });
      seen.add(t);
      added++;
    }
    if (!mine.length) delete store.problems[slug];
  }
  if (json.settings?.slowMinutes) store.settings = { ...store.settings, ...json.settings };
  save();
  return added;
}

// ---------- log dialog ----------

let logCtx = null;

function openLog(slug, minutes) {
  const p = PROBLEMS[slug];
  const first = !attemptsOf(slug).length;
  logCtx = { slug, solved: true };
  $("#log-title").textContent = (first ? "Mark completed: " : "Log review: ") + p.title;
  $("#log-sub").textContent = first
    ? "This first solve adds the problem to your review rotation."
    : `${p.difficulty} · counts as slow above ${store.settings.slowMinutes[p.difficulty]} min`;
  $("#log-min").value = minutes ?? "";
  $("#log-date").value = fmtDate(new Date());
  $("#log-note").value = "";
  setSolved(true);
  $("#log").showModal();
  $("#log-min").focus();
}

function setSolved(v) {
  logCtx.solved = v;
  document.querySelectorAll("[data-solved]").forEach((b) => b.classList.toggle("on", (b.dataset.solved === "1") === v));
  updateGradePreview();
}

function updateGradePreview() {
  if (!logCtx) return;
  const m = parseInt($("#log-min").value, 10);
  const p = PROBLEMS[logCtx.slug];
  if (!logCtx.solved) return ($("#log-grade").innerHTML = `Counts as <strong class="g-failed">failed</strong>: comes back soon.`);
  if (!m) return ($("#log-grade").textContent = "");
  const g = gradeAttempt(m, true, p.difficulty, store.settings);
  $("#log-grade").innerHTML = g === "clean"
    ? `Counts as <strong class="g-clean">clean</strong>: the review interval grows.`
    : `Counts as <strong class="g-slow">slow</strong>: a partial struggle, so it stays in close rotation.`;
}

document.querySelectorAll("[data-solved]").forEach((b) => b.addEventListener("click", () => setSolved(b.dataset.solved === "1")));
$("#log-min").addEventListener("input", updateGradePreview);
$("#log-cancel").addEventListener("click", () => $("#log").close());

$("#log-form").addEventListener("submit", (e) => {
  const minutes = parseInt($("#log-min").value, 10);
  const date = new Date($("#log-date").value.replace(" ", "T"));
  if (!minutes || minutes < 1) { e.preventDefault(); return; }
  if (isNaN(date)) { e.preventDefault(); toast("Date should look like 2026-10-27 14:30"); return; }
  const note = $("#log-note").value.trim();
  (store.problems[logCtx.slug] ??= { attempts: [] }).attempts.push({
    date: date.toISOString(), minutes, solved: logCtx.solved, ...(note ? { note } : {}),
  });
  if (timer?.slug === logCtx.slug) setTimer(null);
  skipped.delete(logCtx.slug);
  save();
  const info = infoFor(logCtx.slug);
  toast(`${PROBLEMS[logCtx.slug].title}: next review ${dueText(info).replace("due ", "")}`);
  render();
});

// ---------- actions ----------

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const slug = b.dataset.slug;
  switch (b.dataset.act) {
    case "fab-review": {
      const items = rotation();
      if (!items.length) return showTab("problems");
      const pool = sessionPool(items).filter((i) => !skipped.has(i.slug));
      if (!timer && pool.length) setTimer({ slug: pickSession(pool, 1)[0].slug, start: Date.now() });
      showTab("review");
      break;
    }
    case "complete":
    case "log":
      openLog(slug);
      break;
    case "start":
      if (timer && timer.slug !== slug && !confirm(`Stop the timer for ${PROBLEMS[timer.slug].title}?`)) return;
      setTimer({ slug, start: Date.now() });
      render();
      break;
    case "stop":
      openLog(slug, Math.max(1, Math.round((Date.now() - timer.start) / 60000)));
      break;
    case "cancel-timer":
      setTimer(null);
      render();
      break;
    case "skip":
      skipped.add(slug);
      render();
      break;
    case "unskip":
      skipped.clear();
      render();
      break;
    case "history":
      openHistory.has(slug) ? openHistory.delete(slug) : openHistory.add(slug);
      render();
      break;
    case "del-attempt": {
      const list = attemptsOf(slug);
      if (!confirm("Delete this entry?")) return;
      tombstone(slug, list.splice(+b.dataset.idx, 1));
      if (!list.length) delete store.problems[slug];
      save();
      render();
      break;
    }
    case "remove":
      if (!confirm(`Remove ${PROBLEMS[slug].title} and all its history from your rotation?`)) return;
      tombstone(slug, attemptsOf(slug));
      delete store.problems[slug];
      openHistory.delete(slug);
      save();
      render();
      break;
    case "copy-ai":
      try {
        await navigator.clipboard.writeText(aiReport());
        toast("AI report copied to clipboard");
      } catch {
        download(`neetcode-report-${stamp()}.md`, aiReport(), "text/markdown");
        toast("Clipboard blocked: downloaded instead");
      }
      break;
    case "download-ai":
      download(`neetcode-report-${stamp()}.md`, aiReport(), "text/markdown");
      break;
    case "export":
      download(`neetcode-backup-${stamp()}.json`, JSON.stringify(exportPayload(), null, 2), "application/json");
      store.lastExport = Date.now();
      save();
      render();
      break;
    case "import":
      $("#import-file").click();
      break;
    case "reset":
      if (!confirm(`Erase ALL progress?${fileSync.status === "on" ? ` This also empties ${fileSync.name} (git still has old commits).` : " Export a backup first if you might want it."}`)) return;
      {
        const old = store;
        store = emptyStore();
        store.deleted = old.deleted;
        for (const [s, p] of Object.entries(old.problems)) tombstone(s, p.attempts);
      }
      setTimer(null);
      save();
      render();
      break;
    case "file-create":
    case "file-open":
      connectFile(b.dataset.act === "file-create");
      break;
    case "file-reconnect":
      reconnectFile();
      break;
    case "file-disconnect":
      disconnectFile();
      break;
    case "download-file":
      download("progress.json", fileText(), "application/json");
      store.lastExport = Date.now();
      save();
      render();
      break;
  }
});

// ---------- progress file ----------
// Mirrors the store into a progress.json you pick (File System Access API: Chrome, Edge),
// so history survives clearing browser data and can be committed to git. The file
// holds only the raw log in a stable order — no derived scores — to keep diffs small.

const fileSync = { supported: "showOpenFilePicker" in window, handle: null, status: "off", name: "progress.json", lastWrite: null };

function fileText() {
  const problems = {};
  for (const slug of Object.keys(store.problems).sort()) {
    problems[slug] = { attempts: [...store.problems[slug].attempts].sort((a, b) => new Date(a.date) - new Date(b.date)) };
  }
  const data = { app: "neetcode-150-review", version: 1, settings: store.settings, problems, deleted: [...new Set(store.deleted)].sort() };
  return JSON.stringify(data, null, 2) + "\n";
}

function fileCard() {
  if (!fileSync.supported) {
    return `<p class="small muted" style="margin-top:0">This browser can't save to files directly (use Chrome or Edge for that).
      Download <strong>progress.json</strong> into this folder and commit it; use <em>Import .json</em> to load it back.</p>
      <button class="btn" data-act="download-file">Download progress.json</button>`;
  }
  const status = {
    on: `Saving to <strong>${esc(fileSync.name)}</strong>${fileSync.lastWrite ? ` · last saved ${fmtDate(fileSync.lastWrite).slice(11)}` : ""}. Commit it whenever you like.`,
    "needs-permission": `Connected to <strong>${esc(fileSync.name)}</strong>, but the browser needs your OK to keep writing to it.`,
    error: `Couldn't read <strong>${esc(fileSync.name)}</strong>; it was left untouched.`,
    off: "Not connected. Your history is only in this browser.",
  }[fileSync.status];
  return `<p class="small" style="margin-top:0">${status}</p>
    <div class="toolbar">
      ${fileSync.status === "needs-permission" ? `<button class="btn primary" data-act="file-reconnect">Reconnect</button>` : ""}
      ${fileSync.status === "off" ? `<button class="btn primary" data-act="file-create">Create progress.json</button>` : ""}
      <button class="btn" data-act="file-open">${fileSync.status === "off" ? "Open existing…" : "Switch file…"}</button>
      ${fileSync.handle ? `<button class="btn text" data-act="file-disconnect">Disconnect</button>` : ""}
    </div>
    <p class="small muted">Put the file in your repo and commit it. Connecting merges the file with this browser's history, so nothing is lost either way.</p>`;
}

// Tiny IndexedDB key-value store: file handles can't go in localStorage.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("nc150", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction("kv").objectStore("kv").get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    value === undefined ? tx.objectStore("kv").delete(key) : tx.objectStore("kv").put(value, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function connectFile(create) {
  const types = [{ description: "Progress file", accept: { "application/json": [".json"] } }];
  try {
    const handle = create
      ? await showSaveFilePicker({ suggestedName: "progress.json", types })
      : (await showOpenFilePicker({ types }))[0];
    await idbSet("file", handle).catch(() => {});
    await attachFile(handle);
  } catch (e) {
    if (e.name !== "AbortError") { console.error(e); toast("Couldn't open that file"); }
  }
}

// Read the file, merge it with local history, then write the merged result back.
async function attachFile(handle) {
  fileSync.handle = handle;
  fileSync.name = handle.name;
  let text;
  try {
    text = await (await handle.getFile()).text();
    if (text.trim()) {
      const json = JSON.parse(text);
      if (typeof json.problems !== "object") throw new Error("not a progress file");
      importData(json);
    }
  } catch (e) {
    // Never overwrite a file we couldn't understand.
    console.error(e);
    fileSync.status = "error";
    render();
    return;
  }
  fileSync.status = "on";
  save();
  render();
}

async function reconnectFile() {
  try {
    if ((await fileSync.handle.requestPermission({ mode: "readwrite" })) === "granted") await attachFile(fileSync.handle);
  } catch (e) {
    console.error(e);
    toast("Couldn't reconnect. Try Open existing…");
  }
}

async function disconnectFile() {
  clearTimeout(fileWriteTimer);
  Object.assign(fileSync, { handle: null, status: "off", name: "progress.json", lastWrite: null });
  await idbSet("file", undefined).catch(() => {});
  render();
}

let fileWriteTimer;
function scheduleFileWrite() {
  if (fileSync.status !== "on") return;
  clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(writeFile, 400);
}

async function writeFile() {
  try {
    const w = await fileSync.handle.createWritable();
    await w.write(fileText());
    await w.close();
    fileSync.lastWrite = Date.now();
    if (activeTab === "summary") render();
  } catch (e) {
    console.error(e);
    fileSync.status = "needs-permission";
    render();
  }
}

// On startup: reattach the remembered file (silently if permission persists), or, when
// served over http (e.g. GitHub Pages), merge in the committed progress.json read-only.
async function restoreFile() {
  if (fileSync.supported) {
    const handle = await idbGet("file").catch(() => null);
    if (handle) {
      fileSync.handle = handle;
      fileSync.name = handle.name;
      if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return attachFile(handle);
      fileSync.status = "needs-permission";
      return render();
    }
  }
  if (location.protocol.startsWith("http")) {
    try {
      const r = await fetch("progress.json", { cache: "no-store" });
      if (r.ok && importData(await r.json())) render();
    } catch {}
  }
}

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = importData(JSON.parse(await file.text()));
    toast(`Imported ${n} new solve${n === 1 ? "" : "s"}`);
    render();
  } catch (err) {
    toast("That file couldn't be read as a backup");
  }
  e.target.value = "";
});

render();
restoreFile();
