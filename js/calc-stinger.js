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

    // --- 3. Compute reference hook (4-leg direct geometry) ---
    const hookXY = { x: cog.x, y: cog.y };
    const hDists = liftingPoints.map(lp => CalcCore.horizontalDist(lp, hookXY));
    const requiredHookZs = liftingPoints.map((lp, i) => lp.z + hDists[i] * Math.tan(minAngleRad));
    const refHookZ = Math.max(...requiredHookZs);
    const refHook = { x: hookXY.x, y: hookXY.y, z: refHookZ };

    // --- 4. Place apex on the line from pair centre toward hook ---
    // The line goes from pair centre through hook XY (COG).
    // Apex sits where bottom sling angles from LPs meet min angle.
    // Top sling then continues along the SAME line — no kink at apex.
    function findApexOnLine(lp0, lp1, pairCentre, target) {
      let lo = 0.01, hi = 0.95;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const apex = {
          x: pairCentre.x + mid * (target.x - pairCentre.x),
          y: pairCentre.y + mid * (target.y - pairCentre.y),
          z: pairCentre.z + mid * (target.z - pairCentre.z)
        };
        const hd0 = CalcCore.horizontalDist(lp0, apex);
        const vd0 = apex.z - lp0.z;
        const hd1 = CalcCore.horizontalDist(lp1, apex);
        const vd1 = apex.z - lp1.z;
        const angle0 = hd0 > 0.001 ? Math.atan2(vd0, hd0) : Math.PI / 2;
        const angle1 = hd1 > 0.001 ? Math.atan2(vd1, hd1) : Math.PI / 2;
        if (Math.min(angle0, angle1) < minAngleRad) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return hi;
    }

    const tA = findApexOnLine(groupALPs[0], groupALPs[1], pairCentreA, refHook);
    const tB = findApexOnLine(groupBLPs[0], groupBLPs[1], pairCentreB, refHook);

    const apexA = {
      x: pairCentreA.x + tA * (refHook.x - pairCentreA.x),
      y: pairCentreA.y + tA * (refHook.y - pairCentreA.y),
      z: pairCentreA.z + tA * (refHook.z - pairCentreA.z)
    };
    const apexB = {
      x: pairCentreB.x + tB * (refHook.x - pairCentreB.x),
      y: pairCentreB.y + tB * (refHook.y - pairCentreB.y),
      z: pairCentreB.z + tB * (refHook.z - pairCentreB.z)
    };

    // --- 5. Hook — top sling extends from apex along the SAME line ---
    // Direction: pair centre → hook (unit vector in 3D)
    // Top sling length pushes the hook further along this direction.
    let topLen = config.topSlingLength || 0;

    function computeHookZFromApex(apex, pairCentre) {
      const dx = refHook.x - pairCentre.x;
      const dy = refHook.y - pairCentre.y;
      const dz = refHook.z - pairCentre.z;
      const lineLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (lineLen < 0.001) return apex.z + (topLen > 0 ? topLen : 5);

      const ux = dx / lineLen;
      const uy = dy / lineLen;
      const uz = dz / lineLen;

      const len = topLen > 0 ? topLen : CalcCore.dist3D(apex, refHook);
      // Hook = apex + len * unit direction
      return apex.z + len * uz;
    }

    const hookZ = Math.max(computeHookZFromApex(apexA, pairCentreA), computeHookZFromApex(apexB, pairCentreB));
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
