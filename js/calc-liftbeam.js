/**
 * Lifting Beam Calculation
 *
 * Single pickup point on beam at COG XY. Hook connects directly to beam
 * (zero-length vertical connection). Beam is horizontal — both ends at
 * the same Z. Only bottom slings (4 total, LP → beam end). Beam bending
 * capacity is NOT checked.
 */

const CalcLiftBeam = (() => {

  /**
   * @param {object} shared - { liftingPoints, cog, minAngleDeg, totalLoad }
   * @param {object} config - { beamLength, orientation, pairing: { groupA: [idx,idx], groupB: [idx,idx] } }
   *                          pairing indices are 1-based
   * @returns {object} standardised result
   */
  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { beamLength, orientation, pairing } = config;
    const minAngleRad = CalcCore.degToRad(minAngleDeg);

    // 1. Extract LP groups (convert 1-based to 0-based)
    const groupAIndices = pairing.groupA.map(i => i - 1);
    const groupBIndices = pairing.groupB.map(i => i - 1);
    const groupALPs = groupAIndices.map(i => liftingPoints[i]);
    const groupBLPs = groupBIndices.map(i => liftingPoints[i]);

    // 2. Group midpoints
    const midA = CalcCore.midpoint(groupALPs[0], groupALPs[1]);
    const midB = CalcCore.midpoint(groupBLPs[0], groupBLPs[1]);

    // 3. Beam axis
    const axis = CalcCore.getOrientationAxis(liftingPoints, orientation);

    // 4. Beam centre XY = midpoint of the two group midpoints
    const beamCentre = CalcCore.midpoint(midA, midB);

    // 5. Beam ends
    let { endA, endB } = CalcCore.computeBeamEnds(beamCentre, beamLength, axis);

    // 6. Assign End A closest to Group A midpoint (swap if needed)
    const distAtoEndA = CalcCore.horizontalDist(midA, endA);
    const distAtoEndB = CalcCore.horizontalDist(midA, endB);
    if (distAtoEndB < distAtoEndA) {
      const tmp = endA;
      endA = endB;
      endB = tmp;
    }

    // 7. Beam end Z per group
    const endAz = CalcCore.computeBeamEndZ(groupALPs, endA, minAngleRad);
    const endBz = CalcCore.computeBeamEndZ(groupBLPs, endB, minAngleRad);

    // 8. Horizontal beam: beamZ = max of the two computed end Zs
    const beamZ = Math.max(endAz, endBz);
    endA.z = beamZ;
    endB.z = beamZ;

    // 9. COG polygon validation
    const cogInsidePolygon = CalcCore.pointInPolygon2D(
      cog, liftingPoints.map(lp => ({ x: lp.x, y: lp.y }))
    );

    // 10. Pickup point
    const pickupPoint = { x: cog.x, y: cog.y, z: beamZ };

    // 11. Hook (same as pickup — zero-length connection)
    const hook = { x: cog.x, y: cog.y, z: beamZ };

    // 12. Bottom slings (4 total): LP → beam end
    const slings = [];
    let slingId = 1;

    // Group A slings → Beam End A
    for (const idx of groupAIndices) {
      const lp = liftingPoints[idx];
      const from = { x: lp.x, y: lp.y, z: lp.z, label: `LP${idx + 1}` };
      const to = { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' };
      slings.push(CalcCore.buildSling(slingId++, from, to));
    }

    // Group B slings → Beam End B
    for (const idx of groupBIndices) {
      const lp = liftingPoints[idx];
      const from = { x: lp.x, y: lp.y, z: lp.z, label: `LP${idx + 1}` };
      const to = { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' };
      slings.push(CalcCore.buildSling(slingId++, from, to));
    }

    // 13. Load at each beam end via moment balance
    //     The total load hangs from the pickup point (COG XY).
    //     Load at End A = totalLoad * distFromPickupToEndB / beamLength
    //     Load at End B = totalLoad * distFromPickupToEndA / beamLength
    const distPickupToEndA = CalcCore.horizontalDist(pickupPoint, endA);
    const distPickupToEndB = CalcCore.horizontalDist(pickupPoint, endB);
    const loadAtEndA = totalLoad * distPickupToEndB / beamLength;
    const loadAtEndB = totalLoad * distPickupToEndA / beamLength;

    // 2-sling tension per group
    const groupATensions = CalcCore.calcTwoSlingTension(
      groupALPs[0], groupALPs[1], endA, loadAtEndA
    );
    const groupBTensions = CalcCore.calcTwoSlingTension(
      groupBLPs[0], groupBLPs[1], endB, loadAtEndB
    );

    // 14. Set tension and verticalLoad on each sling
    //     slings[0..1] = group A, slings[2..3] = group B
    let hasNegativeTension = false;

    for (let i = 0; i < 2; i++) {
      slings[i].tension = CalcCore.round4(groupATensions[i]);
      if (groupATensions[i] < -0.001) hasNegativeTension = true;
      slings[i].verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(groupATensions[i], slings[i].from, slings[i].to));
    }
    for (let i = 0; i < 2; i++) {
      slings[2 + i].tension = CalcCore.round4(groupBTensions[i]);
      if (groupBTensions[i] < -0.001) hasNegativeTension = true;
      slings[2 + i].verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(groupBTensions[i], slings[2 + i].from, slings[2 + i].to));
    }

    // 15. Critical sling (bottom tier only — it's the only tier)
    let maxTension = -Infinity;
    let criticalIndex = 0;
    slings.forEach((s, i) => {
      if (s.tension > maxTension) {
        maxTension = s.tension;
        criticalIndex = i;
      }
    });
    slings[criticalIndex].isCritical = true;

    // 16. Headroom: beamZ - max LP Z
    const maxLPz = Math.max(...liftingPoints.map(lp => lp.z));
    const headroom = beamZ - maxLPz;

    return {
      configType: 'lifting-beam',
      hook,
      hookHeight: CalcCore.round4(beamZ),
      headroom: CalcCore.round4(headroom),
      heightAboveCOG: CalcCore.round4(beamZ - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: 'bottom', id: slings[criticalIndex].id },
      tiers: [{
        name: 'Bottom Slings',
        slings
      }],
      beams: [{
        name: 'Lifting Beam',
        endA: { x: endA.x, y: endA.y, z: endA.z },
        endB: { x: endB.x, y: endB.y, z: endB.z },
        length: beamLength,
        pickupPoint: { x: cog.x, y: cog.y, z: beamZ }
      }],
      intermediatePoints: [
        { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' },
        { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' },
        { x: cog.x, y: cog.y, z: beamZ, label: 'Pickup' }
      ],
      warnings: {
        cogOutsidePolygon: !cogInsidePolygon,
        negativeTension: hasNegativeTension,
        topSlingAngleLow: false,
        liftBeamBendingNotChecked: true
      }
    };
  }

  return { calculate };
})();
