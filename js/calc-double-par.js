/**
 * Sling Length Calculator — Double Spreader (Parallel) Configuration
 *
 * Two independent spreader beams, each centred on its own LP group.
 * Bottom tier: 4 slings — 1 LP to 1 beam end each (1-to-1 mapping)
 * Top tier:    4 slings — 4 beam ends converging to a single hook
 *
 * Exposes: window.CalcDoublePar = { calculate }
 */

window.CalcDoublePar = (() => {

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
   * @param {number} config.beamLengthA - length of Beam A
   * @param {number} config.beamLengthB - length of Beam B
   * @param {string} config.orientationA - 'lengthwise' | 'widthwise' for Beam A
   * @param {string} config.orientationB - 'lengthwise' | 'widthwise' for Beam B
   * @param {Object} config.pairing
   * @param {number[]} config.pairing.groupA - [lpIdx, lpIdx] (1-based)
   * @param {number[]} config.pairing.groupB - [lpIdx, lpIdx] (1-based)
   *
   * @returns {Object} standardised result
   */
  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { beamLengthA, beamLengthB, orientationA, orientationB, pairing } = config;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Auto-pair LPs by proximity (closest two form a pair) ──
    const pairings = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
    let bestPairing = pairings[0];
    let bestDist = Infinity;
    for (const p of pairings) {
      const d = C.horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
              + C.horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
      if (d < bestDist) { bestDist = d; bestPairing = p; }
    }
    const groupALPs = bestPairing[0].map(i => liftingPoints[i]);
    const groupBLPs = bestPairing[1].map(i => liftingPoints[i]);
    const groupALabels = bestPairing[0].map(i => 'LP' + (i + 1));
    const groupBLabels = bestPairing[1].map(i => 'LP' + (i + 1));

    // ── 2. Beam axes ──
    const axisA = C.getOrientationAxis(liftingPoints, orientationA);
    const axisB = C.getOrientationAxis(liftingPoints, orientationB);

    // ── 3. Beam centres — each beam centred on its OWN group midpoint ──
    const midA = C.midpoint(groupALPs[0], groupALPs[1]);
    const midB = C.midpoint(groupBLPs[0], groupBLPs[1]);

    const beamCentreA = { x: midA.x, y: midA.y, z: 0 };
    const beamCentreB = { x: midB.x, y: midB.y, z: 0 };

    // ── 4. Beam ends (initial XY, Z = 0) ──
    let beamEndsA = C.computeBeamEnds(beamCentreA, beamLengthA, axisA);
    let beamEndsB = C.computeBeamEnds(beamCentreB, beamLengthB, axisB);

    // ── 5. Assign beam ends: End 1 = closer to first LP of group ──
    // Beam A
    if (C.horizontalDist(groupALPs[0], beamEndsA.endB) <
        C.horizontalDist(groupALPs[0], beamEndsA.endA)) {
      const tmp = beamEndsA.endA;
      beamEndsA.endA = beamEndsA.endB;
      beamEndsA.endB = tmp;
    }
    // Beam B
    if (C.horizontalDist(groupBLPs[0], beamEndsB.endB) <
        C.horizontalDist(groupBLPs[0], beamEndsB.endA)) {
      const tmp = beamEndsB.endA;
      beamEndsB.endA = beamEndsB.endB;
      beamEndsB.endB = tmp;
    }

    // Name consistently: endA = End 1, endB = End 2
    let beamA1 = beamEndsA.endA;
    let beamA2 = beamEndsA.endB;
    let beamB1 = beamEndsB.endA;
    let beamB2 = beamEndsB.endB;

    // ── 6. Assign each LP to its nearest beam end (1-to-1 within group) ──
    // Group A: LP_A[0] → nearest of beamA1/beamA2, LP_A[1] → the other
    let lpA1Idx = 0, lpA2Idx = 1;
    if (C.horizontalDist(groupALPs[0], beamA1) > C.horizontalDist(groupALPs[0], beamA2)) {
      // LP_A[0] is closer to End 2, swap assignments
      lpA1Idx = 1;
      lpA2Idx = 0;
    }
    // lpA1Idx → beamA1, lpA2Idx → beamA2

    let lpB1Idx = 0, lpB2Idx = 1;
    if (C.horizontalDist(groupBLPs[0], beamB1) > C.horizontalDist(groupBLPs[0], beamB2)) {
      lpB1Idx = 1;
      lpB2Idx = 0;
    }

    // ── 7. Beam end Z from bottom sling min angle ──
    // Each beam end Z governed by its single connected LP
    beamA1.z = C.computeBeamEndZ([groupALPs[lpA1Idx]], beamA1, minAngleRad);
    beamA2.z = C.computeBeamEndZ([groupALPs[lpA2Idx]], beamA2, minAngleRad);
    beamB1.z = C.computeBeamEndZ([groupBLPs[lpB1Idx]], beamB1, minAngleRad);
    beamB2.z = C.computeBeamEndZ([groupBLPs[lpB2Idx]], beamB2, minAngleRad);

    // ── 8. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 9. Hook position ──
    // hookXY = COG XY; hookZ from top sling geometry (4 beam ends → hook)
    const hook = { x: cog.x, y: cog.y, z: 0 };
    const allBeamEnds = [beamA1, beamA2, beamB1, beamB2];

    let maxHookZ = -Infinity;
    for (const be of allBeamEnds) {
      const hd = C.horizontalDist(be, hook);
      const requiredZ = be.z + hd * Math.tan(minAngleRad);
      if (requiredZ > maxHookZ) maxHookZ = requiredZ;
    }
    hook.z = maxHookZ;

    // ── 10. Bottom slings (4 total, 1-to-1 LP → beam end) ──
    const bottomSlings = [];
    let slingId = 1;

    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[lpA1Idx].x, y: groupALPs[lpA1Idx].y, z: groupALPs[lpA1Idx].z,
        label: groupALabels[lpA1Idx] },
      { x: beamA1.x, y: beamA1.y, z: beamA1.z, label: 'Beam A End 1' }
    ));

    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[lpA2Idx].x, y: groupALPs[lpA2Idx].y, z: groupALPs[lpA2Idx].z,
        label: groupALabels[lpA2Idx] },
      { x: beamA2.x, y: beamA2.y, z: beamA2.z, label: 'Beam A End 2' }
    ));

    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[lpB1Idx].x, y: groupBLPs[lpB1Idx].y, z: groupBLPs[lpB1Idx].z,
        label: groupBLabels[lpB1Idx] },
      { x: beamB1.x, y: beamB1.y, z: beamB1.z, label: 'Beam B End 1' }
    ));

    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[lpB2Idx].x, y: groupBLPs[lpB2Idx].y, z: groupBLPs[lpB2Idx].z,
        label: groupBLabels[lpB2Idx] },
      { x: beamB2.x, y: beamB2.y, z: beamB2.z, label: 'Beam B End 2' }
    ));

    // ── 11. Top slings (4 total, each beam end → hook) ──
    const topSlings = [];
    const beamEndLabels = ['Beam A End 1', 'Beam A End 2', 'Beam B End 1', 'Beam B End 2'];

    for (let i = 0; i < allBeamEnds.length; i++) {
      const be = allBeamEnds[i];
      topSlings.push(C.buildSling(slingId++,
        { x: be.x, y: be.y, z: be.z, label: beamEndLabels[i] },
        { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
      ));
    }

    // ── 12. Tensions ──

    // Top tier: 4-sling load distribution (beam ends as "lifting points", hook above)
    const topTensions = C.calcLoadDistribution(allBeamEnds, hook, totalLoad);
    for (let i = 0; i < topSlings.length; i++) {
      topSlings[i].tension = C.round4(topTensions[i]);
    }

    // Vertical load at each beam end (from raw geometry)
    const beamEndVLoads = [];
    for (let i = 0; i < topSlings.length; i++) {
      beamEndVLoads.push(C.computeVerticalLoad(topTensions[i], allBeamEnds[i], hook));
    }

    // Bottom tier: each bottom sling is 1-to-1 with its beam end.
    // Bottom tension = verticalLoad at beam end / sin(bottom angle)
    for (let i = 0; i < bottomSlings.length; i++) {
      const length = C.dist3D(bottomSlings[i].from, bottomSlings[i].to);
      const vd = Math.abs(bottomSlings[i].to.z - bottomSlings[i].from.z);
      if (length < 0.0001 || vd < 0.0001) {
        bottomSlings[i].tension = Infinity;
      } else {
        bottomSlings[i].tension = C.round4(beamEndVLoads[i] * length / vd);
      }
    }

    // ── 13. Vertical loads on all slings (from raw geometry) ──
    const allSlings = [...bottomSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 14. Top sling angle warning ──
    const topSlingAngleLow = topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);

    // ── 15. Negative tension warning ──
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 16. Critical sling (highest tension across all tiers) ──
    let criticalTier = 'bottom';
    let criticalIdx = 0;
    let maxTension = -Infinity;

    bottomSlings.forEach((s, i) => {
      if (s.tension > maxTension) {
        maxTension = s.tension;
        criticalTier = 'bottom';
        criticalIdx = i;
      }
    });
    topSlings.forEach((s, i) => {
      if (s.tension > maxTension) {
        maxTension = s.tension;
        criticalTier = 'top';
        criticalIdx = i;
      }
    });

    // Mark critical sling
    const criticalSlingArr = criticalTier === 'bottom' ? bottomSlings : topSlings;
    criticalSlingArr[criticalIdx].isCritical = true;

    // Mark which sling governs hook height
    for (let i = 0; i < topSlings.length; i++) {
      const be = allBeamEnds[i];
      const hd = C.horizontalDist(be, hook);
      const requiredZ = be.z + hd * Math.tan(minAngleRad);
      topSlings[i].governsHookHeight = (Math.abs(requiredZ - hook.z) < 1e-8);
    }

    // ── 17. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));
    const headroom = C.round4(hook.z - maxLPz);
    const heightAboveCOG = C.round4(hook.z - cog.z);

    // ── 18. Return standardised result ──
    return {
      configType: 'double-parallel',
      hook: { x: C.round4(hook.x), y: C.round4(hook.y), z: C.round4(hook.z) },
      hookHeight: C.round4(hook.z),
      headroom,
      heightAboveCOG,
      totalLoad,
      minAngleDeg,

      criticalSling: { tier: criticalTier, id: criticalIdx + 1 },

      tiers: [
        { name: 'Bottom Slings', slings: bottomSlings },
        { name: 'Top Slings', slings: topSlings }
      ],

      beams: [
        {
          name: 'Beam A',
          endA: { x: C.round4(beamA1.x), y: C.round4(beamA1.y), z: C.round4(beamA1.z) },
          endB: { x: C.round4(beamA2.x), y: C.round4(beamA2.y), z: C.round4(beamA2.z) },
          length: beamLengthA,
          pickupPoint: null
        },
        {
          name: 'Beam B',
          endA: { x: C.round4(beamB1.x), y: C.round4(beamB1.y), z: C.round4(beamB1.z) },
          endB: { x: C.round4(beamB2.x), y: C.round4(beamB2.y), z: C.round4(beamB2.z) },
          length: beamLengthB,
          pickupPoint: null
        }
      ],

      intermediatePoints: [
        { x: C.round4(beamA1.x), y: C.round4(beamA1.y), z: C.round4(beamA1.z), label: 'Beam A End 1' },
        { x: C.round4(beamA2.x), y: C.round4(beamA2.y), z: C.round4(beamA2.z), label: 'Beam A End 2' },
        { x: C.round4(beamB1.x), y: C.round4(beamB1.y), z: C.round4(beamB1.z), label: 'Beam B End 1' },
        { x: C.round4(beamB2.x), y: C.round4(beamB2.y), z: C.round4(beamB2.z), label: 'Beam B End 2' }
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
