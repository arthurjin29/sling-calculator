/**
 * Simple Mode — 2D elevation estimate math.
 * Elevation plane = world X-Z, depth Y = 0. Reuses CalcCore for tension + sling geometry.
 */
const CalcSimple = (() => {
  const ANGLE_FLOOR_DEG = 30;   // hard floor (matches Advanced)
  const ANGLE_AMBER_DEG = 45;   // amber below this

  /** Map Simple-mode inputs to world points. Hook hangs plumb above COG. */
  function toPoints(s) {
    const cog = { x: s.cogLeft, y: 0, z: s.cogBottom };
    const lp1 = { x: s.lp1Left, y: 0, z: s.lp1Bottom };
    const lp2 = { x: s.lp1Left + s.lp2FromLp1, y: 0, z: s.lp2Bottom };
    const hook = { x: cog.x, y: 0, z: s.loadH + s.headroom };
    return { cog, lp1, lp2, hook };
  }

  function computeSimpleDirect(s) {
    const { cog, lp1, lp2, hook } = toPoints(s);

    const sling1 = CalcCore.buildSling(1, { ...lp1, label: 'LP1' }, { ...hook, label: 'Hook' });
    const sling2 = CalcCore.buildSling(2, { ...lp2, label: 'LP2' }, { ...hook, label: 'Hook' });

    const tensions = CalcCore.calcTwoSlingTension(lp1, lp2, hook, s.weight);
    sling1.tension = CalcCore.round2(tensions[0]);
    sling2.tension = CalcCore.round2(tensions[1]);

    const minX = Math.min(lp1.x, lp2.x), maxX = Math.max(lp1.x, lp2.x);
    const minAngle = Math.min(sling1.angleDegFromHoriz, sling2.angleDegFromHoriz);

    return {
      config: 'direct',
      hook, cog, lp1, lp2,
      load: { w: s.loadW, h: s.loadH },
      slings: [sling1, sling2],
      minAngle: CalcCore.round2(minAngle),
      warnings: {
        cogOutsideSpan: cog.x < minX - 1e-6 || cog.x > maxX + 1e-6,
        angleBelowFloor: minAngle < ANGLE_FLOOR_DEG,
        angleAmber: minAngle >= ANGLE_FLOOR_DEG && minAngle < ANGLE_AMBER_DEG,
        degenerate: Math.abs(lp2.x - lp1.x) < 1e-6 || s.headroom <= 0 || s.weight <= 0
      }
    };
  }

  /**
   * Map Simple-mode state to a symmetric 4-lift-point 3D model.
   * Elevation = side view; each LP is mirrored ± depthOffset along Y. COG centred (y=0).
   */
  function buildAdvancedModel(s, depthOffset) {
    const d = Math.abs(depthOffset) || 0;
    const lp1x = s.lp1Left, lp2x = s.lp1Left + s.lp2FromLp1;
    return {
      config: 'direct',
      liftingPoints: [
        { x: lp1x, y: d,  z: s.lp1Bottom },
        { x: lp2x, y: d,  z: s.lp2Bottom },
        { x: lp1x, y: -d, z: s.lp1Bottom },
        { x: lp2x, y: -d, z: s.lp2Bottom }
      ],
      cog: { x: s.cogLeft, y: 0, z: s.cogBottom },
      totalLoad: s.weight
    };
  }

  function computeSimpleSpreader(s) {
    const { cog, lp1, lp2, hook } = toPoints(s);
    const half = s.beamLength / 2;
    const topRise = Math.sqrt(Math.max(s.topSlingLength * s.topSlingLength - half * half, 0));
    const beamZ = hook.z - topRise;
    const endA = { x: cog.x - half, y: 0, z: beamZ, label: 'BeamA' };
    const endB = { x: cog.x + half, y: 0, z: beamZ, label: 'BeamB' };

    const topA = CalcCore.buildSling(1, { ...endA }, { ...hook, label: 'Hook' });
    const topB = CalcCore.buildSling(2, { ...endB }, { ...hook, label: 'Hook' });
    const botA = CalcCore.buildSling(3, { ...lp1, label: 'LP1' }, { ...endA });
    const botB = CalcCore.buildSling(4, { ...lp2, label: 'LP2' }, { ...endB });

    // COG load split → vertical load per LP, then convert to bottom-sling tension.
    const arm1 = Math.abs(lp1.x - cog.x), arm2 = Math.abs(lp2.x - cog.x);
    const totalArm = arm1 + arm2 || 1;
    const v1 = s.weight * arm2 / totalArm, v2 = s.weight * arm1 / totalArm;
    const botSin1 = botA.verticalDist / (botA.length || 1);
    const botSin2 = botB.verticalDist / (botB.length || 1);
    botA.tension = CalcCore.round2(v1 / (botSin1 || 1));
    botB.tension = CalcCore.round2(v2 / (botSin2 || 1));
    // Top slings: each carries its beam-end vertical load (= the bottom-leg vertical load it supports).
    const topSin = topA.verticalDist / (topA.length || 1);
    topA.tension = CalcCore.round2(v1 / (topSin || 1));
    topB.tension = CalcCore.round2(v2 / (topSin || 1));

    const minAngle = Math.min(topA.angleDegFromHoriz, topB.angleDegFromHoriz,
                              botA.angleDegFromHoriz, botB.angleDegFromHoriz);
    return {
      config: 'spreader-beam',
      hook, cog, lp1, lp2,
      load: { w: s.loadW, h: s.loadH },
      beam: { endA, endB, z: beamZ },
      topSlings: [topA, topB],
      bottomSlings: [botA, botB],
      slings: [topA, topB, botA, botB],
      minAngle: CalcCore.round2(minAngle),
      warnings: {
        cogOutsideSpan: cog.x < Math.min(lp1.x, lp2.x) - 1e-6 || cog.x > Math.max(lp1.x, lp2.x) + 1e-6,
        angleBelowFloor: minAngle < ANGLE_FLOOR_DEG,
        angleAmber: minAngle >= ANGLE_FLOOR_DEG && minAngle < ANGLE_AMBER_DEG,
        topSlingTooShort: s.topSlingLength <= half,
        degenerate: Math.abs(lp2.x - lp1.x) < 1e-6 || s.headroom <= 0 || s.weight <= 0
      }
    };
  }

  return { computeSimpleDirect, computeSimpleSpreader, buildAdvancedModel, toPoints, ANGLE_FLOOR_DEG, ANGLE_AMBER_DEG };
})();
if (typeof window !== 'undefined') window.CalcSimple = CalcSimple;
