/**
 * 4-Leg Direct Sling Calculation
 * Ported from the original calc.js — 4 slings from hook directly to 4 LPs.
 */

const CalcDirect = (() => {

  /**
   * @param {object} shared - { liftingPoints, cog, minAngleDeg, totalLoad }
   * @param {object} config - {} (no config-specific inputs for direct)
   * @returns {object} standardised result
   */
  function calculate(shared, config) {
    const { liftingPoints, cog, minAngleDeg, totalLoad } = shared;
    const minAngleRad = CalcCore.degToRad(minAngleDeg);

    const cogInsidePolygon = CalcCore.pointInPolygon2D(
      cog, liftingPoints.map(lp => ({ x: lp.x, y: lp.y }))
    );

    const hookXY = { x: cog.x, y: cog.y };
    const hDists = liftingPoints.map(lp => CalcCore.horizontalDist(lp, hookXY));

    const requiredHookZs = liftingPoints.map((lp, i) => {
      return lp.z + hDists[i] * Math.tan(minAngleRad);
    });

    const hookZ = Math.max(...requiredHookZs);
    const hook = { x: hookXY.x, y: hookXY.y, z: hookZ };

    const slings = liftingPoints.map((lp, i) => {
      const from = { x: lp.x, y: lp.y, z: lp.z, label: `LP${i + 1}` };
      const to = { x: hook.x, y: hook.y, z: hook.z, label: 'Hook' };
      const sling = CalcCore.buildSling(i + 1, from, to);
      sling.governsHookHeight = Math.abs(requiredHookZs[i] - hookZ) < 0.0001;
      return sling;
    });

    // Load distribution (min-norm least squares, N=4)
    const tensions = CalcCore.calcLoadDistribution(liftingPoints, hook, totalLoad);
    let hasNegativeTension = false;
    slings.forEach((s, i) => {
      s.tension = CalcCore.round4(tensions[i]);
      if (tensions[i] < -0.001) hasNegativeTension = true;
      s.verticalLoad = CalcCore.round4(CalcCore.computeVerticalLoad(tensions[i], s.from, s.to));
    });

    // Critical sling = highest tension
    let maxTension = -Infinity;
    let criticalIndex = 0;
    slings.forEach((s, i) => {
      if (s.tension > maxTension) {
        maxTension = s.tension;
        criticalIndex = i;
      }
    });
    slings[criticalIndex].isCritical = true;

    const maxLPz = Math.max(...liftingPoints.map(lp => lp.z));

    return {
      configType: 'direct',
      hook,
      hookHeight: CalcCore.round4(hookZ),
      headroom: CalcCore.round4(hookZ - maxLPz),
      heightAboveCOG: CalcCore.round4(hookZ - cog.z),
      totalLoad,
      minAngleDeg,
      criticalSling: { tier: 'bottom', id: criticalIndex + 1 },
      tiers: [{
        name: 'Slings',
        slings
      }],
      beams: [],
      intermediatePoints: [],
      warnings: {
        cogOutsidePolygon: !cogInsidePolygon,
        negativeTension: hasNegativeTension,
        topSlingAngleLow: false,
        liftBeamBendingNotChecked: false
      }
    };
  }

  return { calculate };
})();
