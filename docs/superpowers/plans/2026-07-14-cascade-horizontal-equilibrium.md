> ⚠️ **SUPERSEDED (2026-07-16)** — implemented then retired. The fixed-length Main Beam
> (picks at the bar ends) replaced this pick-over-sub-COG plan; see
> `docs/superpowers/specs/2026-07-16-cascade-fixed-length-main-beam-design.md`. History only.

# Cascade Horizontal Equilibrium (Pick-Over-Sub-COG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Double Spreader (Cascading) config hang plumb over the COG by picking each beam over the COG of the load it carries, eliminating the sideways force at the hook (measured 25.8% of load) that causes the lean.

**Architecture:** Compute per-LP vertical share via a min-norm rigid-body reaction solve; place each Main-Beam sling pick point over its side's load-weighted sub-COG. The hook (over total COG) then lands collinear with the two picks, so the top slings' horizontal thrusts cancel. The Main Beam stays a fixed physical bar of `masterLength` with pick points sliding inboard. Only `calc-double-cas.js`, one new `calc-core.js` helper, `app.js` warning display, and `test-calc.js` change. All other configs untouched.

**Tech Stack:** Vanilla JS IIFE modules on `window`/`CalcCore`; Node test harness (`node test-calc.js`); Three.js scene (no structural change).

## Global Constraints

- Config affected: **Double Spreader (Cascading) only.** 2nd-Lvl (slave) beams keep their existing structure (ends = attach points, `computeBeamEndPair`, derived length). No other config changes.
- No new dependencies. Modules stay IIFE-on-`window`; `CalcCore` exports via its return object.
- `node test-calc.js` is the gate. All currently-passing tests (146) must still pass after every task; new tests are added, existing per-lay-angle and centred-COG tests must remain green.
- Coordinate system: X=East, Y=North, Z=Up. Sub-COGs and picks are plan (x,y) only; Z comes from the existing masterZ solve.
- Equilibrium claim is scoped: zero net **horizontal force at the hook** (the swing DOF). This is NOT a coupled node solver — intermediate thrust is carried by the rigid beams. Do not add per-member thrust reporting.
- Per-lay angle behaviour (`middleAngleDeg`/`topAngleDeg`, floored at global min) is retained exactly as-is.

---

### Task 1: `computeSupportReactions` in CalcCore

**Files:**
- Modify: `js/calc-core.js` (add function + export)
- Test: `test-calc.js` (add reaction unit tests)

**Interfaces:**
- Produces: `CalcCore.computeSupportReactions(points, cog, totalLoad) → number[]` — min-norm rigid-body vertical reactions. `Σreactions === totalLoad`; reaction-weighted centroid of `points` equals `cog`. May return negative entries when `cog` is near/outside the support hull.
- Consumes: existing `transposeNxM`, `matMxNMultiply`, `mat3x3Inverse`.

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` immediately after the `// ── Test harness ──` helpers are defined and the LP helpers exist (e.g. just before the `// === 1. DIRECT` block, so `CalcCore` and `rectLPs` are in scope):

```javascript
// === CalcCore.computeSupportReactions ===
function runReactionsTest(name, lps, cog, W, expect) {
  totalTests++;
  const errs = [];
  let R;
  try { R = CalcCore.computeSupportReactions(lps, cog, W); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const sum = R.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - W) > 1e-6) errs.push(`sum ${sum} != W ${W}`);
  let cx = 0, cy = 0;
  for (let i = 0; i < lps.length; i++) { cx += R[i] * lps[i].x; cy += R[i] * lps[i].y; }
  cx /= W; cy /= W;
  if (Math.abs(cx - cog.x) > 1e-6 || Math.abs(cy - cog.y) > 1e-6)
    errs.push(`centroid (${cx.toFixed(3)},${cy.toFixed(3)}) != cog (${cog.x},${cog.y})`);
  if (expect) for (let i = 0; i < expect.length; i++)
    if (Math.abs(R[i] - expect[i]) > 0.01) errs.push(`R[${i}]=${R[i].toFixed(3)} != ${expect[i]}`);
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
const _rectReac = [{ x: -4, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 2 }, { x: -4, y: 2 }];
runReactionsTest('reactions-centred', _rectReac, { x: 0, y: 0 }, 20, [5, 5, 5, 5]);
runReactionsTest('reactions-perp-offset', _rectReac, { x: 0, y: 1.5 }, 100, [6.25, 6.25, 43.75, 43.75]);
runReactionsTest('reactions-onaxis-offset', _rectReac, { x: 2, y: 0 }, 20, null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL — `computeSupportReactions` is not a function (EXCEPTION in the three `reactions-*` tests).

- [ ] **Step 3: Implement `computeSupportReactions`**

In `js/calc-core.js`, add this function inside the IIFE, immediately after `calcTwoSlingTension` (before `// --- Sling builder ---`):

