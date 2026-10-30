# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A no-build, no-dependency static web app for spaced-repetition review of the NeetCode 150. The user marks problems completed, logs each redo (minutes + solved?), and the app picks what to review next and estimates an "understanding" score per problem. Open `index.html` directly in a browser (`file://`); there is no server, bundler, or package.json.

## Commands

- Run tests: `node test.js` (plain `assert`, no framework; tests `problems.js` and `srs.js` only). There's no per-test runner — comment out or isolate an `assert` block to run one check.
- Syntax-check the UI: `node --check app.js`
- Visual check without clicking: headless Chrome, e.g.
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=out.png --window-size=1000,800 --virtual-time-budget=3000 file://$PWD/index.html`
  (headless enforces a ~500px minimum width, so phone-width screenshots look clipped when they aren't). To render with demo data, inject `mockups/seed.js` before `problems.js` in a copy of the page.
- Regenerate mockups: `node mockups/build.js` — but see the mockups caveat below.

## Architecture

Three classic `<script>` files loaded in order by `index.html`, sharing globals (no modules, so it works from `file://`):

1. **`problems.js`** — `NEETCODE_150` (topic → `[slug, title, difficulty]`, NeetCode roadmap order) and the flat `PROBLEMS[slug]` lookup. Slugs double as LeetCode URL paths and as storage keys.
2. **`srs.js`** — pure scheduling model, no DOM; guarded `module.exports` makes it testable in Node.
3. **`app.js`** — all UI, storage and file sync.

### The model (srs.js)

- Each attempt is graded `clean` / `slow` / `failed`: unsolved = failed; solved but over `settings.slowMinutes[difficulty]` = slow.
- Per problem, a **stability** S (days) evolves by replaying attempts; recall decays as `R = 0.9^(days/S)`. R *is* the understanding score, a problem is due when R ≤ 0.9, and the queue sorts by `priority()` (1 − R plus a small boost for a recent struggle).
- Clean-review growth is scaled by how much had been forgotten, so reviewing early earns less.
- Starting stability is scaled by difficulty (`DIFFICULTY_STABILITY`: Easy 1, Medium 0.75, Hard 0.5), so harder problems decay faster and come due sooner.
- Decay slows as the rotation grows (`rotationStretch`: √(size/10), minimum 1). Size is derived from each problem's first-attempt time (`rotationStarts`), so reads use today's size and replay judges each review by the size on its date. Logging a new problem therefore shifts every score and due date slightly, and deleting a problem's history can change other problems' intervals.
- `sessionPool` limits a session to due problems, falling back to the whole rotation only when nothing is due. `pickSession` then takes at most one problem per topic before repeating a topic.

### Key invariant: only the raw attempt log is stored

Storage holds `problems[slug].attempts = [{date, minutes, solved, note?}]`. Grades, stability, scores and due dates are **always recomputed** (`analyze()`), which is why changing thresholds in Settings regrades all history. Don't persist derived values.

### Persistence (app.js)

- **localStorage** key `nc150-tracker-v1` is the working copy.
- **`progress.json`** (committed to git by the user) is the durable copy. It's written via the File System Access API (Chrome/Edge only); the file handle is kept in IndexedDB (`nc150` db, `kv` store), so a reload needs at most a "Reconnect" click. `save()` writes localStorage, then debounces a file write. Safari/Firefox fall back to download/import.
- `fileText()` output is deterministic (sorted slugs, attempts oldest-first, no derived fields) so git diffs stay minimal. Keep it that way.
- **Merging** (`importData`) = union of attempts (deduped by slug + timestamp) minus the union of tombstones in `store.deleted` (`"slug@isoDate"`). Any deletion path must call `tombstone()` first or merges will resurrect data. `attachFile` never writes back a file it failed to parse.
- When served over http(s) (e.g. GitHub Pages) with no file handle, startup merges in `fetch("progress.json")` read-only.
- Exports: JSON backup (`exportPayload`, includes derived scores, re-importable) and a Markdown "AI report" (`aiReport`) meant to be pasted into an LLM.

### Rendering

String-template `innerHTML` per tab, re-rendered wholesale on every change; one delegated `click` handler dispatches on `data-act`. Escape all user text (notes, file names) with `esc()`.

### Styling

Google Workspace-style Material 3 (the Gmail/Drive look), inline in `index.html`: app bar with a pill search, a left sidebar holding a "compose"-style FAB (`data-act="fab-review"`) and pill nav with badges (`#due-badge`, `#done-badge`, set in `render()`), and content on a white rounded `main` panel. Below 760px the sidebar becomes a horizontal scrolling row.

- **Colors:** the `--gm-*` palette maps onto the app tokens (`--bg`, `--accent`, `--good`/`--ok`/`--bad`, …), and component rules reference only the app tokens. A new scheme means swapping the two `:root` blocks (light + `prefers-color-scheme: dark`).
- **Buttons:** variants by class: `.primary` (filled), `.tonal`, `.text`, default (outlined). List containers use `.card.flat` (white with a hairline border).
- **Icons:** inline SVG, never an icon font, so the app works offline.
- **Search:** the app-bar search (`#q`) is the only search box. Typing switches to the Problems tab (`showTab`) and filters it.

## Mockups caveat

`mockups/` holds alternative-theme previews (`themes/*.css` layered over a copy of `index.html`, with `seed.js` replacing `localStorage` by an in-memory shim so demos never touch real data). The generated HTML was built from the *pre-Material-3* `index.html`; rerunning `build.js` now layers themes over M3 styles and produces hybrids.
