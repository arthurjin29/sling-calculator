# Cascade Per-Lay Angle + COG Re-Centring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Double Spreader (Cascading) config user-specified rigging angles per lay (middle + top), and re-centre the Main Beam on the COG so the COG is covered by the spreader.

**Architecture:** Three sequential changes, all inside the cascade config. (1) Re-centre the Main Beam on the COG in `calc-double-cas.js` and add an out-of-group warning. (2) Parametrise the existing beam-height solver with optional per-lay target angles (default = global min-angle). (3) Wire two optional angle inputs through the UI. Tests are added to the existing Node harness (`test-calc.js`) except the DOM wiring layer, which is verified live in the browser.

**Tech Stack:** Vanilla ES modules (browser), Node `vm`-based test harness (`node test-calc.js`), no build step. Local dev server: `python -m http.server 8765`.

## Global Constraints

- Changes are confined to the `double-cascade` config. The other 5 configs and Simple mode must be untouched — their test expectations stay frozen.
- Per-lay angle inputs are **optional**; blank = current behaviour (global 30° min-angle floor). Blank path must produce unchanged output.
- Angle inputs, when provided, must be in `[30, 90)`. Below 30 or ≥ 90 → validation error.
- Per-lay angle semantics are **governing** (minimum): the beam is raised until the shallowest sling in the lay reaches the target; steeper slings stay steeper.
- Angle unit spans in HTML must **not** use class `unit-label` — `app.js updateUnitLabels()` overwrites `.unit-label` text with "m"/"ft". Use a plain `<span>°</span>`.
- Run the full suite (`node test-calc.js`) after every task; it must end `RESULTS: <N> passed, 0 failed`.
- Implement one change at a time; if a task regresses the suite, stop and investigate before proceeding (geometry-work rule).

---

## File Structure

- `js/calc-double-cas.js` — cascade math. Modified in Task 1 (masterCenter + warning) and Task 2 (per-lay angles).
- `test-calc.js` — Node test harness. New custom assertion helpers + cases in Tasks 1 and 2.
- `index.html` — cascade input panel. Two new inputs in Task 3.
- `js/app.js` — config builder + validation. Reads new inputs in Task 3.

---

## Task 1: Re-centre Main Beam on COG + out-of-group warning

**Files:**
- Modify: `js/calc-double-cas.js:45` (masterCenter), `js/calc-double-cas.js:105-108` (add warning calc after masterEnds), `js/calc-double-cas.js:294-301` (warnings object)
- Test: `test-calc.js` (new helpers + cases near the cascade section, ~line 492)

**Interfaces:**
- Consumes: `CalcDoubleCas.calculate(shared, config)` — existing signature, unchanged.
- Produces: `result.warnings.masterEndOutsideGroup: boolean` — a new key on the existing warnings object. Later tasks and the UI may read it.

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` immediately after the cascade cases (after line 492, before `// === 7. ADDITIONAL EDGE CASES`):

```javascript
// === CASCADE: COG re-centring (top slings symmetric) ===
function runCascadeTopSymmetryTest(name, shared, config) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const top = r.tiers[2].slings; // tiers = [Bottom, Middle, Top]
  if (Math.abs(top[0].length - top[1].length) > 0.02)
    errs.push(`top slings unequal length: ${top[0].length} vs ${top[1].length}`);
  if (Math.abs(top[0].angleDegFromHoriz - top[1].angleDegFromHoriz) > 0.5)
    errs.push(`top slings unequal angle: ${top[0].angleDegFromHoriz} vs ${top[1].angleDegFromHoriz}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
