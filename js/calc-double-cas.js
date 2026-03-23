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

  /**
   * Place beam ends on direct sling paths from LPs toward a target point.
   * Uses full 3D path (including Y component) for correct placement.
   */
  /**
   * Place beam ends on direct sling paths from LPs toward target.
   *
   * Beam length is the primary constraint — the beam is physical equipment.
   * Bottom sling length (minSlingLen) sets slave beam height independently
   * when beam >= LP spread and t would otherwise be 0.
   */
  function computeBeamEndPair(lp0, lp1, target, beamLength, minSlingLen) {
    const spreadAtZero = C.horizontalDist(lp0, lp1);

    if (spreadAtZero < 0.0001) {
      // Degenerate: LPs at same position
      function placeOnPath(lp) {
        const dx = target.x - lp.x;
        const dy = target.y - lp.y;
        const dz = target.z - lp.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.0001) return { x: lp.x, y: lp.y, z: lp.z + minSlingLen };
        const frac = Math.min(minSlingLen / d, 0.95);
        return { x: lp.x + frac * dx, y: lp.y + frac * dy, z: lp.z + frac * dz };
      }
      return { end0: placeOnPath(lp0), end1: placeOnPath(lp1) };
    }

    // Beam length determines horizontal spread of beam ends.
    // t = fraction from LP toward target on the sling path.
    // At parameter t, horizontal spread between the two ends = spreadAtZero * (1-t).
    // So for requested beamLength: t = 1 - beamLength / spreadAtZero.
    let t = Math.max(0, 1 - beamLength / spreadAtZero);

    // When beam >= spread (t=0), beam ends are at LP level horizontally.
    // Use bottom sling length to lift them above the LPs along the sling path.
    // When beam < spread (t>0), bottom sling length is already determined by t.
    if (t < 0.0001 && minSlingLen > 0) {
      // Beam ends need to be lifted. Place each end at minSlingLen along
      // the 3D path from LP toward target.
      const fullLen0 = C.dist3D(lp0, target);
      const fullLen1 = C.dist3D(lp1, target);
      const t0 = fullLen0 > 0 ? Math.min(minSlingLen / fullLen0, 0.95) : 0;
      const t1 = fullLen1 > 0 ? Math.min(minSlingLen / fullLen1, 0.95) : 0;
      return {
        end0: {
          x: lp0.x + t0 * (target.x - lp0.x),
          y: lp0.y + t0 * (target.y - lp0.y),
          z: lp0.z + t0 * (target.z - lp0.z)
        },
        end1: {
          x: lp1.x + t1 * (target.x - lp1.x),
          y: lp1.y + t1 * (target.y - lp1.y),
          z: lp1.z + t1 * (target.z - lp1.z)
        }
      };
    }

    t = Math.min(t, 0.95);

    return {
      end0: {
        x: lp0.x + t * (target.x - lp0.x),
        y: lp0.y + t * (target.y - lp0.y),
        z: lp0.z + t * (target.z - lp0.z)
      },
      end1: {
        x: lp1.x + t * (target.x - lp1.x),
        y: lp1.y + t * (target.y - lp1.y),
        z: lp1.z + t * (target.z - lp1.z)
      }
    };
  }

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { masterLength, slaveLengthA, slaveLengthB, bottomSlingLen } = config;
    const minAngleRad = C.degToRad(minAngleDeg);
    const minSlingLen = bottomSlingLen ?? 2;

    // ── 1. LP pairing ──
    let groupAIdxs, groupBIdxs;
    if (config.pairing) {
      groupAIdxs = config.pairing.groupA.map(v => v - 1);
      groupBIdxs = config.pairing.groupB.map(v => v - 1);
    } else {
      const pairingsOpt = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
      let bestPairing = pairingsOpt[0];
      let bestDist = Infinity;
      for (const p of pairingsOpt) {
        const d = C.horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
                + C.horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
        if (d < bestDist) { bestDist = d; bestPairing = p; }
      }
      groupAIdxs = bestPairing[0];
      groupBIdxs = bestPairing[1];
    }
    const groupALPs = groupAIdxs.map(i => liftingPoints[i]);
    const groupBLPs = groupBIdxs.map(i => liftingPoints[i]);
    const groupALabels = groupAIdxs.map(i => 'LP' + (i + 1));
    const groupBLabels = groupBIdxs.map(i => 'LP' + (i + 1));

    // ── 2. Master beam — centered above load midpoint ──
    const hookXY = { x: cog.x, y: cog.y };

    const lpMidA = C.midpoint(groupALPs[0], groupALPs[1]);
    const lpMidB = C.midpoint(groupBLPs[0], groupBLPs[1]);
    const masterCenter = C.midpoint(lpMidA, lpMidB);

    const mAxisX = lpMidB.x - lpMidA.x;
    const mAxisY = lpMidB.y - lpMidA.y;
    const mAxisLen = Math.sqrt(mAxisX * mAxisX + mAxisY * mAxisY) || 1;
    const mUx = mAxisX / mAxisLen;
    const mUy = mAxisY / mAxisLen;

    const halfMaster = masterLength / 2;
    const masterEndAxy = { x: masterCenter.x - mUx * halfMaster, y: masterCenter.y - mUy * halfMaster };
    const masterEndBxy = { x: masterCenter.x + mUx * halfMaster, y: masterCenter.y + mUy * halfMaster };

    // Master beam Z: must be high enough for min angle from each LP
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
    let masterZ = Math.max(masterEndAz, masterEndBz);

    // ── 3. Iteratively raise masterZ until middle slings meet min angle ──
    let slaveA1, slaveA2, slaveB1, slaveB2;
    for (let iter = 0; iter < 20; iter++) {
      const mEndA = { ...masterEndAxy, z: masterZ };
      const mEndB = { ...masterEndBxy, z: masterZ };

      const pairA = computeBeamEndPair(groupALPs[0], groupALPs[1], mEndA, slaveLengthA, minSlingLen);
      const pairB = computeBeamEndPair(groupBLPs[0], groupBLPs[1], mEndB, slaveLengthB, minSlingLen);

      slaveA1 = pairA.end0;
      slaveA2 = pairA.end1;
      slaveB1 = pairB.end0;
      slaveB2 = pairB.end1;

      // Find max required masterZ from middle sling angles
      const slaveEnds = [slaveA1, slaveA2, slaveB1, slaveB2];
      const mEnds = [mEndA, mEndA, mEndB, mEndB];
      let newMasterZ = masterZ;
      for (let i = 0; i < 4; i++) {
        const hd = C.horizontalDist(slaveEnds[i], mEnds[i]);
        if (hd > 0.001) {
          const requiredZ = slaveEnds[i].z + hd * Math.tan(minAngleRad);
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

    // ── 4. Hook — above master beam at min angle ──
    const hDistHA = C.horizontalDist(masterEnds.endA, hookXY);
    const hDistHB = C.horizontalDist(masterEnds.endB, hookXY);
    const hook = {
      x: cog.x,
      y: cog.y,
      z: masterZ + Math.max(hDistHA, hDistHB) * Math.tan(minAngleRad)
    };

    // ── 5. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 6. Bottom slings (4): LP → slave beam end ──
    let slingId = 1;
    const bottomSlings = [];
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[0], label: groupALabels[0] },
      { ...slaveA1, label: 'Slave A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[1], label: groupALabels[1] },
      { ...slaveA2, label: 'Slave A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[0], label: groupBLabels[0] },
      { ...slaveB1, label: 'Slave B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[1], label: groupBLabels[1] },
      { ...slaveB2, label: 'Slave B End 2' }
    ));

    // ── 7. Middle slings (4): slave beam ends → master beam ends ──
    const middleSlings = [];
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA1, label: 'Slave A End 1' },
      { ...masterEnds.endA, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA2, label: 'Slave A End 2' },
      { ...masterEnds.endA, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB1, label: 'Slave B End 1' },
      { ...masterEnds.endB, label: 'Master End B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB2, label: 'Slave B End 2' },
      { ...masterEnds.endB, label: 'Master End B' }
    ));

    // ── 8. Top slings (2): master beam ends → hook ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { ...masterEnds.endA, label: 'Master End A' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingA);
    const topSlingB = C.buildSling(slingId++,
      { ...masterEnds.endB, label: 'Master End B' },
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

    // Bottom tier: use calcTwoSlingTension per slave beam for proper load distribution
    // This accounts for rigid beam load transfer when LPs are at different heights.
    const slaveMidA = C.midpoint(slaveA1, slaveA2);
    const slaveMidB = C.midpoint(slaveB1, slaveB2);
    const vLoadSlaveA = C.computeVerticalLoad(midTensionsA[0], slaveA1, masterEnds.endA)
                      + C.computeVerticalLoad(midTensionsA[1], slaveA2, masterEnds.endA);
    const vLoadSlaveB = C.computeVerticalLoad(midTensionsB[0], slaveB1, masterEnds.endB)
                      + C.computeVerticalLoad(midTensionsB[1], slaveB2, masterEnds.endB);

    const botTensionsA = C.calcTwoSlingTension(groupALPs[0], groupALPs[1], slaveMidA, vLoadSlaveA);
    const botTensionsB = C.calcTwoSlingTension(groupBLPs[0], groupBLPs[1], slaveMidB, vLoadSlaveB);

    // Convert vertical loads to sling tensions
    for (let i = 0; i < 2; i++) {
      const botSling = bottomSlings[i];
      const len = C.dist3D(botSling.from, botSling.to);
      const vd = Math.abs(botSling.to.z - botSling.from.z);
      const vLoad = botTensionsA[i];
      botSling.tension = (len < 0.0001 || vd < 0.0001)
        ? C.round4(vLoad) : C.round4(vLoad * len / vd);
    }
    for (let i = 0; i < 2; i++) {
      const botSling = bottomSlings[i + 2];
      const len = C.dist3D(botSling.from, botSling.to);
      const vd = Math.abs(botSling.to.z - botSling.from.z);
      const vLoad = botTensionsB[i];
      botSling.tension = (len < 0.0001 || vd < 0.0001)
        ? C.round4(vLoad) : C.round4(vLoad * len / vd);
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
          length: C.round4(masterLength), pickupPoint: null
        },
        {
          name: 'Slave Beam A',
          endA: { x: C.round4(slaveA1.x), y: C.round4(slaveA1.y), z: C.round4(slaveA1.z) },
          endB: { x: C.round4(slaveA2.x), y: C.round4(slaveA2.y), z: C.round4(slaveA2.z) },
          length: actualSlaveLenA, pickupPoint: null
        },
        {
          name: 'Slave Beam B',
          endA: { x: C.round4(slaveB1.x), y: C.round4(slaveB1.y), z: C.round4(slaveB1.z) },
          endB: { x: C.round4(slaveB2.x), y: C.round4(slaveB2.y), z: C.round4(slaveB2.z) },
          length: actualSlaveLenB, pickupPoint: null
        }
      ],
      intermediatePoints: [
        { ...slaveA1, label: 'Slave A End 1' }, { ...slaveA2, label: 'Slave A End 2' },
        { ...slaveB1, label: 'Slave B End 1' }, { ...slaveB2, label: 'Slave B End 2' },
        { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z), label: 'Master End A' },
        { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z), label: 'Master End B' }
      ],
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
