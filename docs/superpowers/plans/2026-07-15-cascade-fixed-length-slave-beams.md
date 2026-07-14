# Fixed-Length 2nd-Level (Slave) Beams — Cascade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Double-Spreader-Cascading 2nd-Level (slave) beam build at the exact entered length; the bottom slings pull in / splay out to reach the fixed ends, and the beam centre is placed so the beam hangs plumb (zero net horizontal thrust).

**Architecture:** Add one pure `CalcCore` helper (`fixedBeamEnds`) that returns the balanced fixed-length beam-end plan positions via the closed form `C = subCOG − û·(L/2)·(w_b − wₐ)/W`. Then replace the `computeBeamEndPair`-based slave placement in `calc-double-cas.js` with fixed ends + a direct (non-iterative) height solve. Main Beam, reactions, tension cascade, other configs, and Simple mode are untouched.

**Tech Stack:** Vanilla JS (no build); Node `vm`-based test harness (`test-calc.js`, `test-simple.js`).

## Global Constraints

- Vanilla HTML/CSS/JS; no new dependencies; no build step.
- Cascade config ONLY this plan; other configs (Parallel first) are a follow-up.
- Do NOT touch: Main Beam geometry, `computeSupportReactions`/sub-COG, the tension solver (`calcTwoSlingTension` / vertical-load pass-down), `scene.js`, Simple mode.
- One geometry function at a time: run BOTH suites (`node test-calc.js` = 157, `node test-simple.js` = 33) after each change; a regression → revert immediately and rethink.
- Hand-calculate expected values from the spec's closed form BEFORE writing each test (no snapshot placeholders).
- Closed form provenance: `docs/superpowers/specs/2026-07-14-cascade-fixed-length-slave-beams-design.md` §3.
- Angles are measured from horizontal throughout.

---

### Task 1: `CalcCore.fixedBeamEnds` helper

**Files:**
- Modify: `js/calc-core.js` (add function; add to the returned export object)
- Test: `test-calc.js` (new `runFixedBeamEndsTest` block, placed just after the `runReactionsTest` cases near line 189)

**Interfaces:**
- Produces: `fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length) → { end0: {x,y}, end1: {x,y} }`
  - `lpA`, `lpB`: the group's two lifting points (`{x,y,z}`; only x,y used).
  - `wA`, `wB`: the two LPs' vertical load shares (already clamped ≥ 0 by the caller).
  - `subCOG`: `{x,y}` reaction-weighted plan centroid of the pair.
  - `length`: entered beam length.
  - `end0` is on the `lpA` side, `end1` on the `lpB` side. Z is NOT set (caller adds it).

- [ ] **Step 1: Write the failing tests**

Add to `test-calc.js` immediately after line 188 (`runReactionsTest('reactions-onaxis-offset', ...)`):

