/**
 * Automated test suite for sling-length-calculator — 100+ test cases across all 6 configs.
 * Run: node test-calc.js
 */

// ── Shim browser globals ──
const window = {};
global.window = window;

// ── Load calc modules ──
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ window, Math, Infinity, console, Array });

function loadFile(name) {
  const code = fs.readFileSync(path.join(__dirname, 'js', name), 'utf-8');
  vm.runInContext(code, ctx);
}

loadFile('calc-core.js');
loadFile('calc-direct.js');
loadFile('calc-spreader.js');
loadFile('calc-stinger.js');
loadFile('calc-liftbeam.js');
loadFile('calc-double-par.js');
loadFile('calc-double-cas.js');

// Extract calculators from context
const CalcCore    = vm.runInContext('CalcCore', ctx);
const CalcDirect  = vm.runInContext('CalcDirect', ctx);
const CalcSpreader = vm.runInContext('window.CalcSpreader', ctx);
const CalcStinger  = vm.runInContext('CalcStinger', ctx);
const CalcLiftBeam = vm.runInContext('CalcLiftBeam', ctx);
const CalcDoublePar = vm.runInContext('window.CalcDoublePar', ctx);
const CalcDoubleCas = vm.runInContext('window.CalcDoubleCas', ctx);

// ── Test harness ──
let totalTests = 0;
let passCount = 0;
const failures = [];

function runTest(name, calcFn, shared, config, opts = {}) {
  totalTests++;
  const errs = [];

  let result;
  try {
    result = calcFn(shared, config);
  } catch (e) {
    failures.push({ name, error: `EXCEPTION: ${e.message}`, shared, config });
    return;
  }

  // Collect all slings across all tiers
  const allSlings = result.tiers.flatMap(t => t.slings);

  // 1. No NaN or Infinity in key fields
  if (!isFinite(result.hookHeight)) errs.push(`hookHeight=${result.hookHeight}`);
  if (!isFinite(result.headroom))   errs.push(`headroom=${result.headroom}`);
  for (const s of allSlings) {
    if (!isFinite(s.length))            errs.push(`sling ${s.id} length=${s.length}`);
    if (!isFinite(s.angleDegFromHoriz)) errs.push(`sling ${s.id} angle=${s.angleDegFromHoriz}`);
    if (!isFinite(s.tension))           errs.push(`sling ${s.id} tension=${s.tension}`);
    if (!isFinite(s.verticalLoad))      errs.push(`sling ${s.id} vertLoad=${s.verticalLoad}`);
  }

  // 2. All sling lengths > 0
  for (const s of allSlings) {
    if (s.length <= 0) errs.push(`sling ${s.id} length=${s.length} <= 0`);
  }

  // 3. All sling angles between 0 and 90 (from horizontal)
  for (const s of allSlings) {
    if (s.angleDegFromHoriz < -0.1 || s.angleDegFromHoriz > 90.1)
      errs.push(`sling ${s.id} angle=${s.angleDegFromHoriz} out of [0,90]`);
  }

  // 4. Hook height > max LP height
  const maxLPz = Math.max(...shared.liftingPoints.map(p => p.z));
  if (result.hookHeight < maxLPz - 0.01)
    errs.push(`hookHeight ${result.hookHeight} < maxLPz ${maxLPz}`);

  // 5. Headroom > 0
  if (result.headroom < -0.01)
    errs.push(`headroom ${result.headroom} < 0`);

  // 6. Total vertical load ~ totalLoad (only for COG-inside cases, skip if negative tensions)
  if (!opts.expectNegativeTension && !result.warnings.cogOutsidePolygon) {
    // For configs with top slings, sum the top tier vertical loads.
    // For direct / lifting-beam (single tier), sum all vertical loads.
    let topTierSlings;
    if (result.tiers.length === 1) {
      topTierSlings = result.tiers[0].slings;
    } else {
      topTierSlings = result.tiers[result.tiers.length - 1].slings;
    }
    const sumVLoad = topTierSlings.reduce((s, sl) => s + sl.verticalLoad, 0);
    const tolerance = shared.totalLoad * 0.05; // 5% tolerance for rounding
    if (Math.abs(sumVLoad - shared.totalLoad) > Math.max(tolerance, 0.5))
      errs.push(`top-tier vLoad sum ${sumVLoad.toFixed(2)} != totalLoad ${shared.totalLoad} (diff ${Math.abs(sumVLoad - shared.totalLoad).toFixed(2)})`);
  }

  // 7. No negative tensions (unless expected/COG outside)
  if (!opts.expectNegativeTension && !result.warnings.cogOutsidePolygon) {
    for (const s of allSlings) {
      if (s.tension < -0.01)
        errs.push(`sling ${s.id} negative tension=${s.tension}`);
    }
  }

  // 8. Bottom sling angles >= minAngle (within 1-degree tolerance)
  // Bottom tier is always tiers[0]
  const bottomSlings = result.tiers[0].slings;
  for (const s of bottomSlings) {
    if (s.angleDegFromHoriz < shared.minAngleDeg - 1.0)
      errs.push(`bottom sling ${s.id} angle ${s.angleDegFromHoriz} < minAngle ${shared.minAngleDeg} (by ${(shared.minAngleDeg - s.angleDegFromHoriz).toFixed(1)} deg)`);
  }

  if (errs.length > 0) {
    failures.push({ name, errors: errs, shared, config });
  } else {
    passCount++;
  }
}

// ── LP layout helpers ──
function squareLPs(size, z = 0) {
  const h = size / 2;
  return [
    { x: -h, y: -h, z }, { x:  h, y: -h, z },
    { x:  h, y:  h, z }, { x: -h, y:  h, z }
  ];
}

function rectLPs(w, d, z = 0) {
  const hw = w / 2, hd = d / 2;
  return [
    { x: -hw, y: -hd, z }, { x:  hw, y: -hd, z },
    { x:  hw, y:  hd, z }, { x: -hw, y:  hd, z }
  ];
}

function trapezoidLPs(topW, botW, depth, z = 0) {
  const hd = depth / 2;
  return [
    { x: -botW / 2, y: -hd, z }, { x: botW / 2, y: -hd, z },
    { x: topW / 2,  y:  hd, z }, { x: -topW / 2, y: hd, z }
  ];
}

function irregularLPs() {
  return [
    { x: -3, y: -2, z: 0 }, { x: 4, y: -1, z: 0 },
    { x: 3,  y: 3,  z: 0 }, { x: -2, y: 4, z: 0 }
  ];
}

function elevatedLPs(base, zArr) {
  return base.map((p, i) => ({ ...p, z: zArr[i] || 0 }));
}

