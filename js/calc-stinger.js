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

    // --- 1. Extract LP groups (1-based to 0-based) ---
    const groupAIndices = config.pairing.groupA.map(i => i - 1);
    const groupBIndices = config.pairing.groupB.map(i => i - 1);
    const groupALPs = groupAIndices.map(i => liftingPoints[i]);
    const groupBLPs = groupBIndices.map(i => liftingPoints[i]);

    // --- 2. Compute hook from 4-leg direct geometry ---
    const hookXY = { x: cog.x, y: cog.y };
    const hDists = liftingPoints.map(lp => CalcCore.horizontalDist(lp, hookXY));
    const requiredHookZs = liftingPoints.map((lp, i) => lp.z + hDists[i] * Math.tan(minAngleRad));
    const hookZ = Math.max(...requiredHookZs);
    const hook = { x: hookXY.x, y: hookXY.y, z: hookZ };

    // --- 3. Pair centres ---
    const pairCentreA = CalcCore.midpoint(groupALPs[0], groupALPs[1]);
    const pairCentreB = CalcCore.midpoint(groupBLPs[0], groupBLPs[1]);

    // --- 4. Compute apex on the line from pair centre to hook ---
    // Full distance from pair centre to hook
    const fullDistA = CalcCore.dist3D(pairCentreA, hook);
    const fullDistB = CalcCore.dist3D(pairCentreB, hook);

    // Top sling length determines where on the path the split occurs
    let topLen = config.topSlingLength || 0;

    // Default: halfway (t = 0.5)
    let tA, tB;
    if (topLen <= 0) {
      tA = 0.5;
      tB = 0.5;
    } else {
      // t = 1 - topSlingLength / fullDist
      tA = Math.max(0.05, Math.min(0.95, 1 - topLen / fullDistA));
      tB = Math.max(0.05, Math.min(0.95, 1 - topLen / fullDistB));
    }

    // Apex = pairCentre + t * (hook - pairCentre)
    const apexA = {
      x: pairCentreA.x + tA * (hook.x - pairCentreA.x),
      y: pairCentreA.y + tA * (hook.y - pairCentreA.y),
      z: pairCentreA.z + tA * (hook.z - pairCentreA.z)
    };
    const apexB = {
      x: pairCentreB.x + tB * (hook.x - pairCentreB.x),
      y: pairCentreB.y + tB * (hook.y - pairCentreB.y),
      z: pairCentreB.z + tB * (hook.z - pairCentreB.z)
    };

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