```javascript
  /**
   * Minimum-norm rigid-body support reactions for a load on N support points.
   * Solves A·R = b with rows [1..], [x_i - cog.x], [y_i - cog.y] and
   * b = [totalLoad, 0, 0] (vertical equilibrium + moment balance about the COG).
   * Statically indeterminate for N>3 → min-norm solution R = Aᵀ(AAᵀ)⁻¹b.
   * By construction ΣR = totalLoad and the reaction-weighted centroid of the
   * points equals the COG. Entries may be negative when the COG is near or
   * outside the support hull (caller should guard).
   *
   * @param {Array<{x,y}>} points - support points (plan)
   * @param {{x,y}} cog - centre of gravity (plan)
   * @param {number} totalLoad - total vertical load
   * @returns {number[]} reaction per point
   */
  function computeSupportReactions(points, cog, totalLoad) {
    const N = points.length;
    const A = [[], [], []];
    for (let i = 0; i < N; i++) {
      A[0][i] = 1;
      A[1][i] = points[i].x - cog.x;
      A[2][i] = points[i].y - cog.y;
    }
    const b = [totalLoad, 0, 0];
    const AT = transposeNxM(A, 3, N);
    const AAT = matMxNMultiply(A, AT, 3, N, 3);
    const AATinv = mat3x3Inverse(AAT);
    if (!AATinv) return Array(N).fill(totalLoad / N);
    const y = [];
    for (let i = 0; i < 3; i++) {
      y[i] = AATinv[i][0] * b[0] + AATinv[i][1] * b[1] + AATinv[i][2] * b[2];
    }
    const R = [];
    for (let i = 0; i < N; i++) {
      R[i] = AT[i][0] * y[0] + AT[i][1] * y[1] + AT[i][2] * y[2];
    }
    return R;
  }
```

Then add `computeSupportReactions` to the returned object. Change:

```javascript
    calcLoadDistribution, calcTwoSlingTension,
```
to:
```javascript
    calcLoadDistribution, calcTwoSlingTension, computeSupportReactions,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: the three `reactions-*` tests PASS; total pass count = previous + 3; no regressions.

- [ ] **Step 5: Commit**

```bash
git add js/calc-core.js test-calc.js
git commit -m "feat(core): min-norm rigid-body support reactions"
```

---

### Task 2: Pick each beam over its sub-COG (core equilibrium fix)

**Files:**
- Modify: `js/calc-double-cas.js`
- Test: `test-calc.js`

**Interfaces:**
- Consumes: `CalcCore.computeSupportReactions` (Task 1); existing `groupAIdxs`/`groupBIdxs` (0-based LP indices already computed at the top of `calculate`), `liftingPoints`, `cog`, `totalLoad`.
- Produces: `result.intermediatePoints` now contains entries labelled `'Main Pick A'` / `'Main Pick B'` at the sub-COG plan positions; the two top slings satisfy horizontal balance at the hook.

This task replaces the Main-Beam centring block and renames the master-end variables to pick variables. The downstream Z-solve, slave placement, and tension cascade are unchanged in logic — they now operate on the pick points.

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` after the existing `runCascadeBeamOverLpsTest(...)` call (around the `// === CASCADE: per-lay angle overrides ===` divider). These assert the equilibrium property and pick placement:

