/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Three-tier cascading system:
 *   Bottom:  4 slings from 4 LPs to ends of 2 slave beams
 *   Middle:  2 slings from slave beam midpoints to ends of 1 master beam
 *   Top:     2 slings from master beam ends to hook
 *
 * Exposes: window.CalcDoubleCas = { calculate }
 */

window.CalcDoubleCas = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  /**
   * @param {Object} shared
   * @param {Array<{x,y,z}>} shared.liftingPoints - 4 lifting points
   * @param {{x,y,z}} shared.cog - centre of gravity
   * @param {number} shared.minAngleDeg - min sling angle from horizontal (bottom tier)
   * @param {number} shared.totalLoad - total suspended load
   *
   * @param {Object} config
   * @param {number} config.masterLength - master beam length
   * @param {number} config.slaveLengthA - slave beam A length
   * @param {number} config.slaveLengthB - slave beam B length
   * @param {string} config.masterOrientation - 'lengthwise' | 'widthwise'
   * @param {string} config.slaveOrientationA - 'lengthwise' | 'widthwise'
   * @param {string} config.slaveOrientationB - 'lengthwise' | 'widthwise'
   * @param {Object} config.pairing
   * @param {number[]} config.pairing.groupA - [lpIdx, lpIdx] (1-based)
   * @param {number[]} config.pairing.groupB - [lpIdx, lpIdx] (1-based)
   *
   * @returns {Object} standardised result
   */
  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const {
      masterLength, slaveLengthA, slaveLengthB,
      masterOrientation, slaveOrientationA, slaveOrientationB,
      pairing
    } = config;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Extract LP groups (convert 1-based to 0-based) ──
    const groupALPs = pairing.groupA.map(i => liftingPoints[i - 1]);
    const groupBLPs = pairing.groupB.map(i => liftingPoints[i - 1]);

    const groupALabels = pairing.groupA.map(i => 'LP' + i);
    const groupBLabels = pairing.groupB.map(i => 'LP' + i);

    // ── 2. Slave beam A ──
    const slaveAxisA = C.getOrientationAxis(liftingPoints, slaveOrientationA);
    const slaveCentreA = C.midpoint(groupALPs[0], groupALPs[1]);
    slaveCentreA.z = 0;
    let slaveEndsA = C.computeBeamEnds(
      { x: slaveCentreA.x, y: slaveCentreA.y, z: 0 },
      slaveLengthA, slaveAxisA
    );

    // Assign slave end closest to first LP of group A
    const dA0toEndA = C.horizontalDist(groupALPs[0], slaveEndsA.endA);
    const dA0toEndB = C.horizontalDist(groupALPs[0], slaveEndsA.endB);
    if (dA0toEndB < dA0toEndA) {
      const tmp = slaveEndsA.endA;
      slaveEndsA.endA = slaveEndsA.endB;
      slaveEndsA.endB = tmp;
    }

    // Slave A end Z from bottom sling min angle
    slaveEndsA.endA.z = C.computeBeamEndZ([groupALPs[0]], slaveEndsA.endA, minAngleRad);
    slaveEndsA.endB.z = C.computeBeamEndZ([groupALPs[1]], slaveEndsA.endB, minAngleRad);

    // Assign each LP in group A to nearest slave end for bottom slings
    let slaveA_lpAssign; // [{ lp, label, end, endLabel }]
    {
      const d00 = C.horizontalDist(groupALPs[0], slaveEndsA.endA);
      const d01 = C.horizontalDist(groupALPs[0], slaveEndsA.endB);
      if (d00 <= d01) {
        slaveA_lpAssign = [
          { lp: groupALPs[0], label: groupALabels[0], end: slaveEndsA.endA, endLabel: 'Slave A End 1' },
          { lp: groupALPs[1], label: groupALabels[1], end: slaveEndsA.endB, endLabel: 'Slave A End 2' }
        ];
      } else {
        slaveA_lpAssign = [
          { lp: groupALPs[0], label: groupALabels[0], end: slaveEndsA.endB, endLabel: 'Slave A End 2' },
          { lp: groupALPs[1], label: groupALabels[1], end: slaveEndsA.endA, endLabel: 'Slave A End 1' }
        ];
      }
    }

    // Re-compute slave end Z using actual assigned LPs
    slaveEndsA.endA.z = C.computeBeamEndZ(
      slaveA_lpAssign.filter(a => a.end === slaveEndsA.endA).map(a => a.lp),
      slaveEndsA.endA, minAngleRad
    );
    slaveEndsA.endB.z = C.computeBeamEndZ(
      slaveA_lpAssign.filter(a => a.end === slaveEndsA.endB).map(a => a.lp),
      slaveEndsA.endB, minAngleRad
    );

    // ── 3. Slave beam B ──
    const slaveAxisB = C.getOrientationAxis(liftingPoints, slaveOrientationB);
    const slaveCentreB = C.midpoint(groupBLPs[0], groupBLPs[1]);
    slaveCentreB.z = 0;
    let slaveEndsB = C.computeBeamEnds(
      { x: slaveCentreB.x, y: slaveCentreB.y, z: 0 },
      slaveLengthB, slaveAxisB
    );

    // Assign slave end closest to first LP of group B
    const dB0toEndA = C.horizontalDist(groupBLPs[0], slaveEndsB.endA);
    const dB0toEndB = C.horizontalDist(groupBLPs[0], slaveEndsB.endB);
    if (dB0toEndB < dB0toEndA) {
      const tmp = slaveEndsB.endA;
      slaveEndsB.endA = slaveEndsB.endB;
      slaveEndsB.endB = tmp;
    }

    // Assign each LP in group B to nearest slave end
    let slaveB_lpAssign;
    {
      const d00 = C.horizontalDist(groupBLPs[0], slaveEndsB.endA);
      const d01 = C.horizontalDist(groupBLPs[0], slaveEndsB.endB);
      if (d00 <= d01) {
        slaveB_lpAssign = [
          { lp: groupBLPs[0], label: groupBLabels[0], end: slaveEndsB.endA, endLabel: 'Slave B End 1' },
          { lp: groupBLPs[1], label: groupBLabels[1], end: slaveEndsB.endB, endLabel: 'Slave B End 2' }
        ];
      } else {
        slaveB_lpAssign = [
          { lp: groupBLPs[0], label: groupBLabels[0], end: slaveEndsB.endB, endLabel: 'Slave B End 2' },
          { lp: groupBLPs[1], label: groupBLabels[1], end: slaveEndsB.endA, endLabel: 'Slave B End 1' }
        ];
      }
    }

    slaveEndsB.endA.z = C.computeBeamEndZ(
      slaveB_lpAssign.filter(a => a.end === slaveEndsB.endA).map(a => a.lp),
      slaveEndsB.endA, minAngleRad
    );
    slaveEndsB.endB.z = C.computeBeamEndZ(
      slaveB_lpAssign.filter(a => a.end === slaveEndsB.endB).map(a => a.lp),
      slaveEndsB.endB, minAngleRad
    );

    // ── 4. Slave midpoints ──
    const slaveMidA = C.midpoint(slaveEndsA.endA, slaveEndsA.endB);
    const slaveMidB = C.midpoint(slaveEndsB.endA, slaveEndsB.endB);

    // ── 5. Master beam ──
    const masterAxis = C.getOrientationAxis(liftingPoints, masterOrientation);
    const masterCentre = C.midpoint(slaveMidA, slaveMidB);
    masterCentre.z = 0;

    let masterEnds = C.computeBeamEnds(
      { x: masterCentre.x, y: masterCentre.y, z: 0 },
      masterLength, masterAxis
    );

    // Assign master end A closest to slave midpoint A
    const dMidAtoEndA = C.horizontalDist(slaveMidA, masterEnds.endA);
    const dMidAtoEndB = C.horizontalDist(slaveMidA, masterEnds.endB);
    if (dMidAtoEndB < dMidAtoEndA) {
      const tmp = masterEnds.endA;
      masterEnds.endA = masterEnds.endB;
      masterEnds.endB = tmp;
    }

    // Master end Z: the "points" for computing Z are slave midpoints
    masterEnds.endA.z = C.computeBeamEndZ([slaveMidA], masterEnds.endA, minAngleRad);
    masterEnds.endB.z = C.computeBeamEndZ([slaveMidB], masterEnds.endB, minAngleRad);

    // ── 6. Hook position ──
    const hook = { x: cog.x, y: cog.y, z: 0 };

    const hDistAtoHook = C.horizontalDist(masterEnds.endA, hook);
    const hDistBtoHook = C.horizontalDist(masterEnds.endB, hook);

    hook.z = Math.max(
      masterEnds.endA.z + hDistAtoHook * Math.tan(minAngleRad),
      masterEnds.endB.z + hDistBtoHook * Math.tan(minAngleRad)
    );

    // ── 7. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 8. Build bottom slings (4 total) ──
    const bottomSlings = [];
    let slingId = 1;

    const allLpAssigns = [...slaveA_lpAssign, ...slaveB_lpAssign];
    for (const assign of allLpAssigns) {
      const s = C.buildSling(slingId++,
        { x: assign.lp.x, y: assign.lp.y, z: assign.lp.z, label: assign.label },
        { x: assign.end.x, y: assign.end.y, z: assign.end.z, label: assign.endLabel }
      );
      bottomSlings.push(s);
    }

    // ── 9. Build middle slings (2 total) ──
    const middleSlings = [];
    const middleSlingA = C.buildSling(slingId++,
      { x: slaveMidA.x, y: slaveMidA.y, z: slaveMidA.z, label: 'Slave A Mid' },
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' }
    );
    middleSlings.push(middleSlingA);

    const middleSlingB = C.buildSling(slingId++,
      { x: slaveMidB.x, y: slaveMidB.y, z: slaveMidB.z, label: 'Slave B Mid' },
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' }
    );
    middleSlings.push(middleSlingB);

    // ── 10. Build top slings (2 total) ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    topSlings.push(topSlingA);

    const topSlingB = C.buildSling(slingId++,
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    topSlings.push(topSlingB);

    // ── 11. Tensions — cascade upward ──

    // (a) Top sling tensions: 2-sling equilibrium from master ends to hook
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(
      masterEnds.endA, masterEnds.endB, hook, totalLoad
    );
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    // (b) Vertical load at each master end (from raw geometry)
    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterEnds.endA, hook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterEnds.endB, hook);

    // (c) Middle sling tensions: each middle sling carries the vertical load
    //     of its master end. middleTension = vLoad * slingLength / verticalDist
    const midLenA = C.dist3D(slaveMidA, masterEnds.endA);
    const midVdA = Math.abs(masterEnds.endA.z - slaveMidA.z);
    const midTensionA = (midVdA > 1e-9) ? vLoadMasterA * midLenA / midVdA : vLoadMasterA;
    const midLenB = C.dist3D(slaveMidB, masterEnds.endB);
    const midVdB = Math.abs(masterEnds.endB.z - slaveMidB.z);
    const midTensionB = (midVdB > 1e-9) ? vLoadMasterB * midLenB / midVdB : vLoadMasterB;
    middleSlingA.tension = C.round4(midTensionA);
    middleSlingB.tension = C.round4(midTensionB);

    // (d) Vertical load at each slave midpoint = vertical load at corresponding master end
    const vLoadSlaveA = vLoadMasterA;
    const vLoadSlaveB = vLoadMasterB;

    // (e) Each slave midpoint is centred on its beam, so load distributes
    //     equally to the two slave beam ends: vLoadPerEnd = vLoadSlave / 2
    const vLoadSlaveEndA = vLoadSlaveA / 2;
    const vLoadSlaveEndB = vLoadSlaveB / 2;

    // (f) Bottom sling tensions: vLoadPerEnd * slingLength / verticalDist
    for (let i = 0; i < 2; i++) {
      const s = bottomSlings[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      s.tension = C.round4((vd > 1e-9) ? vLoadSlaveEndA * len / vd : vLoadSlaveEndA);
    }
    for (let i = 2; i < 4; i++) {
      const s = bottomSlings[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      s.tension = C.round4((vd > 1e-9) ? vLoadSlaveEndB * len / vd : vLoadSlaveEndB);
    }

    // ── 12. Vertical loads (from raw geometry) ──
    const allSlings = [...bottomSlings, ...middleSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 13. Top / middle sling angle warning ──
    const topSlingAngleLow =
      topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG) ||
      middleSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);

    // ── 14. Negative tension warning ──
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 15. Critical sling (highest tension across all 3 tiers) ──
    let criticalTier = 'bottom';
    let criticalIdx = 0;
    let maxTension = -Infinity;

    bottomSlings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'bottom'; criticalIdx = i; }
    });
    middleSlings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'middle'; criticalIdx = i; }
    });
    topSlings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'top'; criticalIdx = i; }
    });

    // Mark critical sling
    const tierMap = { bottom: bottomSlings, middle: middleSlings, top: topSlings };
    tierMap[criticalTier][criticalIdx].isCritical = true;

    // Mark which sling governs hook height
    const hookZFromA = masterEnds.endA.z + hDistAtoHook * Math.tan(minAngleRad);
    const hookZFromB = masterEnds.endB.z + hDistBtoHook * Math.tan(minAngleRad);
    topSlingA.governsHookHeight = (hookZFromA >= hookZFromB);
    topSlingB.governsHookHeight = (hookZFromB > hookZFromA);

    // ── 16. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));
    const headroom = C.round4(hook.z - maxLPz);
    const heightAboveCOG = C.round4(hook.z - cog.z);

    // ── 17. Return standardised result ──
    return {
      configType: 'double-cascade',
      hook: { x: C.round4(hook.x), y: C.round4(hook.y), z: C.round4(hook.z) },
      hookHeight: C.round4(hook.z),
      headroom,
      heightAboveCOG,
      totalLoad,
      minAngleDeg,

      criticalSling: { tier: criticalTier, id: criticalIdx + 1 },

      tiers: [
        { name: 'Bottom Slings', slings: bottomSlings },
        { name: 'Middle Slings', slings: middleSlings },
        { name: 'Top Slings', slings: topSlings }
      ],

      beams: [
        {
          name: 'Master Beam',
          endA: { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z) },
          endB: { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z) },
          length: masterLength,
          pickupPoint: null
        },
        {
          name: 'Slave Beam A',
          endA: { x: C.round4(slaveEndsA.endA.x), y: C.round4(slaveEndsA.endA.y), z: C.round4(slaveEndsA.endA.z) },
          endB: { x: C.round4(slaveEndsA.endB.x), y: C.round4(slaveEndsA.endB.y), z: C.round4(slaveEndsA.endB.z) },
          length: slaveLengthA,
          pickupPoint: null
        },
        {
          name: 'Slave Beam B',
          endA: { x: C.round4(slaveEndsB.endA.x), y: C.round4(slaveEndsB.endA.y), z: C.round4(slaveEndsB.endA.z) },
          endB: { x: C.round4(slaveEndsB.endB.x), y: C.round4(slaveEndsB.endB.y), z: C.round4(slaveEndsB.endB.z) },
          length: slaveLengthB,
          pickupPoint: null
        }
      ],

      intermediatePoints: [
        { x: C.round4(slaveEndsA.endA.x), y: C.round4(slaveEndsA.endA.y), z: C.round4(slaveEndsA.endA.z), label: 'Slave A End 1' },
        { x: C.round4(slaveEndsA.endB.x), y: C.round4(slaveEndsA.endB.y), z: C.round4(slaveEndsA.endB.z), label: 'Slave A End 2' },
        { x: C.round4(slaveMidA.x), y: C.round4(slaveMidA.y), z: C.round4(slaveMidA.z), label: 'Slave A Mid' },
        { x: C.round4(slaveEndsB.endA.x), y: C.round4(slaveEndsB.endA.y), z: C.round4(slaveEndsB.endA.z), label: 'Slave B End 1' },
        { x: C.round4(slaveEndsB.endB.x), y: C.round4(slaveEndsB.endB.y), z: C.round4(slaveEndsB.endB.z), label: 'Slave B End 2' },
        { x: C.round4(slaveMidB.x), y: C.round4(slaveMidB.y), z: C.round4(slaveMidB.z), label: 'Slave B Mid' },
        { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z), label: 'Master End A' },
        { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z), label: 'Master End B' }
      ],

      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