runCascadeTopSymmetryTest('dbl-cas-cog-offset-top-symmetric',
  { liftingPoints: rectLPs(8, 4), cog: { x: 1.5, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });

// === CASCADE: out-of-group warning ===
function runCascadeWarningTest(name, shared, config, expected) {
  totalTests++;
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  if (r.warnings.masterEndOutsideGroup !== expected)
    failures.push({ name, errors: [`masterEndOutsideGroup=${r.warnings.masterEndOutsideGroup}, expected ${expected}`], shared, config });
  else passCount++;
}
runCascadeWarningTest('dbl-cas-end-outside-group-true',
  { liftingPoints: squareLPs(6), cog: { x: 3, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { masterLength: 3, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2,
    pairing: { groupA: [1, 4], groupB: [2, 3] } }, true);
runCascadeWarningTest('dbl-cas-end-outside-group-false',
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2,
    pairing: { groupA: [1, 4], groupB: [2, 3] } }, false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL. `dbl-cas-cog-offset-top-symmetric` fails with "top slings unequal…" (beam is still LP-centred, so the offset COG makes them lopsided). Both warning tests fail because `masterEndOutsideGroup` is `undefined` (key doesn't exist yet).

- [ ] **Step 3: Re-centre the Main Beam on the COG**

In `js/calc-double-cas.js`, replace line 45:

```javascript
    const masterCenter = C.midpoint(lpMidA, lpMidB);
```

with:

```javascript
    // Main beam centred on the COG so the load's COG is covered by the beam.
    // Beam axis (mUx, mUy) still comes from the LP-group midpoints below.
    const masterCenter = { x: cog.x, y: cog.y };
```

(`lpMidA` / `lpMidB` on lines 43-44 are still needed for the axis on lines 47-49 — leave them.)

- [ ] **Step 4: Add the out-of-group warning calculation**

In `js/calc-double-cas.js`, immediately after the `masterEnds` object (currently ends at line 108), insert:

```javascript
    // Out-of-group check: does either master end project outside its LP group's
    // span along the beam axis? Signals the Main Beam is too short for this COG.
    const projOnAxis = (p) => (p.x - masterCenter.x) * mUx + (p.y - masterCenter.y) * mUy;
    const endOutsideGroup = (groupLPs, endXY) => {
      const projs = groupLPs.map(projOnAxis);
      const lo = Math.min(...projs), hi = Math.max(...projs);
      const e = projOnAxis(endXY);
      return e < lo - 0.01 || e > hi + 0.01;
    };
    const masterEndOutsideGroup =
      endOutsideGroup(groupALPs, masterEndAxy) || endOutsideGroup(groupBLPs, masterEndBxy);
```

- [ ] **Step 5: Expose the warning**

In `js/calc-double-cas.js`, in the `warnings` object (lines 294-301), add the new key. Change:

```javascript
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        bottomSlingBelowMin,
        liftBeamBendingNotChecked: false
      }
```

to:

```javascript
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        bottomSlingBelowMin,
        masterEndOutsideGroup,
        liftBeamBendingNotChecked: false
      }
```

- [ ] **Step 6: Run the full suite to verify green**

Run: `node test-calc.js`
Expected: PASS. `RESULTS: <N> passed, 0 failed`. The three new cases pass; all pre-existing cascade cases (invariant-based via `runTest`) still pass because re-centring keeps every invariant (finite values, positive lengths, load balance, bottom-sling min-angle) satisfied.

- [ ] **Step 7: Commit**

```bash
git add js/calc-double-cas.js test-calc.js
git commit -m "feat(cascade): centre Main Beam on COG + out-of-group warning"
```

---

## Task 2: Per-lay angle overrides (middle + top) — math

**Files:**
- Modify: `js/calc-double-cas.js:24-25` (read config + compute rads), `js/calc-double-cas.js:97` (middle iteration), `js/calc-double-cas.js:120` (hook height)
- Test: `test-calc.js` (new helpers + cases after the Task 1 cases)

**Interfaces:**
- Consumes: `config.middleAngleDeg?: number`, `config.topAngleDeg?: number` — optional (may be `undefined`). Provided by app.js in Task 3; passed directly in tests.
- Produces: no new result fields. Behaviour change only: when a per-lay angle is supplied, the governing (shallowest) sling of that lay lands at that angle.

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` after the Task 1 cascade cases:

```javascript
// === CASCADE: per-lay angle overrides ===
function runCascadeLayAngleTest(name, shared, config, tierIdx, targetAngle) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const slings = r.tiers[tierIdx].slings; // 1 = Middle, 2 = Top
  const govAngle = Math.min(...slings.map(s => s.angleDegFromHoriz));
  if (Math.abs(govAngle - targetAngle) > 1.0)
    errs.push(`governing angle ${govAngle.toFixed(2)} != target ${targetAngle}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}

// Middle lay driven to 60 deg (symmetric load -> all middle slings ~60)
runCascadeLayAngleTest('dbl-cas-middle-angle-60',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, middleAngleDeg: 60 },
  1, 60);

// Top lay driven to 50 deg
runCascadeLayAngleTest('dbl-cas-top-angle-50',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, topAngleDeg: 50 },
  2, 50);

// Larger middle angle -> longer middle slings than the blank baseline
function runCascadeMiddleLongerTest(name, shared, baseConfig, angleDeg) {
  totalTests++;
  const errs = [];
  let base, steep;
  try {
    base = CalcDoubleCas.calculate(shared, baseConfig);
    steep = CalcDoubleCas.calculate(shared, { ...baseConfig, middleAngleDeg: angleDeg });
  } catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const baseLen = base.tiers[1].slings[0].length;
  const steepLen = steep.tiers[1].slings[0].length;
  if (!(steepLen > baseLen + 0.05))
    errs.push(`middle sling not longer: base ${baseLen} vs ${angleDeg}deg ${steepLen}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config: baseConfig });
  else passCount++;
}
runCascadeMiddleLongerTest('dbl-cas-middle-angle-lengthens',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 }, 65);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL. `dbl-cas-middle-angle-60` and `dbl-cas-top-angle-50` report a governing angle near 45 (the global min), not the target — because `middleAngleDeg`/`topAngleDeg` are ignored. `dbl-cas-middle-angle-lengthens` fails because both runs are identical.

- [ ] **Step 3: Read and default the per-lay angles**

In `js/calc-double-cas.js`, extend the config destructure on line 24 and add the two rad values after `minAngleRad` (line 25). Change:

```javascript
    const { masterLength, slaveLengthA, slaveLengthB, bottomSlingLen } = config;
    const minAngleRad = C.degToRad(minAngleDeg);
```

to:

```javascript
    const { masterLength, slaveLengthA, slaveLengthB, bottomSlingLen } = config;
    const minAngleRad = C.degToRad(minAngleDeg);
    // Optional per-lay target angles (governing minimum). Blank -> global min-angle.
    const middleAngleRad = config.middleAngleDeg != null ? C.degToRad(config.middleAngleDeg) : minAngleRad;
    const topAngleRad = config.topAngleDeg != null ? C.degToRad(config.topAngleDeg) : minAngleRad;
```

- [ ] **Step 4: Drive the middle lay by its target angle**

In `js/calc-double-cas.js`, inside the master-height iteration, change line 97 from:

```javascript
          const requiredZ = slaveEnds[i].z + hd * Math.tan(minAngleRad);
```

to:

```javascript
          const requiredZ = slaveEnds[i].z + hd * Math.tan(middleAngleRad);
```

(The master-end seed on lines 64-71 stays on `minAngleRad`: it bounds the LP→master path so the bottom lay still honours the global min-angle. The iteration is what forces the middle governing angle.)

- [ ] **Step 5: Drive the top lay by its target angle**

In `js/calc-double-cas.js`, change the hook height on line 120 from:

```javascript
      z: masterZ + Math.max(hDistHA, hDistHB) * Math.tan(minAngleRad)
```

to:

```javascript
      z: masterZ + Math.max(hDistHA, hDistHB) * Math.tan(topAngleRad)
```

- [ ] **Step 6: Run the full suite to verify green**

Run: `node test-calc.js`
Expected: PASS. `RESULTS: <N> passed, 0 failed`. New angle cases pass; all pre-existing cascade cases still pass because they pass no `middleAngleDeg`/`topAngleDeg`, so both rads default to `minAngleRad` and the math is byte-identical to Task 1's output.

- [ ] **Step 7: Commit**

```bash
git add js/calc-double-cas.js test-calc.js
git commit -m "feat(cascade): per-lay rigging angle overrides (middle + top)"
```

---

## Task 3: Wire per-lay angle inputs through the UI

**Files:**
- Modify: `index.html:343` (add two inputs inside `panel-double-cascade`'s `config-inputs`)
- Modify: `js/app.js:628-634` (read + validate in the `double-cascade` case)

**Interfaces:**
- Consumes: `result.warnings.masterEndOutsideGroup` is available from Task 1 but wiring a UI warning banner is out of scope for this plan (result already carries it; existing warning rendering is unchanged).
- Produces: `config.middleAngleDeg` / `config.topAngleDeg` on the cascade config object (numbers, or omitted when blank) — the fields Task 2's math consumes.

- [ ] **Step 1: Add the two inputs to the cascade panel**

In `index.html`, inside `panel-double-cascade` → `config-inputs`, after the Bottom Sling Length `param-group` (closes at line 343), insert:

```html
          <div class="param-group">
            <label>Middle Lay Angle</label>
            <div><input type="number" id="dcas-middle-angle" step="any" min="30" max="89.9" placeholder="auto"> <span>&deg;</span></div>
          </div>
          <div class="param-group">
            <label>Top Lay Angle</label>
            <div><input type="number" id="dcas-top-angle" step="any" min="30" max="89.9" placeholder="auto"> <span>&deg;</span></div>
          </div>
```

Note: the `°` span deliberately has **no** `unit-label` class, so `updateUnitLabels()` won't overwrite it with "m".

- [ ] **Step 2: Read and validate the inputs in app.js**

In `js/app.js`, in the `case 'double-cascade':` block (lines 628-634), after the `data.bottomSlingLen` line (633) and before `break;`, insert:

```javascript
        const dcasMidAngle = parseFloat(document.getElementById('dcas-middle-angle').value);
        if (!isNaN(dcasMidAngle)) {
          if (dcasMidAngle < 30 || dcasMidAngle >= 90)
            throw new Error('Middle Lay Angle must be between 30° and 90°.');
          data.middleAngleDeg = dcasMidAngle;
        }
        const dcasTopAngle = parseFloat(document.getElementById('dcas-top-angle').value);
        if (!isNaN(dcasTopAngle)) {
          if (dcasTopAngle < 30 || dcasTopAngle >= 90)
            throw new Error('Top Lay Angle must be between 30° and 90°.');
          data.topAngleDeg = dcasTopAngle;
        }
```

(When a field is blank, `parseFloat('')` is `NaN`, so the key is omitted and the math defaults to the global min-angle — the required blank-path behaviour.)

- [ ] **Step 3: Confirm the automated suite is still green**

Run: `node test-calc.js`
Expected: PASS, `0 failed`. (This task adds no calc logic; the suite should be untouched. This step guards against an accidental edit to shared code.)

- [ ] **Step 4: Verify live in the browser**

Start the dev server:

```bash
cd /d/sling-length-calculator && python -m http.server 8765
```

Then in a browser at `http://localhost:8765`:
1. Select **Double Spreader (Cascading)**. Set Main Beam 6, both 2nd Lvl Beams 5, Bottom Sling 2. Leave both new angle fields **blank**. Click **Calculate**. Note the Middle Slings length/angle — this is the baseline (matches current behaviour).
2. Set **Middle Lay Angle = 60**, Calculate. Expected: every Middle sling angle ≥ 60° with the governing one at ~60°, and the Middle sling **length is longer** than the blank baseline (resolves the "should be 5 m or longer" report).
3. Set **Top Lay Angle = 50**, Calculate. Expected: the shallower Top sling reads ~50°.
4. With an off-centre COG, confirm the two Top slings now read **equal** angle/length (COG re-centring from Task 1) and the 3D/plan view shows the COG covered by the Main Beam.
5. Enter `20` in Middle Lay Angle, Calculate. Expected: inline error "Middle Lay Angle must be between 30° and 90°." (no result rendered).

Record what you observed (actual angles/lengths), not "should work".

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat(cascade): UI inputs for per-lay rigging angles"
```

---

## Self-Review

**Spec coverage:**
- Per-lay angle overrides (middle + top), angle-in/length-out, governing semantics, blank=auto → Task 2 (math) + Task 3 (UI). ✓
- COG re-centring, symmetric top slings, COG covered → Task 1. ✓
- Out-of-group warning → Task 1 (Steps 4-5). ✓
- Validation `[30,90)`, amber 30-44 → Task 3 Step 2 enforces the hard range. (Amber 30-44 reuses the existing warning surface driven by `topSlingAngleLow`/angle rendering; no new code needed since a governing angle of 30-44 flows through the existing per-sling angle display.) ✓
- Testing: middle governing, top governing, longer-sling, blank regression, top symmetry, out-of-group warning → covered across Tasks 1-2 plus the full-suite green gate. ✓
- Other configs frozen → Global Constraints + suite green gates. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact before/after. ✓

**Type consistency:** `config.middleAngleDeg` / `config.topAngleDeg` (Task 2 consumes, Task 3 produces) — names match. `result.warnings.masterEndOutsideGroup` (Task 1 produces) — single spelling throughout. `middleAngleRad`/`topAngleRad` used only within `calc-double-cas.js`. Tier indices: `tiers[1]` = Middle, `tiers[2]` = Top, consistent with the result object (`Bottom, Middle, Top`). ✓

**Note on the spec's "rebaseline" wording:** The spec anticipated rebaselining golden cascade numbers. In practice the harness asserts *invariants* (finite, positive, load-balanced, min-angle), not golden values, so re-centring needs no number rebaseline — the invariant gate in Task 1 Step 6 covers it. No separate rebaseline task required.
