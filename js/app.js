/**
 * Sling Length Calculator — UI Logic
 * Form handling, validation, presets, units, save/load, wiring calc → display + diagrams.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('calc-form');
  const resultsSection = document.getElementById('results');
  const errorDiv = document.getElementById('error-msg');
  const presetSelect = document.getElementById('preset-select');
  const unitSelect = document.getElementById('unit-select');
  const loadSelect = document.getElementById('load-select');

  const STORAGE_KEY = 'sling-calc-configs';
  const configSelect = document.getElementById('config-select');
  let currentConfig = 'direct';
  let currentUnit = 'm';
  let lastResults = null;
  let lastCog = null;

  // --- Simple / Advanced mode toggle ---
  const simpleSection = document.getElementById('simple-mode');
  const toolbarEl = document.querySelector('.toolbar');
  const advancedLayout = document.getElementById('advanced-layout');
  const modeSimpleBtn = document.getElementById('mode-simple');
  const modeAdvancedBtn = document.getElementById('mode-advanced');
  function setMode(mode) {
    const simple = mode === 'simple';
    if (simpleSection) simpleSection.style.display = simple ? '' : 'none';
    if (advancedLayout) advancedLayout.style.display = simple ? 'none' : '';
    if (toolbarEl) toolbarEl.style.display = simple ? 'none' : '';
    form.style.display = simple ? 'none' : '';
    resultsSection.style.display = simple ? 'none' : '';
    document.documentElement.classList.toggle('mode-advanced', !simple);
    document.body.classList.toggle('mode-advanced', !simple);
    if (modeSimpleBtn) modeSimpleBtn.classList.toggle('btn-primary', simple);
    if (modeAdvancedBtn) modeAdvancedBtn.classList.toggle('btn-primary', !simple);
    if (!simple) {
      // The 3D canvas has zero size while the shell is hidden; once it becomes
      // visible, let the scene re-read its container and resize. Safe no-op if
      // the scene hasn't initialised yet (no 'resize' listener registered).
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }
  if (modeSimpleBtn) modeSimpleBtn.addEventListener('click', () => setMode('simple'));
  if (modeAdvancedBtn) modeAdvancedBtn.addEventListener('click', () => setMode('advanced'));
  window.SlingApp = window.SlingApp || {};
  window.SlingApp.setMode = setMode;

  /** Prefill the Advanced inputs from a Simple-mode model, switch to Advanced, and compute. */
  window.SlingApp.applyAdvancedModel = function (model) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const round = (v) => Math.round(v * 1000) / 1000;
    const lp = model.liftingPoints;
    for (let i = 0; i < 4; i++) {
      set(`lp${i + 1}-x`, round(lp[i].x));
      set(`lp${i + 1}-y`, round(lp[i].y));
      set(`lp${i + 1}-z`, round(lp[i].z));
    }
    set('cog-x', round(model.cog.x));
    set('cog-y', round(model.cog.y));
    set('cog-z', round(model.cog.z));
    set('total-load', round(model.totalLoad));
    configSelect.value = model.config;
    configSelect.dispatchEvent(new Event('change'));
    setMode('advanced');
    runCalculation();
  };

  if (simpleSection) setMode('simple'); // Simple is the default front door when present

  // --- Presets ---
  const PRESETS = {
    'rect-sym': {
      lps: [[-3,-1.5,0],[3,-1.5,0],[3,1.5,0],[-3,1.5,0]],
      cog: [0,0,0], load: 10, angle: 60
    },
    'rect-offset': {
      lps: [[-3,-1.5,0],[3,-1.5,0],[3,1.5,0],[-3,1.5,0]],
      cog: [0.5,0.2,0], load: 10, angle: 60
    },
    'square': {
      lps: [[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]],
      cog: [0,0,0], load: 8, angle: 60
    },
    'trapezoid': {
      lps: [[-2,-1.5,0],[2,-1.5,0],[1.5,1.5,0],[-1.5,1.5,0]],
      cog: [0,0,0], load: 12, angle: 60
    },
    'elevated': {
      lps: [[-3,-1.5,0.5],[3,-1.5,0],[3,1.5,0.5],[-3,1.5,0]],
      cog: [0,0,0.25], load: 15, angle: 60
    }
  };

  // --- Unit conversion ---
  const M_TO_FT = 3.28084;
  const T_TO_USTON = 1.10231;

  function getUnitLabels() {
    if (currentUnit === 'ft') return { length: 'ft', load: 'US tons' };
    return { length: 'm', load: 'tonnes' };
  }

  function updateUnitLabels() {
    const labels = getUnitLabels();
    document.querySelectorAll('.unit-label').forEach(el => {
      if (el.classList.contains('load-unit')) {
        el.textContent = labels.load;
      } else {
        el.textContent = labels.length;
      }
    });
    document.querySelectorAll('.res-unit').forEach(el => el.textContent = labels.length);
    document.querySelectorAll('.res-load-unit').forEach(el => {
      el.textContent = currentUnit === 'ft' ? 'US t' : 't';
    });
  }

  // Set default min angle
  document.getElementById('min-angle').value = 60;

  // Pre-fill example
  prefillExample();
  refreshSavedList();

  // --- Event listeners ---

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runCalculation();
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    form.reset();
    document.getElementById('min-angle').value = 60;
    resultsSection.style.display = 'none';
    errorDiv.style.display = 'none';
    presetSelect.value = '';
  });

  document.getElementById('btn-example').addEventListener('click', prefillExample);

  configSelect.addEventListener('change', () => {
    currentConfig = configSelect.value;
    // Hide all config panels
    document.querySelectorAll('.config-panel').forEach(p => p.style.display = 'none');
    // Show selected panel (if not direct)
    if (currentConfig !== 'direct') {
      const panel = document.getElementById('panel-' + currentConfig);
      if (panel) panel.style.display = '';
    }
  });

  presetSelect.addEventListener('change', () => {
    const key = presetSelect.value;
    if (!key || !PRESETS[key]) return;
    applyPreset(PRESETS[key]);
  });

  unitSelect.addEventListener('change', () => {
    const newUnit = unitSelect.value;
    if (newUnit === currentUnit) return;

    // Convert all current input values
    convertInputs(currentUnit, newUnit);
    currentUnit = newUnit;
    updateUnitLabels();

    // Re-run calculation if we had results
    if (lastResults) runCalculation();
  });

  document.getElementById('btn-save').addEventListener('click', saveConfig);

  loadSelect.addEventListener('change', () => {
    const name = loadSelect.value;
    if (!name) return;
    loadConfig(name);
    loadSelect.value = '';
  });

  document.getElementById('btn-delete-saved').addEventListener('click', () => {
    const name = loadSelect.value;
    if (!name) return;
    deleteConfig(name);
  });

  // --- Overlay controls ---
  const overlayFile = document.getElementById('overlay-file');
  const overlaySliders = document.getElementById('overlay-sliders');
  const overlayFilename = document.getElementById('overlay-filename');

  overlayFile.addEventListener('change', () => {
    const file = overlayFile.files[0];
    if (!file) return;
    overlayFilename.textContent = file.name;

    SlingOverlay.processFile(file, () => {
      overlaySliders.style.display = '';
      // Re-render diagrams with overlay if we have results
      if (lastResults) refreshDiagrams();
    });
  });

  document.getElementById('btn-overlay-clear').addEventListener('click', () => {
    SlingOverlay.clearOverlay();
    overlayFile.value = '';
    overlayFilename.textContent = 'No file selected';
    overlaySliders.style.display = 'none';
    if (lastResults) refreshDiagrams();
  });

  // Slider wiring
  const sliderIds = [
    { id: 'overlay-opacity', key: 'opacity', valId: 'overlay-opacity-val', fmt: v => `${v}%`, convert: v => v / 100 },
    { id: 'overlay-scale', key: 'scale', valId: 'overlay-scale-val', fmt: v => `${v}%`, convert: v => v / 100 },
    { id: 'overlay-rotation', key: 'rotation', valId: 'overlay-rotation-val', fmt: v => `${v}°`, convert: v => +v },
    { id: 'overlay-ox', key: 'offsetX', valId: 'overlay-ox-val', fmt: v => v, convert: v => +v },
    { id: 'overlay-oy', key: 'offsetY', valId: 'overlay-oy-val', fmt: v => v, convert: v => +v },
  ];

  sliderIds.forEach(({ id, key, valId, fmt, convert }) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.addEventListener('input', () => {
      valEl.textContent = fmt(slider.value);
      SlingOverlay.updateState({ [key]: convert(slider.value) });
      if (lastResults) refreshDiagrams();
    });
  });

  function refreshDiagrams() {
    if (!lastResults || !lastCog) return;
    const unitLabel = currentUnit === 'ft' ? 'ft' : 'm';
    if (typeof SlingDiagram !== 'undefined') {
      SlingDiagram.render(lastResults, lastCog, 'plan-diagram', 'elev-diagram', unitLabel);
    }
    if (typeof SlingOverlay !== 'undefined') {
      SlingOverlay.injectIntoSVG('plan-diagram');
    }
    if (typeof CadImport !== 'undefined') {
      CadImport.injectDxfIntoSVG('plan-diagram');
    }
  }

  // --- DXF controls ---
  const dxfFile = document.getElementById('dxf-file');
  const dxfSliders = document.getElementById('dxf-sliders');
  const dxfFilename = document.getElementById('dxf-filename');
  const dxfInfo = document.getElementById('dxf-info');

  dxfFile.addEventListener('change', async () => {
    const file = dxfFile.files[0];
    if (!file) return;
    dxfFilename.textContent = file.name;
    try {
      await CadImport.loadDXF(file, (count) => {
        dxfInfo.textContent = `(${count} entities)`;
        dxfSliders.style.display = '';
        if (lastResults) refreshDiagrams();
      });
    } catch (err) {
      dxfInfo.textContent = err.message;
    }
  });

  document.getElementById('btn-dxf-clear').addEventListener('click', () => {
    CadImport.clearDXF();
    dxfFile.value = '';
    dxfFilename.textContent = 'No file selected';
    dxfInfo.textContent = '';
    dxfSliders.style.display = 'none';
    if (lastResults) refreshDiagrams();
  });

  const dxfSliderDefs = [
    { id: 'dxf-scale', key: 'scale', valId: 'dxf-scale-val', fmt: v => `${v}%`, convert: v => v / 100 },
    { id: 'dxf-rotation', key: 'rotation', valId: 'dxf-rotation-val', fmt: v => `${v}°`, convert: v => +v },
    { id: 'dxf-ox', key: 'offsetX', valId: 'dxf-ox-val', fmt: v => v, convert: v => +v },
    { id: 'dxf-oy', key: 'offsetY', valId: 'dxf-oy-val', fmt: v => v, convert: v => +v },
    { id: 'dxf-lw', key: 'lineWidth', valId: 'dxf-lw-val', fmt: v => v, convert: v => +v },
  ];

  dxfSliderDefs.forEach(({ id, key, valId, fmt, convert }) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.addEventListener('input', () => {
      valEl.textContent = fmt(slider.value);
      CadImport.updateDxfState({ [key]: convert(slider.value) });
      if (lastResults) refreshDiagrams();
    });
  });

  document.getElementById('dxf-color').addEventListener('input', (e) => {
    CadImport.updateDxfState({ color: e.target.value });
    if (lastResults) refreshDiagrams();
  });

  // --- STL controls ---
  const stlFile = document.getElementById('stl-file');
  const stlSliders = document.getElementById('stl-sliders');
  const stlFilename = document.getElementById('stl-filename');
  const stlInfo = document.getElementById('stl-info');

  stlFile.addEventListener('change', async () => {
    const file = stlFile.files[0];
    if (!file) return;
    stlFilename.textContent = file.name;
    try {
      await CadImport.loadSTL(file, (info) => {
        stlInfo.textContent = `(${info.vertices} verts, ${info.size.x}×${info.size.y}×${info.size.z})`;
        stlSliders.style.display = '';
        if (typeof SlingScene !== 'undefined') SlingScene.refreshStlMesh();
      });
    } catch (err) {
      stlInfo.textContent = err.message;
    }
  });

  document.getElementById('btn-stl-clear').addEventListener('click', () => {
    CadImport.clearSTL();
    stlFile.value = '';
    stlFilename.textContent = 'No file selected';
    stlInfo.textContent = '';
    stlSliders.style.display = 'none';
    if (typeof SlingScene !== 'undefined') SlingScene.refreshStlMesh();
  });

  const stlSliderDefs = [
    { id: 'stl-scale', key: 'scale', valId: 'stl-scale-val', fmt: v => (v/100).toFixed(2), convert: v => v / 100 },
    { id: 'stl-rotation', key: 'rotationZ', valId: 'stl-rotation-val', fmt: v => `${v}°`, convert: v => +v },
    { id: 'stl-opacity', key: 'opacity', valId: 'stl-opacity-val', fmt: v => `${v}%`, convert: v => v / 100 },
    { id: 'stl-ox', key: 'offsetX', valId: 'stl-ox-val', fmt: v => v, convert: v => +v },
    { id: 'stl-oy', key: 'offsetY', valId: 'stl-oy-val', fmt: v => v, convert: v => +v },
    { id: 'stl-oz', key: 'offsetZ', valId: 'stl-oz-val', fmt: v => v, convert: v => +v },
  ];

  stlSliderDefs.forEach(({ id, key, valId, fmt, convert }) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.addEventListener('input', () => {
      valEl.textContent = fmt(slider.value);
      CadImport.updateStlState({ [key]: convert(slider.value) });
      if (typeof SlingScene !== 'undefined') SlingScene.refreshStlMesh();
    });
  });

  updateUnitLabels();

  // --- Core ---

  function runCalculation() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    try {
      const inputs = readInputs();

      // Convert to metres/tonnes for calculation if in feet
      let calcInputs = inputs;
      if (currentUnit === 'ft') {
        calcInputs = convertToMetric(inputs);
      }

      const results = SlingCalc.calculate(
        inputs.configType,
        {
          liftingPoints: calcInputs.liftingPoints,
          cog: calcInputs.cog,
          minAngleDeg: calcInputs.minAngle,
          totalLoad: calcInputs.totalLoad,
          toleranceMode: calcInputs.toleranceMode
        },
        inputs.configData
      );

      // Convert results back to display units
      const displayResults = currentUnit === 'ft' ? convertResultsToImperial(results) : results;

      displayOutput(displayResults);
      if (calcInputs.minAngle < 45) {
        results.warnings = results.warnings || {};
        results.warnings.minAngleBelowAmber = true;
      }
      displayWarnings(results.warnings);

      lastResults = displayResults;
      lastCog = currentUnit === 'ft' ? convertPointToImperial(calcInputs.cog) : calcInputs.cog;

      // Show results section first so 3D container has dimensions
      resultsSection.style.display = 'block';

      // 2D diagrams + overlay
      refreshDiagrams();

      // 3D scene with display units for labels
      if (typeof SlingScene !== 'undefined') {
        const sceneUnits = currentUnit === 'ft'
          ? { length: 'ft', load: 'US t' }
          : { length: 'm', load: 't' };
        SlingScene.update(displayResults, lastCog, sceneUnits);
      }

      resultsSection.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    }
  }

  function convertToMetric(inputs) {
    const conv = (p) => ({ x: p.x / M_TO_FT, y: p.y / M_TO_FT, z: p.z / M_TO_FT });
    const result = {
      liftingPoints: inputs.liftingPoints.map(conv),
      cog: conv(inputs.cog),
      totalLoad: inputs.totalLoad / T_TO_USTON,
      minAngle: inputs.minAngle,
      toleranceMode: inputs.toleranceMode
    };
    // Convert beam lengths in configData
    if (inputs.configData.beamLength) inputs.configData.beamLength /= M_TO_FT;
    if (inputs.configData.beamLengthA) inputs.configData.beamLengthA /= M_TO_FT;
    if (inputs.configData.beamLengthB) inputs.configData.beamLengthB /= M_TO_FT;
    if (inputs.configData.masterLength) inputs.configData.masterLength /= M_TO_FT;
    if (inputs.configData.slaveLengthA) inputs.configData.slaveLengthA /= M_TO_FT;
    if (inputs.configData.slaveLengthB) inputs.configData.slaveLengthB /= M_TO_FT;
    if (inputs.configData.topSlingLength) inputs.configData.topSlingLength /= M_TO_FT;
    if (inputs.configData.bottomSlingLen) inputs.configData.bottomSlingLen /= M_TO_FT;
    return result;
  }

  function convertResultsToImperial(r) {
    return {
      ...r,
      hookHeight: r.hookHeight * M_TO_FT,
      headroom: r.headroom * M_TO_FT,
      heightAboveCOG: r.heightAboveCOG * M_TO_FT,
      totalLoad: r.totalLoad * T_TO_USTON,
      hook: convertPointToImperial(r.hook),
      tiers: r.tiers.map(tier => ({
        ...tier,
        slings: tier.slings.map(s => ({
          ...s,
          length: s.length * M_TO_FT,
          horizontalDist: s.horizontalDist * M_TO_FT,
          verticalDist: s.verticalDist * M_TO_FT,
          tension: s.tension * T_TO_USTON,
          verticalLoad: s.verticalLoad * T_TO_USTON,
          from: convertPointToImperial(s.from),
          to: convertPointToImperial(s.to)
        }))
      })),
      beams: r.beams.map(b => ({
        ...b,
        length: b.length * M_TO_FT,
        endA: convertPointToImperial(b.endA),
        endB: convertPointToImperial(b.endB),
        pickupPoint: b.pickupPoint ? convertPointToImperial(b.pickupPoint) : null
      })),
      intermediatePoints: r.intermediatePoints.map(p => ({
        ...p,
        x: p.x * M_TO_FT, y: p.y * M_TO_FT, z: p.z * M_TO_FT
      })),
      slackLegAnalysis: r.slackLegAnalysis && r.slackLegAnalysis.applicable ? {
        ...r.slackLegAnalysis,
        baseMaxTension: r.slackLegAnalysis.baseMaxTension * T_TO_USTON,
        scenarios: r.slackLegAnalysis.scenarios.map(sc => ({
          ...sc,
          tensions: sc.tensions.map(t => t * T_TO_USTON),
          maxTension: sc.maxTension * T_TO_USTON
        })),
        worstCase: {
          ...r.slackLegAnalysis.worstCase,
          maxTension: r.slackLegAnalysis.worstCase.maxTension * T_TO_USTON
        }
      } : r.slackLegAnalysis,
      loadSharingAnalysis: r.loadSharingAnalysis ? {
        ...r.loadSharingAnalysis,
        baseMaxTension: r.loadSharingAnalysis.baseMaxTension != null
          ? r.loadSharingAnalysis.baseMaxTension * T_TO_USTON : null,
        adjustedMaxTension: r.loadSharingAnalysis.adjustedMaxTension != null
          ? r.loadSharingAnalysis.adjustedMaxTension * T_TO_USTON : null
      } : r.loadSharingAnalysis
    };
  }

  function convertPointToImperial(p) {
    const result = { x: p.x * M_TO_FT, y: p.y * M_TO_FT, z: p.z * M_TO_FT };
    if (p.label) result.label = p.label;
    return result;
  }

  function convertInputs(fromUnit, toUnit) {
    const factor = fromUnit === 'm' ? M_TO_FT : 1 / M_TO_FT;
    const loadFactor = fromUnit === 'm' ? T_TO_USTON : 1 / T_TO_USTON;

    const coordIds = [];
    for (let i = 1; i <= 4; i++) {
      coordIds.push(`lp${i}-x`, `lp${i}-y`, `lp${i}-z`);
    }
    coordIds.push('cog-x', 'cog-y', 'cog-z');

    coordIds.forEach(id => {
      const el = document.getElementById(id);
      const val = parseFloat(el.value);
      if (!isNaN(val)) el.value = parseFloat((val * factor).toFixed(4));
    });

    const loadEl = document.getElementById('total-load');
    const loadVal = parseFloat(loadEl.value);
    if (!isNaN(loadVal)) loadEl.value = parseFloat((loadVal * loadFactor).toFixed(4));
  }

  function prefillExample() {
    applyPreset(PRESETS['rect-offset']);
    presetSelect.value = 'rect-offset';
  }

  function applyPreset(preset) {
    // If we're in feet, convert preset values (which are in metres)
    const factor = currentUnit === 'ft' ? M_TO_FT : 1;
    const loadFactor = currentUnit === 'ft' ? T_TO_USTON : 1;

    for (let i = 0; i < 4; i++) {
      document.getElementById(`lp${i+1}-x`).value = parseFloat((preset.lps[i][0] * factor).toFixed(4));
      document.getElementById(`lp${i+1}-y`).value = parseFloat((preset.lps[i][1] * factor).toFixed(4));
      document.getElementById(`lp${i+1}-z`).value = parseFloat((preset.lps[i][2] * factor).toFixed(4));
    }
    document.getElementById('cog-x').value = parseFloat((preset.cog[0] * factor).toFixed(4));
    document.getElementById('cog-y').value = parseFloat((preset.cog[1] * factor).toFixed(4));
    document.getElementById('cog-z').value = parseFloat((preset.cog[2] * factor).toFixed(4));
    document.getElementById('total-load').value = parseFloat((preset.load * loadFactor).toFixed(4));
    document.getElementById('min-angle').value = preset.angle;
  }

  function readInputs() {
    const lp = (n) => ({
      x: parseRequiredFloat(`lp${n}-x`, `LP${n} X`),
      y: parseRequiredFloat(`lp${n}-y`, `LP${n} Y`),
      z: parseRequiredFloat(`lp${n}-z`, `LP${n} Z`)
    });

    const liftingPoints = [lp(1), lp(2), lp(3), lp(4)];

    const cog = {
      x: parseRequiredFloat('cog-x', 'COG X'),
      y: parseRequiredFloat('cog-y', 'COG Y'),
      z: parseRequiredFloat('cog-z', 'COG Z')
    };

    const totalLoad = parseRequiredFloat('total-load', 'Total Load');
    if (totalLoad <= 0) throw new Error('Total Load must be greater than 0.');

    const minAngle = Math.max(30, parseRequiredFloat('min-angle', 'Min Sling Angle'));
    if (minAngle >= 90) {
      throw new Error('Minimum sling angle must be less than 90°.');
    }
    const minAngleEl = document.getElementById('min-angle');
    if (minAngle < 45) {
      minAngleEl.style.borderColor = '#f39c12';
      minAngleEl.style.backgroundColor = '#fef9e7';
    } else {
      minAngleEl.style.borderColor = '';
      minAngleEl.style.backgroundColor = '';
    }

    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = liftingPoints[i], b = liftingPoints[j];
        if (a.x === b.x && a.y === b.y && a.z === b.z) {
          throw new Error(`LP${i+1} and LP${j+1} are at the same position.`);
        }
      }
    }

    const toleranceModeEl = document.getElementById('sling-tolerance-mode');
    const toleranceMode = toleranceModeEl ? toleranceModeEl.value : 'theoretical';

    return { liftingPoints, cog, totalLoad, minAngle, toleranceMode, configType: currentConfig, configData: readConfigData(currentConfig) };
  }

  function parseRequiredFloat(id, label) {
    const el = document.getElementById(id);
    const val = parseFloat(el.value);
    if (isNaN(val)) throw new Error(`${label} is required and must be a number.`);
    return val;
  }

  function readConfigData(configType) {
    if (configType === 'direct') return {};

    const data = {};

    // Read LP pairing
    const pairingPrefix = getPairingPrefix(configType);
    if (pairingPrefix) {
      data.pairing = {
        groupA: [
          parseInt(document.getElementById('pair-' + pairingPrefix + '-a1').value),
          parseInt(document.getElementById('pair-' + pairingPrefix + '-a2').value)
        ],
        groupB: [
          parseInt(document.getElementById('pair-' + pairingPrefix + '-b1').value),
          parseInt(document.getElementById('pair-' + pairingPrefix + '-b2').value)
        ]
      };
      // Validate: all 4 LPs assigned exactly once
      const all = [...data.pairing.groupA, ...data.pairing.groupB].sort();
      if (all.join(',') !== '1,2,3,4') {
        throw new Error('LP pairing error: each LP (1-4) must be assigned exactly once.');
      }
    }

    // Read beam parameters
    switch (configType) {
      case 'spreader-beam':
        data.beamLength = parseRequiredFloat('spreader-beam-length', 'Beam Length');
        data.orientation = document.getElementById('spreader-orientation').value;
        break;
      case 'stinger':
        data.topSlingLength = parseFloat(document.getElementById('stinger-top-length').value) || 1;
        if (data.topSlingLength <= 0) {
          throw new Error('Top sling length must be greater than 0. For no stinger, use the 4-Sling Direct configuration.');
        }
        break;
      case 'lifting-beam':
        data.beamLength = parseRequiredFloat('liftbeam-length', 'Beam Length');
        data.orientation = document.getElementById('liftbeam-orientation').value;
        break;
      case 'double-parallel':
        data.beamLengthA = parseRequiredFloat('dpar-beam-length-a', 'Beam A Length');
        data.beamLengthB = parseRequiredFloat('dpar-beam-length-b', 'Beam B Length');
        data.orientationA = document.getElementById('dpar-orientation-a').value;
        data.orientationB = document.getElementById('dpar-orientation-b').value;
        data.bottomSlingLen = parseFloat(document.getElementById('dpar-bottom-sling-len').value) || 2;
        break;
      case 'double-cascade':
        data.masterLength = parseRequiredFloat('dcas-master-length', 'Master Beam Length');
        data.slaveLengthA = parseRequiredFloat('dcas-slave-length-a', 'Slave Beam A Length');
        data.slaveLengthB = parseRequiredFloat('dcas-slave-length-b', 'Slave Beam B Length');
        data.masterOrientation = document.getElementById('dcas-master-orientation').value;
        data.bottomSlingLen = parseFloat(document.getElementById('dcas-bottom-sling-len').value) || 2;
        const dcasMidAngle = parseFloat(document.getElementById('dcas-middle-angle').value);
        if (!isNaN(dcasMidAngle)) {
          if (dcasMidAngle < 30 || dcasMidAngle >= 90)
            throw new Error('Middle Lay Angle must be between 30° and 90°.');
          data.middleAngleDeg = dcasMidAngle;
        }
        const dcasTopAngle = parseFloat(document.getElementById('dcas-top-angle').value);
        if (!isNaN(dcasTopAngle)) {
          if (dcasTopAngle < 30 || dcasTopAngle >= 90)
            throw new Error('Top Lay Angle must be between 30° and 90°.');
          data.topAngleDeg = dcasTopAngle;
        }
        break;
    }

    return data;
  }

  function getPairingPrefix(configType) {
    const map = {
      'spreader-beam': 'spreader',
      'stinger': 'stinger',
      'lifting-beam': 'liftbeam',
      'double-parallel': 'dpar',
      'double-cascade': 'dcas'
    };
    return map[configType] || null;
  }

  function displayOutput(r) {
    const dp = currentUnit === 'ft' ? 2 : 3;
    const resUnit = currentUnit === 'ft' ? 'ft' : 'm';
    const resLoadUnit = currentUnit === 'ft' ? 'US t' : 't';

    document.getElementById('res-hook-height').textContent = r.hookHeight.toFixed(dp);
    document.getElementById('res-headroom').textContent = r.headroom.toFixed(dp);
    document.getElementById('res-height-above-cog').textContent = r.heightAboveCOG.toFixed(dp);
    document.getElementById('res-total-load').textContent = r.totalLoad.toFixed(2);

    // Critical sling label
    let criticalText;
    if (r.tiers.length === 1) {
      criticalText = 'Sling ' + r.criticalSling.id;
    } else {
      const tierLabel = r.criticalSling.tier.charAt(0).toUpperCase() + r.criticalSling.tier.slice(1);
      criticalText = tierLabel + ' Sling ' + r.criticalSling.id;
    }
    document.getElementById('res-critical').textContent = criticalText;

    // Build sling tables per tier
    const container = document.getElementById('sling-tables-container');
    container.textContent = '';

    r.tiers.forEach(tier => {
      if (r.tiers.length > 1) {
        const heading = document.createElement('h3');
        heading.textContent = tier.name;
        heading.style.cssText = 'color: var(--primary-light); margin: 1rem 0 0.5rem; font-size: 1rem;';
        container.appendChild(heading);
      }

      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';

      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Sling', 'From / To', 'Length (' + resUnit + ')', 'Angle (horiz / vert)',
       'H. Dist (' + resUnit + ')', 'V. Dist (' + resUnit + ')',
       'Tension (' + resLoadUnit + ')', 'V. Load (' + resLoadUnit + ')', 'Status'].forEach((text, idx) => {
        const th = document.createElement('th');
        th.textContent = text;
        if (idx === 1) th.style.textAlign = 'left';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      tier.slings.forEach(s => {
        const tr = document.createElement('tr');
        if (s.isCritical) tr.classList.add('critical-row');

        const cells = [
          s.id,
          s.from.label + ' \u2192 ' + s.to.label,
          s.length.toFixed(dp),
          s.angleDegFromHoriz.toFixed(1) + '\u00B0 / ' + s.angleDegFromVert.toFixed(1) + '\u00B0',
          s.horizontalDist.toFixed(dp),
          s.verticalDist.toFixed(dp),
          s.tension.toFixed(dp),
          s.verticalLoad.toFixed(dp),
          s.isCritical ? 'CRITICAL' : ''
        ];
        cells.forEach((text, idx) => {
          const td = document.createElement('td');
          td.textContent = text;
          if (idx === 1) { td.style.textAlign = 'left'; td.style.fontSize = '0.8rem'; }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
    });

    // Vertical load check — bottom tier only
    const bottomVLoad = r.tiers[0].slings.reduce((sum, s) => sum + s.verticalLoad, 0);
    document.getElementById('res-vload-check').textContent = bottomVLoad.toFixed(dp);

    // Beam details
    const beamContainer = document.getElementById('beam-details-container');
    if (r.beams.length > 0) {
      beamContainer.style.display = '';
      beamContainer.textContent = '';
      const beamHeading = document.createElement('h2');
      beamHeading.textContent = 'Beam Details';
      beamContainer.appendChild(beamHeading);
      r.beams.forEach(b => {
        const div = document.createElement('div');
        div.style.marginBottom = '0.75rem';
        const lines = [
          b.name + ' \u2014 Length: ' + b.length.toFixed(dp) + ' ' + resUnit,
          'End A: (' + b.endA.x.toFixed(dp) + ', ' + b.endA.y.toFixed(dp) + ', ' + b.endA.z.toFixed(dp) + ') ' + resUnit,
          'End B: (' + b.endB.x.toFixed(dp) + ', ' + b.endB.y.toFixed(dp) + ', ' + b.endB.z.toFixed(dp) + ') ' + resUnit
        ];
        if (b.pickupPoint) {
          lines.push('Pickup: (' + b.pickupPoint.x.toFixed(dp) + ', ' + b.pickupPoint.y.toFixed(dp) + ', ' + b.pickupPoint.z.toFixed(dp) + ') ' + resUnit);
        }
        lines.forEach((line, i) => {
          if (i === 0) {
            const strong = document.createElement('strong');
            strong.textContent = line;
            div.appendChild(strong);
          } else {
            div.appendChild(document.createElement('br'));
            div.appendChild(document.createTextNode(line));
          }
        });
        beamContainer.appendChild(div);
      });
    } else {
      beamContainer.style.display = 'none';
    }

    // Intermediate points
    const ipContainer = document.getElementById('intermediate-points-container');
    if (r.intermediatePoints.length > 0) {
      ipContainer.style.display = '';
      ipContainer.textContent = '';
      const ipHeading = document.createElement('h2');
      ipHeading.textContent = 'Intermediate Points';
      ipContainer.appendChild(ipHeading);
      r.intermediatePoints.forEach(p => {
        const div = document.createElement('div');
        div.textContent = p.label + ': (' + p.x.toFixed(dp) + ', ' + p.y.toFixed(dp) + ', ' + p.z.toFixed(dp) + ') ' + resUnit;
        ipContainer.appendChild(div);
      });
    } else {
      ipContainer.style.display = 'none';
    }

    renderLoadSharingCard(r, dp, resLoadUnit);
    renderSlackLegCard(r, dp, resLoadUnit);
  }

  function renderLoadSharingCard(r, dp, resLoadUnit) {
    const card = document.getElementById('load-sharing-container');
    const desc = document.getElementById('load-sharing-desc');
    const content = document.getElementById('load-sharing-content');
    if (!card) return;
    content.textContent = '';

    const lsa = r.loadSharingAnalysis;
    if (!lsa) { card.style.display = 'none'; return; }
    card.style.display = '';

    const modeLabel = {
      'theoretical': 'Theoretical (no tolerance)',
      'pct2_5': '±2.5% length (matched/measured slings)',
      'pct12_5': '±12.5% length (unmatched/site-modified)'
    }[lsa.toleranceMode] || lsa.toleranceMode;

    desc.textContent = `Mode: ${modeLabel}. Source: ${lsa.source}.`;

    if (!lsa.applicable) {
      const note = document.createElement('div');
      note.style.cssText = 'margin: 0.5rem 0; padding: 0.6rem 0.8rem; background: rgba(255,200,0,0.10); border-left: 3px solid var(--warning, #c98); border-radius: 4px;';
      note.textContent = lsa.note || 'Tolerance factor not applicable for this configuration / mode.';
      content.appendChild(note);
      return;
    }

    const factorPct = ((lsa.factor - 1) * 100).toFixed(0);
    const headline = document.createElement('div');
    headline.style.cssText = 'margin: 0.5rem 0 0.75rem; padding: 0.6rem 0.8rem; background: rgba(255,200,0,0.10); border-left: 3px solid var(--danger); border-radius: 4px;';

    const wcStrong = document.createElement('strong');
    wcStrong.textContent = 'Design max-leg tension (bottom tier): ';
    headline.appendChild(wcStrong);
    const tStrong = document.createElement('strong');
    tStrong.textContent = `${lsa.adjustedMaxTension.toFixed(dp)} ${resLoadUnit}`;
    headline.appendChild(tStrong);

    if (lsa.factor !== 1.0) {
      const span = document.createElement('span');
      span.style.opacity = '0.75';
      span.textContent = ` (${lsa.factor.toFixed(2)}× theoretical ${lsa.baseMaxTension.toFixed(dp)} ${resLoadUnit}, +${factorPct}%)`;
      headline.appendChild(span);
    }
    content.appendChild(headline);

    const cite = document.createElement('p');
    cite.style.cssText = 'margin: 0.4rem 0 0; font-size: 0.85em; opacity: 0.8;';
    cite.textContent = 'Factor based on Nobles "Lifting the Bar" Edition 2 — empirical crane-scale measurements on a 4-leg sling lifting a symmetric load with one leg shortened. Tolerance is expressed as a proportion of sling length because load-share degradation scales with Δ/L, not absolute mm. Applies to the load-attached (bottom-tier) slings only; top slings above a spreader/stinger are statically determinate 2-leg geometry and unaffected.';
    content.appendChild(cite);
  }

  function renderSlackLegCard(r, dp, resLoadUnit) {
    const card = document.getElementById('slack-leg-container');
    const desc = document.getElementById('slack-leg-desc');
    const content = document.getElementById('slack-leg-content');
    if (!card) return;
    content.textContent = '';

    const sla = r.slackLegAnalysis;
    if (!sla) { card.style.display = 'none'; return; }

    card.style.display = '';

    if (!sla.applicable) {
      desc.textContent = sla.reason || 'Not applicable.';
      return;
    }

    const slings = r.tiers[0].slings;
    desc.textContent = `Limiting case (one leg fully unloaded). Each sling assumed slack in turn; load redistributed across the remaining ${slings.length - 1} slings via least-squares.`;

    const wc = sla.worstCase;
    const headline = document.createElement('div');
    headline.style.cssText = 'margin: 0.5rem 0 0.75rem; padding: 0.6rem 0.8rem; background: rgba(255, 200, 0, 0.10); border-left: 3px solid var(--danger); border-radius: 4px;';
    const pctSign = wc.percentOverBase >= 0 ? '+' : '';

    const wcStrong = document.createElement('strong');
    wcStrong.textContent = 'Worst case: ';
    headline.appendChild(wcStrong);
    headline.appendChild(document.createTextNode(`Sling ${wc.criticalSlingId} reaches `));
    const tStrong = document.createElement('strong');
    tStrong.textContent = `${wc.maxTension.toFixed(dp)} ${resLoadUnit}`;
    headline.appendChild(tStrong);
    headline.appendChild(document.createTextNode(` when Sling ${wc.slackSlingId} is slack `));
    const span = document.createElement('span');
    span.style.opacity = '0.75';
    span.textContent = `(${pctSign}${wc.percentOverBase.toFixed(1)}% over base critical ${sla.baseMaxTension.toFixed(dp)} ${resLoadUnit})`;
    headline.appendChild(span);
    content.appendChild(headline);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Slack Sling'];
    slings.forEach(s => headers.push(`T${s.id} (${resLoadUnit})`));
    headers.push('Max', 'Critical', 'Status');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sla.scenarios.forEach(sc => {
      const tr = document.createElement('tr');
      if (sc.slackSlingId === wc.slackSlingId) tr.classList.add('critical-row');
      const cells = [`Sling ${sc.slackSlingId}`];
      sc.tensions.forEach((t, idx) => {
        cells.push((idx + 1) === sc.slackSlingId ? '—' : t.toFixed(dp));
      });
      cells.push(sc.maxTension.toFixed(dp));
      cells.push(`Sling ${sc.criticalSlingId}`);
      cells.push(sc.infeasible ? 'check geometry' : 'OK');
      cells.forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    content.appendChild(wrap);
  }

  function displayWarnings(warnings) {
    let warningDiv = document.getElementById('calc-warnings');
    if (!warningDiv) {
      warningDiv = document.createElement('div');
      warningDiv.id = 'calc-warnings';
      const resultsFirst = resultsSection.querySelector('.card');
      if (resultsFirst) resultsSection.insertBefore(warningDiv, resultsFirst);
      else resultsSection.appendChild(warningDiv);
    }
    warningDiv.innerHTML = '';

    if (!warnings) return;

    const msgs = [];
    if (warnings.cogOutsidePolygon) {
      msgs.push('COG is outside the lifting point polygon — load distribution results may be unreliable. Verify COG position.');
    }
    if (warnings.negativeTension) {
      msgs.push('One or more sling tensions are negative — this is physically impossible and indicates the COG position or LP geometry may be incorrect.');
    }
    if (warnings.topSlingAngleLow) {
      msgs.push('One or more top sling angles are below 30\u00B0 from horizontal — this increases sling tension significantly. Consider increasing the beam length or revising the geometry.');
    }
    if (warnings.bottomAngleLow) {
      msgs.push('One or more bottom sling angles are below the specified minimum angle. Increase the top sling length or revise the geometry.');
    }
    if (warnings.mainBeamTooShort) {
      msgs.push('Main beam is shorter than the required pick-point span — the beam has been drawn at the minimum span needed to reach both pick points. Specify a longer main beam.');
    }
    if (warnings.subCogFallback) {
      msgs.push('A lifting point returned a negative load share (the COG is outside the support “kern” of the lifting points), so a spreader pick was clamped to the loaded side. The load distribution and rig geometry for this configuration are UNRELIABLE, and a top-sling tension may hide a slack/compression (negative) leg. Verify the COG and lifting-point positions.');
    }
    if (warnings.liftBeamBendingNotChecked) {
      msgs.push('Lifting beam bending capacity has NOT been checked — verify the beam can safely support the calculated loads and span.');
    }
    if (warnings.beamEquilibriumNotConverged) {
      msgs.push('A spreader beam did not reach a balanced hanging position — the rig geometry for this configuration is UNRELIABLE. Verify the beam length, lifting-point positions, and COG.');
    }
    if (warnings.minAngleBelowAmber) {
      msgs.push({ text: 'Minimum sling angle is below 45\u00B0', amber: true });
    }

    if (msgs.length === 0) return;

    for (const m of msgs) {
      const div = document.createElement('div');
      div.className = typeof m === 'object' && m.amber ? 'warning-msg warning-amber' : 'warning-msg';
      div.textContent = typeof m === 'object' ? m.text : m;
      warningDiv.appendChild(div);
    }
  }

  // --- Save / Load ---

  function getSavedConfigs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  function saveConfig() {
    const name = prompt('Configuration name:');
    if (!name) return;

    const configs = getSavedConfigs();
    const formData = {};
    const fields = ['lp1-x','lp1-y','lp1-z','lp2-x','lp2-y','lp2-z',
                     'lp3-x','lp3-y','lp3-z','lp4-x','lp4-y','lp4-z',
                     'cog-x','cog-y','cog-z','total-load','min-angle'];
    fields.forEach(id => { formData[id] = document.getElementById(id).value; });
    formData._unit = currentUnit;
    formData._configType = currentConfig;

    // Save config-specific inputs
    if (currentConfig !== 'direct') {
      const panel = document.getElementById('panel-' + currentConfig);
      if (panel) {
        panel.querySelectorAll('input, select').forEach(el => {
          if (el.id) formData[el.id] = el.value;
        });
      }
    }

    configs[name] = formData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    refreshSavedList();
  }

  function loadConfig(name) {
    const configs = getSavedConfigs();
    const data = configs[name];
    if (!data) return;

    // Switch to saved unit first
    if (data._unit && data._unit !== currentUnit) {
      currentUnit = data._unit;
      unitSelect.value = currentUnit;
      updateUnitLabels();
    }

    // Restore config type and switch panels
    const configType = data._configType || 'direct';
    currentConfig = configType;
    configSelect.value = configType;
    document.querySelectorAll('.config-panel').forEach(p => p.style.display = 'none');
    if (configType !== 'direct') {
      const panel = document.getElementById('panel-' + configType);
      if (panel) panel.style.display = '';
    }

    Object.entries(data).forEach(([id, val]) => {
      if (id.startsWith('_')) return;
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
  }

  function deleteConfig(name) {
    if (!confirm(`Delete saved config "${name}"?`)) return;
    const configs = getSavedConfigs();
    delete configs[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    refreshSavedList();
  }

  function refreshSavedList() {
    const configs = getSavedConfigs();
    loadSelect.innerHTML = '<option value="">— Load Saved —</option>';
    Object.keys(configs).sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      loadSelect.appendChild(opt);
    });
  }
});
