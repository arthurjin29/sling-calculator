# Simple Mode — 2D Elevation Front-End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coordinator-friendly "Simple mode" that lets a non-engineer sketch a lift on a 2D elevation (a few on-graph inputs) and get a ballpark "use ~X m slings at ~Y°, leg load ≈ Z t" estimate, with a one-click handoff into the existing 3D calculator.

**Architecture:** A new pure-math module (`calc-simple.js`) reuses `calc-core.js` (no math duplicated). A standalone SVG module (`sketch2d.js`) renders the elevation and handles hybrid drag/type input. `simple-app.js` wires inputs ↔ sketch ↔ results and owns the handoff. A top-level Simple/Advanced toggle in `app.js` gates which UI shows; Advanced (Three.js, all 6 configs) is untouched. Simple mode uses no Three.js.

**Tech Stack:** Vanilla ES-module-free JS (IIFE modules like the existing code), inline SVG, Node `vm`-based test harness (`node test-simple.js`).

**Coordinate mapping (used throughout):** the elevation plane is the world **X–Z** plane with depth **Y = 0**. "From left" → `x`, "from bottom" → `z`. Reuses calc-core convention X=East, Y=North, Z=Up.

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `js/calc-simple.js` | Create | Pure math: `computeSimpleDirect`, `computeSimpleSpreader`, `buildAdvancedModel`. Reuses `CalcCore`. Exposed as global `CalcSimple` (+ `window.CalcSimple`). |
| `test-simple.js` | Create | Node `vm` harness for Simple-mode math. Runs independently of `test-calc.js`. |
| `js/sketch2d.js` | Create | SVG elevation renderer + hybrid drag/type interaction. Exposes a pure `layoutElevation()` (testable) + DOM `Sketch2D.mount/update`. |
| `js/simple-app.js` | Create | Owns `simpleState`; wires inputs ↔ sketch ↔ results; builds results panel; runs the handoff. |
| `index.html` | Modify | Add Simple/Advanced mode toggle + Simple-mode markup (input chips container, SVG host, results panel, "Continue in 3D" control). |
| `js/app.js` | Modify | Add mode toggle wiring; Simple default; expose `applyAdvancedModel()` so the handoff can prefill 3D inputs. |

---

## Task 1: CalcSimple — 4-Leg Direct math + test harness

**Files:**
- Create: `js/calc-simple.js`
- Create: `test-simple.js`

- [ ] **Step 1: Create the test harness `test-simple.js` with the first failing test**

```js
/**
 * Automated test suite for Simple mode math (calc-simple.js).
 * Run: node test-simple.js   — independent of test-calc.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const window = {};
const ctx = vm.createContext({ window, Math, Infinity, console, Array });
function loadFile(name) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', name), 'utf-8'), ctx);
}
loadFile('calc-core.js');
loadFile('calc-simple.js');
const CalcSimple = vm.runInContext('CalcSimple', ctx);

let total = 0, pass = 0;
const failures = [];
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; } else { failures.push(`${name}: ${detail}`); }
}
function near(a, b, tol = 0.01) { return Math.abs(a - b) <= tol; }

// --- Test A: symmetric pick ---
const A = {
  config: 'direct', weight: 10, loadW: 4, loadH: 2,
  cogLeft: 2, cogBottom: 1,
  lp1Left: 0.5, lp1Bottom: 2,
  lp2FromLp1: 3, lp2Bottom: 2,
  headroom: 3
};
const rA = CalcSimple.computeSimpleDirect(A);
check('A hook.x plumb over COG', near(rA.hook.x, 2), `hook.x=${rA.hook.x}`);
check('A hook.z = loadH+headroom', near(rA.hook.z, 5), `hook.z=${rA.hook.z}`);
check('A leg1 length', near(rA.slings[0].length, 3.354), `L1=${rA.slings[0].length}`);
check('A leg1 angle', near(rA.slings[0].angleDegFromHoriz, 63.43, 0.05), `ang1=${rA.slings[0].angleDegFromHoriz}`);
check('A symmetric tensions', near(rA.slings[0].tension, rA.slings[1].tension), `${rA.slings[0].tension} vs ${rA.slings[1].tension}`);
check('A leg1 tension', near(rA.slings[0].tension, 5.59, 0.02), `T1=${rA.slings[0].tension}`);
check('A no cogOutsideSpan', rA.warnings.cogOutsideSpan === false, `${rA.warnings.cogOutsideSpan}`);
check('A no angleBelowFloor', rA.warnings.angleBelowFloor === false, `${rA.warnings.angleBelowFloor}`);

console.log(`\nSimple-mode tests: ${pass}/${total} passed`);
if (failures.length) { failures.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test-simple.js`
Expected: FAIL — `Cannot read properties of undefined` / `CalcSimple is not defined` (module not created yet).

- [ ] **Step 3: Create `js/calc-simple.js` with `computeSimpleDirect`**