// ── Test Cases ──

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

// === CalcCore.fixedBeamEnds ===
function runFixedBeamEndsTest(name, lpA, lpB, wA, wB, subCOG, length, expect) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcCore.fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const dx = r.end1.x - r.end0.x, dy = r.end1.y - r.end0.y;
  const gotLen = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(gotLen - length) > 1e-6) errs.push(`length ${gotLen.toFixed(4)} != ${length}`);
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
runFixedBeamEndsTest('fbe-symmetric',
  { x: -3, y: 0 }, { x: 3, y: 0 }, 5, 5, { x: 0, y: 0 }, 4,
  { end0: { x: -2, y: 0 }, end1: { x: 2, y: 0 } });
runFixedBeamEndsTest('fbe-offset-x',
  { x: 0, y: 0 }, { x: 6, y: 0 }, 3, 7, { x: 4.2, y: 0 }, 5,
  { end0: { x: 0.7, y: 0 }, end1: { x: 5.7, y: 0 } });
runFixedBeamEndsTest('fbe-offset-y',
  { x: 0, y: 0 }, { x: 0, y: 6 }, 3, 7, { x: 0, y: 4.2 }, 5,
  { end0: { x: 0, y: 0.7 }, end1: { x: 0, y: 5.7 } });
runFixedBeamEndsTest('fbe-zero-share',
  { x: -2, y: 0 }, { x: 2, y: 0 }, 0, 0, { x: 0, y: 0 }, 4,
  { end0: { x: -2, y: 0 }, end1: { x: 2, y: 0 } });

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

// === 1. DIRECT (4-leg) ===
const directCalc = (s, c) => CalcDirect.calculate(s, c);

// 1-6: Square layouts at different min angles
[30, 45, 60, 75].forEach((ang, i) => {
  runTest(`direct-square-${ang}deg`, directCalc,
    { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 10 },
    {});
});

// 7-10: Rectangles
[{ w: 10, d: 4 }, { w: 4, d: 10 }, { w: 12, d: 2 }, { w: 2, d: 12 }].forEach((r, i) => {
  runTest(`direct-rect-${r.w}x${r.d}`, directCalc,
    { liftingPoints: rectLPs(r.w, r.d), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    {});
});

// 11-13: Offset COG
runTest('direct-cog-offset-x', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 1, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 }, {});
runTest('direct-cog-offset-y', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 1.5, z: 0 }, minAngleDeg: 45, totalLoad: 10 }, {});
runTest('direct-cog-offset-xy', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 1, y: 1, z: 0 }, minAngleDeg: 60, totalLoad: 15 }, {});

// 14-15: Elevated LPs
runTest('direct-elevated-uniform', directCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [2, 2, 2, 2]), cog: { x: 0, y: 0, z: 2 }, minAngleDeg: 45, totalLoad: 10 }, {});
runTest('direct-elevated-mixed', directCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [0, 1, 2, 0.5]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 10 }, {});

