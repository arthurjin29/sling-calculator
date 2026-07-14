/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Each 2nd-level (slave) beam is picked over the COG of the load it carries
 * (its sub-COG), not the geometric midpoint of its LP pair. The Main Beam's
 * sling pick points sit inboard, over the two sub-COGs, and the hook (over
 * the total COG) lands collinear with those two picks — so the top slings
 * balance horizontally with no lean. Slave beam ends sit on the direct sling
 * paths from LP to Main-Beam pick point, using the same computeBeamEndPair
 * logic as the parallel config.
 *
 *   Top:     2 slings (hook → Main-Beam pick points)
 *   Middle:  4 slings (slave beam ends → Main-Beam pick points)
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

    // ── 2. Pick points — each beam picked over the COG of the load it carries ──
    // Per-LP vertical share from a min-norm rigid-body reaction solve. The
    // reaction-weighted centroid of the LPs equals the COG, so each side's
    // sub-COG and the total COG nest consistently: the hook (over the COG,
    // below) lands collinear with the two Main-Beam pick points, so the two
    // top slings straddle it and their horizontal thrusts cancel — no lean,
    // for a COG offset in any in-plan direction.
    const hookXY = { x: cog.x, y: cog.y };

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
    const subCogA = subCogOf(groupAIdxs);
    const subCogB = subCogOf(groupBIdxs);

    // Main-Beam sling pick points sit over each side's sub-COG (plan x,y).
    const pickAxy = { x: subCogA.x, y: subCogA.y };
    const pickBxy = { x: subCogB.x, y: subCogB.y };

    // Master beam Z: each master end acts as "hook" for its LP pair.
    // Must be high enough for min angle from each LP in its group.
    const hDistA0 = C.horizontalDist(groupALPs[0], pickAxy);
    const hDistA1 = C.horizontalDist(groupALPs[1], pickAxy);
    const hDistB0 = C.horizontalDist(groupBLPs[0], pickBxy);
    const hDistB1 = C.horizontalDist(groupBLPs[1], pickBxy);

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
      const mEndA = { ...pickAxy, z: masterZ };
      const mEndB = { ...pickBxy, z: masterZ };

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

    const masterPicks = {
      pickA: { ...pickAxy, z: masterZ },
      pickB: { ...pickBxy, z: masterZ }
    };

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

    // Actual slave beam lengths
    const actualSlaveLenA = C.round4(C.dist3D(slaveA1, slaveA2));
    const actualSlaveLenB = C.round4(C.dist3D(slaveB1, slaveB2));

    // ── 4. Hook — above master beam at top-lay angle (default min angle) ──
    const hDistHA = C.horizontalDist(masterPicks.pickA, hookXY);
    const hDistHB = C.horizontalDist(masterPicks.pickB, hookXY);
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
      { ...masterPicks.pickA, label: 'Main Pick A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA2, label: '2nd A End 2' },
      { ...masterPicks.pickA, label: 'Main Pick A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB1, label: '2nd B End 1' },
      { ...masterPicks.pickB, label: 'Main Pick B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB2, label: '2nd B End 2' },
      { ...masterPicks.pickB, label: 'Main Pick B' }
    ));

    // ── 8. Top slings (2): master beam ends → hook ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { ...masterPicks.pickA, label: 'Main Pick A' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingA);
    const topSlingB = C.buildSling(slingId++,
      { ...masterPicks.pickB, label: 'Main Pick B' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingB);

    // ── 9. Tensions — cascade downward ──
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(masterPicks.pickA, masterPicks.pickB, hook, totalLoad);
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterPicks.pickA, hook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterPicks.pickB, hook);

    // Middle tier: 2 slings per master end sharing that side's vertical load
    const midTensionsA = C.calcTwoSlingTension(slaveA1, slaveA2, masterPicks.pickA, vLoadMasterA);
    middleSlings[0].tension = C.round4(midTensionsA[0]);
    middleSlings[1].tension = C.round4(midTensionsA[1]);

    const midTensionsB = C.calcTwoSlingTension(slaveB1, slaveB2, masterPicks.pickB, vLoadMasterB);
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
          endA: { x: C.round4(mainBeamEndA.x), y: C.round4(mainBeamEndA.y), z: C.round4(mainBeamEndA.z) },
          endB: { x: C.round4(mainBeamEndB.x), y: C.round4(mainBeamEndB.y), z: C.round4(mainBeamEndB.z) },
          length: C.round4(physicalLength), pickupPoint: null
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
        { x: C.round4(masterPicks.pickA.x), y: C.round4(masterPicks.pickA.y), z: C.round4(masterPicks.pickA.z), label: 'Main Pick A' },
        { x: C.round4(masterPicks.pickB.x), y: C.round4(masterPicks.pickB.y), z: C.round4(masterPicks.pickB.z), label: 'Main Pick B' }
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
        mainBeamTooShort,
        subCogFallback,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
