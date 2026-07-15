# Fixed-Length Parallel Beams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Double-Spreader-Parallel beam a fixed length (the entered `beamLengthA/B`) that hangs at its own equilibrium yaw angle, with the bottom slings pulling in / splaying out to reach the fixed ends.

**Architecture:** Add a pure numerical solver `CalcCore.solveHangingBeam` (damped Newton on the beam's centre + yaw, seeded from the sub-COG / LP-pair line) that returns the two balanced end positions for a given hook height. Wire it into `calc-double-par.js`, solving the hook height and both beam poses in an outer loop, and replace the 4-leg `calcLoadDistribution` top-tension solve with a per-beam determinate one. Flag non-convergence. Cascade, reactions, hook-over-COG, Simple mode, and other configs are untouched.

**Tech Stack:** Vanilla JS (no build); Node `vm` test harness (`test-calc.js` = 163, `test-simple.js` = 33).

## Global Constraints

- Vanilla HTML/CSS/JS; no new dependencies; no build step.
- Double-Spreader-Parallel config ONLY. Do NOT touch: cascade (`calc-double-cas.js` / `fixedBeamEnds`), `computeSupportReactions`, the hook-over-total-COG rule, Simple mode, or any other config's calc.
- Beam must build at the ENTERED length (`beamLengthA/B`); bottom slings adjust.
- "Bottom Sling Length" is a MINIMUM — too-short bottom sling raises the beam, never shrinks it.
- Each beam hangs plumb: net horizontal force on the beam ~ 0; the hook stays over the total COG.
- One geometry function at a time: run BOTH suites after each change. This introduces a numerical solver — watch convergence and any `dbl-par-*` invariant regression; on regression REVERT immediately (`git checkout -- <file>`) and rethink, do not patch over it.
- Derivation provenance: `docs/superpowers/specs/2026-07-15-parallel-fixed-length-beams-design.md` §4–§7. Prototype-verified expected values are embedded below.
- Angles measured from horizontal throughout.

---

### Task 1: `CalcCore.solveHangingBeam` (pure equilibrium solver)

**Files:**
- Modify: `js/calc-core.js` (add function; add to export object next to `fixedBeamEnds`)
- Test: `test-calc.js` (new `runHangingBeamTest` block, after the `fbe-*` tests near line 227)

**Interfaces:**
- Produces: `solveHangingBeam(lpA, lpB, wA, wB, hook, H, length, minAngleRad, minSling) → { end0:{x,y,z}, end1:{x,y,z}, converged:boolean }`
  - `lpA,lpB` `{x,y,z}` the beam's two LPs; `wA,wB` their vertical load shares (clamped ≥0 by caller); `hook` `{x,y}` (over total COG); `H` hook height; `length` entered beam length; `minAngleRad`; `minSling`.
  - `end0` on the `lpA` side, `end1` on the `lpB` side; both at the solved beam height. `converged` false if the Newton iteration did not reach tolerance.

- [ ] **Step 1: Write the failing tests**

In `test-calc.js`, immediately AFTER the last `runFixedBeamEndsTest('fbe-zero-share', ...)` call, insert:

```javascript
// === CalcCore.solveHangingBeam ===
function runHangingBeamTest(name, lpA, lpB, wA, wB, hook, H, length, minAngleDeg, minSling, expect) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcCore.solveHangingBeam(lpA, lpB, wA, wB, hook, H, length, CalcCore.degToRad(minAngleDeg), minSling); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  if (!r.converged) errs.push('did not converge');
  const dx = r.end1.x - r.end0.x, dy = r.end1.y - r.end0.y, dz = r.end1.z - r.end0.z;
  const gotLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (Math.abs(gotLen - length) > 1e-4) errs.push(`length ${gotLen.toFixed(4)} != ${length}`);
  // Net horizontal on the beam ~ 0 (each end: top vert = bottom vert = w).
  const z = r.end0.z;
  const hnet = (e, lp, w) => ({
    x: w * ((hook.x - e.x) / (H - z) + (lp.x - e.x) / (z - lp.z)),
    y: w * ((hook.y - e.y) / (H - z) + (lp.y - e.y) / (z - lp.z))
  });
  const ha = hnet(r.end0, lpA, wA), hb = hnet(r.end1, lpB, wB);
  const net = Math.sqrt((ha.x + hb.x) ** 2 + (ha.y + hb.y) ** 2);
  if (net > 0.01) errs.push(`net horizontal ${net.toFixed(4)} not ~0`);
  // Beam sits near its own LPs, not dragged to the load centre.
  const cx = (r.end0.x + r.end1.x) / 2, cy = (r.end0.y + r.end1.y) / 2;
  const subx = (wA * lpA.x + wB * lpB.x) / (wA + wB), suby = (wA * lpA.y + wB * lpB.y) / (wA + wB);
  if (Math.hypot(cx - subx, cy - suby) > length) errs.push(`centre far from its sub-COG`);
  if (expect) {
    const near = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01;
    if (!near(r.end0, expect.end0)) errs.push(`end0 (${r.end0.x.toFixed(3)},${r.end0.y.toFixed(3)},${r.end0.z.toFixed(3)})`);
    if (!near(r.end1, expect.end1)) errs.push(`end1 (${r.end1.x.toFixed(3)},${r.end1.y.toFixed(3)},${r.end1.z.toFixed(3)})`);
  }
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
// Symmetric (verified via prototype): theta=90 (LP-pair line), centre inboard of
// the LPs at x=-6 (NOT dragged to x=0), min-length governs zB=sqrt(2^2-1.384^2)=1.443.
runHangingBeamTest('shb-symmetric',
  { x: -6, y: -3, z: 0 }, { x: -6, y: 3, z: 0 }, 5, 5, { x: 0, y: 0 }, Math.sqrt(45), 5, 45, 2,
  { end0: { x: -4.709, y: -2.5, z: 1.443 }, end1: { x: -4.709, y: 2.5, z: 1.443 } });
// Offset COG (hook at (1.5,0.8), full-precision shares): beam shifts toward the
// heavier LP; still fixed length and balanced.
runHangingBeamTest('shb-offset',
  { x: -6, y: -3, z: 0 }, { x: -6, y: 3, z: 0 }, 2.4239, 5.0776, { x: 1.5, y: 0.8 }, 8.4077, 5, 45, 2,
  { end0: { x: -4.691, y: -2.369, z: 1.467 }, end1: { x: -4.691, y: 2.631, z: 1.467 } });
// Clean asymmetric (property-only): converges, fixed length, balanced, near its LPs.
runHangingBeamTest('shb-asymmetric',
  { x: -6, y: -3, z: 0 }, { x: -6, y: 3, z: 0 }, 3, 7, { x: 0, y: 0 }, Math.sqrt(45), 5, 45, 2, null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL — 3 new `shb-*` tests report `EXCEPTION: CalcCore.solveHangingBeam is not a function`.

- [ ] **Step 3: Implement the solver**

In `js/calc-core.js`, add this function right AFTER `fixedBeamEnds` and BEFORE `computeVerticalLoad`:

```javascript
  /**
   * Solve a fixed-length spreader beam's free-hanging equilibrium pose.
   * The beam (rigid, horizontal, length `length`, axis free to yaw) carries its
   * two LPs via bottom slings and hangs from `hook` (over the total COG, height
   * `H`) via two top slings. A rigid bar loaded only at its two ends carries a
   * net end force along the bar, so each end's top and bottom vertical share =
   * that LP's load `w_i`. Solve centre (cx,cy) + yaw (th) so the beam's net
   * horizontal force is zero (h_a + h_b = 0 and h_a parallel to the bar) via a
   * damped Newton iteration seeded from the sub-COG / LP-pair line. Beam height
   * (zB) is set by the min bottom-sling angle AND the min bottom-sling length
   * (a MINIMUM — raises the beam, never shrinks it).
   * See docs/superpowers/specs/2026-07-15-parallel-fixed-length-beams-design.md §4-§6.
   */
  function solveHangingBeam(lpA, lpB, wA, wB, hook, H, length, minAngleRad, minSling) {
    const half = length / 2;
    const tan = Math.tan(minAngleRad);
    const W = wA + wB;
    const subx = (W > 1e-9) ? (wA * lpA.x + wB * lpB.x) / W : (lpA.x + lpB.x) / 2;
    const suby = (W > 1e-9) ? (wA * lpA.y + wB * lpB.y) / W : (lpA.y + lpB.y) / 2;
    let cx = subx, cy = suby, th = Math.atan2(lpB.y - lpA.y, lpB.x - lpA.x);

    const endsOf = (cx, cy, th) => {
      const ux = Math.cos(th), uy = Math.sin(th);
      return {
        ea: { x: cx - ux * half, y: cy - uy * half },
        eb: { x: cx + ux * half, y: cy + uy * half },
        ux, uy
      };
    };
    const zBof = (ea, eb) => {
      const req = (e, lp) => {
        const hd = Math.hypot(e.x - lp.x, e.y - lp.y);
        const za = lp.z + hd * tan;
        const zl = (minSling > hd) ? lp.z + Math.sqrt(Math.max(0, minSling * minSling - hd * hd)) : lp.z;
        return Math.max(za, zl);
      };
      return Math.max(req(ea, lpA), req(eb, lpB));
    };
    const residual = (cx, cy, th) => {
      const { ea, eb, ux, uy } = endsOf(cx, cy, th);
      const z = zBof(ea, eb);
      const hvec = (e, lp, w) => {
        const dzTop = H - z, dzBot = z - lp.z;
        return {
          x: w * ((hook.x - e.x) / dzTop + (lp.x - e.x) / dzBot),
          y: w * ((hook.y - e.y) / dzTop + (lp.y - e.y) / dzBot)
        };
      };
      const ha = hvec(ea, lpA, wA), hb = hvec(eb, lpB, wB);
      return [ha.x + hb.x, ha.y + hb.y, ux * ha.y - uy * ha.x];
    };

    let converged = false;
    const damp = 0.6, eps = 1e-6;
    for (let it = 0; it < 80; it++) {
      const r = residual(cx, cy, th);
      if (Math.hypot(r[0], r[1], r[2]) < 1e-7) { converged = true; break; }
      const r1 = residual(cx + eps, cy, th), r2 = residual(cx, cy + eps, th), r3 = residual(cx, cy, th + eps);
      const J = [
        [(r1[0] - r[0]) / eps, (r2[0] - r[0]) / eps, (r3[0] - r[0]) / eps],
        [(r1[1] - r[1]) / eps, (r2[1] - r[1]) / eps, (r3[1] - r[1]) / eps],
        [(r1[2] - r[2]) / eps, (r2[2] - r[2]) / eps, (r3[2] - r[2]) / eps]
      ];
      const Ji = mat3x3Inverse(J);
      if (!Ji) break;   // singular Jacobian — stop; caller flags non-convergence
      const d = [
        -(Ji[0][0] * r[0] + Ji[0][1] * r[1] + Ji[0][2] * r[2]),
        -(Ji[1][0] * r[0] + Ji[1][1] * r[1] + Ji[1][2] * r[2]),
        -(Ji[2][0] * r[0] + Ji[2][1] * r[1] + Ji[2][2] * r[2])
      ];
      cx += damp * d[0]; cy += damp * d[1]; th += damp * d[2];
    }
    const { ea, eb } = endsOf(cx, cy, th);
    const z = zBof(ea, eb);
    return { end0: { x: ea.x, y: ea.y, z }, end1: { x: eb.x, y: eb.y, z }, converged };
  }
```

Then add `solveHangingBeam` to the `return { ... }` export object — change the line `    computeBeamEndPair, fixedBeamEnds` to `    computeBeamEndPair, fixedBeamEnds, solveHangingBeam`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: the 3 `shb-*` tests PASS; total 166; 0 failures.
Run: `node test-simple.js`
Expected: 33/33 PASS.

- [ ] **Step 5: Commit**

```bash
git add js/calc-core.js test-calc.js
git commit -m "feat(calc): solveHangingBeam — free-hang equilibrium pose for a fixed-length beam"
```

---

### Task 2: Use fixed-length hanging beams in the Parallel calc

**Files:**
- Modify: `js/calc-double-par.js` (replace hook+placement §2-3 and tensions §7; add convergence warning)
- Test: `test-calc.js` (add `dbl-par-fixed-len-*` assertions after the existing `dbl-par-*` block)

**Interfaces:**
- Consumes: `CalcCore.solveHangingBeam` (Task 1), `computeSupportReactions`, `horizontalDist`, `dist3D`.
- Produces: unchanged result shape + a new `warnings.beamEquilibriumNotConverged` boolean; `beams[].length` == entered.

- [ ] **Step 1: Write the failing tests**

In `test-calc.js`, find the last `dbl-par-*` runTest (search `dbl-par-long-bottom-sling`) and insert just below it:

```javascript
// Fixed-length parallel beams: length honoured + each beam hangs plumb + hook
// stays over the total COG. Match slings by label; count matches (no vacuous green).
function parBeamHorizNet(res, endLabels) {
  const slings = res.tiers.flatMap(t => t.slings);
  let fx = 0, fy = 0, matched = 0;
  for (const label of endLabels) {
    for (const s of slings) {
      let endPt = null, other = null;
      if (s.from.label === label) { endPt = s.from; other = s.to; }
      else if (s.to.label === label) { endPt = s.to; other = s.from; }
      else continue;
      matched++;
      const dx = other.x - endPt.x, dy = other.y - endPt.y, dz = other.z - endPt.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      fx += s.tension * dx / L; fy += s.tension * dy / L;
    }
  }
  return { net: Math.sqrt(fx * fx + fy * fy), matched };
}
function runFixedParTest(name, shared, config, expectBeamLen) {
  totalTests++;
  const errs = [];
  let res;
  try { res = doubleParCalc(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  if (res.warnings.beamEquilibriumNotConverged) errs.push('did not converge');
  const beamA = res.beams.find(b => b.name === 'Beam A');
  const beamB = res.beams.find(b => b.name === 'Beam B');
  if (Math.abs(beamA.length - expectBeamLen) > 0.01) errs.push(`beamA ${beamA.length} != ${expectBeamLen}`);
  if (Math.abs(beamB.length - expectBeamLen) > 0.01) errs.push(`beamB ${beamB.length} != ${expectBeamLen}`);
  const a = parBeamHorizNet(res, ['Beam A End 1', 'Beam A End 2']);
  const b = parBeamHorizNet(res, ['Beam B End 1', 'Beam B End 2']);
  if (a.matched !== 4) errs.push(`beamA matched ${a.matched} != 4`);
  if (b.matched !== 4) errs.push(`beamB matched ${b.matched} != 4`);
  if (a.net > 0.03) errs.push(`beamA net horizontal ${a.net.toFixed(4)} not ~0`);
  if (b.net > 0.03) errs.push(`beamB net horizontal ${b.net.toFixed(4)} not ~0`);
  // Hook stays over the total COG: the 4 top slings' horizontal resultant ~ 0.
  const top = res.tiers.find(t => t.name === 'Top Slings').slings;
  let hx = 0, hy = 0;
  for (const s of top) {
    const dx = s.from.x - s.to.x, dy = s.from.y - s.to.y, dz = s.from.z - s.to.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    hx += s.tension * dx / L; hy += s.tension * dy / L;
  }
  if (Math.sqrt(hx * hx + hy * hy) > 0.05) errs.push(`hook horizontal resultant ${Math.sqrt(hx*hx+hy*hy).toFixed(4)} not ~0`);
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
// Pair spacing 6 m < 5 m beam is the shrink zone where the old computeBeamEndPair
// derived a shorter beam — these discriminate the fix.
runFixedParTest('dbl-par-fixed-len-symmetric',
  { liftingPoints: rectLPs(12, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLengthA: 5, beamLengthB: 5, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 }, 5);
runFixedParTest('dbl-par-fixed-len-offset',
  { liftingPoints: rectLPs(12, 6), cog: { x: 1.5, y: 0.8, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLengthA: 5, beamLengthB: 5, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 }, 5);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test-calc.js`
Expected: FAIL — `dbl-par-fixed-len-*` report `beamA <derived> != 5` (old code) and/or a missing `beamEquilibriumNotConverged` field. This proves the tests exercise the new behaviour.

- [ ] **Step 3: Implement — replace placement §2-3**

In `js/calc-double-par.js`, replace the block from `// ── 2. Compute hook from 4-leg direct geometry ──` (line 32) through the `beamB2 = pairB.end1;` line (line 45) with:

```javascript
    // ── 2. Per-LP vertical shares (min-norm rigid-body reactions) ──
    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    const wA0 = Math.max(0, reactions[groupAIdxs[0]]);
    const wA1 = Math.max(0, reactions[groupAIdxs[1]]);
    const wB0 = Math.max(0, reactions[groupBIdxs[0]]);
    const wB1 = Math.max(0, reactions[groupBIdxs[1]]);

    // ── 3. Fixed-length hanging beams. Hook is over the total COG; its height is
    //       set by the min top-sling angle over the beam ends. Poses depend on the
    //       hook height and the hook height depends on the ends, so iterate. ──
    const hookXY = { x: cog.x, y: cog.y };
    let hookZ = Math.max(...liftingPoints.map(lp => lp.z + C.horizontalDist(lp, hookXY) * Math.tan(minAngleRad)));
    let beamA1, beamA2, beamB1, beamB2, convergedA = true, convergedB = true;
    for (let outer = 0; outer < 12; outer++) {
      const rA = C.solveHangingBeam(groupALPs[0], groupALPs[1], wA0, wA1, hookXY, hookZ, beamLengthA, minAngleRad, minSlingLen);
      const rB = C.solveHangingBeam(groupBLPs[0], groupBLPs[1], wB0, wB1, hookXY, hookZ, beamLengthB, minAngleRad, minSlingLen);
      beamA1 = rA.end0; beamA2 = rA.end1; beamB1 = rB.end0; beamB2 = rB.end1;
      convergedA = rA.converged; convergedB = rB.converged;
      const ends = [beamA1, beamA2, beamB1, beamB2];
      const newHookZ = Math.max(...ends.map(e => e.z + C.horizontalDist(e, hookXY) * Math.tan(minAngleRad)));
      if (Math.abs(newHookZ - hookZ) < 1e-4) { hookZ = newHookZ; break; }
      hookZ = newHookZ;
    }
    const hook = { x: cog.x, y: cog.y, z: hookZ };
```

(`minSlingLen` and `minAngleRad` already exist at the top of `calculate`. The old `hookXY`/`hDists`/`requiredHookZs`/`hook` and the two `computeBeamEndPair` calls are removed.)

- [ ] **Step 4: Implement — replace tensions §7**

In the same file, replace the entire `// ── 7. Tensions ──` block (from that comment through the end of the bottom-tier `for` loop, currently lines 84-104) with:

```javascript
    // ── 7. Tensions — per-beam determinate: each end's top vertical component is
    //       that LP's load share (replaces the 4-leg calcLoadDistribution). ──
    const endW = [wA0, wA1, wB0, wB1];
    for (let i = 0; i < 4; i++) {
      const be = allBeamEnds[i], w = endW[i];
      const topLen = C.dist3D(be, hook);
      const topVd = hook.z - be.z;
      topSlings[i].tension = C.round4(topVd > 1e-9 ? w * topLen / topVd : w);
    }
    for (let i = 0; i < 4; i++) {
      const s = bottomSlings[i], w = endW[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      s.tension = C.round4((len < 0.0001 || vd < 0.0001) ? w : w * len / vd);
    }
```

- [ ] **Step 5: Implement — add the convergence warning**

In the returned `warnings: { ... }` object (currently lines 185-190), add one line so it reads:

```javascript
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        beamEquilibriumNotConverged: !convergedA || !convergedB,
        liftBeamBendingNotChecked: false
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node test-calc.js`
Expected: `dbl-par-fixed-len-*` PASS; ALL existing `dbl-par-*` invariant tests still PASS; total 168; 0 failures.
Run: `node test-simple.js`
Expected: 33/33 PASS.

If ANY existing `dbl-par-*` test regresses (angle floor, positive-tension, headroom, vLoad-sum) or a case fails to converge, STOP — revert `js/calc-double-par.js` (`git checkout -- js/calc-double-par.js`) and reconsider (solver robustness or an invariant tension). Do NOT loosen an invariant to make it pass.

- [ ] **Step 7: Commit**

```bash
git add js/calc-double-par.js test-calc.js
git commit -m "feat(parallel): fixed-length hanging beams + per-beam determinate tensions"
```

---

### Task 3: Surface the non-convergence warning + visual confirmation

**Files:**
- Modify: `js/app.js` (add the `beamEquilibriumNotConverged` message to `displayWarnings`)

**Interfaces:**
- Consumes: `warnings.beamEquilibriumNotConverged` from Task 2.

- [ ] **Step 1: Add the warning message**

In `js/app.js`, in `displayWarnings`, immediately AFTER the `if (warnings.liftBeamBendingNotChecked) { ... }` block (currently lines 974-976), insert:

```javascript
    if (warnings.beamEquilibriumNotConverged) {
      msgs.push('A spreader beam did not reach a balanced hanging position — the rig geometry for this configuration is UNRELIABLE. Verify the beam length, lifting-point positions, and COG.');
    }
```

- [ ] **Step 2: Verify the suites are still green**

Run: `node test-calc.js` → 168/168. Run: `node test-simple.js` → 33/33. (No calc change; this is UI text only.)

- [ ] **Step 3: Visual confirmation (fresh port — stale-cache rule)**

Start a fresh server (`python -m http.server <new-port>`), open Advanced (3D), select **Double Spreader (Parallel)**, set both beam lengths to **5**, Calculate. Confirm on screen + in *Beam Details*:
- `Beam A/B — Length` reads **5.000 m** (not a shrunk value).
- Each beam sits sensibly over its own LP pair (not dragged to the load centre) and the hook plumb line passes through the COG (no lean).
- Repeat with an offset-COG preset — beams shift toward the heavier side but stay near their LPs; still no lean.
- Browser console: 0 errors. Capture a screenshot. Kill the server by PID when done.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(ui): warn when a parallel spreader beam fails to reach equilibrium"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** §4 equilibrium → Task 1 solver; §5 zB/min-bottom → `zBof`; §6 algorithm + outer hook loop → Task 1 + Task 2 §3; §7 determinate tensions → Task 2 §4; §6 non-convergence warning → Task 2 §5 + Task 3.
- **Type consistency:** `solveHangingBeam` returns `{end0,end1,converged}` with 3-D ends; caller reads `.end0/.end1` and the outer loop reads `.z`. `wA0..wB1` clamp basis matches cascade. `mat3x3Inverse` takes `m[i][j]`, returns inverse or `null` (handled).
- **Risk:** the numerical solver must converge AND keep every existing `dbl-par-*` invariant. Task 2 Step 6 is the gate; revert-on-regression is mandatory (Global Constraints).
- **Not in scope:** cascade, reactions, hook-over-COG, Simple mode, other configs. Spreader/Lifting-Beam rollout is a later plan.
