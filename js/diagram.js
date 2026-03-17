/**
 * Sling Length Calculator — 2D SVG Diagrams for Print/PDF
 * Generates plan view (top-down) and elevation view (side) with dimensions.
 */

const SlingDiagram = (() => {
  const COLORS = {
    critical: '#e74c3c',
    normal: '#27ae60',
    lp: '#2980b9',
    cog: '#e67e22',
    hook: '#2c3e50',
    load: '#3498db',
    dim: '#8e44ad',
    grid: '#ddd',
    text: '#2c3e50'
  };

  /**
   * Render both plan and elevation SVG diagrams.
   * @param {object} results - from SlingCalc.calculate()
   * @param {{x,y,z}} cog
   * @param {string} planContainerId
   * @param {string} elevContainerId
   * @param {string} unit - 'm' or 'ft'
   */
  function render(results, cog, planContainerId, elevContainerId, unit = 'm') {
    renderPlanView(results, cog, planContainerId, unit);
    renderElevationView(results, cog, elevContainerId, unit);
  }

  function renderPlanView(results, cog, containerId, unit) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const { hook, slings } = results;
    const lps = slings.map(s => s.liftingPoint);

    // Compute bounds
    const allX = [...lps.map(p => p.x), cog.x, hook.x];
    const allY = [...lps.map(p => p.y), cog.y, hook.y];
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const pad = 60;
    const w = 500, h = 400;
    const scaleX = (w - pad * 2) / rangeX;
    const scaleY = (h - pad * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const cx = w / 2, cy = h / 2;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

    const tx = (x) => cx + (x - midX) * scale;
    const ty = (y) => cy - (y - midY) * scale; // flip Y

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">`;

    // Title
    svg += `<text x="${w/2}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="${COLORS.text}">Plan View (Top Down)</text>`;

    // Load outline
    svg += `<polygon points="${lps.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ')}" fill="${COLORS.load}" fill-opacity="0.1" stroke="${COLORS.load}" stroke-width="1.5"/>`;

    // Sling lines (projected horizontal)
    slings.forEach(s => {
      const lp = s.liftingPoint;
      const color = s.isCritical ? COLORS.critical : COLORS.normal;
      svg += `<line x1="${tx(hook.x)}" y1="${ty(hook.y)}" x2="${tx(lp.x)}" y2="${ty(lp.y)}" stroke="${color}" stroke-width="2" stroke-dasharray="6,3"/>`;

      // H. dist label at midpoint
      const mx = (tx(hook.x) + tx(lp.x)) / 2;
      const my = (ty(hook.y) + ty(lp.y)) / 2;
      svg += `<text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="10" fill="${color}" font-weight="600">${s.horizontalDist.toFixed(2)}${unit}</text>`;
    });

    // Lifting points
    lps.forEach((lp, i) => {
      svg += `<circle cx="${tx(lp.x)}" cy="${ty(lp.y)}" r="6" fill="${COLORS.lp}" stroke="white" stroke-width="1.5"/>`;
      svg += `<text x="${tx(lp.x)}" y="${ty(lp.y) - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="${COLORS.lp}">LP${i+1}</text>`;
      svg += `<text x="${tx(lp.x)}" y="${ty(lp.y) + 18}" text-anchor="middle" font-size="9" fill="${COLORS.text}">(${lp.x}, ${lp.y})</text>`;
    });

    // COG
    const cogSz = 6;
    svg += `<polygon points="${tx(cog.x)},${ty(cog.y)-cogSz} ${tx(cog.x)+cogSz},${ty(cog.y)} ${tx(cog.x)},${ty(cog.y)+cogSz} ${tx(cog.x)-cogSz},${ty(cog.y)}" fill="${COLORS.cog}" stroke="white" stroke-width="1"/>`;
    svg += `<text x="${tx(cog.x)}" y="${ty(cog.y) - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.cog}">COG</text>`;

    // Hook (same X,Y as COG in plan view — draw as crosshair)
    const hx = tx(hook.x), hy = ty(hook.y);
    svg += `<circle cx="${hx}" cy="${hy}" r="8" fill="none" stroke="${COLORS.hook}" stroke-width="1.5"/>`;
    svg += `<line x1="${hx-10}" y1="${hy}" x2="${hx+10}" y2="${hy}" stroke="${COLORS.hook}" stroke-width="1"/>`;
    svg += `<line x1="${hx}" y1="${hy-10}" x2="${hx}" y2="${hy+10}" stroke="${COLORS.hook}" stroke-width="1"/>`;

    // Legend
    svg += `<text x="10" y="${h-30}" font-size="9" fill="${COLORS.text}">Hook: crosshair at COG position</text>`;
    svg += `<text x="10" y="${h-18}" font-size="9" fill="${COLORS.text}">Dashed lines: horizontal sling projection</text>`;
    svg += `<line x1="10" y1="${h-8}" x2="30" y2="${h-8}" stroke="${COLORS.critical}" stroke-width="2"/>`;
    svg += `<text x="34" y="${h-4}" font-size="9" fill="${COLORS.critical}">Critical</text>`;
    svg += `<line x1="80" y1="${h-8}" x2="100" y2="${h-8}" stroke="${COLORS.normal}" stroke-width="2"/>`;
    svg += `<text x="104" y="${h-4}" font-size="9" fill="${COLORS.normal}">Normal</text>`;

    svg += `</svg>`;
    el.innerHTML = svg;
  }

  function renderElevationView(results, cog, containerId, unit) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const { hook, slings, headroom } = results;
    const lps = slings.map(s => s.liftingPoint);

    // For elevation, project onto a vertical plane through the hook
    // Use the widest horizontal spread direction
    // X-axis = horizontal distance from hook (signed), Y-axis = Z (height)
    const elevPts = lps.map((lp, i) => {
      const dx = lp.x - hook.x;
      const dy = lp.y - hook.y;
      const hDist = Math.sqrt(dx * dx + dy * dy);
      // Sign: use angle to keep left/right separation
      const angle = Math.atan2(dy, dx);
      const signedH = angle > 0 ? -hDist : hDist;
      return { h: signedH, z: lp.z, idx: i };
    });

    // Sort by horizontal position for consistent layout
    elevPts.sort((a, b) => a.h - b.h);

    const allH = elevPts.map(p => p.h);
    const allZ = [...elevPts.map(p => p.z), hook.z, hook.z + 1];
    const minH = Math.min(...allH, 0), maxH = Math.max(...allH, 0);
    const minZ = Math.min(...allZ, 0), maxZ = Math.max(...allZ);
    const rangeH = maxH - minH || 1;
    const rangeZ = maxZ - minZ || 1;

    const pad = 60;
    const w = 500, h = 400;
    const scaleH = (w - pad * 2) / rangeH;
    const scaleZ = (h - pad * 2) / rangeZ;
    const scale = Math.min(scaleH, scaleZ);

    const cx = w / 2, cy = h - pad;
    const midH = (minH + maxH) / 2;

    const tx = (hVal) => cx + (hVal - midH) * scale;
    const ty = (zVal) => cy - (zVal - minZ) * scale;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">`;

    // Title
    svg += `<text x="${w/2}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="${COLORS.text}">Elevation View (Side)</text>`;

    // Ground line
    svg += `<line x1="20" y1="${ty(0)}" x2="${w-20}" y2="${ty(0)}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="4,4"/>`;
    svg += `<text x="${w-18}" y="${ty(0)+14}" text-anchor="end" font-size="9" fill="${COLORS.grid}">Ground</text>`;

    // Hook
    const hookX = tx(0), hookY = ty(hook.z);
    svg += `<rect x="${hookX-8}" y="${hookY-6}" width="16" height="12" rx="2" fill="${COLORS.hook}"/>`;
    svg += `<text x="${hookX}" y="${hookY - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.hook}">HOOK</text>`;

    // Crane wire above hook
    svg += `<line x1="${hookX}" y1="${hookY - 6}" x2="${hookX}" y2="${ty(hook.z + 2)}" stroke="${COLORS.hook}" stroke-width="1.5" stroke-dasharray="4,3"/>`;

    // Sling lines from hook to each LP (elevation)
    elevPts.forEach(ep => {
      const s = slings[ep.idx];
      const color = s.isCritical ? COLORS.critical : COLORS.normal;
      const lpX = tx(ep.h), lpY = ty(ep.z);

      // Sling line
      svg += `<line x1="${hookX}" y1="${hookY}" x2="${lpX}" y2="${lpY}" stroke="${color}" stroke-width="2"/>`;

      // LP marker
      svg += `<circle cx="${lpX}" cy="${lpY}" r="5" fill="${COLORS.lp}" stroke="white" stroke-width="1"/>`;
      svg += `<text x="${lpX}" y="${lpY + 16}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.lp}">LP${ep.idx + 1}</text>`;

      // Sling length + angle label
      const mx = (hookX + lpX) / 2;
      const my = (hookY + lpY) / 2;
      const offset = ep.h < 0 ? -8 : 8;
      const anchor = ep.h < 0 ? 'end' : 'start';
      svg += `<text x="${mx + offset}" y="${my}" text-anchor="${anchor}" font-size="9" font-weight="600" fill="${color}">${s.length.toFixed(2)}${unit}</text>`;
      svg += `<text x="${mx + offset}" y="${my + 11}" text-anchor="${anchor}" font-size="9" fill="${color}">${s.angleDegFromHoriz.toFixed(1)}°</text>`;
      svg += `<text x="${mx + offset}" y="${my + 22}" text-anchor="${anchor}" font-size="9" fill="${color}">${s.tension.toFixed(2)}${unit === 'ft' ? 'US t' : 't'}</text>`;

      // Angle arc
      const arcR = 25;
      const angleRad = Math.atan2(hook.z - ep.z, Math.abs(ep.h));
      const endArcX = lpX + (ep.h < 0 ? -arcR : arcR);
      const endArcY = lpY;
      const midArcX = lpX + Math.cos(angleRad) * arcR * (ep.h < 0 ? -1 : 1);
      const midArcY = lpY - Math.sin(angleRad) * arcR;
      svg += `<path d="M ${endArcX} ${endArcY} A ${arcR} ${arcR} 0 0 ${ep.h < 0 ? 0 : 1} ${midArcX} ${midArcY}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="2,2"/>`;
    });

    // Headroom dimension (right side)
    const maxLPz = Math.max(...lps.map(p => p.z));
    const dimX = tx(maxH) + 40;
    if (headroom > 0.01) {
      const y1 = ty(maxLPz), y2 = ty(hook.z);
      svg += `<line x1="${dimX}" y1="${y1}" x2="${dimX}" y2="${y2}" stroke="${COLORS.dim}" stroke-width="1.5"/>`;
      svg += `<line x1="${dimX-5}" y1="${y1}" x2="${dimX+5}" y2="${y1}" stroke="${COLORS.dim}" stroke-width="1.5"/>`;
      svg += `<line x1="${dimX-5}" y1="${y2}" x2="${dimX+5}" y2="${y2}" stroke="${COLORS.dim}" stroke-width="1.5"/>`;
      // Arrow heads
      svg += `<polygon points="${dimX},${y2+1} ${dimX-3},${y2+7} ${dimX+3},${y2+7}" fill="${COLORS.dim}"/>`;
      svg += `<polygon points="${dimX},${y1-1} ${dimX-3},${y1-7} ${dimX+3},${y1-7}" fill="${COLORS.dim}"/>`;
      svg += `<text x="${dimX + 8}" y="${(y1+y2)/2 + 4}" font-size="10" font-weight="600" fill="${COLORS.dim}">${headroom.toFixed(2)}${unit}</text>`;
      svg += `<text x="${dimX + 8}" y="${(y1+y2)/2 + 16}" font-size="9" fill="${COLORS.dim}">Headroom</text>`;
    }

    // Hook height dimension (left side)
    const dimXL = tx(minH) - 40;
    const y1h = ty(0), y2h = ty(hook.z);
    svg += `<line x1="${dimXL}" y1="${y1h}" x2="${dimXL}" y2="${y2h}" stroke="${COLORS.hook}" stroke-width="1" stroke-dasharray="3,3"/>`;
    svg += `<line x1="${dimXL-5}" y1="${y1h}" x2="${dimXL+5}" y2="${y1h}" stroke="${COLORS.hook}" stroke-width="1"/>`;
    svg += `<line x1="${dimXL-5}" y1="${y2h}" x2="${dimXL+5}" y2="${y2h}" stroke="${COLORS.hook}" stroke-width="1"/>`;
    svg += `<text x="${dimXL - 8}" y="${(y1h+y2h)/2 + 4}" text-anchor="end" font-size="10" font-weight="600" fill="${COLORS.hook}">${results.hookHeight.toFixed(2)}${unit}</text>`;
    svg += `<text x="${dimXL - 8}" y="${(y1h+y2h)/2 + 16}" text-anchor="end" font-size="9" fill="${COLORS.hook}">Hook Ht</text>`;

    svg += `</svg>`;
    el.innerHTML = svg;
  }

  return { render };
})();
