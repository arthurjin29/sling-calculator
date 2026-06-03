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

console.log(`\nSimple-mode tests: ${pass}/${total} passed`);
if (failures.length) { failures.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
