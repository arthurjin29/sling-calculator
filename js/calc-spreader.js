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

    // ── 1. Beam orientation axis + seed placement (used ONLY to assign each LP to
    //    the nearer end; the resting pose comes from the equilibrium solve below). ──
    const axis = C.getOrientationAxis(liftingPoints, orientation);
    const cx = liftingPoints.reduce((s, p) => s + p.x, 0) / 4;
    const cy = liftingPoints.reduce((s, p) => s + p.y, 0) / 4;
    const sAlong = (cx - cog.x) * axis.x + (cy - cog.y) * axis.y;
    const seedCentre = { x: cog.x + sAlong * axis.x, y: cog.y + sAlong * axis.y, z: 0 };
    const seed = C.computeBeamEnds(seedCentre, beamLength, axis);

    // ── 2. Auto-assign each LP to the nearer seed end ──
    const groupA = []; // LPs closer to endA
    const groupB = []; // LPs closer to endB
    for (let i = 0; i < liftingPoints.length; i++) {
      const lp = liftingPoints[i];
      const g = (C.horizontalDist(lp, seed.endA) <= C.horizontalDist(lp, seed.endB)) ? groupA : groupB;
      g.push({ lp, idx: i, label: 'LP' + (i + 1) });
    }
    // Ensure both groups have at least 1 LP (handle edge cases)
    if (groupA.length === 0 || groupB.length === 0) {
      const ranked = liftingPoints.map((lp, i) => ({
        lp, idx: i, label: 'LP' + (i + 1),
        dA: C.horizontalDist(lp, seed.endA)
      })).sort((a, b) => a.dA - b.dA);
      groupA.length = 0;
      groupB.length = 0;
      ranked.slice(0, 2).forEach(r => groupA.push(r));
      ranked.slice(2).forEach(r => groupB.push(r));
    }

    // ── 3. Per-LP vertical shares (min-norm rigid-body reactions) ──
    const reactions = C.computeSupportReactions(liftingPoints, cog, totalLoad);
    const anyNegReaction = reactions.some(r => r < -1e-9);
    const wOf = g => Math.max(0, reactions[g.idx]);
    const lpsA = groupA.map(g => g.lp), wsA = groupA.map(wOf);
    const lpsB = groupB.map(g => g.lp), wsB = groupB.map(wOf);
    const WA = wsA.reduce((s, v) => s + v, 0), WB = wsB.reduce((s, v) => s + v, 0);

    // ── 4. Fixed-length free-hang solve. The beam is a physical bar of beamLength;
    //    every sling attaches at an END, and the bar translates/yaws to hang plumb
    //    (net horizontal ~0) with the hook over the COG. Hook height is set by the
    //    min top-sling angle over the ends; pose depends on hook height and vice
    //    versa, so iterate. minSling = 0 → beam height governed by the min bottom
    //    angle alone (matches the old computeBeamEndZ behaviour). ──
    const cogOutsidePolygon = !C.pointInPolygon2D(cog, liftingPoints);
    const hookXY = { x: cog.x, y: cog.y };
    let hookZ = Math.max(...liftingPoints.map(lp => lp.z + C.horizontalDist(lp, hookXY) * Math.tan(minAngleRad)));
    let endA, endB, converged = true, hookConverged = false;
    for (let outer = 0; outer < 12; outer++) {
      const r = C.solveSpreaderBeam(lpsA, wsA, lpsB, wsB, hookXY, hookZ, beamLength, minAngleRad, 0);
      endA = r.end0; endB = r.end1; converged = r.converged;
      const newHookZ = Math.max(
        endA.z + C.horizontalDist(endA, hookXY) * Math.tan(minAngleRad),
        endB.z + C.horizontalDist(endB, hookXY) * Math.tan(minAngleRad)
      );
      if (Math.abs(newHookZ - hookZ) < 1e-4) { hookZ = newHookZ; hookConverged = true; break; }
      hookZ = newHookZ;
    }
    const hook = { x: cog.x, y: cog.y, z: hookZ };
    const hDistAtoHook = C.horizontalDist(endA, hook);
    const hDistBtoHook = C.horizontalDist(endB, hook);

    // ── 5. Bottom slings — each LP to its assigned beam end ──
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

    // ── 6. Top slings (2 total) ──
    const topSlingA = C.buildSling(slingId++,
      { x: endA.x, y: endA.y, z: endA.z, label: 'Beam End A' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    const topSlingB = C.buildSling(slingId++,
      { x: endB.x, y: endB.y, z: endB.z, label: 'Beam End B' },
      { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' }
    );
    const topSlings = [topSlingA, topSlingB];

    // ── 7. Tensions — per-end determinate: a top sling carries its end's total load
    //    share (WA / WB); a bottom sling carries its own LP's load. Matches the
    //    free-hang solve (per-end loads, not a moment split). ──
    const slingTension = (w, a, b) => {
      const len = C.dist3D(a, b), vd = Math.abs(b.z - a.z);
      return C.round4((len < 1e-4 || vd < 1e-4) ? w : w * len / vd);
    };
    topSlingA.tension = slingTension(WA, endA, hook);
    topSlingB.tension = slingTension(WB, endB, hook);
    const bWeights = [...wsA, ...wsB];
    for (let i = 0; i < bottomSlings.length; i++) {
      bottomSlings[i].tension = slingTension(bWeights[i], bottomSlings[i].from, bottomSlings[i].to);
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

    // Hook height governance
    const hookZFromA = endA.z + hDistAtoHook * Math.tan(minAngleRad);
    const hookZFromB = endB.z + hDistBtoHook * Math.tan(minAngleRad);
    topSlingA.governsHookHeight = (hookZFromA >= hookZFromB);
    topSlingB.governsHookHeight = (hookZFromB > hookZFromA);

    // ── 11. Headroom ──
    const maxLPz = Math.max(...liftingPoints.map(p => p.z));

    const loadSharingAnalysis = C.applyLoadSharingFactor(
      bottomSlings.map(s => s.tension),
      'spreader-beam',
      shared.toleranceMode
    );

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
      loadSharingAnalysis,
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
      slackLegAnalysis: {
        applicable: false,
        toleranceMm: shared.toleranceMm != null ? shared.toleranceMm : 200,
        reason: 'Tolerance check requires geometric perturbation analysis for paired sling configurations (not yet implemented).'
      },
      warnings: {
        cogOutsidePolygon,
        negativeTension,
        topSlingAngleLow,
        beamEquilibriumNotConverged: !converged || !hookConverged,
        subCogFallback: anyNegReaction,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
