/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Three-tier cascading system where slave beams are SPREADER beams:
 *   Bottom:  4 slings from 4 LPs to slave beam ends (1 LP per end)
 *   Middle:  4 slings from slave beam ends to master beam ends (2 per master end)
 *   Top:     2 slings from master beam ends to hook
 *
 * Each slave beam end is a connection point: bottom sling below, middle sling above.
 * The slave beam resists horizontal spreading force (compression only, no bending).
 *
 * Exposes: window.CalcDoubleCas = { calculate }
 */

window.CalcDoubleCas = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const {
      masterLength, slaveLengthA, slaveLengthB,
      masterOrientation, slaveOrientationA, slaveOrientationB
    } = config;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Auto-pair LPs by proximity ──
    const pairingsOpt = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
    let bestPairing = pairingsOpt[0];
    let bestDist = Infinity;
    for (const p of pairingsOpt) {
      const d = C.horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
              + C.horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
      if (d < bestDist) { bestDist = d; bestPairing = p; }
    }
    const groupALPs = bestPairing[0].map(i => liftingPoints[i]);
    const groupBLPs = bestPairing[1].map(i => liftingPoints[i]);
    const groupALabels = bestPairing[0].map(i => 'LP' + (i + 1));
    const groupBLabels = bestPairing[1].map(i => 'LP' + (i + 1));

    // ── 2. Slave beam A ──
    const slaveAxisA = C.getOrientationAxis(liftingPoints, slaveOrientationA);
    const slaveCentreA = C.midpoint(groupALPs[0], groupALPs[1]);
    let slaveEndsA = C.computeBeamEnds({ x: slaveCentreA.x, y: slaveCentreA.y, z: 0 }, slaveLengthA, slaveAxisA);

    // Assign each LP to nearest slave end
    if (C.horizontalDist(groupALPs[0], slaveEndsA.endB) < C.horizontalDist(groupALPs[0], slaveEndsA.endA)) {
      const tmp = slaveEndsA.endA; slaveEndsA.endA = slaveEndsA.endB; slaveEndsA.endB = tmp;
    }
    // LP groupALPs[0] → slaveA end A, groupALPs[1] → slaveA end B
    slaveEndsA.endA.z = C.computeBeamEndZ([groupALPs[0]], slaveEndsA.endA, minAngleRad);
    slaveEndsA.endB.z = C.computeBeamEndZ([groupALPs[1]], slaveEndsA.endB, minAngleRad);

    // ── 3. Slave beam B ──
    const slaveAxisB = C.getOrientationAxis(liftingPoints, slaveOrientationB);
    const slaveCentreB = C.midpoint(groupBLPs[0], groupBLPs[1]);
    let slaveEndsB = C.computeBeamEnds({ x: slaveCentreB.x, y: slaveCentreB.y, z: 0 }, slaveLengthB, slaveAxisB);

    if (C.horizontalDist(groupBLPs[0], slaveEndsB.endB) < C.horizontalDist(groupBLPs[0], slaveEndsB.endA)) {
      const tmp = slaveEndsB.endA; slaveEndsB.endA = slaveEndsB.endB; slaveEndsB.endB = tmp;
    }
    slaveEndsB.endA.z = C.computeBeamEndZ([groupBLPs[0]], slaveEndsB.endA, minAngleRad);
    slaveEndsB.endB.z = C.computeBeamEndZ([groupBLPs[1]], slaveEndsB.endB, minAngleRad);

    // ── 4. Master beam ──
    const masterAxis = C.getOrientationAxis(liftingPoints, masterOrientation);
    // Master centre = midpoint of slave beam centres
    const masterCentre = C.midpoint(slaveCentreA, slaveCentreB);
    let masterEnds = C.computeBeamEnds({ x: masterCentre.x, y: masterCentre.y, z: 0 }, masterLength, masterAxis);

    // Assign master end A closest to slave A centre
    if (C.horizontalDist(slaveCentreA, masterEnds.endB) < C.horizontalDist(slaveCentreA, masterEnds.endA)) {
      const tmp = masterEnds.endA; masterEnds.endA = masterEnds.endB; masterEnds.endB = tmp;
    }

    // Master end Z from slave beam ENDS (not midpoints) — middle slings come from slave ends
    // Slave A's 2 ends both connect to master end A
    masterEnds.endA.z = C.computeBeamEndZ([slaveEndsA.endA, slaveEndsA.endB], masterEnds.endA, minAngleRad);
    masterEnds.endB.z = C.computeBeamEndZ([slaveEndsB.endA, slaveEndsB.endB], masterEnds.endB, minAngleRad);

    // ── 5. Hook position — in master beam plane ──
    const cogToEndA = { x: cog.x - masterEnds.endA.x, y: cog.y - masterEnds.endA.y };
    const mDir = { x: masterEnds.endB.x - masterEnds.endA.x, y: masterEnds.endB.y - masterEnds.endA.y };
    const mLen2D = Math.sqrt(mDir.x * mDir.x + mDir.y * mDir.y);
    let hookX, hookY;
    if (mLen2D > 0.0001) {
      const t = (cogToEndA.x * mDir.x + cogToEndA.y * mDir.y) / (mLen2D * mLen2D);
      hookX = masterEnds.endA.x + t * mDir.x;
      hookY = masterEnds.endA.y + t * mDir.y;
    } else {
      hookX = cog.x; hookY = cog.y;
    }
    const hook = { x: hookX, y: hookY, z: 0 };
    const hDistAtoHook = C.horizontalDist(masterEnds.endA, hook);
    const hDistBtoHook = C.horizontalDist(masterEnds.endB, hook);
    hook.z = Math.max(
      masterEnds.endA.z + hDistAtoHook * Math.tan(minAngleRad),
      masterEnds.endB.z + hDistBtoHook * Math.tan(minAngleRad)
    );

    // ── 6. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 7. Build bottom slings (4 total: LP → slave end) ──
    const bottomSlings = [];
    let slingId = 1;
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[0].x, y: groupALPs[0].y, z: groupALPs[0].z, label: groupALabels[0] },
      { x: slaveEndsA.endA.x, y: slaveEndsA.endA.y, z: slaveEndsA.endA.z, label: 'Slave A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[1].x, y: groupALPs[1].y, z: groupALPs[1].z, label: groupALabels[1] },
      { x: slaveEndsA.endB.x, y: slaveEndsA.endB.y, z: slaveEndsA.endB.z, label: 'Slave A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[0].x, y: groupBLPs[0].y, z: groupBLPs[0].z, label: groupBLabels[0] },
      { x: slaveEndsB.endA.x, y: slaveEndsB.endA.y, z: slaveEndsB.endA.z, label: 'Slave B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[1].x, y: groupBLPs[1].y, z: groupBLPs[1].z, label: groupBLabels[1] },
      { x: slaveEndsB.endB.x, y: slaveEndsB.endB.y, z: slaveEndsB.endB.z, label: 'Slave B End 2' }
    ));

    // ── 8. Build middle slings (4 total: slave ends → master ends) ──
    // Slave A ends → Master End A, Slave B ends → Master End B
    const middleSlings = [];
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveEndsA.endA.x, y: slaveEndsA.endA.y, z: slaveEndsA.endA.z, label: 'Slave A End 1' },
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveEndsA.endB.x, y: slaveEndsA.endB.y, z: slaveEndsA.endB.z, label: 'Slave A End 2' },
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveEndsB.endA.x, y: slaveEndsB.endA.y, z: slaveEndsB.endA.z, label: 'Slave B End 1' },
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveEndsB.endB.x, y: slaveEndsB.endB.y, z: slaveEndsB.endB.z, label: 'Slave B End 2' },
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' }
    ));

    // ── 9. Build top slings (2 total: master ends → hook) ──
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

    // ── 10. Tensions — cascade downward from hook ──

    // (a) Top sling tensions
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(masterEnds.endA, masterEnds.endB, hook, totalLoad);
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    // (b) Vertical load at each master end
    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterEnds.endA, hook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterEnds.endB, hook);

    // (c) Middle sling tensions: 2 slings from slave A ends to master end A
    const midTensionsA = C.calcTwoSlingTension(slaveEndsA.endA, slaveEndsA.endB, masterEnds.endA, vLoadMasterA);
    middleSlings[0].tension = C.round4(midTensionsA[0]);
    middleSlings[1].tension = C.round4(midTensionsA[1]);

    const midTensionsB = C.calcTwoSlingTension(slaveEndsB.endA, slaveEndsB.endB, masterEnds.endB, vLoadMasterB);
    middleSlings[2].tension = C.round4(midTensionsB[0]);
    middleSlings[3].tension = C.round4(midTensionsB[1]);

    // (d) Vertical load at each slave end = middle sling vertical component
    const vLoadSlaveA1 = C.computeVerticalLoad(midTensionsA[0], slaveEndsA.endA, masterEnds.endA);
    const vLoadSlaveA2 = C.computeVerticalLoad(midTensionsA[1], slaveEndsA.endB, masterEnds.endA);
    const vLoadSlaveB1 = C.computeVerticalLoad(midTensionsB[0], slaveEndsB.endA, masterEnds.endB);
    const vLoadSlaveB2 = C.computeVerticalLoad(midTensionsB[1], slaveEndsB.endB, masterEnds.endB);

    // (e) Bottom sling tensions: each bottom sling carries the vertical load of its slave end
    const slaveEndVLoads = [vLoadSlaveA1, vLoadSlaveA2, vLoadSlaveB1, vLoadSlaveB2];
    for (let i = 0; i < 4; i++) {
      const s = bottomSlings[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      s.tension = C.round4((vd > 1e-9) ? slaveEndVLoads[i] * len / vd : slaveEndVLoads[i]);
    }

    // ── 11. Vertical loads ──
    const allSlings = [...bottomSlings, ...middleSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 12. Warnings ──
    const topSlingAngleLow =
      topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG) ||
      middleSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 13. Critical sling ──
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

    const tierMap = { bottom: bottomSlings, middle: middleSlings, top: topSlings };
    tierMap[criticalTier][criticalIdx].isCritical = true;

    // ── 14. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    return {
      configType: 'double-cascade',
      hook: { x: C.round4(hook.x), y: C.round4(hook.y), z: C.round4(hook.z) },
      hookHeight: C.round4(hook.z),
      headroom: C.round4(hook.z - maxLPz),
      heightAboveCOG: C.round4(hook.z - cog.z),
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
          length: masterLength, pickupPoint: null
        },
        {
          name: 'Slave Beam A',
          endA: { x: C.round4(slaveEndsA.endA.x), y: C.round4(slaveEndsA.endA.y), z: C.round4(slaveEndsA.endA.z) },
          endB: { x: C.round4(slaveEndsA.endB.x), y: C.round4(slaveEndsA.endB.y), z: C.round4(slaveEndsA.endB.z) },
          length: slaveLengthA, pickupPoint: null
        },
        {
          name: 'Slave Beam B',
          endA: { x: C.round4(slaveEndsB.endA.x), y: C.round4(slaveEndsB.endA.y), z: C.round4(slaveEndsB.endA.z) },
          endB: { x: C.round4(slaveEndsB.endB.x), y: C.round4(slaveEndsB.endB.y), z: C.round4(slaveEndsB.endB.z) },
          length: slaveLengthB, pickupPoint: null
        }
      ],
      intermediatePoints: [
        { x: C.round4(slaveEndsA.endA.x), y: C.round4(slaveEndsA.endA.y), z: C.round4(slaveEndsA.endA.z), label: 'Slave A End 1' },
        { x: C.round4(slaveEndsA.endB.x), y: C.round4(slaveEndsA.endB.y), z: C.round4(slaveEndsA.endB.z), label: 'Slave A End 2' },
        { x: C.round4(slaveEndsB.endA.x), y: C.round4(slaveEndsB.endA.y), z: C.round4(slaveEndsB.endA.z), label: 'Slave B End 1' },
        { x: C.round4(slaveEndsB.endB.x), y: C.round4(slaveEndsB.endB.y), z: C.round4(slaveEndsB.endB.z), label: 'Slave B End 2' },
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