```js
/**
 * Simple Mode — 2D elevation estimate math.
 * Elevation plane = world X-Z, depth Y = 0. Reuses CalcCore for tension + sling geometry.
 */
const CalcSimple = (() => {
  const ANGLE_FLOOR_DEG = 30;   // hard floor (matches Advanced)
  const ANGLE_AMBER_DEG = 45;   // amber below this

  /** Map Simple-mode inputs to world points. Hook hangs plumb above COG. */
  function toPoints(s) {
    const cog = { x: s.cogLeft, y: 0, z: s.cogBottom };
    const lp1 = { x: s.lp1Left, y: 0, z: s.lp1Bottom };
    const lp2 = { x: s.lp1Left + s.lp2FromLp1, y: 0, z: s.lp2Bottom };
    const hook = { x: cog.x, y: 0, z: s.loadH + s.headroom };
    return { cog, lp1, lp2, hook };
  }

  function computeSimpleDirect(s) {
    const { cog, lp1, lp2, hook } = toPoints(s);

    const sling1 = CalcCore.buildSling(1, { ...lp1, label: 'LP1' }, { ...hook, label: 'Hook' });
    const sling2 = CalcCore.buildSling(2, { ...lp2, label: 'LP2' }, { ...hook, label: 'Hook' });

    const tensions = CalcCore.calcTwoSlingTension(lp1, lp2, hook, s.weight);
    sling1.tension = CalcCore.round2(tensions[0]);
    sling2.tension = CalcCore.round2(tensions[1]);

    const minX = Math.min(lp1.x, lp2.x), maxX = Math.max(lp1.x, lp2.x);
    const minAngle = Math.min(sling1.angleDegFromHoriz, sling2.angleDegFromHoriz);

    return {
      config: 'direct',
      hook, cog, lp1, lp2,
      slings: [sling1, sling2],
      minAngle: CalcCore.round2(minAngle),
      warnings: {
        cogOutsideSpan: cog.x < minX - 1e-6 || cog.x > maxX + 1e-6,
        angleBelowFloor: minAngle < ANGLE_FLOOR_DEG,
        angleAmber: minAngle >= ANGLE_FLOOR_DEG && minAngle < ANGLE_AMBER_DEG,
        degenerate: Math.abs(lp2.x - lp1.x) < 1e-6 || s.headroom <= 0 || s.weight <= 0
      }
    };
  }

  return { computeSimpleDirect, toPoints, ANGLE_FLOOR_DEG, ANGLE_AMBER_DEG };
})();
if (typeof window !== 'undefined') window.CalcSimple = CalcSimple;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test-simple.js`
Expected: `Simple-mode tests: 8/8 passed`

- [ ] **Step 5: Confirm the 103 existing tests still pass**

Run: `node test-calc.js`
Expected: existing summary unchanged (all pass) — `calc-simple.js` is not loaded by it.

- [ ] **Step 6: Commit**

```bash
git add js/calc-simple.js test-simple.js
git commit -m "feat: Simple-mode 4-leg direct estimate math + test harness"
```

---

## Task 2: CalcSimple — asymmetric COG + edge-case tests

**Files:**
- Modify: `test-simple.js` (append before the summary print)
- Modify: `js/calc-simple.js` (only if a test fails)

- [ ] **Step 1: Add failing tests for asymmetry + warnings (insert before the `console.log` summary line)**

```js
// --- Test B: asymmetric COG (closer to LP2 → LP2 carries more) ---
const B = { ...A, cogLeft: 2.5 };
const rB = CalcSimple.computeSimpleDirect(B);
check('B leg2 tension > leg1', rB.slings[1].tension > rB.slings[0].tension,
  `${rB.slings[0].tension} vs ${rB.slings[1].tension}`);
check('B leg1 tension', near(rB.slings[0].tension, 4.01, 0.03), `T1=${rB.slings[0].tension}`);
check('B leg2 tension', near(rB.slings[1].tension, 7.03, 0.03), `T2=${rB.slings[1].tension}`);
check('B leg1 angle', near(rB.slings[0].angleDegFromHoriz, 56.31, 0.05), `ang1=${rB.slings[0].angleDegFromHoriz}`);
check('B leg2 angle', near(rB.slings[1].angleDegFromHoriz, 71.57, 0.05), `ang2=${rB.slings[1].angleDegFromHoriz}`);

// --- Test C: COG outside the pick-point span ---
const C = { ...A, cogLeft: 4.0 };
const rC = CalcSimple.computeSimpleDirect(C);
check('C cogOutsideSpan true', rC.warnings.cogOutsideSpan === true, `${rC.warnings.cogOutsideSpan}`);

// --- Test D: angle below 30° floor (tiny headroom) ---
const D = { ...A, headroom: 0.2 };
const rD = CalcSimple.computeSimpleDirect(D);
check('D angleBelowFloor true', rD.warnings.angleBelowFloor === true, `minAngle=${rD.minAngle}`);
```

- [ ] **Step 2: Run to verify (they should PASS against the Task 1 implementation)**

Run: `node test-simple.js`
Expected: `Simple-mode tests: 13/13 passed`. If any fail, fix `computeSimpleDirect` in `calc-simple.js` so the hand-derived values match, then re-run.

- [ ] **Step 3: Commit**

