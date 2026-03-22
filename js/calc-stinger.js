/**
 * Stinger / Equalising Triangle Calculation
 *
 * Unlike a spreader beam, the stinger splits a direct sling into two segments.
 * Hook height is computed from 4-leg direct geometry (min angle from all LPs).
 * User defines top sling length (default = halfway between LP-pair centre and hook).
 * Apex Z is derived from the top sling length, not from a beam-end-Z formula.
 *
 * Bottom tier: 4 slings from 4 LPs to 2 apex points.
 * Top tier: 2 slings from apex points to hook.
 * No rigid beam.
 */

const CalcStinger = (() => {

  /**
   * @param {object} shared - { liftingPoints, cog, minAngleDeg, totalLoad }
   * @param {object} config - { topSlingLength, pairing: { groupA: [idx,idx], groupB: [idx,idx] } }
   *                          LP indices are 1-based. topSlingLength 0 = auto (halfway).
   */
  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const minAngleRad = CalcCore.degToRad(minAngleDeg);

    // --- 1. Extract LP groups (convert 1-based to 0-based) ---
    const groupAIndices = config.pairing.groupA.map(i => i - 1);
    const groupBIndices = config.pairing.groupB.map(i => i - 1);
    const groupALPs = groupAIndices.map(i => liftingPoints[i]);
    const groupBLPs = groupBIndices.map(i => liftingPoints[i]);

    // --- 2. Compute hook from 4-leg direct geometry (min angle from all 4 LPs) ---
    const hookXY = { x: cog.x, y: cog.y };
    const hDists = liftingPoints.map(lp => CalcCore.horizontalDist(lp, hookXY));
    const requiredHookZs = liftingPoints.map((lp, i) => lp.z + hDists[i] * Math.tan(minAngleRad));
    const hookZ = Math.max(...requiredHookZs);
    const hook = { x: hookXY.x, y: hookXY.y, z: hookZ };

    // --- 3. Apex XY = midpoint of each group's LPs ---
    const midA = CalcCore.midpoint(groupALPs[0], groupALPs[1]);
    const midB = CalcCore.midpoint(groupBLPs[0], groupBLPs[1]);

    // --- 4. Compute apex Z from top sling length ---
    // LP-pair centre (with average Z of the pair)
    const pairCentreA = { x: midA.x, y: midA.y, z: (groupALPs[0].z + groupALPs[1].z) / 2 };
    const pairCentreB = { x: midB.x, y: midB.y, z: (groupBLPs[0].z + groupBLPs[1].z) / 2 };

    // Full path distance from LP-pair centre to hook
    const fullDistA = CalcCore.dist3D(pairCentreA, hook);
    const fullDistB = CalcCore.dist3D(pairCentreB, hook);

    // Top sling length: user-defined or default (half of full path)
    let topLenA = config.topSlingLength || 0;
    let topLenB = config.topSlingLength || 0;
    if (topLenA <= 0) topLenA = (fullDistA + fullDistB) / 4; // half of average full path
    if (topLenB <= 0) topLenB = topLenA; // same for both

    // Horizontal distance from each apex to hook
    const hDistApexA = CalcCore.horizontalDist(midA, hook);
    const hDistApexB = CalcCore.horizontalDist(midB, hook);

    // Apex Z: hook.z - sqrt(topLen² - hDist²)
    let apexAZ, apexBZ;
    if (topLenA > hDistApexA) {
      apexAZ = hookZ - Math.sqrt(topLenA * topLenA - hDistApexA * hDistApexA);
    } else {
      // Top sling too short — place apex at hook Z (degenerate)
      apexAZ = hookZ;
    }
    if (topLenB > hDistApexB) {
      apexBZ = hookZ - Math.sqrt(topLenB * topLenB - hDistApexB * hDistApexB);
    } else {
      apexBZ = hookZ;
    }

    const apexA = { x: midA.x, y: midA.y, z: apexAZ };
    const apexB = { x: midB.x, y: midB.y, z: apexBZ };

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

    // --- 8. Bottom sling tensions per group ---
    const vLoadA = CalcCore.computeVerticalLoad(topTensions[0], apexA, hook);
    const vLoadB = CalcCore.computeVerticalLoad(topTensions[1], apexB, hook);

    const bottomTensionsA = CalcCore.calcTwoSlingTension(
      groupALPs[0], groupALPs[1], apexA, vLoadA
    );
    const bottomTensionsB = CalcCore.calcTwoSlingTension(
      groupBLPs[0], groupBLPs[1], apexB, vLoadB
    );

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

    // --- 10. Check bottom sling angles against min angle ---
    const bottomAngleLow = bottomSlings.some(s => s.angleDegFromHoriz < minAngleDeg - 0.1);
    const topSlingAngleLow = topSlings.some(s => s.angleDegFromHoriz < 30);

    // --- 11. Find critical sling ---
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
