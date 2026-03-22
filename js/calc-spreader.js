/**
 * Sling Length Calculator — Spreader Beam Configuration
 *
 * Bottom tier: 4 slings from 4 LPs to 2 beam ends (auto-assigned by proximity)
 * Top tier:    2 slings from beam ends to hook
 *
 * Exposes: window.CalcSpreader = { calculate }
 */

window.CalcSpreader = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { beamLength, orientation } = config;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Beam centre = centroid of all 4 LPs ──
    const cx = liftingPoints.reduce((s, p) => s + p.x, 0) / 4;
    const cy = liftingPoints.reduce((s, p) => s + p.y, 0) / 4;
    const beamCentre = { x: cx, y: cy, z: 0 };

    // ── 2. Beam orientation axis ──
    const axis = C.getOrientationAxis(liftingPoints, orientation);

    // ── 3. Beam ends (XY, Z = 0 initially) ──
    let { endA, endB } = C.computeBeamEnds(beamCentre, beamLength, axis);

    // ── 4. Auto-assign each LP to nearest beam end ──
    const groupA = []; // LPs closer to endA
    const groupB = []; // LPs closer to endB
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

    // Ensure both groups have at least 1 LP (handle edge cases)
    if (groupA.length === 0 || groupB.length === 0) {
      // Fallback: split evenly by distance ranking
      const ranked = liftingPoints.map((lp, i) => ({
        lp, idx: i, label: 'LP' + (i + 1),
        dA: C.horizontalDist(lp, endA)
      })).sort((a, b) => a.dA - b.dA);
      groupA.length = 0;
      groupB.length = 0;
      ranked.slice(0, 2).forEach(r => groupA.push(r));
      ranked.slice(2).forEach(r => groupB.push(r));
    }

    // ── 5. Beam end Z from bottom sling min angle (per group) ──
    endA.z = C.computeBeamEndZ(groupA.map(g => g.lp), endA, minAngleRad);
    endB.z = C.computeBeamEndZ(groupB.map(g => g.lp), endB, minAngleRad);

    // ── 6. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 7. Hook position — in beam plane, projected along beam axis ──
    // Project COG onto the beam axis line so hook stays in the beam's vertical plane
    const cogToEndA = { x: cog.x - endA.x, y: cog.y - endA.y };
    const beamDir = { x: endB.x - endA.x, y: endB.y - endA.y };
    const beamLen2D = Math.sqrt(beamDir.x * beamDir.x + beamDir.y * beamDir.y);
    let hookX, hookY;
    if (beamLen2D > 0.0001) {
      // Project COG onto beam line: t = dot(cogToEndA, beamDir) / |beamDir|²
      const t = (cogToEndA.x * beamDir.x + cogToEndA.y * beamDir.y) / (beamLen2D * beamLen2D);
      hookX = endA.x + t * beamDir.x;
      hookY = endA.y + t * beamDir.y;
    } else {
      hookX = cog.x;
      hookY = cog.y;
    }
    const hook = { x: hookX, y: hookY, z: 0 };
    const hDistAtoHook = C.horizontalDist(endA, hook);
    const hDistBtoHook = C.horizontalDist(endB, hook);
    hook.z = Math.max(
      endA.z + hDistAtoHook * Math.tan(minAngleRad),
      endB.z + hDistBtoHook * Math.tan(minAngleRad)
    );

    // ── 8. Bottom slings — each LP to its assigned beam end ──
    const bottomSlings = [];
    let slingId = 1;

    for (const g of groupA) {
      bottomSlings.push(C.buildSling(slingId++,
        { x: g.lp.x, y: g.lp.y, z: g.lp.z, label: g.label },
        { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' }
      ));
    }
    for (const g of groupB) {
      bottomSlings.push(C.buildSling(slingId++,
        { x: g.lp.x, y: g.lp.y, z: g.lp.z, label: g.label },
        { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' }
      ));
    }

    // ── 9. Top slings (2 total) ──
    const topSlingA = C.buildSling(slingId++,
      { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    const topSlingB = C.buildSling(slingId++,
      { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    const topSlings = [topSlingA, topSlingB];

    // ── 10. Tensions ──

    // Top sling tensions
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(endA, endB, hook, totalLoad);
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    // Vertical load at each beam end
    const vLoadA = C.computeVerticalLoad(topTensionA, endA, hook);
    const vLoadB = C.computeVerticalLoad(topTensionB, endB, hook);

    // Bottom sling tensions per group
    const groupALPs = groupA.map(g => g.lp);
    const groupBLPs = groupB.map(g => g.lp);

    if (groupALPs.length === 2) {
      const [t0, t1] = C.calcTwoSlingTension(groupALPs[0], groupALPs[1], endA, vLoadA);
      bottomSlings[0].tension = C.round4(t0);
      bottomSlings[1].tension = C.round4(t1);
    } else if (groupALPs.length === 1) {
      // Single LP to this end — tension = vLoad / sin(angle)
      const len = C.dist3D(groupALPs[0], endA);
      const vd = Math.abs(endA.z - groupALPs[0].z);
      bottomSlings[0].tension = C.round4(vd > 1e-9 ? vLoadA * len / vd : vLoadA);
    } else {
      // 3 LPs to this end — use N-sling distribution
      const tensions = C.calcLoadDistribution(groupALPs, endA, vLoadA);
      for (let i = 0; i < groupA.length; i++) bottomSlings[i].tension = C.round4(tensions[i]);
    }

    const bOffset = groupA.length;
    if (groupBLPs.length === 2) {
      const [t0, t1] = C.calcTwoSlingTension(groupBLPs[0], groupBLPs[1], endB, vLoadB);
      bottomSlings[bOffset].tension = C.round4(t0);
      bottomSlings[bOffset + 1].tension = C.round4(t1);
    } else if (groupBLPs.length === 1) {
      const len = C.dist3D(groupBLPs[0], endB);
      const vd = Math.abs(endB.z - groupBLPs[0].z);
      bottomSlings[bOffset].tension = C.round4(vd > 1e-9 ? vLoadB * len / vd : vLoadB);
    } else {
      const tensions = C.calcLoadDistribution(groupBLPs, endB, vLoadB);
      for (let i = 0; i < groupB.length; i++) bottomSlings[bOffset + i].tension = C.round4(tensions[i]);
    }

    // ── 11. Vertical loads ──
    const allSlings = [...bottomSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 12. Warnings ──
    const topSlingAngleLow = topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 13. Critical sling ──
    let criticalTier = 'bottom';
    let criticalIdx = 0;
    let maxTension = -Infinity;

    bottomSlings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'bottom'; criticalIdx = i; }
    });
    topSlings.forEach((s, i) => {
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'top'; criticalIdx = i; }
    });

    const criticalSlingArr = criticalTier === 'bottom' ? bottomSlings : topSlings;
    criticalSlingArr[criticalIdx].isCritical = true;

    // Hook height governance
    const hookZFromA = endA.z + hDistAtoHook * Math.tan(minAngleRad);
    const hookZFromB = endB.z + hDistBtoHook * Math.tan(minAngleRad);
    topSlingA.governsHookHeight = (hookZFromA >= hookZFromB);
    topSlingB.governsHookHeight = (hookZFromB > hookZFromA);

    // ── 14. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    return {
      configType: 'spreader-beam',
      hook: { x: C.round4(hook.x), y: C.round4(hook.y), z: C.round4(hook.z) },
      hookHeight: C.round4(hook.z),
      headroom: C.round4(hook.z - maxLPz),
      heightAboveCOG: C.round4(hook.z - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: criticalTier, id: criticalIdx + 1 },
      tiers: [
        { name: 'Bottom Slings', slings: bottomSlings },
        { name: 'Top Slings', slings: topSlings }
      ],
      beams: [{
        name: 'Spreader Beam',
        endA: { x: C.round4(endA.x), y: C.round4(endA.y), z: C.round4(endA.z) },
        endB: { x: C.round4(endB.x), y: C.round4(endB.y), z: C.round4(endB.z) },
        length: beamLength,
        pickupPoint: null
      }],
      intermediatePoints: [
        { x: C.round4(endA.x), y: C.round4(endA.y), z: C.round4(endA.z), label: 'Beam End A' },
        { x: C.round4(endB.x), y: C.round4(endB.y), z: C.round4(endB.z), label: 'Beam End B' }
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
