/**
 * Stinger / Equalising Triangle Calculation
 *
 * The stinger splits a 4-leg direct lift: at a junction point along each
 * pair's path, two slings become one. Bottom sling angles match the direct
 * config. The apex sits on the line from LP-pair centre to hook.
 *
 * User defines top sling length (0 = auto, halfway along pair-centre-to-hook).
 */

const CalcStinger = (() => {

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const minAngleRad = CalcCore.degToRad(minAngleDeg);

    // --- 1. Auto-pair LPs by proximity (closest two form a pair) ---
    // 3 possible pairings of 4 points into 2 pairs — pick smallest total distance
    const pairings = [
      [[0,1],[2,3]],
      [[0,2],[1,3]],
      [[0,3],[1,2]]
    ];
    let bestPairing = pairings[0];
    let bestDist = Infinity;
    for (const p of pairings) {
      const d = CalcCore.horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
              + CalcCore.horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
      if (d < bestDist) { bestDist = d; bestPairing = p; }
    }
    const groupAIndices = bestPairing[0];
    const groupBIndices = bestPairing[1];
    const groupALPs = groupAIndices.map(i => liftingPoints[i]);
    const groupBLPs = groupBIndices.map(i => liftingPoints[i]);

    // --- 2. Pair centres ---
    const pairCentreA = CalcCore.midpoint(groupALPs[0], groupALPs[1]);
    const pairCentreB = CalcCore.midpoint(groupBLPs[0], groupBLPs[1]);

    // --- 3. Compute apex position from bottom slings (min angle) ---
    // Apex sits above the pair centre at the height required for min angle
    // from each LP in the pair to the apex.
    const hookXY = { x: cog.x, y: cog.y };

    // Apex A: above pair centre A, high enough for min angle from both LPs
    const hDistA0 = CalcCore.horizontalDist(groupALPs[0], pairCentreA);
    const hDistA1 = CalcCore.horizontalDist(groupALPs[1], pairCentreA);
    const apexAz = Math.max(
      groupALPs[0].z + hDistA0 * Math.tan(minAngleRad),
      groupALPs[1].z + hDistA1 * Math.tan(minAngleRad)
    );
    const apexA = { x: pairCentreA.x, y: pairCentreA.y, z: apexAz };

    // Apex B: same logic
    const hDistB0 = CalcCore.horizontalDist(groupBLPs[0], pairCentreB);
    const hDistB1 = CalcCore.horizontalDist(groupBLPs[1], pairCentreB);
    const apexBz = Math.max(
      groupBLPs[0].z + hDistB0 * Math.tan(minAngleRad),
      groupBLPs[1].z + hDistB1 * Math.tan(minAngleRad)
    );
    const apexB = { x: pairCentreB.x, y: pairCentreB.y, z: apexBz };

    // --- 4. Hook position — determined by top sling length ---
    // Top sling goes from apex toward hook (above COG).
    // Top sling length pushes the hook up or down.
    let topLen = config.topSlingLength || 0;

    // Direction from each apex toward hook XY
    const dirAx = hookXY.x - apexA.x;
    const dirAy = hookXY.y - apexA.y;
    const hDistApexA = Math.sqrt(dirAx * dirAx + dirAy * dirAy);

    const dirBx = hookXY.x - apexB.x;
    const dirBy = hookXY.y - apexB.y;
    const hDistApexB = Math.sqrt(dirBx * dirBx + dirBy * dirBy);

    // Default top sling length: use min angle from apex to hook
    if (topLen <= 0) {
      const defaultRiseA = hDistApexA * Math.tan(minAngleRad);
      const defaultRiseB = hDistApexB * Math.tan(minAngleRad);
      const defaultHookZ = Math.max(apexA.z + defaultRiseA, apexB.z + defaultRiseB);
      topLen = Math.max(
        CalcCore.dist3D(apexA, { ...hookXY, z: defaultHookZ }),
        CalcCore.dist3D(apexB, { ...hookXY, z: defaultHookZ })
      );
    }

    // Hook Z: from the top sling length and horizontal distance
    // topLen² = hDist² + (hookZ - apexZ)² → hookZ = apexZ + sqrt(topLen² - hDist²)
    let hookZa = hDistApexA < topLen
      ? apexA.z + Math.sqrt(topLen * topLen - hDistApexA * hDistApexA)
      : apexA.z + hDistApexA * Math.tan(minAngleRad);
    let hookZb = hDistApexB < topLen
      ? apexB.z + Math.sqrt(topLen * topLen - hDistApexB * hDistApexB)
      : apexB.z + hDistApexB * Math.tan(minAngleRad);

    const hookZ = Math.max(hookZa, hookZb);
    const hook = { x: hookXY.x, y: hookXY.y, z: hookZ };

    // --- 5. COG polygon validation ---
    const cogInsidePolygon = CalcCore.pointInPolygon2D(
      cog, liftingPoints.map(lp => ({ x: lp.x, y: lp.y }))
    );

    // --- 6. Build top slings ---
    const topSlingA = CalcCore.buildSling(1,
      { x: apexA.x, y: apexA.y, z: apexA.z, label: 'Apex A' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    const topSlingB = CalcCore.buildSling(2,
      { x: apexB.x, y: apexB.y, z: apexB.z, label: 'Apex B' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );

    // --- 7. Top sling tensions ---
    const topTensions = CalcCore.calcTwoSlingTension(apexA, apexB, hook, totalLoad);
    topSlingA.tension = CalcCore.round4(topTensions[0]);
    topSlingB.tension = CalcCore.round4(topTensions[1]);
    topSlingA.verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(topTensions[0], apexA, hook));
    topSlingB.verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(topTensions[1], apexB, hook));
    const topSlings = [topSlingA, topSlingB];

    // --- 8. Bottom sling tensions ---
    const vLoadA = CalcCore.computeVerticalLoad(topTensions[0], apexA, hook);
    const vLoadB = CalcCore.computeVerticalLoad(topTensions[1], apexB, hook);

    const bottomTensionsA = CalcCore.calcTwoSlingTension(groupALPs[0], groupALPs[1], apexA, vLoadA);
    const bottomTensionsB = CalcCore.calcTwoSlingTension(groupBLPs[0], groupBLPs[1], apexB, vLoadB);

    // --- 9. Build bottom slings ---
    const bottomSlings = [];
    let slingId = 1;

    for (let i = 0; i < 2; i++) {
      const lpIdx = groupAIndices[i];
      const lp = groupALPs[i];
      const sling = CalcCore.buildSling(slingId++,
        { x: lp.x, y: lp.y, z: lp.z, label: 'LP' + (lpIdx + 1) },

        { x: apexA.x, y: apexA.y, z: apexA.z, label: 'Apex A' }
      );
      sling.tension = CalcCore.round4(bottomTensionsA[i]);
      sling.verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(bottomTensionsA[i], sling.from, sling.to));
      bottomSlings.push(sling);
    }

    for (let i = 0; i < 2; i++) {
      const lpIdx = groupBIndices[i];
      const lp = groupBLPs[i];
      const sling = CalcCore.buildSling(slingId++,
        { x: lp.x, y: lp.y, z: lp.z, label: 'LP' + (lpIdx + 1) },

        { x: apexB.x, y: apexB.y, z: apexB.z, label: 'Apex B' }
      );
      sling.tension = CalcCore.round4(bottomTensionsB[i]);
      sling.verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(bottomTensionsB[i], sling.from, sling.to));
      bottomSlings.push(sling);
    }

    // --- 10. Check bottom sling angles vs min angle ---
    const bottomAngleLow = bottomSlings.some(s => s.angleDegFromHoriz < minAngleDeg - 0.1);
    const topSlingAngleLow = topSlings.some(s => s.angleDegFromHoriz < 30);

    // --- 11. Critical sling ---
    const allSlings = [...bottomSlings, ...topSlings];
    let hasNegativeTension = false;
    let criticalTier = 'bottom';
    let criticalIdx = 0;
    let maxTension = -Infinity;

    bottomSlings.forEach((s, i) => {
      if (s.tension < -0.001) hasNegativeTension = true;
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'bottom'; criticalIdx = i; }
    });
    topSlings.forEach((s, i) => {
      if (s.tension < -0.001) hasNegativeTension = true;
      if (s.tension > maxTension) { maxTension = s.tension; criticalTier = 'top'; criticalIdx = i; }
    });

    const criticalArr = criticalTier === 'bottom' ? bottomSlings : topSlings;
    criticalArr[criticalIdx].isCritical = true;

    const maxLPz = Math.max(...liftingPoints.map(lp => lp.z));

    return {
      configType: 'stinger',
      hook,
      hookHeight: CalcCore.round4(hookZ),
      headroom: CalcCore.round4(hookZ - maxLPz),
      heightAboveCOG: CalcCore.round4(hookZ - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: criticalTier, id: criticalIdx + 1 },
      tiers: [
        { name: 'Bottom Slings', slings: bottomSlings },
        { name: 'Top Slings', slings: topSlings }
      ],
      beams: [],
      intermediatePoints: [
        { x: CalcCore.round4(apexA.x), y: CalcCore.round4(apexA.y), z: CalcCore.round4(apexA.z), label: 'Apex A' },
        { x: CalcCore.round4(apexB.x), y: CalcCore.round4(apexB.y), z: CalcCore.round4(apexB.z), label: 'Apex B' }
      ],
      warnings: {
        cogOutsidePolygon: !cogInsidePolygon,
        negativeTension: hasNegativeTension,
        topSlingAngleLow,
        bottomAngleLow,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
