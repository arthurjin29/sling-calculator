/**
 * Lifting Beam Calculation
 *
 * Single pickup point on beam at COG position (projected onto beam axis).
 * Hook connects directly to beam (zero-length vertical connection).
 * Beam is horizontal — both ends at the same Z.
 * Only bottom slings (4 total, each LP to nearest beam end).
 * Beam bending capacity is NOT checked.
 */

const CalcLiftBeam = (() => {

  const C = CalcCore;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { beamLength, orientation } = config;
    const minAngleRad = C.degToRad(minAngleDeg);

    // 1. Beam centre = centroid of all 4 LPs
    const cx = liftingPoints.reduce((s, p) => s + p.x, 0) / 4;
    const cy = liftingPoints.reduce((s, p) => s + p.y, 0) / 4;
    const beamCentre = { x: cx, y: cy, z: 0 };

    // 2. Beam axis
    const axis = C.getOrientationAxis(liftingPoints, orientation);

    // 3. Beam ends
    let { endA, endB } = C.computeBeamEnds(beamCentre, beamLength, axis);

    // 4. Auto-assign each LP to nearest beam end
    const groupA = [];
    const groupB = [];
    for (let i = 0; i < liftingPoints.length; i++) {
      const lp = liftingPoints[i];
      const dA = C.horizontalDist(lp, endA);
      const dB = C.horizontalDist(lp, endB);
      if (dA <= dB) {
        groupA.push({ lp, idx: i, label: 'LP' + (i + 1) });
      } else {
        groupB.push({ lp, idx: i, label: 'LP' + (i + 1) });
      }
    }

    // Fallback if all LPs on one side
    if (groupA.length === 0 || groupB.length === 0) {
      const ranked = liftingPoints.map((lp, i) => ({
        lp, idx: i, label: 'LP' + (i + 1),
        dA: C.horizontalDist(lp, endA)
      })).sort((a, b) => a.dA - b.dA);
      groupA.length = 0;
      groupB.length = 0;
      ranked.slice(0, 2).forEach(r => groupA.push(r));
      ranked.slice(2).forEach(r => groupB.push(r));
    }

    // 5. Beam end Z per group
    const endAz = C.computeBeamEndZ(groupA.map(g => g.lp), endA, minAngleRad);
    const endBz = C.computeBeamEndZ(groupB.map(g => g.lp), endB, minAngleRad);

    // 6. Horizontal beam: both ends at max Z
    const beamZ = Math.max(endAz, endBz);
    endA.z = beamZ;
    endB.z = beamZ;

    // 7. COG polygon validation
    const cogInsidePolygon = C.pointInPolygon2D(
      cog, liftingPoints.map(lp => ({ x: lp.x, y: lp.y }))
    );

    // 8. Pickup point — project COG onto beam axis
    const cogToEndA = { x: cog.x - endA.x, y: cog.y - endA.y };
    const beamDir = { x: endB.x - endA.x, y: endB.y - endA.y };
    const beamLen2D = Math.sqrt(beamDir.x * beamDir.x + beamDir.y * beamDir.y);
    let pickupX, pickupY;
    if (beamLen2D > 0.0001) {
      const t = (cogToEndA.x * beamDir.x + cogToEndA.y * beamDir.y) / (beamLen2D * beamLen2D);
      pickupX = endA.x + t * beamDir.x;
      pickupY = endA.y + t * beamDir.y;
    } else {
      pickupX = cog.x;
      pickupY = cog.y;
    }
    const pickupPoint = { x: pickupX, y: pickupY, z: beamZ };

    // 9. Hook = pickup (zero-length connection)
    const hook = { x: pickupX, y: pickupY, z: beamZ };

    // 10. Bottom slings — each LP to nearest beam end
    const slings = [];
    let slingId = 1;

    for (const g of groupA) {
      slings.push(C.buildSling(slingId++,
        { x: g.lp.x, y: g.lp.y, z: g.lp.z, label: g.label },
        { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' }
      ));
    }
    for (const g of groupB) {
      slings.push(C.buildSling(slingId++,
        { x: g.lp.x, y: g.lp.y, z: g.lp.z, label: g.label },
        { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' }
      ));
    }

    // 11. Load at each beam end via moment balance along beam
    const distPickupToEndA = C.horizontalDist(pickupPoint, endA);
    const distPickupToEndB = C.horizontalDist(pickupPoint, endB);
    const totalBeamSpan = distPickupToEndA + distPickupToEndB;
    const loadAtEndA = totalBeamSpan > 0.0001 ? totalLoad * distPickupToEndB / totalBeamSpan : totalLoad / 2;
    const loadAtEndB = totalBeamSpan > 0.0001 ? totalLoad * distPickupToEndA / totalBeamSpan : totalLoad / 2;

    // 12. Bottom sling tensions per group
    let hasNegativeTension = false;
    const groupALPs = groupA.map(g => g.lp);
    const groupBLPs = groupB.map(g => g.lp);
    const bOffset = groupA.length;

    if (groupALPs.length === 2) {
      const [t0, t1] = C.calcTwoSlingTension(groupALPs[0], groupALPs[1], endA, loadAtEndA);
      slings[0].tension = C.round4(t0);
      slings[1].tension = C.round4(t1);
      if (t0 < -0.001 || t1 < -0.001) hasNegativeTension = true;
    } else if (groupALPs.length === 1) {
      const len = C.dist3D(groupALPs[0], endA);
      const vd = Math.abs(endA.z - groupALPs[0].z);
      slings[0].tension = C.round4(vd > 1e-9 ? loadAtEndA * len / vd : loadAtEndA);
    } else {
      const tensions = C.calcLoadDistribution(groupALPs, endA, loadAtEndA);
      for (let i = 0; i < groupA.length; i++) slings[i].tension = C.round4(tensions[i]);
    }

    if (groupBLPs.length === 2) {
      const [t0, t1] = C.calcTwoSlingTension(groupBLPs[0], groupBLPs[1], endB, loadAtEndB);
      slings[bOffset].tension = C.round4(t0);
      slings[bOffset + 1].tension = C.round4(t1);
      if (t0 < -0.001 || t1 < -0.001) hasNegativeTension = true;
    } else if (groupBLPs.length === 1) {
      const len = C.dist3D(groupBLPs[0], endB);
      const vd = Math.abs(endB.z - groupBLPs[0].z);
      slings[bOffset].tension = C.round4(vd > 1e-9 ? loadAtEndB * len / vd : loadAtEndB);
    } else {
      const tensions = C.calcLoadDistribution(groupBLPs, endB, loadAtEndB);
      for (let i = 0; i < groupB.length; i++) slings[bOffset + i].tension = C.round4(tensions[i]);
    }

    // 13. Vertical loads
    for (const s of slings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
      if (s.tension < -0.001) hasNegativeTension = true;
    }

    // 14. Critical sling
    let maxTension = -Infinity;
    let criticalIndex = 0;
    slings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalIndex = i; }
    });
    slings[criticalIndex].isCritical = true;

    // 15. Headroom
    const maxLPz = Math.max(...liftingPoints.map(lp => lp.z));

    return {
      configType: 'lifting-beam',
      hook,
      hookHeight: C.round4(beamZ),
      headroom: C.round4(beamZ - maxLPz),
      heightAboveCOG: C.round4(beamZ - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: 'bottom', id: slings[criticalIndex].id },
      tiers: [{ name: 'Bottom Slings', slings }],
      beams: [{
        name: 'Lifting Beam',
        endA: { x: C.round4(endA.x), y: C.round4(endA.y), z: C.round4(endA.z) },
        endB: { x: C.round4(endB.x), y: C.round4(endB.y), z: C.round4(endB.z) },
        length: beamLength,
        pickupPoint: { x: C.round4(pickupX), y: C.round4(pickupY), z: C.round4(beamZ) }
      }],
      intermediatePoints: [
        { x: C.round4(endA.x), y: C.round4(endA.y), z: C.round4(endA.z), label: 'Beam End A' },
        { x: C.round4(endB.x), y: C.round4(endB.y), z: C.round4(endB.z), label: 'Beam End B' },
        { x: C.round4(pickupX), y: C.round4(pickupY), z: C.round4(beamZ), label: 'Pickup' }
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
