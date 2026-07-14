/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Same as parallel, but the hook is replaced by a master spreader beam.
 * Each master beam end acts as the "hook" for a slave beam pair.
 * Slave beam ends sit on the direct sling paths from LP to master beam end,
 * using the same computeBeamEndPair logic as the parallel config.
 *
 *   Top:     2 slings (hook → master beam ends)
 *   Middle:  4 slings (slave beam ends → master beam ends)
 *   Bottom:  4 slings (LPs → slave beam ends)
 *   Total:   10 slings, 3 beams
 *
 * Exposes: window.CalcDoubleCas = { calculate }
 */

window.CalcDoubleCas = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { masterLength, slaveLengthA, slaveLengthB, bottomSlingLen } = config;
    const minAngleRad = C.degToRad(minAngleDeg);
    // Optional per-lay target angles (governing minimum). Blank -> global min-angle.
    const middleAngleRad = config.middleAngleDeg != null ? Math.max(minAngleRad, C.degToRad(config.middleAngleDeg)) : minAngleRad;
    const topAngleRad = config.topAngleDeg != null ? Math.max(minAngleRad, C.degToRad(config.topAngleDeg)) : minAngleRad;
    const minSlingLen = bottomSlingLen ?? 2;

    // ── 1. LP pairing ──
    let groupAIdxs, groupBIdxs;
    if (config.pairing) {
      groupAIdxs = config.pairing.groupA.map(v => v - 1);
      groupBIdxs = config.pairing.groupB.map(v => v - 1);
    } else {
      [groupAIdxs, groupBIdxs] = C.autoPairLPs(liftingPoints);
    }
    const groupALPs = groupAIdxs.map(i => liftingPoints[i]);
    const groupBLPs = groupBIdxs.map(i => liftingPoints[i]);
    const groupALabels = groupAIdxs.map(i => 'LP' + (i + 1));
    const groupBLabels = groupBIdxs.map(i => 'LP' + (i + 1));

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

    // Master beam Z: each master end acts as "hook" for its LP pair.
    // Must be high enough for min angle from each LP in its group.
    const hDistA0 = C.horizontalDist(groupALPs[0], masterEndAxy);
    const hDistA1 = C.horizontalDist(groupALPs[1], masterEndAxy);
    const hDistB0 = C.horizontalDist(groupBLPs[0], masterEndBxy);
    const hDistB1 = C.horizontalDist(groupBLPs[1], masterEndBxy);

    const masterEndAz = Math.max(
      groupALPs[0].z + hDistA0 * Math.tan(minAngleRad),
      groupALPs[1].z + hDistA1 * Math.tan(minAngleRad)
    );
    const masterEndBz = Math.max(
      groupBLPs[0].z + hDistB0 * Math.tan(minAngleRad),
      groupBLPs[1].z + hDistB1 * Math.tan(minAngleRad)
    );
    // Both ends at same Z (it's a rigid beam)
    let masterZ = Math.max(masterEndAz, masterEndBz);

    // Iteratively raise masterZ until middle slings also meet min angle.
    // Slave end positions depend on masterZ, and middle sling angles depend on both.
    let slaveA1, slaveA2, slaveB1, slaveB2;
    for (let iter = 0; iter < 20; iter++) {
      const mEndA = { ...masterEndAxy, z: masterZ };
      const mEndB = { ...masterEndBxy, z: masterZ };

      const pairA = C.computeBeamEndPair(groupALPs[0], groupALPs[1], mEndA, slaveLengthA, minSlingLen);
      const pairB = C.computeBeamEndPair(groupBLPs[0], groupBLPs[1], mEndB, slaveLengthB, minSlingLen);

      slaveA1 = pairA.end0;
      slaveA2 = pairA.end1;
      slaveB1 = pairB.end0;
      slaveB2 = pairB.end1;

      // Check middle sling angles and compute required masterZ
      const slaveEnds = [slaveA1, slaveA2, slaveB1, slaveB2];
      const mEnds = [mEndA, mEndA, mEndB, mEndB];
      let newMasterZ = masterZ;
      for (let i = 0; i < 4; i++) {
        const hd = C.horizontalDist(slaveEnds[i], mEnds[i]);
        if (hd > 0.001) {
          const requiredZ = slaveEnds[i].z + hd * Math.tan(middleAngleRad);
          if (requiredZ > newMasterZ) newMasterZ = requiredZ;
        }
      }
      if (newMasterZ - masterZ < 0.001) break;
      masterZ = newMasterZ;
    }

    const masterEnds = {
      endA: { ...masterEndAxy, z: masterZ },
      endB: { ...masterEndBxy, z: masterZ }
    };

    // Actual slave beam lengths
    const actualSlaveLenA = C.round4(C.dist3D(slaveA1, slaveA2));
    const actualSlaveLenB = C.round4(C.dist3D(slaveB1, slaveB2));

    // ── 4. Hook — above master beam at top-lay angle (default min angle) ──
    const hDistHA = C.horizontalDist(masterEnds.endA, hookXY);
    const hDistHB = C.horizontalDist(masterEnds.endB, hookXY);
    const hook = {
      x: cog.x,
      y: cog.y,
      z: masterZ + Math.max(hDistHA, hDistHB) * Math.tan(topAngleRad)
    };

    // ── 5. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 6. Bottom slings (4): LP → slave beam end ──
    let slingId = 1;
    const bottomSlings = [];
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[0], label: groupALabels[0] },
      { ...slaveA1, label: '2nd A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[1], label: groupALabels[1] },
      { ...slaveA2, label: '2nd A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[0], label: groupBLabels[0] },
      { ...slaveB1, label: '2nd B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[1], label: groupBLabels[1] },
      { ...slaveB2, label: '2nd B End 2' }
    ));

    // ── 7. Middle slings (4): slave beam ends → master beam ends ──
    const middleSlings = [];
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA1, label: '2nd A End 1' },
      { ...masterEnds.endA, label: 'Main End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA2, label: '2nd A End 2' },
      { ...masterEnds.endA, label: 'Main End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB1, label: '2nd B End 1' },
      { ...masterEnds.endB, label: 'Main End B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB2, label: '2nd B End 2' },
      { ...masterEnds.endB, label: 'Main End B' }
    ));

    // ── 8. Top slings (2): master beam ends → hook ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { ...masterEnds.endA, label: 'Main End A' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingA);
    const topSlingB = C.buildSling(slingId++,
      { ...masterEnds.endB, label: 'Main End B' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingB);

    // ── 9. Tensions — cascade downward ──
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(masterEnds.endA, masterEnds.endB, hook, totalLoad);
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterEnds.endA, hook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterEnds.endB, hook);

    // Middle tier: 2 slings per master end sharing that side's vertical load
    const midTensionsA = C.calcTwoSlingTension(slaveA1, slaveA2, masterEnds.endA, vLoadMasterA);
    middleSlings[0].tension = C.round4(midTensionsA[0]);
    middleSlings[1].tension = C.round4(midTensionsA[1]);

    const midTensionsB = C.calcTwoSlingTension(slaveB1, slaveB2, masterEnds.endB, vLoadMasterB);
    middleSlings[2].tension = C.round4(midTensionsB[0]);
    middleSlings[3].tension = C.round4(midTensionsB[1]);

    // Bottom tier: each bottom sling carries the vertical load from its slave beam end
    for (let i = 0; i < 4; i++) {
      const midSling = middleSlings[i];
      const botSling = bottomSlings[i];
      const vLoad = C.computeVerticalLoad(midSling.tension, midSling.from, midSling.to);
      const len = C.dist3D(botSling.from, botSling.to);
      const vd = Math.abs(botSling.to.z - botSling.from.z);
      if (len < 0.0001 || vd < 0.0001) {
        botSling.tension = C.round4(vLoad);
      } else {
        botSling.tension = C.round4(vLoad * len / vd);
      }
    }

    // ── 10. Vertical loads ──
    const allSlings = [...bottomSlings, ...middleSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 11. Warnings ──
    const topSlingAngleLow =
      topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG) ||
      middleSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);
    const nearHorizontalBottom = bottomSlings.some(s => s.angleDegFromHoriz < 5);
    const bottomSlingBelowMin = minSlingLen > 0 && bottomSlings.some(s => s.length < minSlingLen - 0.01);

    // ── 12. Critical sling ──
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

    // ── 13. Result ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    const loadSharingAnalysis = C.applyLoadSharingFactor(
      bottomSlings.map(s => s.tension),
      'double-cascade',
      shared.toleranceMode
    );

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
      loadSharingAnalysis,
      beams: [
        {
          name: 'Main Beam',
          endA: { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z) },
          endB: { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z) },
          length: C.round4(masterLength), pickupPoint: null
        },
        {
          name: '2nd Lvl Beam A',
          endA: { x: C.round4(slaveA1.x), y: C.round4(slaveA1.y), z: C.round4(slaveA1.z) },
          endB: { x: C.round4(slaveA2.x), y: C.round4(slaveA2.y), z: C.round4(slaveA2.z) },
          length: actualSlaveLenA, pickupPoint: null
        },
        {
          name: '2nd Lvl Beam B',
          endA: { x: C.round4(slaveB1.x), y: C.round4(slaveB1.y), z: C.round4(slaveB1.z) },
          endB: { x: C.round4(slaveB2.x), y: C.round4(slaveB2.y), z: C.round4(slaveB2.z) },
          length: actualSlaveLenB, pickupPoint: null
        }
      ],
      intermediatePoints: [
        { ...slaveA1, label: '2nd A End 1' }, { ...slaveA2, label: '2nd A End 2' },
        { ...slaveB1, label: '2nd B End 1' }, { ...slaveB2, label: '2nd B End 2' },
        { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z), label: 'Main End A' },
        { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z), label: 'Main End B' }
      ],
      slackLegAnalysis: {
        applicable: false,
        toleranceMm: shared.toleranceMm != null ? shared.toleranceMm : 200,
        reason: 'Tolerance check requires geometric perturbation analysis for paired sling configurations (not yet implemented).'
      },
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        bottomSlingBelowMin,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