// 16-17: Trapezoid and irregular
runTest('direct-trapezoid', directCalc,
  { liftingPoints: trapezoidLPs(4, 8, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 12 }, {});
runTest('direct-irregular', directCalc,
  { liftingPoints: irregularLPs(), cog: { x: 0.5, y: 1, z: 0 }, minAngleDeg: 60, totalLoad: 8 }, {});

// 18: COG outside polygon
runTest('direct-cog-outside', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 5, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  {}, { expectNegativeTension: true });

// 19: Very small LP spread
runTest('direct-tiny-spread', directCalc,
  { liftingPoints: squareLPs(0.5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 5 }, {});

// 20: Heavy load
runTest('direct-heavy', directCalc,
  { liftingPoints: squareLPs(10), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 500 }, {});


// === 2. SPREADER BEAM ===
const spreaderCalc = (s, c) => CalcSpreader.calculate(s, c);

// 21-26: Various beam lengths and orientations
[
  { bl: 4, o: 'lengthwise', lps: rectLPs(10, 4) },
  { bl: 6, o: 'widthwise', lps: rectLPs(10, 4) },
  { bl: 3, o: 'lengthwise', lps: squareLPs(6) },
  { bl: 8, o: 'lengthwise', lps: rectLPs(12, 4) },
  { bl: 2, o: 'widthwise', lps: rectLPs(6, 10) },
  { bl: 5, o: 'lengthwise', lps: squareLPs(8) },
].forEach((t, i) => {
  runTest(`spreader-${i + 1}-bl${t.bl}-${t.o}`, spreaderCalc,
    { liftingPoints: t.lps, cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    { beamLength: t.bl, orientation: t.o });
});

// 27-29: Different min angles
[30, 60, 75].forEach(ang => {
  runTest(`spreader-angle-${ang}`, spreaderCalc,
    { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 15 },
    { beamLength: 3, orientation: 'widthwise' });
});

// 30-31: Offset COG
runTest('spreader-cog-offset', spreaderCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 1, y: 0.5, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 3, orientation: 'widthwise' });
runTest('spreader-cog-offset-large', spreaderCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 4, orientation: 'lengthwise' });

// 32-33: Elevated LPs
runTest('spreader-elevated', spreaderCalc,
  { liftingPoints: elevatedLPs(rectLPs(8, 4), [1, 1, 0, 0]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 15 },
  { beamLength: 3, orientation: 'widthwise' });
runTest('spreader-elevated-all', spreaderCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [3, 3, 3, 3]), cog: { x: 0, y: 0, z: 3 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLength: 4, orientation: 'lengthwise' });

// 34: Very large beam length (wider than LP spread)
runTest('spreader-large-beam', spreaderCalc,
  { liftingPoints: squareLPs(4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLength: 12, orientation: 'lengthwise' });

// 35: Trapezoid
runTest('spreader-trapezoid', spreaderCalc,
  { liftingPoints: trapezoidLPs(3, 6, 5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 15 },
  { beamLength: 4, orientation: 'lengthwise' });


// === 3. STINGER / EQUALISING TRIANGLE ===
const stingerCalc = (s, c) => CalcStinger.calculate(s, c);

// 36-40: Various top sling lengths
[0, 2, 4, 6, 8].forEach((tsl, i) => {
  runTest(`stinger-tsl-${tsl}`, stingerCalc,
    { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    { topSlingLength: tsl });
});

// 41-43: Different min angles
[30, 60, 75].forEach(ang => {
  runTest(`stinger-angle-${ang}`, stingerCalc,
    { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 15 },
    { topSlingLength: 3 });
});

// 44-45: Offset COG
runTest('stinger-cog-offset', stingerCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 1, y: 0.5, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { topSlingLength: 3 });
runTest('stinger-cog-offset-large', stingerCalc,
  { liftingPoints: squareLPs(6), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { topSlingLength: 4 });

// 46-47: Elevated LPs
runTest('stinger-elevated-uniform', stingerCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [2, 2, 2, 2]), cog: { x: 0, y: 0, z: 2 }, minAngleDeg: 45, totalLoad: 10 },
  { topSlingLength: 3 });
runTest('stinger-elevated-mixed', stingerCalc,
  { liftingPoints: elevatedLPs(rectLPs(8, 4), [0, 1, 2, 0.5]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 15 },
  { topSlingLength: 4 });

// 48: Irregular layout
runTest('stinger-irregular', stingerCalc,
  { liftingPoints: irregularLPs(), cog: { x: 0.5, y: 1, z: 0 }, minAngleDeg: 45, totalLoad: 12 },
  { topSlingLength: 5 });

// 49: Trapezoid
runTest('stinger-trapezoid', stingerCalc,
  { liftingPoints: trapezoidLPs(3, 7, 5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 18 },
  { topSlingLength: 3 });

// 50: Auto top sling (0) with large spread
runTest('stinger-auto-large', stingerCalc,
  { liftingPoints: rectLPs(12, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 30 },
  { topSlingLength: 0 });


// === 4. LIFTING BEAM ===
const liftbeamCalc = (s, c) => CalcLiftBeam.calculate(s, c);

// 51-56: Various beam lengths and orientations
[
  { bl: 8, o: 'lengthwise', lps: rectLPs(10, 4) },
  { bl: 3, o: 'widthwise', lps: rectLPs(10, 4) },
  { bl: 5, o: 'lengthwise', lps: squareLPs(6) },
  { bl: 10, o: 'lengthwise', lps: rectLPs(8, 4) },
  { bl: 4, o: 'widthwise', lps: rectLPs(4, 8) },
  { bl: 6, o: 'lengthwise', lps: squareLPs(8) },
].forEach((t, i) => {
  runTest(`liftbeam-${i + 1}`, liftbeamCalc,
    { liftingPoints: t.lps, cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    { beamLength: t.bl, orientation: t.o });
});

// 57-58: Different min angles
[30, 60].forEach(ang => {
  runTest(`liftbeam-angle-${ang}`, liftbeamCalc,
    { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 15 },
    { beamLength: 6, orientation: 'lengthwise' });
});

// 59-60: Offset COG
runTest('liftbeam-cog-offset', liftbeamCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 8, orientation: 'lengthwise' });
runTest('liftbeam-cog-offset-y', liftbeamCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 0, y: 1, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 8, orientation: 'lengthwise' });

// 61-62: Elevated LPs
runTest('liftbeam-elevated', liftbeamCalc,
  { liftingPoints: elevatedLPs(rectLPs(8, 4), [0, 0, 1, 1]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 15 },
  { beamLength: 6, orientation: 'lengthwise' });
runTest('liftbeam-elevated-all', liftbeamCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [5, 5, 5, 5]), cog: { x: 0, y: 0, z: 5 }, minAngleDeg: 60, totalLoad: 10 },
  { beamLength: 5, orientation: 'lengthwise' });

// 63: Very large beam
runTest('liftbeam-large-beam', liftbeamCalc,
  { liftingPoints: squareLPs(4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLength: 15, orientation: 'lengthwise' });

// 64: Trapezoid
runTest('liftbeam-trapezoid', liftbeamCalc,
  { liftingPoints: trapezoidLPs(4, 8, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 18 },
  { beamLength: 6, orientation: 'lengthwise' });

// 65: Irregular
runTest('liftbeam-irregular', liftbeamCalc,
  { liftingPoints: irregularLPs(), cog: { x: 0.5, y: 1, z: 0 }, minAngleDeg: 45, totalLoad: 12 },
  { beamLength: 5, orientation: 'lengthwise' });


// === 5. DOUBLE SPREADER PARALLEL ===
const doubleParCalc = (s, c) => CalcDoublePar.calculate(s, c);

// 66-71: Various beam lengths
[
  { bla: 3, blb: 3, lps: rectLPs(8, 4) },
  { bla: 2, blb: 2, lps: squareLPs(6) },
  { bla: 4, blb: 4, lps: rectLPs(10, 6) },
  { bla: 1, blb: 1, lps: rectLPs(6, 3) },
  { bla: 3, blb: 5, lps: rectLPs(10, 4) },
  { bla: 6, blb: 6, lps: squareLPs(8) },
].forEach((t, i) => {
  runTest(`dbl-par-${i + 1}`, doubleParCalc,
    { liftingPoints: t.lps, cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    { beamLengthA: t.bla, beamLengthB: t.blb, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });
});

// 72-73: Different min angles
[30, 60].forEach(ang => {
  runTest(`dbl-par-angle-${ang}`, doubleParCalc,
    { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 15 },
    { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });
});

// 74-75: Offset COG
runTest('dbl-par-cog-offset', doubleParCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 1, y: 0.5, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });
runTest('dbl-par-cog-offset-big', doubleParCalc,
  { liftingPoints: squareLPs(6), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });

// 76-77: Elevated LPs
runTest('dbl-par-elevated', doubleParCalc,
  { liftingPoints: elevatedLPs(rectLPs(8, 4), [0, 1, 1, 0]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 15 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });
runTest('dbl-par-elevated-all', doubleParCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [4, 4, 4, 4]), cog: { x: 0, y: 0, z: 4 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });

// 78: Very large beam
runTest('dbl-par-large-beam', doubleParCalc,
  { liftingPoints: squareLPs(4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLengthA: 10, beamLengthB: 10, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });

// 79: Trapezoid
runTest('dbl-par-trapezoid', doubleParCalc,
  { liftingPoints: trapezoidLPs(3, 7, 5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 18 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 });

// 80: Different bottom sling lengths
runTest('dbl-par-long-bottom-sling', doubleParCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 5 });

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

// Negative min-norm reaction (COG outside the support kern but inside the hull):
// subCogFallback must fire, no NaN, beams keep their fixed length via seed fallback.
(function runNegShareParTest() {
  totalTests++;
  const errs = [];
  let res;
  try {
    res = doubleParCalc(
      { liftingPoints: rectLPs(12, 6), cog: { x: 4, y: 2, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
      { beamLengthA: 5, beamLengthB: 5, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 }
    );
  } catch (e) { failures.push({ name: 'dbl-par-neg-share', error: `EXCEPTION: ${e.message}` }); return; }
  if (res.warnings.subCogFallback !== true) errs.push('subCogFallback did not fire for COG outside kern');
  const slings = res.tiers.flatMap(t => t.slings);
  for (const s of slings) {
    if (!isFinite(s.length)) errs.push(`NaN sling length (${s.from.label}->${s.to.label})`);
    if (!isFinite(s.tension)) errs.push(`NaN sling tension (${s.from.label}->${s.to.label})`);
  }
  for (const b of res.beams) {
    if (!isFinite(b.length)) errs.push(`NaN beam length (${b.name})`);
    else if (Math.abs(b.length - 5) > 0.01) errs.push(`${b.name} length ${b.length} != 5 (fixed length not preserved in fallback)`);
  }
  if (errs.length) failures.push({ name: 'dbl-par-neg-share', errors: errs });
  else passCount++;
})();


// === 6. DOUBLE SPREADER CASCADING ===
const doubleCasCalc = (s, c) => CalcDoubleCas.calculate(s, c);

// 81-86: Various master/slave lengths
[
  { ml: 6, sla: 3, slb: 3, lps: rectLPs(8, 4) },
  { ml: 4, sla: 2, slb: 2, lps: squareLPs(6) },
  { ml: 8, sla: 4, slb: 4, lps: rectLPs(10, 6) },
  { ml: 5, sla: 3, slb: 3, lps: rectLPs(6, 4) },
  { ml: 6, sla: 2, slb: 4, lps: rectLPs(10, 4) },
  { ml: 10, sla: 3, slb: 3, lps: squareLPs(8) },
].forEach((t, i) => {
  runTest(`dbl-cas-${i + 1}`, doubleCasCalc,
    { liftingPoints: t.lps, cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
    { masterLength: t.ml, slaveLengthA: t.sla, slaveLengthB: t.slb, bottomSlingLen: 2 });
});

// 87-88: Different min angles
[30, 60].forEach(ang => {
  runTest(`dbl-cas-angle-${ang}`, doubleCasCalc,
    { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: ang, totalLoad: 15 },
    { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });
});

// 89-90: Offset COG
runTest('dbl-cas-cog-offset', doubleCasCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 1, y: 0.5, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });
runTest('dbl-cas-cog-offset-big', doubleCasCalc,
  { liftingPoints: squareLPs(6), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { masterLength: 5, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });

// 91-92: Elevated LPs
runTest('dbl-cas-elevated', doubleCasCalc,
  { liftingPoints: elevatedLPs(rectLPs(8, 4), [0, 0, 2, 2]), cog: { x: 0, y: 0, z: 1 }, minAngleDeg: 45, totalLoad: 15 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });
runTest('dbl-cas-elevated-all', doubleCasCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [3, 3, 3, 3]), cog: { x: 0, y: 0, z: 3 }, minAngleDeg: 45, totalLoad: 10 },
  { masterLength: 5, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });

// 93: Large master beam
runTest('dbl-cas-large-master', doubleCasCalc,
  { liftingPoints: squareLPs(4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { masterLength: 12, slaveLengthA: 2, slaveLengthB: 2, bottomSlingLen: 2 });

// Fixed-length slave beams: actual 2nd-lvl beam length == entered length,
// and the slave beam hangs plumb (net horizontal force on the beam ~ 0).
// Net horizontal force on a slave beam = Σ over its ends of Σ over the slings
// attached to that end of tension·unit(end→other). Match by LABEL (robust to
// coordinate rounding) and count matches so a mislabel can't pass vacuously.
function beamHorizNet(res, endLabels) {
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
function runFixedSlaveTest(name, shared, config, expectBeamLen, expectEndZ) {
  totalTests++;
  const errs = [];
  let res;
  try { res = doubleCasCalc(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const beamA = res.beams.find(b => b.name === '2nd Lvl Beam A');
  const beamB = res.beams.find(b => b.name === '2nd Lvl Beam B');
  if (Math.abs(beamA.length - expectBeamLen) > 0.01) errs.push(`beamA ${beamA.length} != ${expectBeamLen}`);
  if (Math.abs(beamB.length - expectBeamLen) > 0.01) errs.push(`beamB ${beamB.length} != ${expectBeamLen}`);
  // Both slave beams must hang plumb (net horizontal ~ 0), each with 4 slings matched.
  const a = beamHorizNet(res, ['2nd A End 1', '2nd A End 2']);
  const b = beamHorizNet(res, ['2nd B End 1', '2nd B End 2']);
  if (a.matched !== 4) errs.push(`beamA matched ${a.matched} slings != 4`);
  if (b.matched !== 4) errs.push(`beamB matched ${b.matched} slings != 4`);
  if (a.net > 0.02) errs.push(`beamA net horizontal ${a.net.toFixed(4)} not ~0`);
  if (b.net > 0.02) errs.push(`beamB net horizontal ${b.net.toFixed(4)} not ~0`);
  // Optional hand-calculated beam height (both slave ends share one z).
  if (expectEndZ != null && Math.abs(beamA.endA.z - expectEndZ) > 0.01)
    errs.push(`beamA endA.z ${beamA.endA.z} != ${expectEndZ}`);
  if (errs.length) failures.push({ name, errors: errs });
  else passCount++;
}
// Pair spacing 6 m < 5 m beam is inside the min-bottom-sling clamp zone, where
// the OLD computeBeamEndPair shrank the beam to ~4 m — so these discriminate the
// fix. New code must keep the full 5 m and stay horizontally balanced.
// Symmetric hand-check: pair along y at x=-6, ends at y=±2.5 → each bottom sling
// hd=0.5 from its LP; min-length (2) governs → zBeam = sqrt(2^2 - 0.5^2) = 1.9365.
runFixedSlaveTest('dbl-cas-fixed-len-symmetric',
  { liftingPoints: rectLPs(12, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 10, slaveLengthA: 5, slaveLengthB: 5, bottomSlingLen: 2 }, 5, 1.9365);
runFixedSlaveTest('dbl-cas-fixed-len-offset',
  { liftingPoints: rectLPs(12, 6), cog: { x: 1.5, y: 0.8, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 10, slaveLengthA: 5, slaveLengthB: 5, bottomSlingLen: 2 }, 5);

// 94: Trapezoid
runTest('dbl-cas-trapezoid', doubleCasCalc,
  { liftingPoints: trapezoidLPs(3, 7, 5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 18 },
  { masterLength: 5, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });

// 95: Irregular
runTest('dbl-cas-irregular', doubleCasCalc,
  { liftingPoints: irregularLPs(), cog: { x: 0.5, y: 1, z: 0 }, minAngleDeg: 45, totalLoad: 12 },
  { masterLength: 5, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2 });

// 96: Long bottom slings
runTest('dbl-cas-long-bottom', doubleCasCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 5 });

// 97: 75 deg min angle
runTest('dbl-cas-steep-75', doubleCasCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 75, totalLoad: 10 },
  { masterLength: 4, slaveLengthA: 2, slaveLengthB: 2, bottomSlingLen: 2 });

// === CASCADE: Main Beam over lifting points, hook over COG ===
// Main Beam centres over the LP-midpoint (NOT the COG). With a centred COG the beam
// centre coincides with the COG so the top slings are equal; with an offset COG the
// beam stays over the LPs while the hook stays over the COG, so the top slings differ.
function runCascadeTopEqualTest(name, shared, config) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const top = r.tiers[2].slings; // tiers = [Bottom, Middle, Top]
  if (Math.abs(top[0].length - top[1].length) > 0.02)
    errs.push(`top slings should be equal (centred COG): ${top[0].length} vs ${top[1].length}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
runCascadeTopEqualTest('dbl-cas-centred-cog-top-equal',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2,
    pairing: { groupA: [1, 4], groupB: [2, 3] } });

// Offset COG: Main Beam centre stays over the LP-midpoint (NOT the COG), hook over
// COG, so the two top slings come out at different lengths (rig hangs plumb, no lean).
function runCascadeBeamOverLpsTest(name, shared, config, expectBeamCenter) {
  totalTests++;
  const errs = [];
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }
  const mb = r.beams.find(b => b.name === 'Main Beam');
  const beamCx = (mb.endA.x + mb.endB.x) / 2, beamCy = (mb.endA.y + mb.endB.y) / 2;
  if (Math.abs(beamCx - expectBeamCenter.x) > 0.02 || Math.abs(beamCy - expectBeamCenter.y) > 0.02)
    errs.push(`beam centre (${beamCx.toFixed(3)},${beamCy.toFixed(3)}) != LP-mid (${expectBeamCenter.x},${expectBeamCenter.y})`);
  if (Math.abs(beamCx - shared.cog.x) < 0.02 && Math.abs(beamCy - shared.cog.y) < 0.02)
    errs.push(`beam centre coincides with the offset COG — should stay over LP-mid`);
  if (Math.abs(r.hook.x - shared.cog.x) > 0.01 || Math.abs(r.hook.y - shared.cog.y) > 0.01)
    errs.push(`hook (${r.hook.x},${r.hook.y}) not over COG (${shared.cog.x},${shared.cog.y})`);
  const top = r.tiers[2].slings;
  if (Math.abs(top[0].length - top[1].length) < 0.1)
    errs.push(`top slings should differ (offset COG): ${top[0].length} vs ${top[1].length}`);
  if (errs.length) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}
runCascadeBeamOverLpsTest('dbl-cas-offset-cog-beam-over-lps',
  { liftingPoints: rectLPs(8, 4), cog: { x: 1.5, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2,
    pairing: { groupA: [1, 4], groupB: [2, 3] } },
  { x: 0, y: 0 });

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

// Per-lay angle is a FLOOR at the global min: a below-min override must NOT lower the lay.
runCascadeLayAngleTest('dbl-cas-top-angle-below-globalmin-floored',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, topAngleDeg: 30 },
  2, 60);  // top governed to 60 (the global min), NOT 30
runCascadeLayAngleTest('dbl-cas-middle-angle-below-globalmin-floored',
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, middleAngleDeg: 30 },
  1, 60);  // middle governed to >= 60

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
  // picks must lie ON the physical bar segment (endA..endB), not just within radius of endA.
  // A point P lies on segment endA-endB iff dist(P,endA) + dist(P,endB) == spanAB (within tolerance);
  // a sign-flipped/outboard pick would push the sum above spanAB.
  const pA = r.intermediatePoints.find(p => p.label === 'Main Pick A');
  const pB = r.intermediatePoints.find(p => p.label === 'Main Pick B');
  if (!pA || !pB) { failures.push({ name, errors: ['Main Pick A/B missing from intermediatePoints'], shared, config }); return; }
  const spanAB = Math.sqrt((mb.endB.x - mb.endA.x) ** 2 + (mb.endB.y - mb.endA.y) ** 2);
  for (const [label, p] of [['Main Pick A', pA], ['Main Pick B', pB]]) {
    const dEndA = Math.sqrt((p.x - mb.endA.x) ** 2 + (p.y - mb.endA.y) ** 2);
    const dEndB = Math.sqrt((p.x - mb.endB.x) ** 2 + (p.y - mb.endB.y) ** 2);
    if (dEndA + dEndB > spanAB + 0.01) errs.push(`${label} outside bar span`);
  }
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
// In-hull near-corner COG (inside the polygon but outside the support "kern"):
// a reaction goes negative -> clamp-and-renormalise keeps the pick LOAD-AWARE
// (lands on the loaded LP), NOT the geometric midpoint. Still flagged unreliable.
(function () {
  totalTests++;
  const errs = [];
  const shared = { liftingPoints: rectLPs(8, 4), cog: { x: 3.5, y: 1.75, z: 0 }, minAngleDeg: 45, totalLoad: 20 };
  const config = { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2, pairing: { groupA: [1, 4], groupB: [2, 3] } };
  let r;
  try { r = CalcDoubleCas.calculate(shared, config); }
  catch (e) { failures.push({ name: 'dbl-cas-subcog-clamp-loadaware', error: `EXCEPTION: ${e.message}` }); return; }
  if (!r.warnings.subCogFallback) errs.push('subCogFallback should be true for in-hull near-corner COG');
  if (r.warnings.cogOutsidePolygon) errs.push('cogOutsidePolygon should be false (COG is inside the hull)');
  const pA = r.intermediatePoints.find(p => p.label === 'Main Pick A');
  // group A = LP1(-4,-2) [reaction<0 -> clamped to 0] + LP4(-4,2): pick lands on
  // the loaded LP4 (~ -4, 2), NOT the geometric midpoint (-4, 0).
  if (!pA || Math.abs(pA.x - (-4)) > 0.01 || pA.y < 1.5)
    errs.push(`pickA (${pA && pA.x},${pA && pA.y}) not clamped toward loaded LP4 (~-4,2); midpoint would be (-4,0)`);
  if (errs.length) failures.push({ name: 'dbl-cas-subcog-clamp-loadaware', errors: errs });
  else passCount++;
})();

// === 7. ADDITIONAL EDGE CASES (to reach 100+) ===

// 98: COG at LP height on elevated layout (direct)
runTest('direct-cog-at-lp-height', directCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [5, 5, 5, 5]), cog: { x: 0, y: 0, z: 5 }, minAngleDeg: 45, totalLoad: 10 }, {});

// 99: Nearly collinear LPs (very narrow rectangle)
runTest('direct-narrow', directCalc,
  { liftingPoints: rectLPs(20, 0.5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 30, totalLoad: 10 }, {});

// 100: Large totalLoad
runTest('spreader-heavy-load', spreaderCalc,
  { liftingPoints: rectLPs(12, 6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 1000 },
  { beamLength: 5, orientation: 'widthwise' });

// 101: All different LP Z with stinger
runTest('stinger-all-diff-z', stingerCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [0, 2, 4, 1]), cog: { x: 0, y: 0, z: 1 }, minAngleDeg: 45, totalLoad: 10 },
  { topSlingLength: 4 });

// 102: Square LPs with spreader widthwise
runTest('spreader-square-widthwise', spreaderCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 10 },
  { beamLength: 3, orientation: 'widthwise' });

// 103: Cascading with explicit pairing
runTest('dbl-cas-explicit-pair', doubleCasCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, bottomSlingLen: 2,
    pairing: { groupA: [1, 2], groupB: [3, 4] } });

// 104: Direct with COG elevated above LPs
runTest('direct-cog-above-lps', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 2 }, minAngleDeg: 45, totalLoad: 10 }, {});

// 105: Stinger with 30 deg and auto top sling
runTest('stinger-30-auto', stingerCalc,
  { liftingPoints: rectLPs(10, 5), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 30, totalLoad: 25 },
  { topSlingLength: 0 });


// === SLACK-LEG TOLERANCE CHECK ===
function runSlackLegTest(name, calcFn, shared, config, opts = {}) {
  totalTests++;
  const errs = [];

  let result;
  try {
    result = calcFn(shared, config);
  } catch (e) {
    failures.push({ name, error: `EXCEPTION: ${e.message}`, shared, config });
    return;
  }

  const sla = result.slackLegAnalysis;

  if (opts.expectApplicable === false) {
    if (!sla || sla.applicable !== false) errs.push(`expected applicable=false, got ${sla && sla.applicable}`);
  } else {
    if (!sla || sla.applicable !== true) {
      errs.push(`expected applicable=true, got ${sla && sla.applicable}`);
    } else {
      const N = result.tiers[0].slings.length;
      if (sla.scenarios.length !== N) errs.push(`expected ${N} scenarios, got ${sla.scenarios.length}`);

      sla.scenarios.forEach((sc, i) => {
        // Slack sling tension must be 0
        const slackT = sc.tensions[sc.slackSlingId - 1];
        if (Math.abs(slackT) > 0.001) errs.push(`scenario ${i}: slack sling tension ${slackT} != 0`);
        // Max tension must equal max of tensions array
        const calcMax = Math.max(...sc.tensions);
        if (Math.abs(calcMax - sc.maxTension) > 0.01) errs.push(`scenario ${i}: maxTension ${sc.maxTension} != actual max ${calcMax}`);
        // Critical sling must point to the max
        if (Math.abs(sc.tensions[sc.criticalSlingId - 1] - sc.maxTension) > 0.01)
          errs.push(`scenario ${i}: critical sling tension doesn't match maxTension`);
        // No NaN/Infinity
        sc.tensions.forEach(t => { if (!isFinite(t)) errs.push(`scenario ${i}: NaN tension`); });
      });

      // Worst-case max must >= base max (slack always increases load on a sling)
      if (sla.worstCase.maxTension < sla.baseMaxTension - 0.01)
        errs.push(`worstCase max ${sla.worstCase.maxTension} < base max ${sla.baseMaxTension}`);

      if (opts.checkVerticalSum) {
        // For 4-leg direct symmetric: verify that for each scenario, the sum of vertical
        // components of remaining tensions equals totalLoad.
        sla.scenarios.forEach((sc, i) => {
          let sumV = 0;
          for (let j = 0; j < sc.tensions.length; j++) {
            if (j === sc.slackSlingId - 1) continue;
            const lp = shared.liftingPoints[j];
            const dx = result.hook.x - lp.x;
            const dy = result.hook.y - lp.y;
            const dz = result.hook.z - lp.z;
            const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const uz = dz / L;
            sumV += sc.tensions[j] * uz;
          }
          if (Math.abs(sumV - shared.totalLoad) > 0.05)
            errs.push(`scenario ${i}: sum of vertical tensions ${sumV.toFixed(3)} != totalLoad ${shared.totalLoad}`);
        });
      }
    }
  }

  if (errs.length > 0) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}

// 106-109: Direct slack-leg — applicability + math
runSlackLegTest('slack-direct-symmetric-square', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMm: 200 },
  {}, { checkVerticalSum: true });

runSlackLegTest('slack-direct-rect', directCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0.5, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 20, toleranceMm: 200 },
  {}, { checkVerticalSum: true });

runSlackLegTest('slack-direct-elevated-mixed', directCalc,
  { liftingPoints: elevatedLPs(squareLPs(6), [0, 1, 2, 0.5]), cog: { x: 0, y: 0, z: 0.5 }, minAngleDeg: 45, totalLoad: 10, toleranceMm: 200 },
  {}, { checkVerticalSum: true });

runSlackLegTest('slack-direct-irregular', directCalc,
  { liftingPoints: irregularLPs(), cog: { x: 0.5, y: 1, z: 0 }, minAngleDeg: 60, totalLoad: 8, toleranceMm: 200 },
  {}, { checkVerticalSum: true });

// 110-114: Paired configs must report applicable=false
runSlackLegTest('slack-spreader-not-applicable', spreaderCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMm: 200 },
  { beamLength: 6, orientation: 'lengthwise' }, { expectApplicable: false });

runSlackLegTest('slack-stinger-not-applicable', stingerCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMm: 200 },
  { topSlingLength: 1 }, { expectApplicable: false });

runSlackLegTest('slack-liftbeam-not-applicable', liftbeamCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMm: 200 },
  { beamLength: 6, orientation: 'lengthwise' }, { expectApplicable: false });

runSlackLegTest('slack-double-par-not-applicable', doubleParCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 15, toleranceMm: 200 },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 },
  { expectApplicable: false });

runSlackLegTest('slack-double-cas-not-applicable', doubleCasCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 20, toleranceMm: 200 },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, masterOrientation: 'lengthwise', bottomSlingLen: 2 },
  { expectApplicable: false });

// 115: Symmetric square 4-leg analytical sanity:
// With COG centred and symmetric LPs, dropping any 1 sling → remaining 3 share 10 t.
// Worst-case sling tension should be the same regardless of which is dropped (by symmetry).
{
  totalTests++;
  const r = directCalc(
    { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMm: 200 },
    {}
  );
  const errs = [];
  const maxes = r.slackLegAnalysis.scenarios.map(sc => sc.maxTension);
  const allEqual = maxes.every(m => Math.abs(m - maxes[0]) < 0.01);
  if (!allEqual) errs.push(`symmetric: scenario maxes differ: ${maxes.join(',')}`);
  // For a centred COG with 4 symmetric LPs, dropping one → diagonally opposite sling
  // goes to zero tension; the other two (perpendicular pair) each carry 10/(2·sin60°) =
  // 5.7735 t. This is the classic "2× factor" — base critical was 10/(4·sin60°) =
  // 2.887 t, so worst-case ≈ 2.0× base.
  if (Math.abs(maxes[0] - 5.7735) > 0.05)
    errs.push(`symmetric: expected slack max ~5.7735 t, got ${maxes[0]}`);
  // Verify the 2× ratio over base critical
  const baseMax = r.slackLegAnalysis.baseMaxTension;
  const ratio = maxes[0] / baseMax;
  if (Math.abs(ratio - 2.0) > 0.05)
    errs.push(`symmetric: expected slack/base ratio ~2.0, got ${ratio.toFixed(3)}`);
  if (errs.length > 0) failures.push({ name: 'slack-direct-symmetric-analytical', errors: errs, shared: {}, config: {} });
  else passCount++;
}


// === LOAD-SHARING TOLERANCE FACTOR (Nobles) ===
// Tests for CalcCore.applyLoadSharingFactor — pure unit tests, no calculator wiring yet.
function runLSFTest(name, tensions, configType, mode, expected) {
  totalTests++;
  const errs = [];
  const r = CalcCore.applyLoadSharingFactor(tensions, configType, mode);

  if (expected.applicable !== undefined && r.applicable !== expected.applicable)
    errs.push(`applicable: expected ${expected.applicable}, got ${r.applicable}`);
  if (expected.factor !== undefined && r.factor !== expected.factor)
    errs.push(`factor: expected ${expected.factor}, got ${r.factor}`);
  if (expected.adjustedMaxTension !== undefined &&
      Math.abs((r.adjustedMaxTension ?? 0) - expected.adjustedMaxTension) > 0.001)
    errs.push(`adjustedMaxTension: expected ${expected.adjustedMaxTension}, got ${r.adjustedMaxTension}`);
  if (expected.toleranceMode !== undefined && r.toleranceMode !== expected.toleranceMode)
    errs.push(`toleranceMode: expected ${expected.toleranceMode}, got ${r.toleranceMode}`);
  if (expected.baseMaxTension !== undefined &&
      Math.abs(r.baseMaxTension - expected.baseMaxTension) > 0.001)
    errs.push(`baseMaxTension: expected ${expected.baseMaxTension}, got ${r.baseMaxTension}`);

  if (errs.length > 0) failures.push({ name, errors: errs });
  else passCount++;
}

// Theoretical mode — factor 1, applicable for any config (or none)
runLSFTest('lsf-theoretical-direct', [4, 3, 2, 1], 'direct', 'theoretical',
  { applicable: true, factor: 1.0, baseMaxTension: 4, adjustedMaxTension: 4, toleranceMode: 'theoretical' });
runLSFTest('lsf-theoretical-no-config', [5], null, 'theoretical',
  { applicable: true, factor: 1.0, baseMaxTension: 5, adjustedMaxTension: 5 });
runLSFTest('lsf-theoretical-undefined-mode', [10, 8], 'direct', undefined,
  { applicable: true, factor: 1.0, baseMaxTension: 10, adjustedMaxTension: 10, toleranceMode: 'theoretical' });

// mm50 — direct measurements from Nobles
runLSFTest('lsf-pct2_5-direct', [5, 4, 3, 2], 'direct', 'pct2_5',
  { applicable: true, factor: 1.88, baseMaxTension: 5, adjustedMaxTension: 9.4 });
runLSFTest('lsf-pct2_5-spreader', [5, 4, 3, 2], 'spreader-beam', 'pct2_5',
  { applicable: true, factor: 1.18, baseMaxTension: 5, adjustedMaxTension: 5.9 });
runLSFTest('lsf-pct2_5-stinger', [5, 4, 3, 2], 'stinger', 'pct2_5',
  { applicable: true, factor: 1.36, baseMaxTension: 5, adjustedMaxTension: 6.8 });

// mm50 — equivalents (mapped configs)
runLSFTest('lsf-pct2_5-liftbeam-as-spreader', [5], 'lifting-beam', 'pct2_5',
  { applicable: true, factor: 1.18, adjustedMaxTension: 5.9 });
runLSFTest('lsf-pct2_5-doublepar-as-spreader', [5], 'double-parallel', 'pct2_5',
  { applicable: true, factor: 1.18, adjustedMaxTension: 5.9 });
runLSFTest('lsf-pct2_5-doublecas-as-stinger', [5], 'double-cascade', 'pct2_5',
  { applicable: true, factor: 1.36, adjustedMaxTension: 6.8 });

// mm250 — Nobles measured for spreader+stinger families only
runLSFTest('lsf-pct12_5-spreader', [10], 'spreader-beam', 'pct12_5',
  { applicable: true, factor: 1.68, adjustedMaxTension: 16.8 });
runLSFTest('lsf-pct12_5-stinger', [10], 'stinger', 'pct12_5',
  { applicable: true, factor: 2.00, adjustedMaxTension: 20.0 });

// mm250 — direct: NOT measured by Nobles → applicable=false
runLSFTest('lsf-pct12_5-direct-not-measured', [10], 'direct', 'pct12_5',
  { applicable: false, factor: null });

// Unknown configType → applicable=false (theoretical mode is the safe fallback)
runLSFTest('lsf-pct2_5-unknown-config', [10], 'unknown-arrangement', 'pct2_5',
  { applicable: false, factor: null });

// baseMaxTension picks max regardless of order
runLSFTest('lsf-base-picks-max', [1, 5, 3, 2], 'spreader-beam', 'pct2_5',
  { baseMaxTension: 5, factor: 1.18, adjustedMaxTension: 5.9 });


// === LOAD-SHARING INTEGRATION (per-config) ===
// Verifies each calculator emits result.loadSharingAnalysis with the right factor.
function runLSFIntegrationTest(name, calcFn, shared, config, expectedConfigType, expectedFactor) {
  totalTests++;
  const errs = [];
  let r;
  try { r = calcFn(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }

  const lsa = r.loadSharingAnalysis;
  if (!lsa) { errs.push('loadSharingAnalysis missing'); }
  else {
    if (r.configType !== expectedConfigType)
      errs.push(`configType: expected ${expectedConfigType}, got ${r.configType}`);
    if (lsa.factor !== expectedFactor)
      errs.push(`factor: expected ${expectedFactor}, got ${lsa.factor}`);

    // baseMaxTension must equal max of BOTTOM-TIER tensions only — Nobles tested
    // the 4 load-attached chains (bottom tier). Top slings above a spreader/stinger
    // are statically determinate 2-leg geometry and don't share this tolerance issue.
    const bottomTier = r.tiers.find(t => /bottom/i.test(t.name)) || r.tiers[0];
    const expectedBase = Math.max(...bottomTier.slings.map(s => s.tension));
    if (Math.abs(lsa.baseMaxTension - CalcCore.round4(expectedBase)) > 0.01)
      errs.push(`baseMaxTension ${lsa.baseMaxTension} != max(bottom tier) ${expectedBase}`);

    // adjustedMaxTension == baseMaxTension * factor (when applicable)
    if (lsa.applicable && Math.abs(lsa.adjustedMaxTension - CalcCore.round4(lsa.baseMaxTension * lsa.factor)) > 0.01)
      errs.push(`adjustedMaxTension ${lsa.adjustedMaxTension} != baseMaxTension * factor`);
  }

  if (errs.length > 0) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}

// Direct config — tolerance modes
runLSFIntegrationTest('integ-direct-theoretical', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'theoretical' },
  {}, 'direct', 1.0);

runLSFIntegrationTest('integ-direct-pct2_5', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct2_5' },
  {}, 'direct', 1.88);

runLSFIntegrationTest('integ-direct-default-no-mode', directCalc,
  { liftingPoints: squareLPs(6), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10 },
  {}, 'direct', 1.0);

// Spreader, stinger, lift-beam, double-par, double-cas — mm50 mode
runLSFIntegrationTest('integ-spreader-pct2_5', spreaderCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct2_5' },
  { beamLength: 6, orientation: 'lengthwise' }, 'spreader-beam', 1.18);

runLSFIntegrationTest('integ-stinger-pct2_5', stingerCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct2_5' },
  { topSlingLength: 1 }, 'stinger', 1.36);

runLSFIntegrationTest('integ-liftbeam-pct2_5', liftbeamCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct2_5' },
  { beamLength: 6, orientation: 'lengthwise' }, 'lifting-beam', 1.18);

runLSFIntegrationTest('integ-doublepar-pct2_5', doubleParCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 15, toleranceMode: 'pct2_5' },
  { beamLengthA: 3, beamLengthB: 3, orientationA: 'widthwise', orientationB: 'widthwise', bottomSlingLen: 2 },
  'double-parallel', 1.18);

