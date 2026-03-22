/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Three-tier cascading where slave beam ends sit on the direct sling paths
 * (same approach as double-parallel). The master beam connects the slave
 * beam groups. Slave beams are spreader beams (compression, no bending).
 *
 *   Bottom:  4 slings from 4 LPs to slave beam ends (on sling paths)
 *   Middle:  4 slings from slave beam ends to master beam ends
 *   Top:     2 slings from master beam ends to hook
 *
 * Exposes: window.CalcDoubleCas = { calculate }
 */

window.CalcDoubleCas = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const {
      masterLength, slaveLengthA, slaveLengthB,
      masterOrientation, bottomSlingLen
    } = config;
    const minSlingLen = bottomSlingLen || 2;
    const minAngleRad = C.degToRad(minAngleDeg);

    // ── 1. Auto-pair LPs by proximity ──
    const pairingsOpt = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
    let bestPairing = pairingsOpt[0];
    let bestDist = Infinity;
    for (const p of pairingsOpt) {
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

    // ── 3. Place slave beam ends on direct sling paths ──
    function computeBeamEndPair(lp0, lp1, beamLength) {
      const spreadAtZero = C.horizontalDist(lp0, lp1);

      if (spreadAtZero < 0.0001 || beamLength >= spreadAtZero) {
        // Beam >= LP spread: beam handles the short direction entirely.
        // Bottom slings stay angled in the long direction (X-Z plane).
        function placeOnXZpath(lp) {
          const dx = hook.x - lp.x;
          const dz = hook.z - lp.z;
          const xzDist = Math.sqrt(dx * dx + dz * dz);
          if (xzDist < 0.0001) return { x: lp.x, y: lp.y, z: lp.z + minSlingLen };
          const frac = Math.min(minSlingLen / xzDist, 0.95);
          return {
            x: lp.x + frac * dx,
            y: lp.y,
            z: lp.z + frac * dz
          };
        }
        return { end0: placeOnXZpath(lp0), end1: placeOnXZpath(lp1), t: 0 };
      }

      // Beam shorter than LP spread: place ends on direct sling paths
      let t = 1 - beamLength / spreadAtZero;

      const fullLen0 = C.dist3D(lp0, hook);
      const fullLen1 = C.dist3D(lp1, hook);
      const minT = Math.max(
        fullLen0 > 0 ? minSlingLen / fullLen0 : 0,
        fullLen1 > 0 ? minSlingLen / fullLen1 : 0
      );
      t = Math.max(t, minT);
      t = Math.min(t, 0.95);

      return {
        end0: {
          x: lp0.x + t * (hook.x - lp0.x),
          y: lp0.y + t * (hook.y - lp0.y),
          z: lp0.z + t * (hook.z - lp0.z)
        },
        end1: {
          x: lp1.x + t * (hook.x - lp1.x),
          y: lp1.y + t * (hook.y - lp1.y),
          z: lp1.z + t * (hook.z - lp1.z)
        },
        t
      };
    }

    const pairA = computeBeamEndPair(groupALPs[0], groupALPs[1], slaveLengthA);
    const pairB = computeBeamEndPair(groupBLPs[0], groupBLPs[1], slaveLengthB);

    const slaveA1 = pairA.end0;
    const slaveA2 = pairA.end1;
    const slaveB1 = pairB.end0;
    const slaveB2 = pairB.end1;

    // ── 4. Master beam — on sling paths, above slave beams ──
    // Treat slave midpoints as the "LPs" for the master tier.
    // Use the same computeBeamEndPair logic so master ends sit on the
    // sling paths from slave midpoints toward the hook, converging inward.
    const slaveMidA = C.midpoint(slaveA1, slaveA2);
    const slaveMidB = C.midpoint(slaveB1, slaveB2);

    // Master beam "spread" is the distance between slave midpoints
    const masterSpread = C.horizontalDist(slaveMidA, slaveMidB);
    let masterEndA, masterEndB;

    if (masterSpread < 0.0001 || masterLength >= masterSpread) {
      // Master beam >= slave spread: master ends on X-Z path from slave mids
      function placeMasterOnXZ(pt) {
        const dx = hook.x - pt.x;
        const dz = hook.z - pt.z;
        const xzDist = Math.sqrt(dx * dx + dz * dz);
        if (xzDist < 0.0001) return { x: pt.x, y: pt.y, z: pt.z + 2 };
        const frac = Math.min(2 / xzDist, 0.5); // 2m min middle sling
        return { x: pt.x + frac * dx, y: pt.y, z: pt.z + frac * dz };
      }
      masterEndA = placeMasterOnXZ(slaveMidA);
      masterEndB = placeMasterOnXZ(slaveMidB);
    } else {
      // Master beam shorter than slave spread: place on 3D sling paths
      const tMaster = 1 - masterLength / masterSpread;
      const fullLenA = C.dist3D(slaveMidA, hook);
      const fullLenB = C.dist3D(slaveMidB, hook);
      const minTM = Math.max(
        fullLenA > 0 ? 2 / fullLenA : 0, // 2m min middle sling
        fullLenB > 0 ? 2 / fullLenB : 0
      );
      const tM = Math.min(Math.max(tMaster, minTM), 0.7);
      masterEndA = {
        x: slaveMidA.x + tM * (hook.x - slaveMidA.x),
        y: slaveMidA.y + tM * (hook.y - slaveMidA.y),
        z: slaveMidA.z + tM * (hook.z - slaveMidA.z)
      };
      masterEndB = {
        x: slaveMidB.x + tM * (hook.x - slaveMidB.x),
        y: slaveMidB.y + tM * (hook.y - slaveMidB.y),
        z: slaveMidB.z + tM * (hook.z - slaveMidB.z)
      };
    }

    const masterEnds = { endA: masterEndA, endB: masterEndB };

    // ── 5. Hook position — use 4-leg direct hook (already computed) ──
    const topHook = { x: hook.x, y: hook.y, z: hook.z };

    // ── 6. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 7. Bottom slings (4): LP → slave beam end ──
    const bottomSlings = [];
    let slingId = 1;
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[0].x, y: groupALPs[0].y, z: groupALPs[0].z, label: groupALabels[0] },
      { x: slaveA1.x, y: slaveA1.y, z: slaveA1.z, label: 'Slave A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupALPs[1].x, y: groupALPs[1].y, z: groupALPs[1].z, label: groupALabels[1] },
      { x: slaveA2.x, y: slaveA2.y, z: slaveA2.z, label: 'Slave A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[0].x, y: groupBLPs[0].y, z: groupBLPs[0].z, label: groupBLabels[0] },
      { x: slaveB1.x, y: slaveB1.y, z: slaveB1.z, label: 'Slave B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { x: groupBLPs[1].x, y: groupBLPs[1].y, z: groupBLPs[1].z, label: groupBLabels[1] },
      { x: slaveB2.x, y: slaveB2.y, z: slaveB2.z, label: 'Slave B End 2' }
    ));

    // ── 8. Middle slings (4): slave ends → master ends ──
    const middleSlings = [];
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveA1.x, y: slaveA1.y, z: slaveA1.z, label: 'Slave A End 1' },
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveA2.x, y: slaveA2.y, z: slaveA2.z, label: 'Slave A End 2' },
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveB1.x, y: slaveB1.y, z: slaveB1.z, label: 'Slave B End 1' },
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { x: slaveB2.x, y: slaveB2.y, z: slaveB2.z, label: 'Slave B End 2' },
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' }
    ));

    // ── 9. Top slings (2): master ends → hook ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { x: masterEnds.endA.x, y: masterEnds.endA.y, z: masterEnds.endA.z, label: 'Master End A' },
      { x: topHook.x, y: topHook.y, z: topHook.z, label: 'Hook' }
    );
    topSlings.push(topSlingA);
    const topSlingB = C.buildSling(slingId++,
      { x: masterEnds.endB.x, y: masterEnds.endB.y, z: masterEnds.endB.z, label: 'Master End B' },
      { x: topHook.x, y: topHook.y, z: topHook.z, label: 'Hook' }
    );
    topSlings.push(topSlingB);

    // ── 10. Tensions — cascade downward ──
    const [topTensionA, topTensionB] = C.calcTwoSlingTension(masterEnds.endA, masterEnds.endB, topHook, totalLoad);
    topSlingA.tension = C.round4(topTensionA);
    topSlingB.tension = C.round4(topTensionB);

    const vLoadMasterA = C.computeVerticalLoad(topTensionA, masterEnds.endA, topHook);
    const vLoadMasterB = C.computeVerticalLoad(topTensionB, masterEnds.endB, topHook);

    const midTensionsA = C.calcTwoSlingTension(slaveA1, slaveA2, masterEnds.endA, vLoadMasterA);
    middleSlings[0].tension = C.round4(midTensionsA[0]);
    middleSlings[1].tension = C.round4(midTensionsA[1]);

    const midTensionsB = C.calcTwoSlingTension(slaveB1, slaveB2, masterEnds.endB, vLoadMasterB);
    middleSlings[2].tension = C.round4(midTensionsB[0]);
    middleSlings[3].tension = C.round4(midTensionsB[1]);

    const vLoadSlaveA1 = C.computeVerticalLoad(midTensionsA[0], slaveA1, masterEnds.endA);
    const vLoadSlaveA2 = C.computeVerticalLoad(midTensionsA[1], slaveA2, masterEnds.endA);
    const vLoadSlaveB1 = C.computeVerticalLoad(midTensionsB[0], slaveB1, masterEnds.endB);
    const vLoadSlaveB2 = C.computeVerticalLoad(midTensionsB[1], slaveB2, masterEnds.endB);

    const slaveEndVLoads = [vLoadSlaveA1, vLoadSlaveA2, vLoadSlaveB1, vLoadSlaveB2];
    for (let i = 0; i < 4; i++) {
      const s = bottomSlings[i];
      const len = C.dist3D(s.from, s.to);
      const vd = Math.abs(s.to.z - s.from.z);
      s.tension = C.round4((vd > 1e-9) ? slaveEndVLoads[i] * len / vd : slaveEndVLoads[i]);
    }

    // ── 11. Vertical loads ──
    const allSlings = [...bottomSlings, ...middleSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 12. Warnings ──
    const topSlingAngleLow =
      topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG) ||
      middleSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);

    // ── 13. Critical sling ──
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

    // ── 14. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));
    const actualSlaveLenA = C.round4(C.dist3D(slaveA1, slaveA2));
    const actualSlaveLenB = C.round4(C.dist3D(slaveB1, slaveB2));

    return {
      configType: 'double-cascade',
      hook: { x: C.round4(topHook.x), y: C.round4(topHook.y), z: C.round4(topHook.z) },
      hookHeight: C.round4(topHook.z),
      headroom: C.round4(topHook.z - maxLPz),
      heightAboveCOG: C.round4(topHook.z - cog.z),
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
          length: masterLength, pickupPoint: null
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
        { x: C.round4(slaveA1.x), y: C.round4(slaveA1.y), z: C.round4(slaveA1.z), label: 'Slave A End 1' },
        { x: C.round4(slaveA2.x), y: C.round4(slaveA2.y), z: C.round4(slaveA2.z), label: 'Slave A End 2' },
        { x: C.round4(slaveB1.x), y: C.round4(slaveB1.y), z: C.round4(slaveB1.z), label: 'Slave B End 1' },
        { x: C.round4(slaveB2.x), y: C.round4(slaveB2.y), z: C.round4(slaveB2.z), label: 'Slave B End 2' },
        { x: C.round4(masterEnds.endA.x), y: C.round4(masterEnds.endA.y), z: C.round4(masterEnds.endA.z), label: 'Master End A' },
        { x: C.round4(masterEnds.endB.x), y: C.round4(masterEnds.endB.y), z: C.round4(masterEnds.endB.z), label: 'Master End B' }
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
