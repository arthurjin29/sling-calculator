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
    // Print condensed inputs
    const lps = f.shared.liftingPoints;
    console.log(`  LPs: [${lps.map(p => `(${p.x},${p.y},${p.z})`).join(', ')}]`);
    console.log(`  COG: (${f.shared.cog.x},${f.shared.cog.y},${f.shared.cog.z}), minAngle: ${f.shared.minAngleDeg}, load: ${f.shared.totalLoad}`);
    if (Object.keys(f.config).length > 0)
      console.log(`  Config: ${JSON.stringify(f.config)}`);
    console.log('');
  }
}

process.exit(failures.length > 0 ? 1 : 0);