```javascript
// === CASCADE: horizontal equilibrium (pick over sub-COG) ===
// Net horizontal force at the hook from the two top slings — the source of "lean".
function hookHorizForce(r) {
  const hook = r.hook;
  const top = r.tiers[2].slings; // tiers = [Bottom, Middle, Top]
  let fx = 0, fy = 0;
  for (const s of top) {
    const end = s.from; // beam pick; s.to = hook
    const dx = end.x - hook.x, dy = end.y - hook.y, dz = end.z - hook.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    fx += s.tension * dx / L;
    fy += s.tension * dy / L;
  }
  return Math.sqrt(fx * fx + fy * fy);
}
function runCascadeHookBalancedTest(name, shared, config, opts) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const F = hookHorizForce(r);
  const tol = 0.005 * shared.totalLoad; // 0.5% of load
  if (F > tol) errs.push(`hook horizontal force ${F.toFixed(4)} > tol ${tol.toFixed(4)}`);
  if (Math.abs(r.hook.x - shared.cog.x) > 0.01 || Math.abs(r.hook.y - shared.cog.y) > 0.01)
    errs.push(`hook (${r.hook.x},${r.hook.y}) not over COG`);
  const top = r.tiers[2].slings;
  if (opts && opts.topAsym === true && Math.abs(top[0].length - top[1].length) < 0.1)
    errs.push(`top slings should differ (offset COG): ${top[0].length} vs ${top[1].length}`);
  if (opts && opts.topAsym === false && Math.abs(top[0].length - top[1].length) > 0.02)
    errs.push(`top slings should be equal (symmetric): ${top[0].length} vs ${top[1].length}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
