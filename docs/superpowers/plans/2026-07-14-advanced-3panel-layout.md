# Advanced-Mode 3-Panel App-Shell Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restructure Advanced (3D) mode into a viewport-filling 3-panel app-shell — inputs left, 3D diagram right, detailed results across the bottom — with no page scroll and internal panel scrolling.

**Architecture:** Wrap the four existing Advanced blocks (toolbar, `#calc-form`, a new `#diagram-panel` holding `#scene-container`, `#results`) in one `#advanced-layout` div. A CSS grid, scoped to `body.mode-advanced` at widths ≥ 1001px on screen, arranges them; everywhere else (narrow, print, Simple mode) they fall back to today's stacked flow. `setMode` toggles the `mode-advanced` body class and fires a resize so the 3D canvas fits its panel.

**Tech Stack:** Vanilla HTML/CSS/JS, Three.js (unchanged). No build step, no new deps.

## Global Constraints

- Advanced mode only. Simple mode, all calc logic, warning text, and the printed report must be unchanged.
- Layout is CSS/DOM/one small JS hook — NO calculation code changes. `node test-calc.js` (157) and `node test-simple.js` (33) must stay green as the regression gate.
- All existing element IDs preserved (`#calc-form`, `#results`, `#scene-container`, `#calc-warnings`, `.toolbar`, `#scene-container`) so `scene.js`, calculate wiring, and print rules keep working.
- Shell styling is gated on `@media screen and (min-width: 1001px)` AND `body.mode-advanced`. Below 1001px, in print, or in Simple mode → normal stacked flow (current behavior).
- These tasks have NO unit tests (pure layout); verification is browser-visual on a fresh port + the calc suite staying green. State exactly what was observed.

---

### Task 1: DOM restructure — wrap Advanced blocks, move 3D into its own panel

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `#advanced-layout` wrapper containing (in order) `.toolbar`, `#calc-form`, `#diagram-panel` (new, holds `#scene-container`), `#results` (with the 3D card removed). This DOM order is also the ≤1000px/print stacked order: toolbar → inputs → 3D → results.

This task changes only structure. With no CSS grid yet, the page renders as a normal stack and everything (calc, 3D, print) keeps working — a safe, independently-verifiable checkpoint.

- [ ] **Step 1: Open the `<!-- TOOLBAR -->` wrapper**

In `index.html`, immediately BEFORE the `<!-- TOOLBAR -->` comment (currently line ~73), insert the opening wrapper:

```html
    <!-- ADVANCED-MODE APP-SHELL -->
    <div id="advanced-layout">
```

- [ ] **Step 2: Move the 3D card out of `#results` into a new `#diagram-panel`**

The 3D card currently lives at the END of `#results`:

```html
      <!-- 3D VISUALIZATION (hidden in print) -->
      <div class="card no-print">
        <h2>3D View</h2>
        <div id="scene-container"></div>
      </div>
    </section>
```

Remove that 3D card block from inside `#results` so `#results` now ends directly after the 2D-diagrams card:

```html
    </section>
```

Then, immediately BEFORE the `<!-- RESULTS -->` comment / `<section id="results">` (so the stacked order is toolbar → inputs → 3D → results), insert the diagram panel:

```html
    <!-- 3D DIAGRAM PANEL (hidden in print) -->
    <div id="diagram-panel" class="no-print">
      <div class="card">
        <h2>3D View</h2>
        <div id="scene-container"></div>
      </div>
    </div>

```

- [ ] **Step 3: Close the wrapper after `#results`**

After the `</section>` that closes `#results` (currently line ~583) and BEFORE the `.container`-closing `</div>`, insert the wrapper close:

```html
    </div>
    <!-- /advanced-layout -->
```

- [ ] **Step 4: Verify structure is well-formed and the app still works (stacked)**

