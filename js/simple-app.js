/**
 * Simple mode controller — reads the 2-pick inputs, computes a direct estimate,
 * renders the elevation sketch + results, and keeps inputs ↔ sketch in two-way sync.
 */
document.addEventListener('DOMContentLoaded', () => {
  const ids = ['weight', 'loadw', 'loadh', 'cogleft', 'cogbottom',
               'lp1left', 'lp1bottom', 'lp2from', 'lp2bottom', 'headroom'];
  const $ = (id) => document.getElementById('sm-' + id);
  const sketchHost = document.getElementById('sm-sketch');
  const resultsEl = document.getElementById('sm-results');
  if (!sketchHost || typeof CalcSimple === 'undefined' || typeof Sketch2D === 'undefined') return;

  function readState() {
    return {
      config: 'direct',
      weight: +$('weight').value, loadW: +$('loadw').value, loadH: +$('loadh').value,
      cogLeft: +$('cogleft').value, cogBottom: +$('cogbottom').value,
      lp1Left: +$('lp1left').value, lp1Bottom: +$('lp1bottom').value,
      lp2FromLp1: +$('lp2from').value, lp2Bottom: +$('lp2bottom').value,
      headroom: +$('headroom').value
    };
  }

  function recompute() {
    const r = CalcSimple.computeSimpleDirect(readState());
    Sketch2D.update(r);
    renderResults(r);
    return r;
  }

  const round1 = (v) => Math.round(v * 10) / 10;

  function onSketchChange({ key, world }) {
    if (key === 'cog') {
      $('cogleft').value = round1(world.x);
      $('cogbottom').value = round1(Math.max(world.z, 0));
    } else if (key === 'lp1') {
      $('lp1left').value = round1(world.x);
      $('lp1bottom').value = round1(Math.max(world.z, 0));
    } else if (key === 'lp2') {
      $('lp2from').value = round1(world.x - (+$('lp1left').value));
      $('lp2bottom').value = round1(Math.max(world.z, 0));
    }
    recompute();
  }

  function renderResults(r) {
    const legs = r.slings;
    const labels = ['LP1', 'LP2', 'LP3', 'LP4'];
    const maxLen = Math.max(...legs.map(s => s.length));
    const maxT = Math.max(...legs.map(s => s.tension));
    const cls = r.warnings.angleBelowFloor ? 'sm-bad' : r.warnings.angleAmber ? 'sm-amber' : 'sm-ok';
    const headline = r.warnings.degenerate
      ? '⚠ Check the inputs — the pick points coincide or a value is zero.'
      : r.warnings.angleBelowFloor
        ? `⚠ Sling angle ${r.minAngle}° is below the 30° minimum — increase headroom or bring the pick points in.`
        : `Use slings ≈ ${maxLen.toFixed(1)} m · choose ≥ ${maxT.toFixed(1)} t WLL at this angle (min ${r.minAngle}°)`;
    const warn = r.warnings.cogOutsideSpan
      ? '<div class="sm-headline sm-bad">⚠ COG is outside the pick points — the load will swing on lift-off.</div>'
      : '';

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
  ids.forEach(id => $(id).addEventListener('input', recompute));
  recompute();

  // expose for the (future) 3D handoff
  window.SimpleApp = { readState, recompute };
});
