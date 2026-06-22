/**
 * Simple mode controller — reads the 2-pick inputs, computes a direct estimate,
 * renders the elevation sketch + results, and keeps inputs ↔ sketch in two-way sync.
 */
document.addEventListener('DOMContentLoaded', () => {
  const ids = ['weight', 'loadw', 'loadh', 'cogleft', 'cogbottom',
               'lp1left', 'lp1bottom', 'lp2left', 'lp2bottom', 'headroom'];
  const $ = (id) => document.getElementById('sm-' + id);
  const sketchHost = document.getElementById('sm-sketch');
  const resultsEl = document.getElementById('sm-results');
  if (!sketchHost || typeof CalcSimple === 'undefined' || typeof Sketch2D === 'undefined') return;

  // LP1/LP2/COG ride the load-box corners/centre until the user drags or types them.
  const touched = { lp1: false, lp2: false, cog: false };
  function reseed() {
    const w = +$('loadw').value, h = +$('loadh').value;
    if (!touched.lp1) { $('lp1left').value = 0; $('lp1bottom').value = round1(h); }
    if (!touched.lp2) { $('lp2left').value = round1(w); $('lp2bottom').value = round1(h); }
    if (!touched.cog) { $('cogleft').value = round1(w / 2); $('cogbottom').value = round1(h / 2); }
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // LPs and COG must stay within the load rectangle [0,W] x [0,H].
  function clampAll() {
    const w = +$('loadw').value, h = +$('loadh').value;
    $('lp1left').value = round1(clamp(+$('lp1left').value, 0, w));
    $('lp1bottom').value = round1(clamp(+$('lp1bottom').value, 0, h));
    $('lp2left').value = round1(clamp(+$('lp2left').value, 0, w));
    $('lp2bottom').value = round1(clamp(+$('lp2bottom').value, 0, h));
    $('cogleft').value = round1(clamp(+$('cogleft').value, 0, w));
    $('cogbottom').value = round1(clamp(+$('cogbottom').value, 0, h));
  }

  function readState() {
    const cfgEl = document.getElementById('sm-config');
    return {
      config: cfgEl ? cfgEl.value : 'direct',
      weight: +$('weight').value, loadW: +$('loadw').value, loadH: +$('loadh').value,
      cogLeft: +$('cogleft').value, cogBottom: +$('cogbottom').value,
      lp1Left: +$('lp1left').value, lp1Bottom: +$('lp1bottom').value,
      lp2FromLp1: (+$('lp2left').value) - (+$('lp1left').value), lp2Bottom: +$('lp2bottom').value,
      headroom: +$('headroom').value,
      beamLength: +$('beamlen').value, topSlingLength: +$('toplen').value
    };
  }

  function recompute() {
    const s = readState();
    const spreader = s.config === 'spreader-beam';
    const spreaderInputs = document.getElementById('sm-spreader-inputs');
    if (spreaderInputs) spreaderInputs.style.display = spreader ? '' : 'none';
    const r = spreader ? CalcSimple.computeSimpleSpreader(s) : CalcSimple.computeSimpleDirect(s);
    Sketch2D.update(r);
    renderResults(r);
    return r;
  }

  const round1 = (v) => Math.round(v * 10) / 10;

  function onSketchChange({ key, world }) {
    touched[key] = true;
    const w = +$('loadw').value, h = +$('loadh').value;
    const x = clamp(world.x, 0, w), z = clamp(world.z, 0, h);
    if (key === 'cog') {
      $('cogleft').value = round1(x);
      $('cogbottom').value = round1(z);
    } else if (key === 'lp1') {
      $('lp1left').value = round1(x);
      $('lp1bottom').value = round1(z);
    } else if (key === 'lp2') {
      $('lp2left').value = round1(x);
      $('lp2bottom').value = round1(z);
    }
    recompute();
  }

  function renderResults(r) {
    const legs = r.slings;
    const labels = r.config === 'spreader-beam'
      ? ['Top A', 'Top B', 'Bottom LP1', 'Bottom LP2']
      : ['LP1', 'LP2', 'LP3', 'LP4'];
    const maxLen = Math.max(...legs.map(s => s.length));
    const maxT = Math.max(...legs.map(s => s.tension));
    const cls = r.warnings.angleBelowFloor ? 'sm-bad' : r.warnings.angleAmber ? 'sm-amber' : 'sm-ok';
    const headline = r.warnings.degenerate
      ? '⚠ Check the inputs — the pick points coincide or a value is zero.'
      : r.warnings.angleBelowFloor
        ? `⚠ Sling angle ${r.minAngle}° is below the 30° minimum — increase headroom or bring the pick points in.`
        : `Use slings ≈ ${maxLen.toFixed(1)} m · choose ≥ ${maxT.toFixed(1)} t WLL at this angle (min ${r.minAngle}°)`;
    const warn =
      (r.warnings.topSlingTooShort
        ? '<div class="sm-headline sm-bad">⚠ Top sling is shorter than half the beam — lengthen the top slings.</div>' : '') +
      (r.warnings.cogOutsideSpan
        ? '<div class="sm-headline sm-bad">⚠ COG is outside the pick points — the load will swing on lift-off.</div>' : '');

    const rows = legs.map((s, i) =>
      `<tr><td>${labels[i] || ('Leg ' + (i + 1))}</td><td>${s.length.toFixed(2)} m</td>` +
      `<td>${s.angleDegFromHoriz}°</td><td>${s.tension} t</td></tr>`).join('');

    // textContent-safe: all values above are numbers; labels are literals.
    resultsEl.innerHTML =
      `<div class="sm-headline ${cls}">${headline}</div>${warn}` +
      '<table class="sm-legs"><tr><th>Leg</th><th>Length</th><th>Angle</th><th>Tension</th></tr>' +
      rows + '</table>';
  }

  Sketch2D.mount(sketchHost, onSketchChange);
  // Load width/height re-seed the untouched points; LP/COG field edits mark that point touched.
  // Load dims: untouched points follow corners live (input); enforce box bounds once settled (change).
  ['loadw', 'loadh'].forEach(id => {
    $(id).addEventListener('input', () => { reseed(); recompute(); });
    $(id).addEventListener('change', () => { clampAll(); recompute(); });
  });
  // LP/COG fields: live preview on input (marks touched); clamp into the box on change.
  const wirePoint = (key, idList) => idList.forEach(id => {
    $(id).addEventListener('input', () => { touched[key] = true; recompute(); });
    $(id).addEventListener('change', () => { clampAll(); recompute(); });
  });
  wirePoint('lp1', ['lp1left', 'lp1bottom']);
  wirePoint('lp2', ['lp2left', 'lp2bottom']);
  wirePoint('cog', ['cogleft', 'cogbottom']);
  ['weight', 'headroom'].forEach(id => $(id).addEventListener('input', recompute));
  const configSel = document.getElementById('sm-config');
  if (configSel) configSel.addEventListener('change', recompute);
  ['beamlen', 'toplen'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', recompute); });
  recompute();

  // --- Handoff: mirror the 2-pick estimate into the symmetric 4-LP Advanced model ---
  const continueBtn = document.getElementById('sm-continue-3d');
  if (continueBtn) continueBtn.addEventListener('click', () => {
    if (!window.SlingApp || !window.SlingApp.applyAdvancedModel) return;
    const depth = +document.getElementById('sm-depth').value || 2;
    const model = CalcSimple.buildAdvancedModel(readState(), depth);
    window.SlingApp.applyAdvancedModel(model);
  });

  window.SimpleApp = { readState, recompute };
});