runLSFIntegrationTest('integ-doublecas-pct2_5', doubleCasCalc,
  { liftingPoints: rectLPs(8, 4), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 20, toleranceMode: 'pct2_5' },
  { masterLength: 6, slaveLengthA: 3, slaveLengthB: 3, masterOrientation: 'lengthwise', bottomSlingLen: 2 },
  'double-cascade', 1.36);

// mm250 — confirm spreader/stinger families work
runLSFIntegrationTest('integ-spreader-pct12_5', spreaderCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct12_5' },
  { beamLength: 6, orientation: 'lengthwise' }, 'spreader-beam', 1.68);

runLSFIntegrationTest('integ-stinger-pct12_5', stingerCalc,
  { liftingPoints: rectLPs(6, 3), cog: { x: 0, y: 0, z: 0 }, minAngleDeg: 60, totalLoad: 10, toleranceMode: 'pct12_5' },
  { topSlingLength: 1 }, 'stinger', 2.00);


// === HOOK-OVER-COG (beam translates to sit over an offset COG) ===
// Bug: with a widthwise beam and the COG offset lengthwise (perpendicular to the
// beam axis), the hook/pickup must stay directly above the COG in plan view.
// rectLPs(10,4): X is the long axis, so 'widthwise' beam runs along Y; a lengthwise
// COG offset is along X — the component a beam-axis projection used to discard.
function runHookOverCogTest(name, calcFn, shared, config) {
  totalTests++;
  const errs = [];
  let r;
  try { r = calcFn(shared, config); }
  catch (e) { failures.push({ name, error: `EXCEPTION: ${e.message}` }); return; }

  const { cog } = shared;
  if (Math.abs(r.hook.x - cog.x) > 0.01) errs.push(`hook.x ${r.hook.x} != cog.x ${cog.x}`);
  if (Math.abs(r.hook.y - cog.y) > 0.01) errs.push(`hook.y ${r.hook.y} != cog.y ${cog.y}`);

  if (errs.length > 0) failures.push({ name, errors: errs, shared, config });
  else passCount++;
}

