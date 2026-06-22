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
loadFile('sketch2d.js');
const Sketch2D = vm.runInContext('Sketch2D', ctx);

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

// --- Test G: layout maps world X-Z (Z-up) to SVG pixels (Y-down) with margin ---
const lay = Sketch2D.layoutElevation(
  { minX: 0, maxX: 4, minZ: 0, maxZ: 5 },
  { width: 400, height: 300, margin: 20 }
);
const p = lay.toScreen(0, 0);     // world bottom-left
check('G bottom-left x at margin', near(p.x, 20, 0.5), `x=${p.x}`);
check('G bottom-left y near bottom', p.y > 250, `y=${p.y}`);
const top = lay.toScreen(0, 5);   // world top → smaller screen y
check('G higher Z → smaller screen y', top.y < p.y, `${top.y} < ${p.y}`);

// --- Test H: result carries the load box dimensions for the renderer ---
check('H direct load.w/h echo inputs', rA.load && near(rA.load.w, 4) && near(rA.load.h, 2),
  JSON.stringify(rA.load));
check('H spreader load.w/h echo inputs', rF.load && near(rF.load.w, 4) && near(rF.load.h, 2),
  JSON.stringify(rF.load));

// --- Test I: crossed picks (LP1 right of LP2) → beam ends pair to same-side LP, no crossed slings ---
// lp1 at x=4 (right), lp2 at x=0 (left); beam ends at cog.x±1 = 1 (A,left) and 3 (B,right)
const I = { ...A, config: 'spreader-beam', beamLength: 2, topSlingLength: 2, lp1Left: 4, lp2FromLp1: -4 };
const rI = CalcSimple.computeSimpleSpreader(I);
check('I left beam end → left pick (x=0)', near(rI.bottomSlings[0].from.x, 0) && near(rI.bottomSlings[0].to.x, 1),
  `from=${rI.bottomSlings[0].from.x} to=${rI.bottomSlings[0].to.x}`);
check('I right beam end → right pick (x=4)', near(rI.bottomSlings[1].from.x, 4) && near(rI.bottomSlings[1].to.x, 3),
  `from=${rI.bottomSlings[1].from.x} to=${rI.bottomSlings[1].to.x}`);
// no crossing: the two bottom slings occupy disjoint x-ranges around the beam centre
check('I bottom slings do not cross',
  Math.max(rI.bottomSlings[0].from.x, rI.bottomSlings[0].to.x) <= Math.min(rI.bottomSlings[1].from.x, rI.bottomSlings[1].to.x),
  'left-span max must be <= right-span min');

console.log(`\nSimple-mode tests: ${pass}/${total} passed`);
if (failures.length) { failures.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