```bash
git add test-simple.js js/calc-simple.js
git commit -m "test: Simple-mode asymmetric COG + COG-outside-span + angle-floor cases"
```

---

## Task 3: CalcSimple — handoff `buildAdvancedModel`

**Files:**
- Modify: `js/calc-simple.js`
- Modify: `test-simple.js`

- [ ] **Step 1: Add a failing handoff test (insert before summary print)**

```js
// --- Test E: handoff mirrors 2 LPs → symmetric 4-LP model across depth ---
const E = CalcSimple.buildAdvancedModel(A, 2);
check('E 4 lifting points', E.liftingPoints.length === 4, `n=${E.liftingPoints.length}`);
check('E LP front+x', near(E.liftingPoints[0].x, 0.5) && near(E.liftingPoints[0].y, 2) && near(E.liftingPoints[0].z, 2),
  JSON.stringify(E.liftingPoints[0]));
check('E LP2 front', near(E.liftingPoints[1].x, 3.5) && near(E.liftingPoints[1].y, 2) && near(E.liftingPoints[1].z, 2),
  JSON.stringify(E.liftingPoints[1]));
check('E LP back -y', near(E.liftingPoints[2].y, -2) && near(E.liftingPoints[3].y, -2),
  `${E.liftingPoints[2].y}, ${E.liftingPoints[3].y}`);
check('E COG centred in depth', near(E.cog.x, 2) && near(E.cog.y, 0) && near(E.cog.z, 1), JSON.stringify(E.cog));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test-simple.js`
Expected: FAIL — `buildAdvancedModel is not a function`.

- [ ] **Step 3: Implement `buildAdvancedModel` (add inside the IIFE, before `return`)**

```js
  /**
   * Map Simple-mode state to a symmetric 4-lift-point 3D model.
   * Elevation = side view; each LP is mirrored ± depthOffset along Y. COG centred (y=0).
   */
  function buildAdvancedModel(s, depthOffset) {
    const d = Math.abs(depthOffset) || 0;
    const lp1x = s.lp1Left, lp2x = s.lp1Left + s.lp2FromLp1;
    return {
      config: 'direct',
      liftingPoints: [
        { x: lp1x, y: d,  z: s.lp1Bottom },
        { x: lp2x, y: d,  z: s.lp2Bottom },
        { x: lp1x, y: -d, z: s.lp1Bottom },
        { x: lp2x, y: -d, z: s.lp2Bottom }
      ],
      cog: { x: s.cogLeft, y: 0, z: s.cogBottom },
      totalLoad: s.weight
    };
  }
```