```javascript
// === CalcCore.fixedBeamEnds ===
function runFixedBeamEndsTest(name, lpA, lpB, wA, wB, subCOG, length, expect) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcCore.fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  // Beam realises the full entered length (ends `length` apart in plan)
  const dx = r.end1.x - r.end0.x, dy = r.end1.y - r.end0.y;
  const gotLen = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(gotLen - length) > 1e-6) errs.push(`length ${gotLen.toFixed(4)} != ${length}`);
  // Pick sits over the load-weighted average of the ENDS (plumb / zero thrust)
  const W = wA + wB;
  if (W > 1e-9) {
    const avgx = (wA * r.end0.x + wB * r.end1.x) / W;
    const avgy = (wA * r.end0.y + wB * r.end1.y) / W;
    if (Math.abs(avgx - subCOG.x) > 1e-6 || Math.abs(avgy - subCOG.y) > 1e-6)
      errs.push(`end-weighted avg (${avgx.toFixed(3)},${avgy.toFixed(3)}) != subCOG (${subCOG.x},${subCOG.y})`);
  }
  if (expect) {
    if (Math.abs(r.end0.x - expect.end0.x) > 1e-4 || Math.abs(r.end0.y - expect.end0.y) > 1e-4)
      errs.push(`end0 (${r.end0.x.toFixed(3)},${r.end0.y.toFixed(3)}) != (${expect.end0.x},${expect.end0.y})`);
    if (Math.abs(r.end1.x - expect.end1.x) > 1e-4 || Math.abs(r.end1.y - expect.end1.y) > 1e-4)
      errs.push(`end1 (${r.end1.x.toFixed(3)},${r.end1.y.toFixed(3)}) != (${expect.end1.x},${expect.end1.y})`);
  }
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
// Symmetric shares → centre at subCOG (= midpoint), ends symmetric.
runFixedBeamEndsTest('fbe-symmetric',
  { x: -3, y: 0 }, { x: 3, y: 0 }, 5, 5, { x: 0, y: 0 }, 4,
  { end0: { x: -2, y: 0 }, end1: { x: 2, y: 0 } });
// Offset shares along +x: subCOG=4.2, shift=1.0 → centre 3.2 → ends 0.7 / 5.7.
runFixedBeamEndsTest('fbe-offset-x',
  { x: 0, y: 0 }, { x: 6, y: 0 }, 3, 7, { x: 4.2, y: 0 }, 5,
  { end0: { x: 0.7, y: 0 }, end1: { x: 5.7, y: 0 } });
// Offset shares along +y (axis follows the LP line): ends 0.7 / 5.7 on y.
runFixedBeamEndsTest('fbe-offset-y',
  { x: 0, y: 0 }, { x: 0, y: 6 }, 3, 7, { x: 0, y: 4.2 }, 5,
  { end0: { x: 0, y: 0.7 }, end1: { x: 0, y: 5.7 } });
// Fallback: no positive share → geometric midpoint centre, full length kept.
runFixedBeamEndsTest('fbe-zero-share',
  { x: -2, y: 0 }, { x: 2, y: 0 }, 0, 0, { x: 0, y: 0 }, 4,
  { end0: { x: -2, y: 0 }, end1: { x: 2, y: 0 } });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL — 4 new failures (`fbe-*`) reporting `EXCEPTION: CalcCore.fixedBeamEnds is not a function`.

- [ ] **Step 3: Implement the helper**

In `js/calc-core.js`, add this function next to `computeBeamEndPair` (after it, before `computeVerticalLoad`):

```javascript
  /**
   * Fixed-length beam end placement for a 2-LP group.
   * The beam is a rigid bar of `length`, axis along the LP-pair line, positioned
   * so it hangs plumb under a pick over `subCOG`. A rigid bar loaded only at its
   * two ends carries a net force along the bar, so each middle sling carries its
   * own end's load; for the two middle thrusts to cancel the pick must sit over
   * the load-weighted average of the ENDS, giving
   *   C = subCOG - u * (length/2) * (wB - wA) / (wA + wB)
   * with u the unit vector from lpA to lpB. Returns plan (x,y); caller sets z.
   * end0 is on the lpA side, end1 on the lpB side.
   * See docs/superpowers/specs/2026-07-14-cascade-fixed-length-slave-beams-design.md §3.
   */
  function fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length) {
    const dx = lpB.x - lpA.x, dy = lpB.y - lpA.y;
    const axisLen = Math.sqrt(dx * dx + dy * dy);
    const half = length / 2;
    if (axisLen < 1e-9) {
      // Coincident LP pair (degenerate) — no axis to lay the bar along.
      return { end0: { x: subCOG.x, y: subCOG.y }, end1: { x: subCOG.x, y: subCOG.y } };
    }
    const ux = dx / axisLen, uy = dy / axisLen;
    const W = wA + wB;
    let cx, cy;
    if (W < 1e-9) {
      // No positive share (fallback state) — geometric midpoint keeps full length.
      cx = (lpA.x + lpB.x) / 2; cy = (lpA.y + lpB.y) / 2;
    } else {
      const shift = half * (wB - wA) / W;   // centre offset toward the lighter LP
      cx = subCOG.x - ux * shift; cy = subCOG.y - uy * shift;
    }
    return {
      end0: { x: cx - ux * half, y: cy - uy * half },
      end1: { x: cx + ux * half, y: cy + uy * half }
    };
  }
