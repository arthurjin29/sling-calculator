/**
 * Sling Length Calculator — Double Spreader (Parallel) Configuration
 *
 * Two independent spreader beams, each sitting on the direct sling paths.
 * The beams handle the short direction — converting converging slings into
 * parallel slings. Bottom sling angles match the 4-leg direct config.
 *
 * Bottom tier: 4 slings from 4 LPs to beam ends (on direct sling paths)
 * Top tier:    4 slings from 4 beam ends to hook
 *
 * Exposes: window.CalcDoublePar = { calculate }
 */

window.CalcDoublePar = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { beamLengthA, beamLengthB, orientationA, orientationB, bottomSlingLen } = config;
    const minSlingLen = bottomSlingLen || 2;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Auto-pair LPs by proximity ──
    const pairings = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
    let bestPairing = pairings[0];
    let bestDist = Infinity;
    for (const p of pairings) {
      const d = C.horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
              + C.horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
      if (d < bestDist) { bestDist = d; bestPairing = p; }
    }
    const groupAIdxs = bestPairing[0];
    const groupBIdxs = bestPairing[1];
    const groupALPs = groupAIdxs.map(i => liftingPoints[i]);
    const groupBLPs = groupBIdxs.map(i => liftingPoints[i]);
    const groupALabels = groupAIdxs.map(i => 'LP' + (i + 1));
    const groupBLabels = groupBIdxs.map(i => 'LP' + (i + 1));

    // ── 2. Compute hook from 4-leg direct geometry ──
    const hookXY = { x: cog.x, y: cog.y };
    const hDists = liftingPoints.map(lp => C.horizontalDist(lp, hookXY));
    const requiredHookZs = liftingPoints.map((lp, i) => lp.z + hDists[i] * Math.tan(minAngleRad));
    const hook = { x: cog.x, y: cog.y, z: Math.max(...requiredHookZs) };

    // ── 3. Place beam ends on direct sling paths ──
    // For each LP pair, find parameter t along the direct sling paths
    // where the distance between the two path points = beam length.
    // Path: P(t) = LP + t * (hook - LP), distance between pair at t decreases with t.
    function computeBeamEndPair(lp0, lp1, beamLength) {
      // At parameter t:
      // P0(t) = lp0 + t*(hook - lp0)
      // P1(t) = lp1 + t*(hook - lp1)
      // dist(P0, P1) = |lp1 - lp0| * (1-t) in XY (both converge to same hook)
      // But in 3D, z components are the same so only XY matters for horizontal spread
      const spreadAtZero = C.horizontalDist(lp0, lp1);

      let t;
      if (spreadAtZero < 0.0001) {
        t = 0.5; // degenerate — LPs at same position
      } else if (beamLength >= spreadAtZero) {
        // Beam longer than LP spread — place near LPs with min sling length
        t = 0;
      } else {
        t = 1 - beamLength / spreadAtZero;
      }

      // Enforce minimum bottom sling length
      const fullLen0 = C.dist3D(lp0, hook);
      const fullLen1 = C.dist3D(lp1, hook);
      const minT = Math.max(
        fullLen0 > 0 ? minSlingLen / fullLen0 : 0,
        fullLen1 > 0 ? minSlingLen / fullLen1 : 0
      );
      t = Math.max(t, minT);
      t = Math.min(t, 0.95); // don't go all the way to hook

      const end0 = {
        x: lp0.x + t * (hook.x - lp0.x),
        y: lp0.y + t * (hook.y - lp0.y),
        z: lp0.z + t * (hook.z - lp0.z)
      };
      const end1 = {
        x: lp1.x + t * (hook.x - lp1.x),
        y: lp1.y + t * (hook.y - lp1.y),
        z: lp1.z + t * (hook.z - lp1.z)
      };
      return { end0, end1, t };
    }

    const pairA = computeBeamEndPair(groupALPs[0], groupALPs[1], beamLengthA);
    const pairB = computeBeamEndPair(groupBLPs[0], groupBLPs[1], beamLengthB);

    const beamA1 = pairA.end0;
    const beamA2 = pairA.end1;
    const beamB1 = pairB.end0;
    const beamB2 = pairB.end1;

    // ── 4. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 5. Bottom slings (4 total: LP → beam end on sling path) ──
    const bottomSlings = [];
    let slingId = 1;

    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[0].x, y: groupALPs[0].y, z: groupALPs[0].z, label: groupALabels[0] },
      { x: beamA1.x, y: beamA1.y, z: beamA1.z, label: 'Beam A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[1].x, y: groupALPs[1].y, z: groupALPs[1].z, label: groupALabels[1] },
      { x: beamA2.x, y: beamA2.y, z: beamA2.z, label: 'Beam A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[0].x, y: groupBLPs[0].y, z: groupBLPs[0].z, label: groupBLabels[0] },
      { x: beamB1.x, y: beamB1.y, z: beamB1.z, label: 'Beam B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[1].x, y: groupBLPs[1].y, z: groupBLPs[1].z, label: groupBLabels[1] },
      { x: beamB2.x, y: beamB2.y, z: beamB2.z, label: 'Beam B End 2' }
    ));

    // ── 6. Top slings (4 total: beam ends → hook) ──
    const allBeamEnds = [beamA1, beamA2, beamB1, beamB2];
    const beamEndLabels = ['Beam A End 1', 'Beam A End 2', 'Beam B End 1', 'Beam B End 2'];
    const topSlings = [];

    for (let i = 0; i < 4; i++) {
      const be = allBeamEnds[i];
      topSlings.push(C.buildSling(slingId++,
        { x: be.x, y: be.y, z: be.z, label: beamEndLabels[i] },
        { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
      ));
    }

    // ── 7. Tensions ──

    // Top tier: 4-sling load distribution
    const topTensions = C.calcLoadDistribution(allBeamEnds, hook, totalLoad);
    for (let i = 0; i < 4; i++) topSlings[i].tension = C.round4(topTensions[i]);

    // Bottom tier: each bottom sling carries the vertical load of its beam end
    const beamEndVLoads = [];
    for (let i = 0; i < 4; i++) {
      beamEndVLoads.push(C.computeVerticalLoad(topTensions[i], allBeamEnds[i], hook));
    }
    for (let i = 0; i < 4; i++) {
      const s = bottomSlings[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      if (len < 0.0001 || vd < 0.0001) {
        s.tension = C.round4(beamEndVLoads[i]);
      } else {
        s.tension = C.round4(beamEndVLoads[i] * len / vd);
      }
    }

    // ── 8. Vertical loads ──
    const allSlings = [...bottomSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 9. Warnings ──
    const topSlingAngleLow = topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 10. Critical sling ──
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

    // ── 11. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    // Compute actual beam lengths for display
    const actualBeamLenA = C.dist3D(beamA1, beamA2);
    const actualBeamLenB = C.dist3D(beamB1, beamB2);

    return {
      configType: 'double-parallel',
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
      beams: [
        {
          name: 'Beam A',
          endA: { x: C.round4(beamA1.x), y: C.round4(beamA1.y), z: C.round4(beamA1.z) },
          endB: { x: C.round4(beamA2.x), y: C.round4(beamA2.y), z: C.round4(beamA2.z) },
          length: C.round4(actualBeamLenA),
          pickupPoint: null
        },
        {
          name: 'Beam B',
          endA: { x: C.round4(beamB1.x), y: C.round4(beamB1.y), z: C.round4(beamB1.z) },
          endB: { x: C.round4(beamB2.x), y: C.round4(beamB2.y), z: C.round4(beamB2.z) },
          length: C.round4(actualBeamLenB),
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