// Perpendicular (Y) offset — the lean case. Top slings equal by x-symmetry.
runCascadeHookBalancedTest('dbl-cas-perp-cog-hook-balanced',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 1.5, z: 0 }, minAngleDeg: 60, totalLoad: 100 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  { topAsym: false });
// On-axis (X) offset — balanced at hook AND asymmetric top slings.
runCascadeHookBalancedTest('dbl-cas-onaxis-cog-asym-top',
  { liftingPoints: rectLPs(8, 4), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  { topAsym: true });

// Picks sit over the reaction-weighted sub-COGs; hook plan == COG.
function runCascadePicksOverSubCogTest(name, shared, config) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const lps = shared.liftingPoints;
  const R = CalcCore.computeSupportReactions(lps, shared.cog, shared.totalLoad);
  const gA = config.pairing.groupA.map(v => v - 1), gB = config.pairing.groupB.map(v => v - 1);
  const sc = (idxs) => { let w = 0, sx = 0, sy = 0; idxs.forEach(i => { w += R[i]; sx += R[i] * lps[i].x; sy += R[i] * lps[i].y; }); return { x: sx / w, y: sy / w }; };
  const scA = sc(gA), scB = sc(gB);
  const pA = r.intermediatePoints.find(p => p.label === 'Main Pick A');
  const pB = r.intermediatePoints.find(p => p.label === 'Main Pick B');
  if (!pA || !pB) { failures.push({ name, errors: ['Main Pick A/B missing from intermediatePoints'] }); return; }
  if (Math.abs(pA.x - scA.x) > 1e-3 || Math.abs(pA.y - scA.y) > 1e-3) errs.push(`pickA (${pA.x},${pA.y}) != subCogA (${scA.x.toFixed(3)},${scA.y.toFixed(3)})`);
  if (Math.abs(pB.x - scB.x) > 1e-3 || Math.abs(pB.y - scB.y) > 1e-3) errs.push(`pickB (${pB.x},${pB.y}) != subCogB (${scB.x.toFixed(3)},${scB.y.toFixed(3)})`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
runCascadePicksOverSubCogTest('dbl-cas-picks-over-subcog',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 1.5, z: 0 }, minAngleDeg: 60, totalLoad: 100 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: `dbl-cas-perp-cog-hook-balanced` FAILS (current geometry: hook horizontal ≈ 25.8, ≫ tol 0.5) and `dbl-cas-picks-over-subcog` FAILS (no `'Main Pick A'` label yet). `dbl-cas-onaxis-cog-asym-top` may already pass (on-axis balances) — that's fine.

- [ ] **Step 3: Replace the Main-Beam centring block with sub-COG picks**

In `js/calc-double-cas.js`, replace this block (the `// ── 2. Master beam — centered above load midpoint ──` section):

```javascript
    // ── 2. Master beam — centered above load midpoint ──
    const hookXY = { x: cog.x, y: cog.y };
    const lpMidA = C.midpoint(groupALPs[0], groupALPs[1]);
    const lpMidB = C.midpoint(groupBLPs[0], groupBLPs[1]);
    // Main beam centred over the load's lifting points (midpoint of the two
    // LP-group midpoints), NOT the COG — keeps each 2nd-level beam over its LP
    // pair so the rig hangs plumb. The hook stays over the COG (below), so when
    // the COG is offset the two top slings come out at different lengths.
    const masterCenter = C.midpoint(lpMidA, lpMidB);

    const mAxisX = lpMidB.x - lpMidA.x;
    const mAxisY = lpMidB.y - lpMidA.y;
    const mAxisLen = Math.sqrt(mAxisX * mAxisX + mAxisY * mAxisY) || 1;
    const mUx = mAxisX / mAxisLen;
    const mUy = mAxisY / mAxisLen;

    const halfMaster = masterLength / 2;
    const masterEndAxy = { x: masterCenter.x - mUx * halfMaster, y: masterCenter.y - mUy * halfMaster };
    const masterEndBxy = { x: masterCenter.x + mUx * halfMaster, y: masterCenter.y + mUy * halfMaster };
```

with:

```javascript
    // ── 2. Pick points — each beam picked over the COG of the load it carries ──
    // Per-LP vertical share from a min-norm rigid-body reaction solve. The
    // reaction-weighted centroid of the LPs equals the COG, so each side's
    // sub-COG and the total COG nest consistently: the hook (over the COG,
    // below) lands collinear with the two Main-Beam pick points, so the two
    // top slings straddle it and their horizontal thrusts cancel — no lean,
    // for a COG offset in any in-plan direction.
    const hookXY = { x: cog.x, y: cog.y };

    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    const subCogOf = (idxs) => {
      let w = 0, sx = 0, sy = 0;
      for (const i of idxs) { w += reactions[i]; sx += reactions[i] * liftingPoints[i].x; sy += reactions[i] * liftingPoints[i].y; }
      return { x: sx / w, y: sy / w };
    };
    const subCogA = subCogOf(groupAIdxs);
    const subCogB = subCogOf(groupBIdxs);

    // Main-Beam sling pick points sit over each side's sub-COG (plan x,y).
    const pickAxy = { x: subCogA.x, y: subCogA.y };
    const pickBxy = { x: subCogB.x, y: subCogB.y };
```

- [ ] **Step 4: Rename master-end references to pick references (downstream)**

In the same file, apply these exact substitutions (all in `calculate`). Each is a mechanical rename; a missed one throws or NaNs and is caught by the suite.

4a. The horizontal-distance block:
```javascript
    const hDistA0 = C.horizontalDist(groupALPs[0], masterEndAxy);
    const hDistA1 = C.horizontalDist(groupALPs[1], masterEndAxy);
    const hDistB0 = C.horizontalDist(groupBLPs[0], masterEndBxy);
    const hDistB1 = C.horizontalDist(groupBLPs[1], masterEndBxy);
```
→ replace `masterEndAxy` with `pickAxy` and `masterEndBxy` with `pickBxy` (4 references).

4b. The loop end points:
```javascript
      const mEndA = { ...masterEndAxy, z: masterZ };
      const mEndB = { ...masterEndBxy, z: masterZ };
```
→
```javascript
      const mEndA = { ...pickAxy, z: masterZ };
      const mEndB = { ...pickBxy, z: masterZ };
```

4c. The master-ends object:
```javascript
    const masterEnds = {
      endA: { ...masterEndAxy, z: masterZ },
      endB: { ...masterEndBxy, z: masterZ }
    };
```
→
```javascript
    const masterPicks = {
      pickA: { ...pickAxy, z: masterZ },
      pickB: { ...pickBxy, z: masterZ }
    };
```

4d. Hook horizontal distances:
```javascript
    const hDistHA = C.horizontalDist(masterEnds.endA, hookXY);
    const hDistHB = C.horizontalDist(masterEnds.endB, hookXY);
```
→ `masterEnds.endA` → `masterPicks.pickA`, `masterEnds.endB` → `masterPicks.pickB`.

4e. Middle slings — replace the four `middleSlings.push(...)` calls' upper points:
`{ ...masterEnds.endA, label: 'Main End A' }` → `{ ...masterPicks.pickA, label: 'Main Pick A' }` (2 occurrences)
`{ ...masterEnds.endB, label: 'Main End B' }` → `{ ...masterPicks.pickB, label: 'Main Pick B' }` (2 occurrences)

4f. Top slings:
`{ ...masterEnds.endA, label: 'Main End A' }` → `{ ...masterPicks.pickA, label: 'Main Pick A' }`
`{ ...masterEnds.endB, label: 'Main End B' }` → `{ ...masterPicks.pickB, label: 'Main Pick B' }`

4g. Tension cascade:
```javascript
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(masterEnds.endA, masterEnds.endB, hook, totalLoad);
```
→ `masterEnds.endA` → `masterPicks.pickA`, `masterEnds.endB` → `masterPicks.pickB`.
```javascript
    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterEnds.endA, hook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterEnds.endB, hook);
```
→ `masterEnds.endA` → `masterPicks.pickA`, `masterEnds.endB` → `masterPicks.pickB`.
```javascript
    const midTensionsA = C.calcTwoSlingTension(slaveA1, slaveA2, masterEnds.endA, vLoadMasterA);
```
→ `masterEnds.endA` → `masterPicks.pickA`.
```javascript
    const midTensionsB = C.calcTwoSlingTension(slaveB1, slaveB2, masterEnds.endB, vLoadMasterB);
```
→ `masterEnds.endB` → `masterPicks.pickB`.

4h. Main Beam result entry (interim — Task 3 revisits the ends/length):
```javascript
        {
          name: 'Main Beam',
          endA: { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z) },
          endB: { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z) },
          length: C.round4(masterLength), pickupPoint: null
        },
```
→
```javascript
        {
          name: 'Main Beam',
          endA: { x: C.round4(masterPicks.pickA.x), y: C.round4(masterPicks.pickA.y), z: C.round4(masterPicks.pickA.z) },
          endB: { x: C.round4(masterPicks.pickB.x), y: C.round4(masterPicks.pickB.y), z: C.round4(masterPicks.pickB.z) },
          length: C.round4(C.horizontalDist(masterPicks.pickA, masterPicks.pickB)), pickupPoint: null
        },
```

4i. `intermediatePoints`:
```javascript
      { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z), label: 'Main End A' },
      { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z), label: 'Main End B' }
```
→
```javascript
      { x: C.round4(masterPicks.pickA.x), y: C.round4(masterPicks.pickA.y), z: C.round4(masterPicks.pickA.z), label: 'Main Pick A' },
      { x: C.round4(masterPicks.pickB.x), y: C.round4(masterPicks.pickB.y), z: C.round4(masterPicks.pickB.z), label: 'Main Pick B' }
```

- [ ] **Step 5: Verify no stray references remain**

Run: `grep -n "masterEnds\|masterEndAxy\|masterEndBxy\|masterCenter\|lpMidA\|lpMidB\|'Main End" js/calc-double-cas.js`
Expected: no output (all renamed/removed).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: `dbl-cas-perp-cog-hook-balanced`, `dbl-cas-onaxis-cog-asym-top`, `dbl-cas-picks-over-subcog` PASS. Existing `dbl-cas-centred-cog-top-equal`, `dbl-cas-offset-cog-beam-over-lps`, all per-lay-angle tests, and all `dbl-cas-1..97` invariant tests still PASS. Zero failures.

- [ ] **Step 7: Commit**

```bash
git add js/calc-double-cas.js test-calc.js
git commit -m "fix(cascade): pick each beam over its sub-COG (horizontal equilibrium at hook)"
```

---

### Task 3: Fixed-length Main Beam with inboard picks + `mainBeamTooShort` warning

**Files:**
- Modify: `js/calc-double-cas.js`, `js/app.js`
- Test: `test-calc.js`

**Interfaces:**
- Consumes: `masterPicks`, `pickAxy`, `pickBxy`, `masterZ`, `masterLength` (Task 2).
- Produces: `result.beams[0]` (Main Beam) `endA`/`endB` are the physical bar ends (honouring `masterLength`); `result.beams[0].length === max(masterLength, pickSpacing)`; `result.warnings.mainBeamTooShort` boolean.

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` after the Task 2 cascade tests:

```javascript
// Main Beam is a physical bar of masterLength with picks inboard; too-short warns.
function runCascadeBeamLengthTest(name, shared, config, expectLen, expectTooShort) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const mb = r.beams.find(b => b.name === 'Main Beam');
  if (Math.abs(mb.length - expectLen) > 0.01) errs.push(`main beam length ${mb.length} != ${expectLen}`);
  if (!!r.warnings.mainBeamTooShort !== expectTooShort)
    errs.push(`mainBeamTooShort=${r.warnings.mainBeamTooShort}, expected ${expectTooShort}`);
  // picks must lie within the physical bar span (endA..endB)
  const pA = r.intermediatePoints.find(p => p.label === 'Main Pick A');
  const spanAB = Math.sqrt((mb.endB.x - mb.endA.x) ** 2 + (mb.endB.y - mb.endA.y) ** 2);
  const dPickA = Math.sqrt((pA.x - mb.endA.x) ** 2 + (pA.y - mb.endA.y) ** 2);
  if (dPickA > spanAB + 0.01) errs.push(`pickA outside bar span`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
// pickSpacing for rectLPs(8,4) with pairing [1,4]/[2,3] and centred COG = 8.
runCascadeBeamLengthTest('dbl-cas-main-beam-honors-length',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 10, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  10, false);
runCascadeBeamLengthTest('dbl-cas-main-beam-too-short',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  8, true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: `dbl-cas-main-beam-honors-length` FAILS (interim length = pickSpacing 8, not 10; `mainBeamTooShort` undefined). `dbl-cas-main-beam-too-short` may partially pass on length (8) but FAILS on `mainBeamTooShort` (undefined ≠ true).

- [ ] **Step 3: Compute physical Main-Beam ends**

In `js/calc-double-cas.js`, immediately after the `masterPicks` object definition (from Task 2 step 4c), insert:

```javascript
    // Main Beam is a physical bar of masterLength; the sling pick points slide
    // inboard over the sub-COGs. Bar spans the picks plus symmetric overhang.
    const pickSpacing = C.horizontalDist(masterPicks.pickA, masterPicks.pickB);
    const mainBeamTooShort = masterLength < pickSpacing - 1e-9;
    const physicalLength = Math.max(masterLength, pickSpacing);
    const overhang = (physicalLength - pickSpacing) / 2;
    let mbUx = 0, mbUy = 0;
    if (pickSpacing > 1e-9) { mbUx = (pickBxy.x - pickAxy.x) / pickSpacing; mbUy = (pickBxy.y - pickAxy.y) / pickSpacing; }
    const mainBeamEndA = { x: pickAxy.x - mbUx * overhang, y: pickAxy.y - mbUy * overhang, z: masterZ };
    const mainBeamEndB = { x: pickBxy.x + mbUx * overhang, y: pickBxy.y + mbUy * overhang, z: masterZ };
```

- [ ] **Step 4: Use physical ends in the Main Beam result and add the warning**

Replace the Main Beam result entry (from Task 2 step 4h):

```javascript
        {
          name: 'Main Beam',
          endA: { x: C.round4(masterPicks.pickA.x), y: C.round4(masterPicks.pickA.y), z: C.round4(masterPicks.pickA.z) },
          endB: { x: C.round4(masterPicks.pickB.x), y: C.round4(masterPicks.pickB.y), z: C.round4(masterPicks.pickB.z) },
          length: C.round4(C.horizontalDist(masterPicks.pickA, masterPicks.pickB)), pickupPoint: null
        },
```
→
```javascript
        {
          name: 'Main Beam',
          endA: { x: C.round4(mainBeamEndA.x), y: C.round4(mainBeamEndA.y), z: C.round4(mainBeamEndA.z) },
          endB: { x: C.round4(mainBeamEndB.x), y: C.round4(mainBeamEndB.y), z: C.round4(mainBeamEndB.z) },
          length: C.round4(physicalLength), pickupPoint: null
        },
```

Add `mainBeamTooShort` to the `warnings` object:
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
→ add `mainBeamTooShort,` after `bottomSlingBelowMin,`:
```javascript
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        bottomSlingBelowMin,
        mainBeamTooShort,
        liftBeamBendingNotChecked: false
      }
```

- [ ] **Step 5: Surface the warning in the UI**

In `js/app.js`, in the warnings-render block (after the `warnings.bottomAngleLow` block, before `warnings.liftBeamBendingNotChecked`), add:

```javascript
    if (warnings.mainBeamTooShort) {
      msgs.push('Main beam is shorter than the required pick-point span — the beam has been drawn at the minimum span needed to reach both pick points. Specify a longer main beam.');
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: `dbl-cas-main-beam-honors-length` (length 10, tooShort false, pick within span) and `dbl-cas-main-beam-too-short` (length 8, tooShort true) PASS. All prior tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add js/calc-double-cas.js js/app.js test-calc.js
git commit -m "feat(cascade): fixed-length Main Beam with inboard picks + too-short warning"
```

---

### Task 4: `subCogFallback` guard for negative reactions

**Files:**
- Modify: `js/calc-double-cas.js`, `js/app.js`
- Test: `test-calc.js`

**Interfaces:**
- Produces: `result.warnings.subCogFallback` boolean — true when any side has a negative reaction (COG near/outside the hull) and that side's sub-COG fell back to the geometric LP-pair midpoint.

- [ ] **Step 1: Write the failing test**

Add to `test-calc.js` after the Task 3 tests:

```javascript
// COG beyond the LP hull yields a negative reaction → sub-COG falls back to the
// geometric midpoint and warns, but geometry stays finite.
function runCascadeSubCogFallbackTest(name, shared, config, expectFallback) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  if (!!r.warnings.subCogFallback !== expectFallback)
    errs.push(`subCogFallback=${r.warnings.subCogFallback}, expected ${expectFallback}`);
  const all = r.tiers.flatMap(t => t.slings);
  if (all.some(s => !isFinite(s.length) || s.length <= 0)) errs.push(`non-finite/zero sling length under fallback`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
// cog x=5 (beyond LP x=4) → reactions [-1.25, 11.25, 11.25, -1.25] → fallback.
runCascadeSubCogFallbackTest('dbl-cas-subcog-fallback',
  { liftingPoints: rectLPs(8, 4), cog: { x: 5, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  true);
// Centred COG → no fallback.
runCascadeSubCogFallbackTest('dbl-cas-subcog-no-fallback',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } },
  false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: `dbl-cas-subcog-fallback` FAILS (`subCogFallback` undefined ≠ true). `dbl-cas-subcog-no-fallback` may pass (undefined is falsy) — acceptable.

- [ ] **Step 3: Add the fallback to `subCogOf`**

In `js/calc-double-cas.js`, replace the `subCogOf` definition (from Task 2 step 3):

```javascript
    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    const subCogOf = (idxs) => {
      let w = 0, sx = 0, sy = 0;
      for (const i of idxs) { w += reactions[i]; sx += reactions[i] * liftingPoints[i].x; sy += reactions[i] * liftingPoints[i].y; }
      return { x: sx / w, y: sy / w };
    };
```
→
```javascript
    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    let subCogFallback = false;
    const subCogOf = (idxs) => {
      let w = 0, sx = 0, sy = 0, anyNeg = false;
      for (const i of idxs) {
        if (reactions[i] < 0) anyNeg = true;
        w += reactions[i]; sx += reactions[i] * liftingPoints[i].x; sy += reactions[i] * liftingPoints[i].y;
      }
      if (anyNeg || Math.abs(w) < 1e-9) {
        // COG near/outside the support hull → sub-COG ill-defined; use the
        // geometric LP-pair midpoint so the rig stays buildable (warned).
        subCogFallback = true;
        const mid = C.midpoint(liftingPoints[idxs[0]], liftingPoints[idxs[1]]);
        return { x: mid.x, y: mid.y };
      }
      return { x: sx / w, y: sy / w };
    };
```

- [ ] **Step 4: Add the warning key and UI message**

In `js/calc-double-cas.js` `warnings` object, add `subCogFallback,` after `mainBeamTooShort,`:
```javascript
        bottomSlingBelowMin,
        mainBeamTooShort,
        subCogFallback,
        liftBeamBendingNotChecked: false
```

In `js/app.js`, after the `warnings.mainBeamTooShort` block, add:
```javascript
    if (warnings.subCogFallback) {
      msgs.push('COG is near or outside the lifting-point hull, so a side’s load share went negative — the pick point fell back to the geometric midpoint. Verify the COG and lifting-point positions.');
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: `dbl-cas-subcog-fallback` (true) and `dbl-cas-subcog-no-fallback` (false) PASS. All prior tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add js/calc-double-cas.js js/app.js test-calc.js
git commit -m "feat(cascade): fall back to LP midpoint on negative reaction (subCogFallback warning)"
```

---

### Task 5: Browser visual verification (fresh port) + full regression

**Files:** none (verification only).

- [ ] **Step 1: Full suite green**

Run: `node test-calc.js` and `node test-simple.js`
Expected: `test-calc.js` all pass (146 prior + new tests); `test-simple.js` unchanged/all pass.

- [ ] **Step 2: Serve on a FRESH port (avoid stale-cache trap)**

Run: `python -m http.server 8791` from the project root (a port not used earlier this session, so the persistent browser context can't serve cached JS). Note the PID.

- [ ] **Step 3: Visually verify the cascade with an offset COG**

Load `http://localhost:8791/`, switch to Advanced → Double Spreader (Cascading). Enter an off-centre COG (e.g. LPs 8×4, COG y-offset). Confirm in the 3D view:
- The load hangs **plumb** (no lean) with the hook over the COG.
- The Main Beam sits level; the two sling pick points are inboard, over each side's sub-COG; the top slings are visibly **different lengths** for the asymmetric case.
- Try a `masterLength` shorter than the pick span → the `mainBeamTooShort` warning appears.
- No console errors.

Capture a screenshot for the record (per CLAUDE.md "observe the rendered result").

- [ ] **Step 4: Kill the dev server by PID/port only**

Run: `netstat -ano | grep :8791 | head -1` → `taskkill //PID <pid> //F` (never blanket-kill `python.exe`).

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch. Note: deploy remains gated on `/eng-review` and CPEng sign-off (out of scope for this plan).

---

## Self-Review

**Spec coverage:** §2 pick-over-sub-COG → Task 2. §2.1 fixed beam + inboard picks + `mainBeamTooShort` → Task 3. §3 min-norm reactions → Task 1; negative-reaction fallback → Task 4. §6 equilibrium scope (hook horizontal) → Task 2 tests. §7 all listed tests covered (hook-balanced, asym-top, picks-over-subcog, honors-length/too-short, centred regression via existing `dbl-cas-centred-cog-top-equal`, hand-check reactions in Task 1). §4 files: calc-core (T1), calc-double-cas (T2-4), app.js warnings (T3-4), scene.js no change (T5 visual), test-calc (all). No gaps.

**Placeholder scan:** none — every step has concrete code, exact commands, and expected output.

**Type/name consistency:** `computeSupportReactions` (T1) called identically in T2 and tests. `masterPicks.pickA/pickB`, `pickAxy/pickBxy`, `mainBeamEndA/mainBeamEndB`, `pickSpacing`, `physicalLength`, `mainBeamTooShort`, `subCogFallback` used consistently across T2-4. Warning keys added to the calc object (T3, T4) match the keys read in app.js (T3, T4). Test helpers (`hookHorizForce`, `runCascade*`) defined before use.
