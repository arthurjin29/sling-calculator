/**
 * Sling Length Calculator — 2D SVG Diagrams for Print/PDF
 * Generates plan view (top-down) and elevation view (side) with dimensions.
 * Supports multi-tier rigging configs (beams, intermediate points).
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
    text: '#2c3e50',
    beam: '#c0392b',
    tierBottom: '#2980b9',
    tierTop: '#e67e22',
    tierMiddle: '#9b59b6',
    intermediate: '#8b5cf6'
  };

  const TIER_COLORS = [COLORS.tierBottom, COLORS.tierTop, COLORS.tierMiddle];

  /**
   * Get the sling colour for a given tier index and critical state.
   */
  function slingColor(tierIdx, isCritical) {
    if (isCritical) return COLORS.critical;
    return TIER_COLORS[tierIdx] || COLORS.tierBottom;
  }

  /**
   * Flatten all slings across all tiers into a unified list with tier metadata.
   */
  function collectAllSlings(results) {
    const tiers = results.tiers || [];
    const all = [];
    tiers.forEach((tier, tIdx) => {
      (tier.slings || []).forEach(s => {
        all.push({ ...s, tierIndex: tIdx });
      });
    });
    return all;
  }

  /**
   * Get bottom-tier lifting points (the 'from' of the lowest tier slings).
   */
  function getLiftingPoints(results) {
    const tiers = results.tiers || [];
    if (tiers.length === 0) return [];
    return tiers[0].slings.map(s => s.from);
  }

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

    const { hook } = results;
    const allSlings = collectAllSlings(results);
    const lps = getLiftingPoints(results);
    const beams = results.beams || [];
    const intermediatePoints = results.intermediatePoints || [];

    // Compute bounds — include LPs, hook, COG, beam ends, intermediate points, and all sling endpoints
    const allX = [...lps.map(p => p.x), cog.x, hook.x];
    const allY = [...lps.map(p => p.y), cog.y, hook.y];

    allSlings.forEach(s => {
      allX.push(s.from.x, s.to.x);
      allY.push(s.from.y, s.to.y);
    });
    beams.forEach(b => {
      allX.push(b.endA.x, b.endB.x);
      allY.push(b.endA.y, b.endB.y);
    });
    intermediatePoints.forEach(p => {
      allX.push(p.x);
      allY.push(p.y);
    });

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

    const svgParts = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">`);

    // Title
    svgParts.push(`<text x="${w/2}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="${COLORS.text}">Plan View (Top Down)</text>`);

    // Load outline (polygon of bottom-tier lifting points)
    if (lps.length >= 2) {
      svgParts.push(`<polygon points="${lps.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ')}" fill="${COLORS.load}" fill-opacity="0.1" stroke="${COLORS.load}" stroke-width="1.5"/>`);
    }

    // Draw beams
    beams.forEach(b => {
      const x1 = tx(b.endA.x), y1 = ty(b.endA.y);
      const x2 = tx(b.endB.x), y2 = ty(b.endB.y);
      svgParts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.beam}" stroke-width="4"/>`);
      svgParts.push(`<circle cx="${x1}" cy="${y1}" r="4" fill="${COLORS.beam}" stroke="white" stroke-width="1"/>`);
      svgParts.push(`<circle cx="${x2}" cy="${y2}" r="4" fill="${COLORS.beam}" stroke="white" stroke-width="1"/>`);
    });

    // Draw intermediate points (small triangle markers)
    intermediatePoints.forEach(p => {
      const px = tx(p.x), py = ty(p.y);
      const sz = 4;
      svgParts.push(`<polygon points="${px},${py - sz} ${px + sz},${py + sz} ${px - sz},${py + sz}" fill="${COLORS.intermediate}" stroke="white" stroke-width="1"/>`);
    });

    // Sling lines (projected horizontal) — all tiers
    const planLabelPos = [0.35, 0.45, 0.55, 0.65];
    allSlings.forEach((s, sIdx) => {
      const from = s.from;
      const to = s.to;
      const color = slingColor(s.tierIndex, s.isCritical);
      svgParts.push(`<line x1="${tx(to.x)}" y1="${ty(to.y)}" x2="${tx(from.x)}" y2="${ty(from.y)}" stroke="${color}" stroke-width="2" stroke-dasharray="6,3"/>`);

      // H. dist label at staggered position
      if (s.horizontalDist != null) {
        const t = planLabelPos[sIdx % planLabelPos.length];
        const mx = tx(to.x) + (tx(from.x) - tx(to.x)) * t;
        const my = ty(to.y) + (ty(from.y) - ty(to.y)) * t;
        svgParts.push(`<text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="10" fill="${color}" font-weight="600">${s.horizontalDist.toFixed(2)}${unit}</text>`);
      }
    });

    // Lifting points (bottom tier)
    lps.forEach((lp, i) => {
      svgParts.push(`<circle cx="${tx(lp.x)}" cy="${ty(lp.y)}" r="6" fill="${COLORS.lp}" stroke="white" stroke-width="1.5"/>`);
      svgParts.push(`<text x="${tx(lp.x)}" y="${ty(lp.y) - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="${COLORS.lp}">LP${i+1}</text>`);
      svgParts.push(`<text x="${tx(lp.x)}" y="${ty(lp.y) + 18}" text-anchor="middle" font-size="9" fill="${COLORS.text}">(${lp.x}, ${lp.y})</text>`);
    });

    // COG
    const cogSz = 6;
    svgParts.push(`<polygon points="${tx(cog.x)},${ty(cog.y)-cogSz} ${tx(cog.x)+cogSz},${ty(cog.y)} ${tx(cog.x)},${ty(cog.y)+cogSz} ${tx(cog.x)-cogSz},${ty(cog.y)}" fill="${COLORS.cog}" stroke="white" stroke-width="1"/>`);
    svgParts.push(`<text x="${tx(cog.x)}" y="${ty(cog.y) - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.cog}">COG</text>`);

    // Hook (same X,Y as COG in plan view — draw as crosshair)
    const hx = tx(hook.x), hy = ty(hook.y);
    svgParts.push(`<circle cx="${hx}" cy="${hy}" r="8" fill="none" stroke="${COLORS.hook}" stroke-width="1.5"/>`);
    svgParts.push(`<line x1="${hx-10}" y1="${hy}" x2="${hx+10}" y2="${hy}" stroke="${COLORS.hook}" stroke-width="1"/>`);
    svgParts.push(`<line x1="${hx}" y1="${hy-10}" x2="${hx}" y2="${hy+10}" stroke="${COLORS.hook}" stroke-width="1"/>`);

    // Legend
    let legendY = h - 42;
    svgParts.push(`<text x="10" y="${legendY}" font-size="9" fill="${COLORS.text}">Hook: crosshair at COG position</text>`);
    legendY += 12;
    svgParts.push(`<text x="10" y="${legendY}" font-size="9" fill="${COLORS.text}">Dashed lines: horizontal sling projection</text>`);
    legendY += 12;
    svgParts.push(`<line x1="10" y1="${legendY}" x2="30" y2="${legendY}" stroke="${COLORS.critical}" stroke-width="2"/>`);
    svgParts.push(`<text x="34" y="${legendY + 4}" font-size="9" fill="${COLORS.critical}">Critical</text>`);
    svgParts.push(`<line x1="80" y1="${legendY}" x2="100" y2="${legendY}" stroke="${COLORS.tierBottom}" stroke-width="2"/>`);
    svgParts.push(`<text x="104" y="${legendY + 4}" font-size="9" fill="${COLORS.tierBottom}">Bottom</text>`);
    if ((results.tiers || []).length > 1) {
      svgParts.push(`<line x1="150" y1="${legendY}" x2="170" y2="${legendY}" stroke="${COLORS.tierTop}" stroke-width="2"/>`);
      svgParts.push(`<text x="174" y="${legendY + 4}" font-size="9" fill="${COLORS.tierTop}">Top</text>`);
      if (beams.length > 0) {
        svgParts.push(`<line x1="210" y1="${legendY}" x2="230" y2="${legendY}" stroke="${COLORS.beam}" stroke-width="4"/>`);
        svgParts.push(`<text x="234" y="${legendY + 4}" font-size="9" fill="${COLORS.beam}">Beam</text>`);
      }
    }

    svgParts.push(`</svg>`);
    el.innerHTML = svgParts.join('');
  }

  function renderElevationView(results, cog, containerId, unit) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const { hook, headroom } = results;
    const allSlings = collectAllSlings(results);
    const lps = getLiftingPoints(results);
    const beams = results.beams || [];
    const intermediatePoints = results.intermediatePoints || [];

    // For elevation, project onto a vertical plane through the hook
    // X-axis = horizontal distance from hook (signed), Y-axis = Z (height)
    function projectToElevation(pt) {
      const dx = pt.x - hook.x;
      const dy = pt.y - hook.y;
      const hDist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const signedH = angle > 0 ? -hDist : hDist;
      return { h: signedH, z: pt.z };
    }

    const elevLPs = lps.map((lp, i) => {
      const proj = projectToElevation(lp);
      return { h: proj.h, z: proj.z, idx: i };
    });

    // Sort by horizontal position for consistent layout
    elevLPs.sort((a, b) => a.h - b.h);

    // Collect all 3D points for bounds
    const slingPts3D = [];
    allSlings.forEach(s => {
      slingPts3D.push(s.from, s.to);
    });
    beams.forEach(b => {
      slingPts3D.push(b.endA, b.endB);
    });
    intermediatePoints.forEach(p => {
      slingPts3D.push(p);
    });

    // Compute bounds including all points
    const allH = [0]; // hook is at h=0
    const allZ = [hook.z, hook.z + 1, 0];

    elevLPs.forEach(p => { allH.push(p.h); allZ.push(p.z); });
    slingPts3D.forEach(pt => {
      const proj = projectToElevation(pt);
      allH.push(proj.h);
      allZ.push(pt.z);
    });

    const minH = Math.min(...allH), maxH = Math.max(...allH);
    const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
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

    const svgParts = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">`);

    // Title
    svgParts.push(`<text x="${w/2}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="${COLORS.text}">Elevation View (Side)</text>`);

    // Ground line
    svgParts.push(`<line x1="20" y1="${ty(0)}" x2="${w-20}" y2="${ty(0)}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="4,4"/>`);
    svgParts.push(`<text x="${w-18}" y="${ty(0)+14}" text-anchor="end" font-size="9" fill="${COLORS.grid}">Ground</text>`);

    // Hook
    const hookX = tx(0), hookY = ty(hook.z);
    svgParts.push(`<rect x="${hookX-8}" y="${hookY-6}" width="16" height="12" rx="2" fill="${COLORS.hook}"/>`);
    svgParts.push(`<text x="${hookX}" y="${hookY - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.hook}">HOOK</text>`);

    // Crane wire above hook
    svgParts.push(`<line x1="${hookX}" y1="${hookY - 6}" x2="${hookX}" y2="${ty(hook.z + 2)}" stroke="${COLORS.hook}" stroke-width="1.5" stroke-dasharray="4,3"/>`);

    // Draw beams in elevation
    beams.forEach(b => {
      const projA = projectToElevation(b.endA);
      const projB = projectToElevation(b.endB);
      const x1 = tx(projA.h), y1 = ty(b.endA.z);
      const x2 = tx(projB.h), y2 = ty(b.endB.z);
      svgParts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.beam}" stroke-width="4"/>`);
      svgParts.push(`<circle cx="${x1}" cy="${y1}" r="4" fill="${COLORS.beam}" stroke="white" stroke-width="1"/>`);
      svgParts.push(`<circle cx="${x2}" cy="${y2}" r="4" fill="${COLORS.beam}" stroke="white" stroke-width="1"/>`);
    });

    // Draw intermediate points in elevation
    intermediatePoints.forEach(p => {
      const proj = projectToElevation(p);
      const px = tx(proj.h), py = ty(p.z);
      const sz = 4;
      svgParts.push(`<polygon points="${px},${py - sz} ${px + sz},${py + sz} ${px - sz},${py + sz}" fill="${COLORS.intermediate}" stroke="white" stroke-width="1"/>`);
    });

    // Sling lines from all tiers
    const elevLabelPos = [0.3, 0.45, 0.55, 0.7];
    allSlings.forEach((s, sIdx) => {
      const projFrom = projectToElevation(s.from);
      const projTo = projectToElevation(s.to);
      const color = slingColor(s.tierIndex, s.isCritical);
      const fromX = tx(projFrom.h), fromY = ty(s.from.z);
      const toX = tx(projTo.h), toY = ty(s.to.z);

      // Sling line
      svgParts.push(`<line x1="${toX}" y1="${toY}" x2="${fromX}" y2="${fromY}" stroke="${color}" stroke-width="2"/>`);

      // Sling length + angle label at staggered position
      if (s.length != null) {
        const t = elevLabelPos[sIdx % elevLabelPos.length];
        const mx = toX + (fromX - toX) * t;
        const my = toY + (fromY - toY) * t;
        const offset = projFrom.h < 0 ? -8 : 8;
        const anchor = projFrom.h < 0 ? 'end' : 'start';
        svgParts.push(`<text x="${mx + offset}" y="${my}" text-anchor="${anchor}" font-size="9" font-weight="600" fill="${color}">${s.length.toFixed(2)}${unit}</text>`);
        if (s.angleDegFromHoriz != null) {
          svgParts.push(`<text x="${mx + offset}" y="${my + 11}" text-anchor="${anchor}" font-size="9" fill="${color}">${s.angleDegFromHoriz.toFixed(1)}°</text>`);
        }
        if (s.tension != null) {
          svgParts.push(`<text x="${mx + offset}" y="${my + 22}" text-anchor="${anchor}" font-size="9" fill="${color}">${s.tension.toFixed(2)}${unit === 'ft' ? 'US t' : 't'}</text>`);
        }
      }

      // Angle arc (only for bottom-tier slings at LP positions)
      if (s.tierIndex === 0 && s.angleDegFromHoriz != null) {
        const arcR = 25;
        const angleRad = Math.atan2(s.to.z - s.from.z, Math.abs(projFrom.h - projTo.h));
        const endArcX = fromX + (projFrom.h < 0 ? -arcR : arcR);
        const endArcY = fromY;
        const midArcX = fromX + Math.cos(angleRad) * arcR * (projFrom.h < 0 ? -1 : 1);
        const midArcY = fromY - Math.sin(angleRad) * arcR;
        svgParts.push(`<path d="M ${endArcX} ${endArcY} A ${arcR} ${arcR} 0 0 ${projFrom.h < 0 ? 0 : 1} ${midArcX} ${midArcY}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="2,2"/>`);
      }
    });

    // LP markers (bottom tier)
    elevLPs.forEach(ep => {
      const lpX = tx(ep.h), lpY = ty(ep.z);
      svgParts.push(`<circle cx="${lpX}" cy="${lpY}" r="5" fill="${COLORS.lp}" stroke="white" stroke-width="1"/>`);
      svgParts.push(`<text x="${lpX}" y="${lpY + 16}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLORS.lp}">LP${ep.idx + 1}</text>`);
    });

    // Headroom dimension (right side)
    const maxLPz = Math.max(...lps.map(p => p.z));
    const dimX = tx(maxH) + 40;
    if (headroom > 0.01) {
      const y1 = ty(maxLPz), y2 = ty(hook.z);
      svgParts.push(`<line x1="${dimX}" y1="${y1}" x2="${dimX}" y2="${y2}" stroke="${COLORS.dim}" stroke-width="1.5"/>`);
      svgParts.push(`<line x1="${dimX-5}" y1="${y1}" x2="${dimX+5}" y2="${y1}" stroke="${COLORS.dim}" stroke-width="1.5"/>`);
      svgParts.push(`<line x1="${dimX-5}" y1="${y2}" x2="${dimX+5}" y2="${y2}" stroke="${COLORS.dim}" stroke-width="1.5"/>`);
      // Arrow heads
      svgParts.push(`<polygon points="${dimX},${y2+1} ${dimX-3},${y2+7} ${dimX+3},${y2+7}" fill="${COLORS.dim}"/>`);
      svgParts.push(`<polygon points="${dimX},${y1-1} ${dimX-3},${y1-7} ${dimX+3},${y1-7}" fill="${COLORS.dim}"/>`);
      svgParts.push(`<text x="${dimX + 8}" y="${(y1+y2)/2 + 4}" font-size="10" font-weight="600" fill="${COLORS.dim}">${headroom.toFixed(2)}${unit}</text>`);
      svgParts.push(`<text x="${dimX + 8}" y="${(y1+y2)/2 + 16}" font-size="9" fill="${COLORS.dim}">Headroom</text>`);
    }

    // Hook height dimension (left side)
    const dimXL = tx(minH) - 40;
    const y1h = ty(0), y2h = ty(hook.z);
    svgParts.push(`<line x1="${dimXL}" y1="${y1h}" x2="${dimXL}" y2="${y2h}" stroke="${COLORS.hook}" stroke-width="1" stroke-dasharray="3,3"/>`);
    svgParts.push(`<line x1="${dimXL-5}" y1="${y1h}" x2="${dimXL+5}" y2="${y1h}" stroke="${COLORS.hook}" stroke-width="1"/>`);
    svgParts.push(`<line x1="${dimXL-5}" y1="${y2h}" x2="${dimXL+5}" y2="${y2h}" stroke="${COLORS.hook}" stroke-width="1"/>`);
    svgParts.push(`<text x="${dimXL - 8}" y="${(y1h+y2h)/2 + 4}" text-anchor="end" font-size="10" font-weight="600" fill="${COLORS.hook}">${results.hookHeight.toFixed(2)}${unit}</text>`);
    svgParts.push(`<text x="${dimXL - 8}" y="${(y1h+y2h)/2 + 16}" text-anchor="end" font-size="9" fill="${COLORS.hook}">Hook Ht</text>`);

    svgParts.push(`</svg>`);
    el.innerHTML = svgParts.join('');
  }

  return { render };
})();