Run: `python -m http.server 8801 --bind 127.0.0.1` (fresh port), open `http://127.0.0.1:8801/`, switch to Advanced.
Expected (no CSS grid yet, so it's a normal vertical stack): page loads, **console has 0 errors**, Calculate populates results, the **3D view renders** (now sitting above the results in the stack), and Print/PDF still shows the stacked report with 2D diagrams. Confirm `document.getElementById('advanced-layout')`, `document.getElementById('diagram-panel')`, and `document.getElementById('scene-container')` all exist and `#scene-container` is inside `#diagram-panel`. Kill the server by PID (`netstat -ano | grep :8801` → `taskkill //PID <pid> //F`).

- [ ] **Step 5: Confirm the calc suite is unaffected + commit**

Run: `node test-calc.js` → 157 pass; `node test-simple.js` → 33 pass.

```bash
git add index.html
git commit -m "refactor(ui): wrap Advanced blocks in #advanced-layout, move 3D to #diagram-panel"
```

---

### Task 2: App-shell grid CSS

**Files:**
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `#advanced-layout`, `#diagram-panel`, `#calc-form`, `#results`, `.toolbar`, `#scene-container`, `#calc-warnings` (Task 1 DOM), and `body.mode-advanced` (added by Task 3 — the class won't exist until Task 3, so on-screen verification of the grid requires Task 3; this task is verified by reading the CSS and by temporarily adding the class in devtools).

- [ ] **Step 1: Add the app-shell grid block**

Append to `css/style.css` (after the existing `/* 3D Scene */` block, before `/* Print styles */`):

```css
/* Advanced-mode 3-panel app-shell (screen, wide, advanced only) */
@media screen and (min-width: 1001px) {
  body.mode-advanced .container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: none;
    padding: 0.75rem 1rem;
    box-sizing: border-box;
    overflow: hidden;               /* no page scroll — panels scroll internally */
  }
  body.mode-advanced #advanced-layout {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(340px, 400px) 1fr;
    grid-template-rows: auto minmax(0, 1fr) minmax(0, 40vh);
    grid-template-areas:
      "toolbar toolbar"
      "inputs  diagram"
      "results results";
    gap: 1rem;
  }
  body.mode-advanced #advanced-layout > .toolbar { grid-area: toolbar; }
  body.mode-advanced #calc-form   { grid-area: inputs;  overflow: auto; min-height: 0; margin: 0; }
  body.mode-advanced #diagram-panel { grid-area: diagram; min-height: 0; display: flex; }
  body.mode-advanced #diagram-panel > .card { flex: 1; display: flex; flex-direction: column; margin: 0; min-height: 0; }
  body.mode-advanced #diagram-panel #scene-container { flex: 1; height: auto; min-height: 0; }
  body.mode-advanced #results { grid-area: results; overflow: auto; min-height: 0; position: relative; }
  /* Sticky safety warnings at the top of the results panel */
  body.mode-advanced #results #calc-warnings {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--bg, #fff);
    padding-bottom: 0.5rem;
  }
}
```

- [ ] **Step 2: Verify the CSS via devtools override**

Run a fresh server (`python -m http.server 8802 --bind 127.0.0.1`), open Advanced, and in the console run `document.body.classList.add('mode-advanced')` then Calculate.
Expected at desktop width (≥1001px): 3 panels fill the viewport, **no page scroll**; toolbar spans the top; inputs (left) and results (bottom) scroll internally; the 3D fills the right panel; warnings pin to the top of the results panel while it scrolls. Resize the window narrower than 1001px → collapses to the stacked column. Kill the server by PID.

(The `body.mode-advanced` class is added permanently by Task 3; this manual toggle just proves the CSS ahead of the JS.)

- [ ] **Step 3: Confirm print + narrow are untouched + commit**

Still on the server: at ≤1000px width and in Print preview, confirm the layout is the current stacked flow (print shows summary + tables + 2D diagrams, no 3D). `node test-calc.js` → 157. Then:

```bash
git add css/style.css
git commit -m "feat(ui): app-shell grid for Advanced mode (screen, >=1001px, advanced only)"
```

---

### Task 3: `setMode` integration + 3D resize on entering Advanced

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `#advanced-layout` (Task 1), the `body.mode-advanced` grid (Task 2).
- Produces: `body.mode-advanced` class toggled with the mode; the 3D canvas resized to its panel when Advanced becomes visible.

- [ ] **Step 1: Grab the wrapper element**

In `js/app.js`, near the other mode elements (after `const toolbarEl = document.querySelector('.toolbar');`, ~line 23), add:

```javascript
  const advancedLayout = document.getElementById('advanced-layout');
```

- [ ] **Step 2: Toggle the shell class + wrapper visibility + resize in `setMode`**

Replace the current `setMode` body:

```javascript
  function setMode(mode) {
    const simple = mode === 'simple';
    if (simpleSection) simpleSection.style.display = simple ? '' : 'none';
    if (toolbarEl) toolbarEl.style.display = simple ? 'none' : '';
    form.style.display = simple ? 'none' : '';
    resultsSection.style.display = simple ? 'none' : '';
    if (modeSimpleBtn) modeSimpleBtn.classList.toggle('btn-primary', simple);
    if (modeAdvancedBtn) modeAdvancedBtn.classList.toggle('btn-primary', !simple);
  }
```

with:

```javascript
  function setMode(mode) {
    const simple = mode === 'simple';
    if (simpleSection) simpleSection.style.display = simple ? '' : 'none';
    if (advancedLayout) advancedLayout.style.display = simple ? 'none' : '';
    if (toolbarEl) toolbarEl.style.display = simple ? 'none' : '';
    form.style.display = simple ? 'none' : '';
    resultsSection.style.display = simple ? 'none' : '';
    document.body.classList.toggle('mode-advanced', !simple);
    if (modeSimpleBtn) modeSimpleBtn.classList.toggle('btn-primary', simple);
    if (modeAdvancedBtn) modeAdvancedBtn.classList.toggle('btn-primary', !simple);
    if (!simple) {
      // The 3D canvas has zero size while the shell is hidden; once it becomes
      // visible, let the scene re-read its container and resize. Safe no-op if
      // the scene hasn't initialised yet (no 'resize' listener registered).
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }
```

Note: keeping the individual `toolbarEl`/`form`/`resultsSection` display toggles is intentional — `resultsSection` still relies on its `display` for calc-gating (`#results { display:none }` until a calculation runs), and the others are harmless redundancy that keeps the stacked/narrow fallback behaving exactly as before.

- [ ] **Step 3: Verify the full app-shell end-to-end (fresh port)**

Run `python -m http.server 8803 --bind 127.0.0.1`, open `http://127.0.0.1:8803/`.
Expected:
- Load → Simple mode (default), normal page, no `mode-advanced` on body.
- Click **Advanced (3D)** → 3-panel app-shell fills the viewport at desktop width; `document.body.classList.contains('mode-advanced')` is true.
- Calculate → results + tables fill the bottom panel; warnings pin to its top and stay visible while scrolling results; 3D fills the right panel.
- Resize the window → 3D **resizes** to the panel (no distortion); below 1001px it collapses to the stacked column.
- Switch Simple ↔ Advanced repeatedly → 3D renders at the correct size each time it re-enters Advanced (resize fires).
- Print/PDF → stacked report, 2D diagrams, no 3D.
- Console: **0 errors** throughout.
Capture a screenshot at desktop width. Kill the server by PID.

- [ ] **Step 4: Regression + commit**

Run: `node test-calc.js` → 157; `node test-simple.js` → 33.

```bash
git add js/app.js
git commit -m "feat(ui): setMode toggles app-shell class + resizes 3D on entering Advanced"
```

---

### Task 4: Final visual verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Full regression**

Run: `node test-calc.js` (157) and `node test-simple.js` (33) — both green.

- [ ] **Step 2: Cross-check the acceptance criteria on a fresh port**

Serve on a not-yet-used port. Walk every point in the spec §7 checklist: desktop 3-panel fills viewport / internal scroll / 3D fills+resizes / warnings sticky / narrow collapses / print stacked report / console clean. Test at least two configs (e.g. Direct and Double Cascade) to confirm the 3D and results populate for different result shapes. Screenshot desktop + narrow. Kill the server by PID (never blanket-kill python).

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch. Deploy remains gated on `/eng-review` (calc) + CPEng; a layout change doesn't alter that gate but the visual verification above is required before the public URL.

---

## Self-Review

**Spec coverage:** §2 layout grid → Task 2. §3 DOM wrapper + move 3D → Task 1. §4 screen-only/wide-only/print/responsive/simple-untouched → Task 2 media-query scope + Task 3 class toggle; mode-switch resize → Task 3. Warnings sticky → Task 2. §5 files: index.html (T1), css/style.css (T2), js/app.js (T3), scene.js unchanged. §7 verification → Tasks 2–4. No gaps.

**Placeholder scan:** none — exact HTML/CSS/JS blocks, exact ports, exact expected observations.

**Consistency:** `#advanced-layout`, `#diagram-panel`, `body.mode-advanced`, `#calc-warnings` used identically across tasks. DOM order in Task 1 (toolbar → inputs → diagram → results) matches the grid-areas in Task 2 and the stacked-fallback order in the spec. Task 2's grid is inert until Task 3 adds `body.mode-advanced` — Task 2's verification accounts for this by toggling the class manually in devtools.

**Note on testing:** these are layout tasks with no unit tests; the calc suite (157+33) is the regression gate and each task states the exact browser observations that constitute verification.