Then add `buildAdvancedModel` to the returned object: `return { computeSimpleDirect, computeSimpleSpreader, buildAdvancedModel, toPoints, ANGLE_FLOOR_DEG, ANGLE_AMBER_DEG };`
(Leave `computeSimpleSpreader` out of the return until Task 4 if it isn't defined yet — add it to the return in Task 4.)

- [ ] **Step 4: Run to verify it passes**

Run: `node test-simple.js`
Expected: `Simple-mode tests: 18/18 passed`

- [ ] **Step 5: Commit**

```bash
git add js/calc-simple.js test-simple.js
git commit -m "feat: Simple-mode 3D handoff — mirror 2 LPs to symmetric 4-LP model"
```

---

## Task 4: CalcSimple — Spreader Beam variant

**Model (estimate):** beam centred above COG, length `beamLength`; ends at `x = cogLeft ± beamLength/2`. Top slings (length `topSlingLength`) run hook→each beam end symmetrically, so hook sits `sqrt(topSlingLength² − (beamLength/2)²)` above the beam. Hook height fixed by headroom (`hook.z = loadH + headroom`), so `beamZ = hook.z − that`. Bottom slings run each beam end → its LP. Bottom-leg tensions use the COG load split (as in direct); top-sling tension ≈ each beam-end vertical load / sin(top angle).

**Files:**
- Modify: `js/calc-simple.js`
- Modify: `test-simple.js`

- [ ] **Step 1: Add a failing spreader test (insert before summary print)**

```js
// --- Test F: spreader beam — symmetric, top slings clear the beam half-span ---
const F = { ...A, config: 'spreader-beam', beamLength: 2, topSlingLength: 2 };
const rF = CalcSimple.computeSimpleSpreader(F);
// top half-span = 1.0, topSling = 2.0 → hook above beam = sqrt(4-1)=1.732
check('F hook.z = loadH+headroom', near(rF.hook.z, 5), `hook.z=${rF.hook.z}`);
check('F beamZ', near(rF.beam.z, 5 - 1.732, 0.01), `beamZ=${rF.beam.z}`);
check('F beam ends span', near(rF.beam.endB.x - rF.beam.endA.x, 2), `span=${rF.beam.endB.x - rF.beam.endA.x}`);
check('F has 2 top + 2 bottom slings', rF.topSlings.length === 2 && rF.bottomSlings.length === 2,
  `${rF.topSlings.length}/${rF.bottomSlings.length}`);
check('F top sling length', near(rF.topSlings[0].length, 2, 0.001), `Lt=${rF.topSlings[0].length}`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test-simple.js`
Expected: FAIL — `computeSimpleSpreader is not a function`.

- [ ] **Step 3: Implement `computeSimpleSpreader` (add inside IIFE; add to return object)**

```js
  function computeSimpleSpreader(s) {
    const { cog, lp1, lp2, hook } = toPoints(s);
    const half = s.beamLength / 2;
    const topRise = Math.sqrt(Math.max(s.topSlingLength * s.topSlingLength - half * half, 0));
    const beamZ = hook.z - topRise;
    const endA = { x: cog.x - half, y: 0, z: beamZ, label: 'BeamA' };
    const endB = { x: cog.x + half, y: 0, z: beamZ, label: 'BeamB' };

    const topA = CalcCore.buildSling(1, { ...endA }, { ...hook, label: 'Hook' });
    const topB = CalcCore.buildSling(2, { ...endB }, { ...hook, label: 'Hook' });
    const botA = CalcCore.buildSling(3, { ...lp1, label: 'LP1' }, { ...endA });
    const botB = CalcCore.buildSling(4, { ...lp2, label: 'LP2' }, { ...endB });

    // COG load split → vertical load per LP, then convert to bottom-sling tension.
    const arm1 = Math.abs(lp1.x - cog.x), arm2 = Math.abs(lp2.x - cog.x);
    const totalArm = arm1 + arm2 || 1;
    const v1 = s.weight * arm2 / totalArm, v2 = s.weight * arm1 / totalArm;
    const botSin1 = botA.verticalDist / (botA.length || 1);
    const botSin2 = botB.verticalDist / (botB.length || 1);
    botA.tension = CalcCore.round2(v1 / (botSin1 || 1));
    botB.tension = CalcCore.round2(v2 / (botSin2 || 1));
    // Top slings: each carries its beam-end vertical load (= the bottom-leg vertical load it supports).
    const topSin = topA.verticalDist / (topA.length || 1);
    topA.tension = CalcCore.round2(v1 / (topSin || 1));
    topB.tension = CalcCore.round2(v2 / (topSin || 1));

    const minAngle = Math.min(topA.angleDegFromHoriz, topB.angleDegFromHoriz,
                              botA.angleDegFromHoriz, botB.angleDegFromHoriz);
    return {
      config: 'spreader-beam',
      hook, cog, lp1, lp2,
      beam: { endA, endB, z: beamZ },
      topSlings: [topA, topB],
      bottomSlings: [botA, botB],
      slings: [topA, topB, botA, botB],
      minAngle: CalcCore.round2(minAngle),
      warnings: {
        cogOutsideSpan: cog.x < Math.min(lp1.x, lp2.x) - 1e-6 || cog.x > Math.max(lp1.x, lp2.x) + 1e-6,
        angleBelowFloor: minAngle < ANGLE_FLOOR_DEG,
        angleAmber: minAngle >= ANGLE_FLOOR_DEG && minAngle < ANGLE_AMBER_DEG,
        topSlingTooShort: s.topSlingLength <= half,
        degenerate: Math.abs(lp2.x - lp1.x) < 1e-6 || s.headroom <= 0 || s.weight <= 0
      }
    };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node test-simple.js`
Expected: `Simple-mode tests: 23/23 passed`

- [ ] **Step 5: Commit**

```bash
git add js/calc-simple.js test-simple.js
git commit -m "feat: Simple-mode spreader-beam estimate (top + bottom slings)"
```

---

## Task 5: sketch2d — pure layout mapping (testable)

The SVG renderer needs a pure function mapping world metres → SVG pixel coords (Y-down). Isolate it so it's unit-testable without a DOM.

**Files:**
- Create: `js/sketch2d.js`
- Modify: `test-simple.js`

- [ ] **Step 1: Add a failing layout test (insert before summary print)**

```js
// --- Test G: layout maps world X-Z (Z-up) to SVG pixels (Y-down) with margin ---
const Sketch2D = vm.runInContext('(loadFile("sketch2d.js"), Sketch2D)', ctx);
const lay = Sketch2D.layoutElevation(
  { minX: 0, maxX: 4, minZ: 0, maxZ: 5 },
  { width: 400, height: 300, margin: 20 }
);
const p = lay.toScreen(0, 0);     // world bottom-left
check('G bottom-left x at margin', near(p.x, 20, 0.5), `x=${p.x}`);
check('G bottom-left y near bottom', p.y > 250, `y=${p.y}`);
const top = lay.toScreen(0, 5);   // world top → smaller screen y
check('G higher Z → smaller screen y', top.y < p.y, `${top.y} < ${p.y}`);
```

Add `loadFile` reuse: ensure `loadFile('sketch2d.js')` works (it's in `js/`). Simpler: at top of `test-simple.js` add `loadFile('sketch2d.js'); const Sketch2D = vm.runInContext('Sketch2D', ctx);` and replace the inline `vm.runInContext('(loadFile...)')` above with direct use of `Sketch2D`.

- [ ] **Step 2: Run to verify it fails**

Run: `node test-simple.js`
Expected: FAIL — `Sketch2D is not defined`.

- [ ] **Step 3: Create `js/sketch2d.js` with the pure layout fn**

```js
/**
 * Sketch2D — SVG elevation renderer + hybrid drag/type for Simple mode.
 * layoutElevation() is pure (no DOM) and unit-tested.
 */
const Sketch2D = (() => {
  /** Build a world→screen mapper that fits bounds into a viewbox with margin, Z-up→Y-down. */
  function layoutElevation(bounds, view) {
    const w = view.width, h = view.height, m = view.margin;
    const worldW = (bounds.maxX - bounds.minX) || 1;
    const worldH = (bounds.maxZ - bounds.minZ) || 1;
    const scale = Math.min((w - 2 * m) / worldW, (h - 2 * m) / worldH);
    function toScreen(x, z) {
      return {
        x: m + (x - bounds.minX) * scale,
        y: h - m - (z - bounds.minZ) * scale
      };
    }
    function toWorld(px, pz) {
      return {
        x: bounds.minX + (px - m) / scale,
        z: bounds.minZ + (h - m - pz) / scale
      };
    }
    return { scale, toScreen, toWorld };
  }

  return { layoutElevation };
})();
if (typeof window !== 'undefined') window.Sketch2D = Sketch2D;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node test-simple.js`
Expected: `Simple-mode tests: 26/26 passed`

- [ ] **Step 5: Commit**

```bash
git add js/sketch2d.js test-simple.js
git commit -m "feat: Sketch2D pure world→screen layout mapping for elevation"
```

---

## Task 6: sketch2d — SVG render + hybrid drag/type (DOM)

DOM interaction; verified manually in the browser. Add the rendering + interaction layer to `Sketch2D`.

**Files:**
- Modify: `js/sketch2d.js`

- [ ] **Step 1: Add `mount` / `update` rendering to `Sketch2D` (inside the IIFE; add to return)**

```js
  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  let host, svg, onChange, current;

  /** mount(hostEl, changeCb) — changeCb({key, worldDelta}) fires on drag. */
  function mount(hostEl, changeCb) {
    host = hostEl; onChange = changeCb;
    svg = el('svg', { viewBox: '0 0 460 340', class: 'sketch-svg' });
    host.innerHTML = '';
    host.appendChild(svg);
  }

  /** update(result) — redraw from a computeSimpleDirect/Spreader result. */
  function update(result) {
    current = result;
    const xs = [result.lp1.x, result.lp2.x, result.hook.x, result.cog.x];
    const zs = [result.lp1.z, result.lp2.z, result.hook.z, result.cog.z, 0];
    const bounds = { minX: Math.min(...xs) - 0.5, maxX: Math.max(...xs) + 0.5,
                     minZ: Math.min(...zs), maxZ: Math.max(...zs) + 0.3 };
    const lay = layoutElevation(bounds, { width: 460, height: 340, margin: 30 });
    svg.innerHTML = '';
    const H = lay.toScreen(result.hook.x, result.hook.z);
    const P1 = lay.toScreen(result.lp1.x, result.lp1.z);
    const P2 = lay.toScreen(result.lp2.x, result.lp2.z);
    const G = lay.toScreen(result.cog.x, result.cog.z);
    // slings
    svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: P1.x, y2: P1.y, class: 'sk-sling' }));
    svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: P2.x, y2: P2.y, class: 'sk-sling' }));
    // plumb line hook→cog
    svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: G.x, y2: G.y, class: 'sk-plumb' }));
    // draggable handles
    addHandle(P1, 'lp1', 'LP1'); addHandle(P2, 'lp2', 'LP2'); addHandle(G, 'cog', 'COG');
    // hook marker
    svg.appendChild(el('circle', { cx: H.x, cy: H.y, r: 6, class: 'sk-hook' }));

    function addHandle(pt, key, label) {
      const c = el('circle', { cx: pt.x, cy: pt.y, r: 8, class: 'sk-handle', 'data-key': key });
      c.style.cursor = 'grab';
      c.addEventListener('pointerdown', (e) => startDrag(e, key, lay));
      svg.appendChild(c);
      const t = el('text', { x: pt.x, y: pt.y - 12, class: 'sk-label' }); t.textContent = label;
      svg.appendChild(t);
    }
  }

  function startDrag(e, key, lay) {
    e.preventDefault();
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * 460;
      const py = (ev.clientY - rect.top) / rect.height * 340;
      const w = lay.toWorld(px, py);
      onChange({ key, world: w });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
```

Add to return: `return { layoutElevation, mount, update };`

- [ ] **Step 2: Add minimal SVG CSS to `css/` (append to the main stylesheet)**

```css
.sketch-svg { width: 100%; max-width: 520px; background: #0f1420; border-radius: 8px; }
.sk-sling { stroke: #7fb0ff; stroke-width: 3; }
.sk-plumb { stroke: #444c5e; stroke-width: 1; stroke-dasharray: 4 4; }
.sk-handle { fill: #ff9d4d; stroke: #fff; stroke-width: 1.5; }
.sk-hook { fill: none; stroke: #ffd24d; stroke-width: 3; }
.sk-label { fill: #c6cddb; font-size: 11px; text-anchor: middle; }
```

(Find the loaded stylesheet via `<link rel="stylesheet">` in `index.html` and append there.)

- [ ] **Step 3: Run the existing tests to confirm nothing broke**

Run: `node test-simple.js && node test-calc.js`
Expected: 26/26 Simple + existing suite green (DOM code isn't exercised by Node).

- [ ] **Step 4: Commit**

```bash
git add js/sketch2d.js css/
git commit -m "feat: Sketch2D SVG elevation render + draggable handles"
```

---

## Task 7: index.html — Simple/Advanced toggle + Simple markup

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

- [ ] **Step 1: Add a mode toggle + Simple-mode container near the top of the body (above the existing toolbar/form)**

```html
<div class="mode-toggle">
  <button id="mode-simple" class="btn btn-small btn-primary">Simple</button>
  <button id="mode-advanced" class="btn btn-small">Advanced (3D)</button>
</div>

<section id="simple-mode">
  <div class="simple-inputs">
    <label>Weight <input type="number" id="sm-weight" step="any" value="10"> t</label>
    <label>Load W <input type="number" id="sm-loadw" step="any" value="4"> m</label>
    <label>Load H <input type="number" id="sm-loadh" step="any" value="2"> m</label>
    <label>COG ← <input type="number" id="sm-cogleft" step="any" value="2"> m</label>
    <label>COG ↑ <input type="number" id="sm-cogbottom" step="any" value="1"> m</label>
    <label>LP1 ← <input type="number" id="sm-lp1left" step="any" value="0.5"> m</label>
    <label>LP1 ↑ <input type="number" id="sm-lp1bottom" step="any" value="2"> m</label>
    <label>LP2 from LP1 <input type="number" id="sm-lp2from" step="any" value="3"> m</label>
    <label>LP2 ↑ <input type="number" id="sm-lp2bottom" step="any" value="2"> m</label>
    <label>Headroom <input type="number" id="sm-headroom" step="any" value="3"> m</label>
  </div>
  <div id="sm-sketch"></div>
  <div id="sm-results" class="simple-results"></div>
  <div class="simple-handoff">
    <label>Depth offset <input type="number" id="sm-depth" step="any" value="2"> m</label>
    <button id="sm-continue-3d" class="btn">Continue in 3D calculator →</button>
  </div>
</section>
```

- [ ] **Step 2: Add the module script tags (after the existing calc-*.js includes, before app.js)**

```html
<script src="js/calc-simple.js"></script>
<script src="js/sketch2d.js"></script>
<script src="js/simple-app.js"></script>
```

- [ ] **Step 3: Wire the toggle in `js/app.js` (inside the `DOMContentLoaded` callback)**

```js
const simpleSection = document.getElementById('simple-mode');
const advancedSection = document.getElementById('calc-form'); // existing form/root
function setMode(mode) {
  const simple = mode === 'simple';
  simpleSection.style.display = simple ? '' : 'none';
  advancedSection.style.display = simple ? 'none' : '';
  document.getElementById('results').style.display = simple ? 'none' : '';
  document.getElementById('mode-simple').classList.toggle('btn-primary', simple);
  document.getElementById('mode-advanced').classList.toggle('btn-primary', !simple);
}
document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
document.getElementById('mode-advanced').addEventListener('click', () => setMode('advanced'));
setMode('simple'); // Simple is the default front door
```

(If `#results` or the form root id differs, use the actual top-level container that wraps the Advanced UI — verify by reading `index.html` around the existing `calc-form`.)

- [ ] **Step 4: Manual verify in browser**

Run: `python -m http.server 8765` from project root, open `http://localhost:8765`.
Expected: Simple mode shows first with the input grid + an empty sketch host; "Advanced (3D)" button swaps to the existing tool unchanged.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: Simple/Advanced mode toggle, Simple-mode markup (Simple default)"
```

---

## Task 8: simple-app — wire inputs ↔ sketch ↔ results

**Files:**
- Create: `js/simple-app.js`

- [ ] **Step 1: Create `js/simple-app.js`**

```js
/** Simple mode controller: reads inputs, computes, renders sketch + results, runs handoff. */
document.addEventListener('DOMContentLoaded', () => {
  const ids = ['weight','loadw','loadh','cogleft','cogbottom','lp1left','lp1bottom','lp2from','lp2bottom','headroom'];
  const $ = (id) => document.getElementById('sm-' + id);
  const sketchHost = document.getElementById('sm-sketch');
  const resultsEl = document.getElementById('sm-results');
  if (!sketchHost) return; // Simple markup not present

  function readState() {
    return {
      config: 'direct',
      weight: +$('weight').value, loadW: +$('loadw').value, loadH: +$('loadh').value,
      cogLeft: +$('cogleft').value, cogBottom: +$('cogbottom').value,
      lp1Left: +$('lp1left').value, lp1Bottom: +$('lp1bottom').value,
      lp2FromLp1: +$('lp2from').value, lp2Bottom: +$('lp2bottom').value,
      headroom: +$('headroom').value
    };
  }

  function recompute() {
    const s = readState();
    const r = CalcSimple.computeSimpleDirect(s);
    Sketch2D.update(r);
    renderResults(r);
    return r;
  }

  function onSketchChange({ key, world }) {
    if (key === 'cog') { $('cogleft').value = round1(world.x); $('cogbottom').value = round1(world.z); }
    else if (key === 'lp1') { $('lp1left').value = round1(world.x); $('lp1bottom').value = round1(world.z); }
    else if (key === 'lp2') {
      $('lp2from').value = round1(world.x - (+$('lp1left').value)); $('lp2bottom').value = round1(world.z);
    }
    recompute();
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  Sketch2D.mount(sketchHost, onSketchChange);
  ids.forEach(id => $(id).addEventListener('input', recompute));
  recompute();

  function renderResults(r) {
    const cls = r.warnings.angleBelowFloor ? 'sm-bad' : r.warnings.angleAmber ? 'sm-amber' : 'sm-ok';
    const maxT = Math.max(r.slings[0].tension, r.slings[1].tension);
    const headline = r.warnings.angleBelowFloor
      ? `⚠ Angle ${r.minAngle}° is below the 30° minimum — increase headroom or move pick points in.`
      : `Use slings ≈ ${Math.max(r.slings[0].length, r.slings[1].length).toFixed(1)} m · choose ≥ ${maxT.toFixed(1)} t WLL at this angle`;
    const cogWarn = r.warnings.cogOutsideSpan
      ? `<div class="sm-bad">⚠ COG is outside the pick points — the load will swing.</div>` : '';
    resultsEl.innerHTML = `
      <div class="${cls}">${headline}</div>
      ${cogWarn}
      <table class="sm-legs">
        <tr><th>Leg</th><th>Length</th><th>Angle</th><th>Tension</th></tr>
        <tr><td>LP1</td><td>${r.slings[0].length.toFixed(2)} m</td><td>${r.slings[0].angleDegFromHoriz}°</td><td>${r.slings[0].tension} t</td></tr>
        <tr><td>LP2</td><td>${r.slings[1].length.toFixed(2)} m</td><td>${r.slings[1].angleDegFromHoriz}°</td><td>${r.slings[1].tension} t</td></tr>
      </table>`;
  }

  // expose for the handoff task
  window.SimpleApp = { readState, recompute };
});
```

- [ ] **Step 2: Add results CSS (append to stylesheet)**

```css
.sm-ok { color: #7fe3a8; } .sm-amber { color: #ffd24d; } .sm-bad { color: #ff7b7b; }
.sm-legs { width: 100%; margin-top: 10px; border-collapse: collapse; }
.sm-legs th, .sm-legs td { border: 1px solid #2a3447; padding: 4px 8px; font-size: 13px; }
```

- [ ] **Step 3: Manual verify**

Run: `python -m http.server 8765`, open the page in Simple mode.
Expected: editing any number redraws the elevation and updates the result line + per-leg table; dragging LP1/LP2/COG handles updates the matching inputs and recomputes live. Set headroom very small → red below-30° warning. Move COG past a pick point → swing warning.

- [ ] **Step 4: Commit**

```bash
git add js/simple-app.js css/
git commit -m "feat: Simple-mode controller — live inputs, drag, results panel"
```

---

## Task 9: Handoff UI — Continue in 3D

**Files:**
- Modify: `js/app.js` (expose `applyAdvancedModel`)
- Modify: `js/simple-app.js` (wire the button)

- [ ] **Step 1: In `js/app.js`, expose a function that writes a model into the Advanced inputs and switches mode**

```js
window.SlingApp = window.SlingApp || {};
window.SlingApp.applyAdvancedModel = function (model) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  const lp = model.liftingPoints;
  for (let i = 0; i < 4; i++) {
    set(`lp${i+1}-x`, round(lp[i].x)); set(`lp${i+1}-y`, round(lp[i].y)); set(`lp${i+1}-z`, round(lp[i].z));
  }
  set('cog-x', round(model.cog.x)); set('cog-y', round(model.cog.y)); set('cog-z', round(model.cog.z));
  set('total-load', round(model.totalLoad));
  if (configSelect) { configSelect.value = model.config; configSelect.dispatchEvent(new Event('change')); }
  setMode('advanced');
  function round(v) { return Math.round(v * 1000) / 1000; }
};
```

(Field ids `lp1-x … lp4-z`, `cog-x/y/z`, `total-load`, and `config-select` are the existing Advanced inputs — confirmed in `index.html`.)

- [ ] **Step 2: In `js/simple-app.js`, wire the Continue button (inside the DOMContentLoaded block)**

```js
const continueBtn = document.getElementById('sm-continue-3d');
if (continueBtn) continueBtn.addEventListener('click', () => {
  const s = readState();
  const depth = +document.getElementById('sm-depth').value || 2;
  const model = CalcSimple.buildAdvancedModel(s, depth);
  window.SlingApp.applyAdvancedModel(model);
});
```

- [ ] **Step 3: Manual verify the handoff**

Run: `python -m http.server 8765`. In Simple mode set distinct values, set depth offset = 2, click "Continue in 3D calculator →".
Expected: switches to Advanced mode; LP1..LP4 are the mirrored ± depth pairs, COG centred (y=0), load carried over; the 3D scene renders the 4-leg model; changing depth offset before clicking changes the Y values.

- [ ] **Step 4: Commit**

```bash
git add js/app.js js/simple-app.js
git commit -m "feat: Simple→3D handoff — prefill Advanced inputs + switch mode"
```

---

## Task 10: Spreader-beam in Simple UI + final verification

**Files:**
- Modify: `index.html`, `js/simple-app.js`, `js/sketch2d.js`

- [ ] **Step 1: Add a Simple-mode config switch + spreader-only inputs to `index.html` (inside `#simple-mode`, above `.simple-inputs`)**

```html
<label>Configuration
  <select id="sm-config"><option value="direct">4-Leg Direct</option><option value="spreader-beam">Spreader Beam</option></select>
</label>
<div id="sm-spreader-inputs" style="display:none">
  <label>Beam length <input type="number" id="sm-beamlen" step="any" value="2"> m</label>
  <label>Top sling length <input type="number" id="sm-toplen" step="any" value="2"> m</label>
</div>
```

- [ ] **Step 2: Extend `readState`/`recompute` in `js/simple-app.js` to branch on config**

```js
// in readState(): add config + spreader fields
const cfg = document.getElementById('sm-config').value;
// ...return { ...existing, config: cfg, beamLength: +bl, topSlingLength: +tl }
// in recompute(): choose calc + (for spreader) render top+bottom legs
const r = s.config === 'spreader-beam' ? CalcSimple.computeSimpleSpreader(s) : CalcSimple.computeSimpleDirect(s);
// show/hide #sm-spreader-inputs on config change; renderResults handles r.slings generically
```

Update `renderResults` to iterate `r.slings` (works for 2 or 4 legs) instead of hard-coding two rows, and add a `Sketch2D.update` branch that draws the beam + top/bottom slings when `r.beam` is present (draw `endA/endB`, lines hook→ends and ends→LPs).

- [ ] **Step 2b: Extend `Sketch2D.update` to draw the beam when `result.beam` exists**

```js
if (result.beam) {
  const A = lay.toScreen(result.beam.endA.x, result.beam.endA.z);
  const B = lay.toScreen(result.beam.endB.x, result.beam.endB.z);
  svg.appendChild(el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'sk-beam' }));
  result.topSlings.forEach(() => {}); // top/bottom lines drawn from endpoints below
}
```

Add `.sk-beam { stroke:#5b6b85; stroke-width:5; }` to CSS. Draw top slings hook→endA/endB and bottom slings endA→LP1 / endB→LP2 using the same `el('line', …)` pattern.

- [ ] **Step 3: Manual verify spreader in Simple mode**

Run: `python -m http.server 8765`. Switch config to Spreader Beam.
Expected: beam-length + top-sling inputs appear; elevation shows the beam, 2 top slings to the hook, 2 bottom slings to the LPs; results table lists 4 legs; "Continue in 3D" carries `config = spreader-beam` into Advanced.

- [ ] **Step 4: Full regression — both suites green**

Run: `node test-simple.js && node test-calc.js`
Expected: `Simple-mode tests: 26/26 passed` AND the original 103 tests still pass.

- [ ] **Step 5: Update the spec status + commit**

Edit `docs/superpowers/specs/2026-06-03-simple-mode-2d-elevation-design.md` status line to `Implemented`.

```bash
git add index.html js/simple-app.js js/sketch2d.js css/ docs/superpowers/specs/2026-06-03-simple-mode-2d-elevation-design.md
git commit -m "feat: spreader-beam in Simple mode + finalize Simple-mode front-end"
```

---

## Self-review notes (coverage vs spec)

- **2D elevation, fewer inputs, not drawing-snap** → Tasks 1, 7, 8 (the input grid + SVG). ✓
- **Scope = 4-Leg Direct + Spreader Beam** → Tasks 1–4 (math), 8 (direct UI), 10 (spreader UI). ✓
- **On-graph hybrid drag + type** → Task 6 (drag handles) + Task 8 (inputs ↔ sketch two-way). ✓
- **Hook plumb above COG, COG drives load share** → Task 1 `toPoints` + `calcTwoSlingTension`; verified in Tests A/B. ✓
- **Handoff: mirror to symmetric 4-point, editable depth offset** → Task 3 (math, Test E) + Task 9 (UI + `#sm-depth`). ✓
- **Plain-language + per-leg table + 30/45° thresholds** → Task 8 `renderResults`. ✓
- **Edge cases (COG outside span, angle floor, degenerate)** → Task 1 warnings + Tests C/D; surfaced in Task 8. ✓
- **103 existing tests stay green** → verified in Steps 1.5, 6.3, 10.4; Simple tests isolated in `test-simple.js`. ✓
- **Advanced 3D untouched** → only additive edits to `app.js` (toggle + `applyAdvancedModel`); no change to calc-*.js or scene.js. ✓
