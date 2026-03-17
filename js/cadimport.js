/**
 * Sling Length Calculator — DXF & STL Import (Phase 4b)
 * DXF: parse 2D geometry, overlay on plan view SVG.
 * STL: load 3D mesh into Three.js scene.
 */

const CadImport = (() => {
  let dxfState = {
    entities: null,  // parsed DXF entities
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotation: 0,
    color: '#555555',
    lineWidth: 1
  };

  let stlState = {
    mesh: null,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    scale: 1,
    rotationZ: 0,
    opacity: 0.5
  };

  let dxfParserLoaded = false;

  // ===================== DXF =====================

  async function loadDXF(file, onReady) {
    await ensureDxfParser();
    const text = await file.text();
    const parser = new window.DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf || !dxf.entities) {
      throw new Error('Failed to parse DXF file — no entities found.');
    }
    dxfState.entities = dxf.entities;

    // Auto-scale: compute bounding box
    const bbox = getDxfBBox(dxf.entities);
    dxfState._bbox = bbox;

    onReady(dxf.entities.length);
  }

  function clearDXF() {
    dxfState.entities = null;
    dxfState.offsetX = 0;
    dxfState.offsetY = 0;
    dxfState.scale = 1;
    dxfState.rotation = 0;
    dxfState._bbox = null;
  }

  function getDxfState() { return { ...dxfState }; }
  function updateDxfState(updates) { Object.assign(dxfState, updates); }

  function getDxfBBox(entities) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    entities.forEach(e => {
      const pts = getEntityPoints(e);
      pts.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
    if (!isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    return { minX, maxX, minY, maxY };
  }

  function getEntityPoints(e) {
    const pts = [];
    if (e.type === 'LINE') {
      pts.push(e.vertices[0], e.vertices[1]);
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      (e.vertices || []).forEach(v => pts.push(v));
    } else if (e.type === 'CIRCLE') {
      pts.push({ x: e.center.x - e.radius, y: e.center.y - e.radius });
      pts.push({ x: e.center.x + e.radius, y: e.center.y + e.radius });
    } else if (e.type === 'ARC') {
      pts.push({ x: e.center.x - e.radius, y: e.center.y - e.radius });
      pts.push({ x: e.center.x + e.radius, y: e.center.y + e.radius });
    } else if (e.type === 'POINT') {
      pts.push(e.position);
    }
    return pts;
  }

  /**
   * Inject DXF geometry into the plan view SVG.
   */
  function injectDxfIntoSVG(containerId, planBounds) {
    if (!dxfState.entities) return;

    const container = document.getElementById(containerId);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Remove existing DXF overlay
    const existing = svg.querySelector('.dxf-overlay');
    if (existing) existing.remove();

    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const svgW = vb[2], svgH = vb[3];
    const bbox = dxfState._bbox;
    if (!bbox) return;

    const s = dxfState;
    const dxfW = bbox.maxX - bbox.minX || 1;
    const dxfH = bbox.maxY - bbox.minY || 1;
    const dxfCx = (bbox.minX + bbox.maxX) / 2;
    const dxfCy = (bbox.minY + bbox.maxY) / 2;

    // Scale DXF to fit SVG with padding, then apply user scale
    const fitScale = Math.min((svgW * 0.7) / dxfW, (svgH * 0.7) / dxfH) * s.scale;

    const cx = svgW / 2 + s.offsetX;
    const cy = svgH / 2 + s.offsetY;

    // Transform: DXF coord → SVG coord
    const tx = (x) => cx + (x - dxfCx) * fitScale;
    const ty = (y) => cy - (y - dxfCy) * fitScale; // flip Y

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'dxf-overlay');
    g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);

    dxfState.entities.forEach(e => {
      const color = s.color;
      const lw = s.lineWidth;

      if (e.type === 'LINE') {
        const line = svgEl('line', {
          x1: tx(e.vertices[0].x), y1: ty(e.vertices[0].y),
          x2: tx(e.vertices[1].x), y2: ty(e.vertices[1].y),
          stroke: color, 'stroke-width': lw, fill: 'none'
        });
        g.appendChild(line);
      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const verts = e.vertices || [];
        if (verts.length < 2) return;
        const pts = verts.map(v => `${tx(v.x)},${ty(v.y)}`).join(' ');
        const closed = e.shape || false;
        const el = svgEl(closed ? 'polygon' : 'polyline', {
          points: pts, stroke: color, 'stroke-width': lw, fill: 'none'
        });
        g.appendChild(el);
      } else if (e.type === 'CIRCLE') {
        const circ = svgEl('circle', {
          cx: tx(e.center.x), cy: ty(e.center.y), r: e.radius * fitScale,
          stroke: color, 'stroke-width': lw, fill: 'none'
        });
        g.appendChild(circ);
      } else if (e.type === 'ARC') {
        const arcPath = describeArc(
          tx(e.center.x), ty(e.center.y),
          e.radius * fitScale,
          -e.endAngle, -e.startAngle // flip for SVG Y inversion
        );
        const path = svgEl('path', {
          d: arcPath, stroke: color, 'stroke-width': lw, fill: 'none'
        });
        g.appendChild(path);
      }
    });

    // Insert behind sling geometry (after title)
    const firstText = svg.querySelector('text');
    if (firstText && firstText.nextSibling) {
      svg.insertBefore(g, firstText.nextSibling);
    } else {
      svg.appendChild(g);
    }
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    let diff = endAngle - startAngle;
    if (diff < 0) diff += 360;
    const largeArc = diff > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  async function ensureDxfParser() {
    if (dxfParserLoaded) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.min.js';
      script.onload = () => { dxfParserLoaded = true; resolve(); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ===================== STL =====================

  /**
   * Load STL file into the Three.js scene.
   * Uses dynamic import of STLLoader from Three.js addons.
   * @param {File} file
   * @param {Function} onReady - called with bounding box info
   */
  async function loadSTL(file, onReady) {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const THREE = window.__THREE__;

    const buffer = await file.arrayBuffer();
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Center the geometry at origin
    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshLambertMaterial({
      color: 0x8899aa,
      transparent: true,
      opacity: stlState.opacity
    });

    if (stlState.mesh) {
      stlState.mesh.geometry.dispose();
      stlState._material?.dispose();
      stlState.mesh = null;
    }

    const mesh = new THREE.Mesh(geometry, material);
    stlState.mesh = mesh;
    stlState._size = { x: size.x, y: size.y, z: size.z };
    stlState._material = material;

    onReady({
      vertices: geometry.attributes.position.count,
      size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) }
    });
  }

  /**
   * Add the STL mesh to a Three.js scene with current transform state.
   * Called by the scene module.
   */
  function getStlMesh() {
    if (!stlState.mesh) return null;
    const THREE = window.__THREE__;
    const s = stlState;
    const mesh = s.mesh;

    mesh.position.set(s.offsetX, s.offsetZ, -s.offsetY);
    mesh.scale.setScalar(s.scale);
    mesh.rotation.set(0, s.rotationZ * Math.PI / 180, 0);
    if (s._material) s._material.opacity = s.opacity;

    return mesh;
  }

  function clearSTL() {
    if (stlState.mesh) {
      stlState.mesh.geometry.dispose();
      stlState._material?.dispose();
    }
    stlState.mesh = null;
    stlState.offsetX = 0;
    stlState.offsetY = 0;
    stlState.offsetZ = 0;
    stlState.scale = 1;
    stlState.rotationZ = 0;
    stlState.opacity = 0.5;
    stlState._size = null;
    stlState._material = null;
  }

  function getStlState() { return { ...stlState }; }
  function updateStlState(updates) { Object.assign(stlState, updates); }

  return {
    loadDXF, clearDXF, getDxfState, updateDxfState, injectDxfIntoSVG,
    loadSTL, clearSTL, getStlState, updateStlState, getStlMesh
  };
})();
