/**
 * Sketch2D — SVG elevation renderer + hybrid drag/type for Simple mode.
 * layoutElevation() is pure (no DOM) and unit-tested.
 */
const Sketch2D = (() => {
  /** Build a world→screen mapper that fits bounds into a viewbox with margin, Z-up→Y-down. */
  function layoutElevation(bounds, view) {
    const w = view.width, h = view.height, m = view.margin;
    const worldW = (bounds.maxX - bounds.minX) || 1;
    const worldH = (bounds.maxZ - bounds.minZ) || 1;
    const scale = Math.min((w - 2 * m) / worldW, (h - 2 * m) / worldH);
    function toScreen(x, z) {
      return {
        x: m + (x - bounds.minX) * scale,
        y: h - m - (z - bounds.minZ) * scale
      };
    }
    function toWorld(px, pz) {
      return {
        x: bounds.minX + (px - m) / scale,
        z: bounds.minZ + (h - m - pz) / scale
      };
    }
    return { scale, toScreen, toWorld };
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  const VIEW = { width: 460, height: 340, margin: 30 };
  let host, svg, onChange, current;

  /** mount(hostEl, changeCb) — changeCb({key, world}) fires while dragging a handle. */
  function mount(hostEl, changeCb) {
    host = hostEl; onChange = changeCb;
    svg = el('svg', { viewBox: `0 0 ${VIEW.width} ${VIEW.height}`, class: 'sketch-svg' });
    host.innerHTML = '';
    host.appendChild(svg);
  }

  /** update(result) — redraw from a computeSimpleDirect / computeSimpleSpreader result. */
  function update(result) {
    if (!svg) return;
    current = result;
    const lw = (result.load && result.load.w > 0) ? result.load.w : 0;
    const lh = (result.load && result.load.h > 0) ? result.load.h : 0;
    const xs = [result.lp1.x, result.lp2.x, result.hook.x, result.cog.x, 0, lw];
    const zs = [result.lp1.z, result.lp2.z, result.hook.z, result.cog.z, 0, lh];
    const bounds = { minX: Math.min(...xs) - 0.5, maxX: Math.max(...xs) + 0.5,
                     minZ: Math.min(...zs), maxZ: Math.max(...zs) + 0.3 };
    const lay = layoutElevation(bounds, VIEW);
    svg.innerHTML = '';

    // load box (backmost), world rect [0,lw] x [0,lh]
    if (lw > 0 && lh > 0) {
      const tl = lay.toScreen(0, lh), br = lay.toScreen(lw, 0);
      svg.appendChild(el('rect', { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y, class: 'sk-load' }));
    }

    const H = lay.toScreen(result.hook.x, result.hook.z);
    const P1 = lay.toScreen(result.lp1.x, result.lp1.z);
    const P2 = lay.toScreen(result.lp2.x, result.lp2.z);
    const G = lay.toScreen(result.cog.x, result.cog.z);

    // ground line at world z = 0
    const g0 = lay.toScreen(bounds.minX, 0), g1 = lay.toScreen(bounds.maxX, 0);
    svg.appendChild(el('line', { x1: g0.x, y1: g0.y, x2: g1.x, y2: g1.y, class: 'sk-ground' }));

    if (result.beam) {
      // Spreader-beam: beam bar + top slings (hook→ends) + bottom slings (ends→LPs)
      const A = lay.toScreen(result.beam.endA.x, result.beam.endA.z);
      const B = lay.toScreen(result.beam.endB.x, result.beam.endB.z);
      // top slings: hook → each beam end
      svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: A.x, y2: A.y, class: 'sk-sling' }));
      svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: B.x, y2: B.y, class: 'sk-sling' }));
      // bottom slings: drawn from their real endpoints (beam end → same-side pick, never crossed)
      (result.bottomSlings || []).forEach(sl => {
        const a = lay.toScreen(sl.to.x, sl.to.z), b = lay.toScreen(sl.from.x, sl.from.z);
        svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sk-sling' }));
      });
      svg.appendChild(el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'sk-beam' }));
    } else {
      // 4-leg direct: slings hook→each LP
      svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: P1.x, y2: P1.y, class: 'sk-sling' }));
      svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: P2.x, y2: P2.y, class: 'sk-sling' }));
    }

    // plumb line hook→COG
    svg.appendChild(el('line', { x1: H.x, y1: H.y, x2: G.x, y2: G.y, class: 'sk-plumb' }));

    // draggable handles
    addHandle(P1, 'lp1', 'LP1');
    addHandle(P2, 'lp2', 'LP2');
    addHandle(G, 'cog', 'COG');

    // hook marker (not draggable — it follows COG + headroom)
    svg.appendChild(el('circle', { cx: H.x, cy: H.y, r: 6, class: 'sk-hook' }));
    const ht = el('text', { x: H.x, y: H.y - 12, class: 'sk-label' });
    ht.textContent = 'Hook';
    svg.appendChild(ht);

    function addHandle(pt, key, label) {
      const c = el('circle', { cx: pt.x, cy: pt.y, r: 8, class: 'sk-handle', 'data-key': key });
      c.style.cursor = 'grab';
      c.addEventListener('pointerdown', (e) => startDrag(e, key, lay));
      svg.appendChild(c);
      const t = el('text', { x: pt.x, y: pt.y - 12, class: 'sk-label' });
      t.textContent = label;
      svg.appendChild(t);
    }
  }

  function startDrag(e, key, lay) {
    e.preventDefault();
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * VIEW.width;
      const py = (ev.clientY - rect.top) / rect.height * VIEW.height;
      const w = lay.toWorld(px, py);
      if (onChange) onChange({ key, world: w });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return { layoutElevation, mount, update };
})();
if (typeof window !== 'undefined') window.Sketch2D = Sketch2D;
