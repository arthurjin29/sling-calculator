/**
 * Sling Length Calculator — Double Spreader (Cascading) Configuration
 *
 * Every beam is a FIXED physical bar and every connection sits at a beam END —
 * a spreader cannot put its pick at its middle. The Main Beam's two ends ARE its
 * sling pick points (span = masterLength), and the whole bar translates/yaws to
 * hang in equilibrium under the hook (over the total COG), so the rig hangs plumb
 * with no lean and the slings splay to whatever angle balances it. Each 2nd-level
 * (slave) beam is likewise a fixed-length bar (the entered slaveLength): it hangs
 * from its Main-Beam pick and carries its two LPs, held from ABOVE (middle slings)
 * and BELOW (bottom slings) so it can sit level even under an off-centre pick. The
 * sub-COGs (reaction-weighted, load-aware) are only the SEED for placing the Main
 * bar — the picks then settle at the bar ends via the coupled free-hang solve.
 *
 *   Top:     2 slings (hook → Main-Beam pick points)
 *   Middle:  4 slings (slave beam ends → Main-Beam pick points)
 *   Bottom:  4 slings (LPs → slave beam ends)
 *   Total:   10 slings, 3 beams
 *
 * Exposes: window.CalcDoubleCas = { calculate }
 */

window.CalcDoubleCas = (() => {

  const C = CalcCore;
  const TOP_ANGLE_WARN_DEG = 30;

  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const { masterLength, slaveLengthA, slaveLengthB, bottomSlingLen } = config;
    const minAngleRad = C.degToRad(minAngleDeg);
    // Optional per-lay target angles (governing minimum). Blank -> global min-angle.
    const middleAngleRad = config.middleAngleDeg != null ? Math.max(minAngleRad, C.degToRad(config.middleAngleDeg)) : minAngleRad;
    const topAngleRad = config.topAngleDeg != null ? Math.max(minAngleRad, C.degToRad(config.topAngleDeg)) : minAngleRad;
    const minSlingLen = bottomSlingLen ?? 2;

    // ── 1. LP pairing ──
    let groupAIdxs, groupBIdxs;
    if (config.pairing) {
      groupAIdxs = config.pairing.groupA.map(v => v - 1);
      groupBIdxs = config.pairing.groupB.map(v => v - 1);
    } else {
      [groupAIdxs, groupBIdxs] = C.autoPairLPs(liftingPoints);
    }
    const groupALPs = groupAIdxs.map(i => liftingPoints[i]);
    const groupBLPs = groupBIdxs.map(i => liftingPoints[i]);
    const groupALabels = groupAIdxs.map(i => 'LP' + (i + 1));
    const groupBLabels = groupBIdxs.map(i => 'LP' + (i + 1));

    // ── 2. Pick points — each beam picked over the COG of the load it carries ──
    // Per-LP vertical share from a min-norm rigid-body reaction solve. The
    // reaction-weighted centroid of the LPs equals the COG, so each side's
    // sub-COG and the total COG nest consistently: the hook (over the COG,
    // below) lands collinear with the two Main-Beam pick points, so the two
    // top slings straddle it and their horizontal thrusts cancel — no lean,
    // for a COG offset in any in-plan direction.
    const hookXY = { x: cog.x, y: cog.y };

    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    let subCogFallback = false;
    const subCogOf = (idxs) => {
      // A negative min-norm reaction means that LP would have to pull DOWN (the
      // COG is outside the support "kern"); slings can't push. Clamp negatives
      // to zero and renormalise so the sub-COG stays LOAD-AWARE (biased to the
      // loaded side) and on the beam line, instead of discarding the load info.
      // Flag the state as unreliable either way.
      // Flag only meaningfully-negative reactions; a float-noise value at the
      // exact kern boundary clamps to ~0 with no geometric effect, so it should
      // not raise the UNRELIABLE warning.
      let anyNeg = false;
      for (const i of idxs) { if (reactions[i] < -1e-9) anyNeg = true; }
      if (anyNeg) subCogFallback = true;
      let w = 0, sx = 0, sy = 0;
      for (const i of idxs) {
        const r = Math.max(0, reactions[i]);
        w += r; sx += r * liftingPoints[i].x; sy += r * liftingPoints[i].y;
      }
      if (w < 1e-9) {
        // No positive reaction on this side (e.g. both clamped) → last-resort
        // geometric LP-pair midpoint so the rig stays buildable.
        subCogFallback = true;
        const mid = C.midpoint(liftingPoints[idxs[0]], liftingPoints[idxs[1]]);
        return { x: mid.x, y: mid.y };
      }
      return { x: sx / w, y: sy / w };
    };
    const subCogA = subCogOf(groupAIdxs);
    const subCogB = subCogOf(groupBIdxs);

    // ── 3. Vertical load shares per LP (clamped — same basis as subCogOf) ──
    const wA0 = Math.max(0, reactions[groupAIdxs[0]]);
    const wA1 = Math.max(0, reactions[groupAIdxs[1]]);
    const wB0 = Math.max(0, reactions[groupBIdxs[0]]);
    const wB1 = Math.max(0, reactions[groupBIdxs[1]]);
    const WA = wA0 + wA1, WB = wB0 + wB1;

    // ── 4. Coupled free-hang solve — every beam is a FIXED physical bar ───────────
    // Connections sit at each beam's ENDS and the slings splay to whatever angle
    // balances the rig. Each 2nd-Lvl beam hangs from its Main pick and supports its
    // two LPs (CalcCore.solveHangingBeam); the Main beam hangs from the hook and
    // supports the two sub-spreaders — each of its ends carrying that sub's TWO
    // middle slings (CalcCore.solveCascadeMainBeam), which also raises the Main beam
    // so every middle sling meets the middle-lay angle floor. A 2nd-Lvl beam can sit
    // level under an off-centre pick because it is held from ABOVE (middle slings)
    // and BELOW (bottom slings). Heights cascade LP → 2nd-Lvl → Main → hook, so
    // iterate the whole z-stack to convergence.
    const seedH = Math.max(...liftingPoints.map(p => p.z)) + 1e4;
    const seedMain = C.fixedBeamEnds(subCogA, subCogB, WA, WB, cog, masterLength);
    let pickA = { x: seedMain.end0.x, y: seedMain.end0.y, z: seedH };
    let pickB = { x: seedMain.end1.x, y: seedMain.end1.y, z: seedH };
    let hookZ = seedH + 1e4;

    let sA, sB, mE, masterZ = seedH;
    let mainConv = true, subConvA = true, subConvB = true, stackConv = false;
    for (let outer = 0; outer < 40; outer++) {
      sA = C.solveHangingBeam(groupALPs[0], groupALPs[1], wA0, wA1, pickA, pickA.z, slaveLengthA, minAngleRad, minSlingLen);
      sB = C.solveHangingBeam(groupBLPs[0], groupBLPs[1], wB0, wB1, pickB, pickB.z, slaveLengthB, minAngleRad, minSlingLen);
      subConvA = sA.converged; subConvB = sB.converged;
      mE = C.solveCascadeMainBeam(sA.end0, sA.end1, wA0, wA1, sB.end0, sB.end1, wB0, wB1, hookXY, hookZ, masterLength, middleAngleRad);
      mainConv = mE.converged; masterZ = mE.z;
      const npA = { x: mE.end0.x, y: mE.end0.y, z: masterZ };
      const npB = { x: mE.end1.x, y: mE.end1.y, z: masterZ };
      const newHookZ = masterZ + Math.max(C.horizontalDist(npA, hookXY), C.horizontalDist(npB, hookXY)) * Math.tan(topAngleRad);
      const chg = Math.hypot(npA.x - pickA.x, npA.y - pickA.y) + Math.hypot(npB.x - pickB.x, npB.y - pickB.y)
                + Math.abs(newHookZ - hookZ) + Math.abs(masterZ - pickA.z);
      pickA = npA; pickB = npB; hookZ = newHookZ;
      if (chg < 1e-5) { stackConv = true; break; }
    }
    const beamEquilibriumNotConverged = !mainConv || !subConvA || !subConvB || !stackConv;
    // Final 2nd-Lvl solve at the settled picks so the drawn sub ends match the picks.
    sA = C.solveHangingBeam(groupALPs[0], groupALPs[1], wA0, wA1, pickA, pickA.z, slaveLengthA, minAngleRad, minSlingLen);
    sB = C.solveHangingBeam(groupBLPs[0], groupBLPs[1], wB0, wB1, pickB, pickB.z, slaveLengthB, minAngleRad, minSlingLen);

    const hook = { x: cog.x, y: cog.y, z: hookZ };
    const slaveA1 = { x: sA.end0.x, y: sA.end0.y, z: sA.end0.z };
    const slaveA2 = { x: sA.end1.x, y: sA.end1.y, z: sA.end1.z };
    const slaveB1 = { x: sB.end0.x, y: sB.end0.y, z: sB.end0.z };
    const slaveB2 = { x: sB.end1.x, y: sB.end1.y, z: sB.end1.z };
    const masterPicks = { pickA, pickB };

    // Main Beam ends ARE the pick points — the full physical masterLength is used,
    // with no inboard overhang.
    const physicalLength = masterLength;
    const mainBeamEndA = { ...pickA };
    const mainBeamEndB = { ...pickB };

    // Actual (built) beam lengths — fixed to the entered lengths.
    const actualSlaveLenA = C.round4(C.dist3D(slaveA1, slaveA2));
    const actualSlaveLenB = C.round4(C.dist3D(slaveB1, slaveB2));

    // ── 5. COG polygon validation ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);

    // ── 6. Bottom slings (4): LP → slave beam end ──
    let slingId = 1;
    const bottomSlings = [];
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[0], label: groupALabels[0] },
      { ...slaveA1, label: '2nd A End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupALPs[1], label: groupALabels[1] },
      { ...slaveA2, label: '2nd A End 2' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[0], label: groupBLabels[0] },
      { ...slaveB1, label: '2nd B End 1' }
    ));
    bottomSlings.push(C.buildSling(slingId++,
      { ...groupBLPs[1], label: groupBLabels[1] },
      { ...slaveB2, label: '2nd B End 2' }
    ));

    // ── 7. Middle slings (4): slave beam ends → master beam ends ──
    const middleSlings = [];
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA1, label: '2nd A End 1' },
      { ...masterPicks.pickA, label: 'Main Pick A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveA2, label: '2nd A End 2' },
      { ...masterPicks.pickA, label: 'Main Pick A' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB1, label: '2nd B End 1' },
      { ...masterPicks.pickB, label: 'Main Pick B' }
    ));
    middleSlings.push(C.buildSling(slingId++,
      { ...slaveB2, label: '2nd B End 2' },
      { ...masterPicks.pickB, label: 'Main Pick B' }
    ));

    // ── 8. Top slings (2): master beam ends → hook ──
    const topSlings = [];
    const topSlingA = C.buildSling(slingId++,
      { ...masterPicks.pickA, label: 'Main Pick A' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingA);
    const topSlingB = C.buildSling(slingId++,
      { ...masterPicks.pickB, label: 'Main Pick B' },
      { ...hook, label: 'Hook' }
    );
    topSlings.push(topSlingB);

    // ── 9. Tensions — each sling carries its own load's vertical component, matching
    //       the free-hang solve (per-end loads, not a moment split). A top sling holds
    //       its side's full sub-assembly (WA / WB); a middle/bottom sling holds its
    //       own end's LP load. ──
    const endW = [wA0, wA1, wB0, wB1];
    const slingTension = (w, a, b) => {
      const len = C.dist3D(a, b);
      const vd = Math.abs(b.z - a.z);
      return C.round4((len < 1e-4 || vd < 1e-4) ? w : w * len / vd);
    };
    topSlingA.tension = slingTension(WA, masterPicks.pickA, hook);
    topSlingB.tension = slingTension(WB, masterPicks.pickB, hook);
    for (let i = 0; i < 4; i++) {
      middleSlings[i].tension = slingTension(endW[i], middleSlings[i].from, middleSlings[i].to);
      bottomSlings[i].tension = slingTension(endW[i], bottomSlings[i].from, bottomSlings[i].to);
    }

    // ── 10. Vertical loads ──
    const allSlings = [...bottomSlings, ...middleSlings, ...topSlings];
    for (const s of allSlings) {
      s.verticalLoad = C.round4(C.computeVerticalLoad(s.tension, s.from, s.to));
    }

    // ── 11. Warnings ──
    const topSlingAngleLow =
      topSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG) ||
      middleSlings.some(s => s.angleDegFromHoriz < TOP_ANGLE_WARN_DEG);
    const negativeTension = allSlings.some(s => s.tension < 0);
    const nearHorizontalBottom = bottomSlings.some(s => s.angleDegFromHoriz < 5);
    const bottomSlingBelowMin = minSlingLen > 0 && bottomSlings.some(s => s.length < minSlingLen - 0.01);

    // ── 12. Critical sling ──
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

    // ── 13. Result ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    const loadSharingAnalysis = C.applyLoadSharingFactor(
      bottomSlings.map(s => s.tension),
      'double-cascade',
      shared.toleranceMode
    );

    return {
      configType: 'double-cascade',
      hook: { x: C.round4(hook.x), y: C.round4(hook.y), z: C.round4(hook.z) },
      hookHeight: C.round4(hook.z),
      headroom: C.round4(hook.z - maxLPz),
      heightAboveCOG: C.round4(hook.z - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: criticalTier, id: criticalIdx + 1 },
      tiers: [
        { name: 'Bottom Slings', slings: bottomSlings },
        { name: 'Middle Slings', slings: middleSlings },
        { name: 'Top Slings', slings: topSlings }
      ],
      loadSharingAnalysis,
      beams: [
        {
          name: 'Main Beam',
          endA: { x: C.round4(mainBeamEndA.x), y: C.round4(mainBeamEndA.y), z: C.round4(mainBeamEndA.z) },
          endB: { x: C.round4(mainBeamEndB.x), y: C.round4(mainBeamEndB.y), z: C.round4(mainBeamEndB.z) },
          length: C.round4(physicalLength), pickupPoint: null
        },
        {
          name: '2nd Lvl Beam A',
          endA: { x: C.round4(slaveA1.x), y: C.round4(slaveA1.y), z: C.round4(slaveA1.z) },
          endB: { x: C.round4(slaveA2.x), y: C.round4(slaveA2.y), z: C.round4(slaveA2.z) },
          length: actualSlaveLenA, pickupPoint: null
        },
        {
          name: '2nd Lvl Beam B',
          endA: { x: C.round4(slaveB1.x), y: C.round4(slaveB1.y), z: C.round4(slaveB1.z) },
          endB: { x: C.round4(slaveB2.x), y: C.round4(slaveB2.y), z: C.round4(slaveB2.z) },
          length: actualSlaveLenB, pickupPoint: null
        }
      ],
      intermediatePoints: [
        { ...slaveA1, label: '2nd A End 1' }, { ...slaveA2, label: '2nd A End 2' },
        { ...slaveB1, label: '2nd B End 1' }, { ...slaveB2, label: '2nd B End 2' },
        { x: C.round4(masterPicks.pickA.x), y: C.round4(masterPicks.pickA.y), z: C.round4(masterPicks.pickA.z), label: 'Main Pick A' },
        { x: C.round4(masterPicks.pickB.x), y: C.round4(masterPicks.pickB.y), z: C.round4(masterPicks.pickB.z), label: 'Main Pick B' }
      ],
      slackLegAnalysis: {
        applicable: false,
        toleranceMm: shared.toleranceMm != null ? shared.toleranceMm : 200,
        reason: 'Tolerance check requires geometric perturbation analysis for paired sling configurations (not yet implemented).'
      },
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        nearHorizontalBottom,
        bottomSlingBelowMin,
        beamEquilibriumNotConverged,
        subCogFallback,
        liftBeamBendingNotChecked: false,
        // The balanced Main/2nd-Lvl bars carry real axial compression + bending that
        // this tool does NOT size — surface a standing note for the cascade config.
        spreaderBeamCapacityNotChecked: true
      }
    };
  }

  return { calculate };
})();
