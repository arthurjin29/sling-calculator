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
  let currentUnit = 'm';
  let lastResults = null;
  let lastCog = null;

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
        calcInputs.liftingPoints,
        calcInputs.cog,
        calcInputs.minAngle,
        calcInputs.totalLoad
      );

      // Convert results back to display units
      const displayResults = currentUnit === 'ft' ? convertResultsToImperial(results) : results;

      displayOutput(displayResults);
      displayWarnings(results.warnings);

      lastResults = displayResults;
      lastCog = currentUnit === 'ft' ? convertPointToImperial(calcInputs.cog) : calcInputs.cog;

      // 2D diagrams + overlay
      refreshDiagrams();

      // 3D scene with display units for labels
      if (typeof SlingScene !== 'undefined') {
        const sceneUnits = currentUnit === 'ft'
          ? { length: 'ft', load: 'US t' }
          : { length: 'm', load: 't' };
        SlingScene.update(displayResults, lastCog, sceneUnits);
      }

      resultsSection.style.display = 'block';
      resultsSection.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    }
  }

  function convertToMetric(inputs) {
    const conv = (p) => ({ x: p.x / M_TO_FT, y: p.y / M_TO_FT, z: p.z / M_TO_FT });
    return {
      liftingPoints: inputs.liftingPoints.map(conv),
      cog: conv(inputs.cog),
      totalLoad: inputs.totalLoad / T_TO_USTON,
      minAngle: inputs.minAngle
    };
  }

  function convertResultsToImperial(r) {
    return {
      ...r,
      hookHeight: r.hookHeight * M_TO_FT,
      headroom: r.headroom * M_TO_FT,
      heightAboveCOG: r.heightAboveCOG * M_TO_FT,
      totalLoad: r.totalLoad * T_TO_USTON,
      hook: convertPointToImperial(r.hook),
      slings: r.slings.map(s => ({
        ...s,
        length: s.length * M_TO_FT,
        horizontalDist: s.horizontalDist * M_TO_FT,
        verticalDist: s.verticalDist * M_TO_FT,
        tension: s.tension * T_TO_USTON,
        verticalLoad: s.verticalLoad * T_TO_USTON,
        liftingPoint: convertPointToImperial(s.liftingPoint)
      }))
    };
  }

  function convertPointToImperial(p) {
    return { x: p.x * M_TO_FT, y: p.y * M_TO_FT, z: p.z * M_TO_FT };
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

    const minAngle = parseRequiredFloat('min-angle', 'Min Sling Angle');
    if (minAngle <= 0 || minAngle >= 90) {
      throw new Error('Minimum sling angle must be between 0° and 90° (exclusive).');
    }

    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = liftingPoints[i], b = liftingPoints[j];
        if (a.x === b.x && a.y === b.y && a.z === b.z) {
          throw new Error(`LP${i+1} and LP${j+1} are at the same position.`);
        }
      }
    }

    return { liftingPoints, cog, totalLoad, minAngle };
  }

  function parseRequiredFloat(id, label) {
    const el = document.getElementById(id);
    const val = parseFloat(el.value);
    if (isNaN(val)) throw new Error(`${label} is required and must be a number.`);
    return val;
  }

  function displayOutput(r) {
    const dp = currentUnit === 'ft' ? 2 : 3;

    document.getElementById('res-hook-height').textContent = r.hookHeight.toFixed(dp);
    document.getElementById('res-headroom').textContent = r.headroom.toFixed(dp);
    document.getElementById('res-height-above-cog').textContent = r.heightAboveCOG.toFixed(dp);
    document.getElementById('res-total-load').textContent = r.totalLoad.toFixed(2);
    document.getElementById('res-critical').textContent = `Sling ${r.criticalSlingId}`;

    const tbody = document.getElementById('sling-table-body');
    tbody.innerHTML = '';

    r.slings.forEach(s => {
      const tr = document.createElement('tr');
      if (s.isCritical) tr.classList.add('critical-row');

      tr.innerHTML = `
        <td>${s.id}</td>
        <td>${s.length.toFixed(dp)}</td>
        <td>${s.angleDegFromHoriz.toFixed(1)}° / ${s.angleDegFromVert.toFixed(1)}°</td>
        <td>${s.horizontalDist.toFixed(dp)}</td>
        <td>${s.verticalDist.toFixed(dp)}</td>
        <td>${s.tension.toFixed(dp)}</td>
        <td>${s.verticalLoad.toFixed(dp)}</td>
        <td>${s.isCritical ? 'CRITICAL' : ''}</td>
      `;
      tbody.appendChild(tr);
    });

    const vSum = r.slings.reduce((sum, s) => sum + s.verticalLoad, 0);
    document.getElementById('res-vload-check').textContent = vSum.toFixed(dp);
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

    if (msgs.length === 0) return;

    warningDiv.innerHTML = msgs.map(m =>
      `<div class="warning-msg">${m}</div>`
    ).join('');
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