runHookOverCogTest('liftbeam-hook-over-cog-perp', liftbeamCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 3, orientation: 'widthwise' });

runHookOverCogTest('spreader-hook-over-cog-perp', spreaderCalc,
  { liftingPoints: rectLPs(10, 4), cog: { x: 2, y: 0, z: 0 }, minAngleDeg: 45, totalLoad: 20 },
  { beamLength: 3, orientation: 'widthwise' });


// ── Report ──
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passCount} passed, ${failures.length} failed, ${totalTests} total`);
console.log('='.repeat(60));

if (failures.length > 0) {
  console.log('\nFAILURES:\n');
  for (const f of failures) {
    console.log(`--- ${f.name} ---`);
    if (f.error) {
      console.log(`  ${f.error}`);
    } else {
      for (const e of f.errors) {
        console.log(`  - ${e}`);
      }
    }
    // Print condensed inputs (when available)
    if (f.shared && f.shared.liftingPoints) {
      const lps = f.shared.liftingPoints;
      console.log(`  LPs: [${lps.map(p => `(${p.x},${p.y},${p.z})`).join(', ')}]`);
      console.log(`  COG: (${f.shared.cog.x},${f.shared.cog.y},${f.shared.cog.z}), minAngle: ${f.shared.minAngleDeg}, load: ${f.shared.totalLoad}`);
    }
    if (f.config && Object.keys(f.config).length > 0)
      console.log(`  Config: ${JSON.stringify(f.config)}`);
    console.log('');
  }
}

process.exit(failures.length > 0 ? 1 : 0);