```

Then add `fixedBeamEnds` to the object returned at the bottom of the `CalcCore` IIFE (the `return { ... }` that already lists `computeBeamEndPair`, `computeSupportReactions`, etc.) — insert `fixedBeamEnds,` alongside `computeBeamEndPair`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: the 4 `fbe-*` tests PASS; total rises to 161; 0 failures.
Run: `node test-simple.js`
Expected: 33/33 PASS (untouched).

- [ ] **Step 5: Commit**

```bash
git add js/calc-core.js test-calc.js
git commit -m "feat(calc): fixedBeamEnds — balanced fixed-length beam end placement"
```

---

### Task 2: Use fixed-length slave beams in the cascade calc

**Files:**
- Modify: `js/calc-double-cas.js` (replace the slave-beam placement + height solve, lines ~91-142)
- Test: `test-calc.js` (add two cascade assertions after the existing `dbl-cas-*` block, ~line 494)

**Interfaces:**
- Consumes: `CalcCore.fixedBeamEnds` (Task 1); existing `reactions`, `subCogA/subCogB`, `pickAxy/pickBxy`, `groupA*/groupB*`, `minAngleRad`, `middleAngleRad`, `minSlingLen`.
- Produces: unchanged result shape; `beams[1].length` / `beams[2].length` now equal `slaveLengthA/B` (barring the degenerate fallback).

- [ ] **Step 1: Write the failing tests**

In `test-calc.js`, add after the last `dbl-cas-*` runTest (search for `dbl-cas-large-master`, add just below it):

```javascript
// Fixed-length slave beams: actual 2nd-lvl beam length == entered length,
// and the slave beam hangs plumb (net horizontal force on the beam ~ 0).
function midMag(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function beamHorizNet(res, endLabels, otherFor) {
  // Sum the horizontal force each attached sling exerts on the beam ends.
  const slings = res.tiers.flatMap(t => t.slings);
  let fx = 0, fy = 0;
  for (const end of endLabels) {
    const P = res.intermediatePoints.find(p => p.label === end);
    for (const s of slings) {
      const atEnd =
        (Math.abs(s.from.x - P.x) < 1e-6 && Math.abs(s.from.y - P.y) < 1e-6 && Math.abs(s.from.z - P.z) < 1e-6) ? s.to :
        (Math.abs(s.to.x - P.x) < 1e-6 && Math.abs(s.to.y - P.y) < 1e-6 && Math.abs(s.to.z - P.z) < 1e-6) ? s.from : null;
      if (!atEnd) continue;
      const dx = atEnd.x - P.x, dy = atEnd.y - P.y, dz = atEnd.z - P.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      fx += s.tension * dx / L; fy += s.tension * dy / L;
    }
  }
  return Math.sqrt(fx * fx + fy * fy);
}
function runFixedSlaveTest(name, shared, config, expectBeamLen) {
  totalTests++;
  const errs = [];
  let res;
  try { res = doubleCasCalc(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const beamA = res.beams.find(b => b.name === '2nd Lvl Beam A');
  const beamB = res.beams.find(b => b.name === '2nd Lvl Beam B');
  if (Math.abs(beamA.length - expectBeamLen) > 0.01) errs.push(`beamA ${beamA.length} != ${expectBeamLen}`);
  if (Math.abs(beamB.length - expectBeamLen) > 0.01) errs.push(`beamB ${beamB.length} != ${expectBeamLen}`);
  // Beam A hangs plumb: net horizontal force on its two ends ~ 0.
  const netA = beamHorizNet(res, ['2nd A End 1', '2nd A End 2']);
  if (netA > 0.02) errs.push(`beamA net horizontal ${netA.toFixed(4)} not ~0`);
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
// Wide LPs + 5 m beam: length honoured (was silently shrunk to ~4 m before).
runFixedSlaveTest('dbl-cas-fixed-len-symmetric',
  { liftingPoints: rectLPs(12, 8), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 10, slaveLengthA: 5, slaveLengthB: 5, bottomSlingLen: 2 }, 5);
// Offset COG: length still honoured AND beam still balances horizontally.
runFixedSlaveTest('dbl-cas-fixed-len-offset',
  { liftingPoints: rectLPs(12, 8), cog: { x: 1.5, y: 0.8, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 10, slaveLengthA: 5, slaveLengthB: 5, bottomSlingLen: 2 }, 5);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL — `dbl-cas-fixed-len-*` report `beamA <~4> != 5` (current derived length shrinks the beam), confirming the tests exercise the new behaviour.

- [ ] **Step 3: Replace the slave placement + height solve**

In `js/calc-double-cas.js`, delete the block from the `// Master beam Z:` comment (currently line 91) through the end of the `masterPicks` object literal (currently line 142) — i.e. everything between the `pickAxy`/`pickBxy` definitions (keep those) and the `// Main Beam is a physical bar` comment (keep that). Replace it with:

```javascript
    // ── 3. Vertical load shares per LP (clamped — same basis as subCogOf) ──
    const wA0 = Math.max(0, reactions[groupAIdxs[0]]);
    const wA1 = Math.max(0, reactions[groupAIdxs[1]]);
    const wB0 = Math.max(0, reactions[groupBIdxs[0]]);
    const wB1 = Math.max(0, reactions[groupBIdxs[1]]);

    // Fixed-length slave beam ends (plan positions; z set below). Each beam is a
    // rigid bar of the entered length, axis along its LP-pair line, centred so it
    // hangs plumb under its Main pick (pick over the end-weighted average).
    const endsA = C.fixedBeamEnds(groupALPs[0], groupALPs[1], wA0, wA1, subCogA, slaveLengthA);
    const endsB = C.fixedBeamEnds(groupBLPs[0], groupBLPs[1], wB0, wB1, subCogB, slaveLengthB);

    // Slave beam height: raise the rigid horizontal beam until BOTH its bottom
    // slings meet the min angle AND the min bottom-sling length. The entered
    // "Bottom Sling Length" is a MINIMUM — lift the beam, never shrink it.
    const zBeamOf = (lp0, e0, lp1, e1) => {
      const req = (lp, e) => {
        const hd = C.horizontalDist(lp, e);
        const zAngle = lp.z + hd * Math.tan(minAngleRad);
        const zLen = (minSlingLen > hd) ? lp.z + Math.sqrt(minSlingLen * minSlingLen - hd * hd) : lp.z;
        return Math.max(zAngle, zLen);
      };
      return Math.max(req(lp0, e0), req(lp1, e1));
    };
    const zBA = zBeamOf(groupALPs[0], endsA.end0, groupALPs[1], endsA.end1);
    const zBB = zBeamOf(groupBLPs[0], endsB.end0, groupBLPs[1], endsB.end1);

    const slaveA1 = { ...endsA.end0, z: zBA };
    const slaveA2 = { ...endsA.end1, z: zBA };
    const slaveB1 = { ...endsB.end0, z: zBB };
    const slaveB2 = { ...endsB.end1, z: zBB };

    // Main pick height: raised so every middle sling (slave end → Main pick)
    // meets the middle-lay target angle. Ends are fixed, so this is direct.
    const midReqZ = (end, pickxy) => end.z + C.horizontalDist(end, pickxy) * Math.tan(middleAngleRad);
    const masterZ = Math.max(
      midReqZ(slaveA1, pickAxy), midReqZ(slaveA2, pickAxy),
      midReqZ(slaveB1, pickBxy), midReqZ(slaveB2, pickBxy)
    );

    const masterPicks = {
      pickA: { ...pickAxy, z: masterZ },
      pickB: { ...pickBxy, z: masterZ }
    };
```

Leave everything from `// Main Beam is a physical bar` (pickSpacing / mainBeamTooShort / overhang / mainBeamEndA-B) and `actualSlaveLenA/B` onward exactly as-is — they already read `masterPicks`, `slaveA1..B2`, `pickAxy/pickBxy`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: `dbl-cas-fixed-len-symmetric` and `dbl-cas-fixed-len-offset` PASS; all existing `dbl-cas-*` invariant tests still PASS; total 163; 0 failures.
Run: `node test-simple.js`
Expected: 33/33 PASS.

If any existing `dbl-cas-*` test regresses (e.g. a bottom-sling min-angle or negative-tension invariant), STOP, revert this file (`git checkout -- js/calc-double-cas.js`), and reconsider the height solve before retrying — do not patch over it.

- [ ] **Step 5: Visual confirmation (fresh port — stale-cache rule)**

Start a fresh server (`python -m http.server <new-port>`), open Advanced (3D), select **Double Spreader (Cascading)**, set both 2nd-Lvl beam lengths to **5**, middle angle **60°**, Calculate. Confirm on screen + in *Beam Details*:
- `2nd Lvl Beam A/B — Length` reads **5.000 m** (not ~4 m).
- Middle slings ≈ **5 m** at ~60°.
- Rig hangs plumb (hook plumb line through COG; no lean), including with an offset COG preset.
- Browser console: 0 errors.

Capture a screenshot for the record. Kill the server by PID when done.

- [ ] **Step 6: Commit**

```bash
git add js/calc-double-cas.js test-calc.js
git commit -m "feat(cascade): fixed-length 2nd-lvl beams (bottom slings pull in/out; plumb centre)"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** §3 closed form → Task 1; §4 height solve + bottom-sling-minimum → Task 2 Step 3; §5 "reported length == entered" → Task 2 tests; §7 symmetric + offset hand-checks → both tasks' tests.
- **Type consistency:** `fixedBeamEnds` returns `{end0,end1}` (plan only) in both the helper and the caller; caller adds `z`. `reactions`/`subCogA`/`pickAxy` names match the existing `calc-double-cas.js`.
- **Not in scope:** no change to Main Beam, reactions, tensions, `scene.js`, Simple mode, or any non-cascade config. The Parallel config rollout is a separate later plan.
