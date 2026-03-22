/**
 * Sling Length Calculator — Calculation Router
 * Routes configType to the correct calculation module.
 * Uses lazy resolution so modules can load in any order.
 */

const SlingCalc = (() => {
  const modules = {
    'direct':          () => typeof CalcDirect    !== 'undefined' ? CalcDirect    : null,
    'spreader-beam':   () => typeof CalcSpreader  !== 'undefined' ? CalcSpreader  : null,
    'stinger':         () => typeof CalcStinger   !== 'undefined' ? CalcStinger   : null,
    'lifting-beam':    () => typeof CalcLiftBeam  !== 'undefined' ? CalcLiftBeam  : null,
    'double-parallel': () => typeof CalcDoublePar !== 'undefined' ? CalcDoublePar : null,
    'double-cascade':  () => typeof CalcDoubleCas !== 'undefined' ? CalcDoubleCas : null
  };

  /**
   * @param {string} configType - one of the module keys
   * @param {object} shared - { liftingPoints, cog, minAngleDeg, totalLoad }
   * @param {object} config - config-specific inputs (beam length, pairing, etc.)
   * @returns {object} standardised result
   */
  function calculate(configType, shared, config) {
    const getModule = modules[configType];
    if (!getModule) throw new Error(`Unknown configuration type: ${configType}`);
    const mod = getModule();
    if (!mod) throw new Error(`Calculation module for "${configType}" is not loaded.`);
    return mod.calculate(shared, config);
  }

  return { calculate };
})();
