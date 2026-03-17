/**
 * Sling Length Calculator — 3D Visualization (ES Module)
 * Three.js scene: load, lifting points, hook, slings, labels.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Expose THREE globally for cadimport.js STL loading
window.__THREE__ = THREE;

let scene, camera, renderer, labelRenderer, controls;
let container;
let sceneObjects = [];
let stlMeshInScene = null;

export function init(containerId) {
  container = document.getElementById(containerId);
  if (!container) return;

  const w = container.clientWidth;
  const h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f4f8);

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
  camera.position.set(15, 10, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(30, 30, 0xbbbbbb, 0xdddddd);
  scene.add(grid);

  const axes = new THREE.AxesHelper(3);
  scene.add(axes);

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  if (!container || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
}

function clearScene() {
  sceneObjects.forEach(obj => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    // Remove CSS2DObject DOM elements to prevent leaks
    if (obj instanceof CSS2DObject && obj.element && obj.element.parentNode) {
      obj.element.parentNode.removeChild(obj.element);
    }
  });
  sceneObjects = [];
}

/**
 * Update the 3D scene with calculation results.
 * @param {object} results
 * @param {{x,y,z}} cog
 * @param {object} [units] - { length: 'm'|'ft', load: 't'|'US t' }
 */
export function update(results, cog, units) {
  const unitLen = (units && units.length) || 'm';
  const unitLoad = (units && units.load) || 't';
  clearScene();

  const { hook, slings } = results;
  const lps = slings.map(s => s.liftingPoint);

  const criticalColor = 0xe74c3c;
  const normalColor = 0x27ae60;
  const hookColor = 0x2c3e50;
  const lpColor = 0x2980b9;
  const cogColor = 0xe67e22;
  const loadFillColor = 0x3498db;

  // --- Load footprint (filled polygon between LPs) ---
  // Project onto XZ plane in Three.js (Y=up)
  const loadShape = new THREE.Shape();
  loadShape.moveTo(lps[0].x, -lps[0].y);
  for (let i = 1; i < lps.length; i++) {
    loadShape.lineTo(lps[i].x, -lps[i].y);
  }
  loadShape.closePath();
  const loadGeo = new THREE.ShapeGeometry(loadShape);
  const loadMat = new THREE.MeshBasicMaterial({
    color: loadFillColor, transparent: true, opacity: 0.15, side: THREE.DoubleSide
  });
  const loadMesh = new THREE.Mesh(loadGeo, loadMat);
  const avgZ = lps.reduce((s, p) => s + p.z, 0) / lps.length;
  loadMesh.rotation.x = -Math.PI / 2;
  loadMesh.position.y = avgZ;
  scene.add(loadMesh);
  sceneObjects.push(loadMesh);

  // Load outline
  const outlinePts = lps.map(p => new THREE.Vector3(p.x, p.z, -p.y));
  outlinePts.push(outlinePts[0].clone());
  const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
  const outlineMat = new THREE.LineBasicMaterial({ color: loadFillColor, linewidth: 2 });
  const outlineLine = new THREE.Line(outlineGeo, outlineMat);
  scene.add(outlineLine);
  sceneObjects.push(outlineLine);

  // --- Lifting points (spheres) ---
  lps.forEach((lp, i) => {
    const sphere = createSphere(0.12, lpColor);
    sphere.position.set(lp.x, lp.z, -lp.y);
    scene.add(sphere);
    sceneObjects.push(sphere);

    const label = createLabel(`LP${i + 1}`, '#2980b9');
    label.position.set(lp.x, lp.z + 0.35, -lp.y);
    scene.add(label);
    sceneObjects.push(label);
  });

  // --- COG marker ---
  const cogMarker = createDiamond(0.15, cogColor);
  cogMarker.position.set(cog.x, cog.z, -cog.y);
  scene.add(cogMarker);
  sceneObjects.push(cogMarker);

  const cogLabel = createLabel('COG', '#e67e22');
  cogLabel.position.set(cog.x, cog.z + 0.35, -cog.y);
  scene.add(cogLabel);
  sceneObjects.push(cogLabel);

  // --- Hook block ---
  const hookGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.4, 8);
  const hookMat = new THREE.MeshLambertMaterial({ color: hookColor });
  const hookMesh = new THREE.Mesh(hookGeo, hookMat);
  hookMesh.position.set(hook.x, hook.z, -hook.y);
  scene.add(hookMesh);
  sceneObjects.push(hookMesh);

  const hookLabel = createLabel('HOOK', '#2c3e50');
  hookLabel.position.set(hook.x, hook.z + 0.5, -hook.y);
  scene.add(hookLabel);
  sceneObjects.push(hookLabel);

  // Vertical dashed line above hook (crane wire)
  const wirePts = [
    new THREE.Vector3(hook.x, hook.z, -hook.y),
    new THREE.Vector3(hook.x, hook.z + 3, -hook.y)
  ];
  const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePts);
  const wireMat = new THREE.LineDashedMaterial({ color: 0x7f8c8d, dashSize: 0.3, gapSize: 0.15 });
  const wireLine = new THREE.Line(wireGeo, wireMat);
  wireLine.computeLineDistances();
  scene.add(wireLine);
  sceneObjects.push(wireLine);

  // --- Sling lines + labels ---
  slings.forEach((s) => {
    const lp = s.liftingPoint;
    const color = s.isCritical ? criticalColor : normalColor;

    const hookPt = new THREE.Vector3(hook.x, hook.z, -hook.y);
    const lpPt = new THREE.Vector3(lp.x, lp.z, -lp.y);

    // Tube for visible sling
    const path = new THREE.LineCurve3(hookPt, lpPt);
    const tubeGeo = new THREE.TubeGeometry(path, 1, 0.03, 8, false);
    const tubeMat = new THREE.MeshLambertMaterial({ color });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    scene.add(tube);
    sceneObjects.push(tube);

    // Sling label at midpoint
    const mid = new THREE.Vector3().addVectors(hookPt, lpPt).multiplyScalar(0.5);
    const labelText = `${s.length.toFixed(2)}${unitLen}\n${s.angleDegFromHoriz.toFixed(0)}\u00B0\n${s.tension.toFixed(2)}${unitLoad}`;
    const labelColor = s.isCritical ? '#e74c3c' : '#27ae60';
    const slingLabel = createLabel(labelText, labelColor, true);
    slingLabel.position.copy(mid);
    scene.add(slingLabel);
    sceneObjects.push(slingLabel);
  });

  // --- Headroom dimension line ---
  const maxLPz = Math.max(...lps.map(p => p.z));
  if (results.headroom > 0.01) {
    const dimX = hook.x + 1.5;
    const dimPts = [
      new THREE.Vector3(dimX, maxLPz, -hook.y),
      new THREE.Vector3(dimX, hook.z, -hook.y)
    ];
    const dimGeo = new THREE.BufferGeometry().setFromPoints(dimPts);
    const dimMat = new THREE.LineDashedMaterial({ color: 0x8e44ad, dashSize: 0.2, gapSize: 0.1 });
    const dimLine = new THREE.Line(dimGeo, dimMat);
    dimLine.computeLineDistances();
    scene.add(dimLine);
    sceneObjects.push(dimLine);

    const dimLabel = createLabel(`Headroom*\n${results.headroom.toFixed(2)}${unitLen}`, '#8e44ad');
    dimLabel.position.set(dimX, (maxLPz + hook.z) / 2, -hook.y);
    scene.add(dimLabel);
    sceneObjects.push(dimLabel);
  }

  // --- STL mesh if loaded ---
  refreshStlMesh();

  fitCameraToScene(lps, hook);
}

/**
 * Add/update STL mesh in the scene.
 * Called after update() and when STL controls change.
 */
export function refreshStlMesh() {
  // Remove previous STL mesh
  if (stlMeshInScene) {
    scene.remove(stlMeshInScene);
    stlMeshInScene = null;
  }

  if (typeof CadImport !== 'undefined') {
    const mesh = CadImport.getStlMesh();
    if (mesh) {
      scene.add(mesh);
      stlMeshInScene = mesh;
    }
  }
}

function fitCameraToScene(lps, hook) {
  const allPts = [...lps, hook];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  allPts.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.z); maxY = Math.max(maxY, p.z);
    minZ = Math.min(minZ, -p.y); maxZ = Math.max(maxZ, -p.y);
  });

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 5);

  controls.target.set(cx, cy, cz);
  camera.position.set(cx + size * 1.2, cy + size * 0.8, cz + size * 1.2);
  camera.lookAt(cx, cy, cz);
  controls.update();
}

function createSphere(radius, color) {
  const geo = new THREE.SphereGeometry(radius, 16, 16);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

function createDiamond(size, color) {
  const geo = new THREE.OctahedronGeometry(size);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

function createLabel(text, color, background = false) {
  const div = document.createElement('div');
  div.style.color = color;
  div.style.fontSize = '12px';
  div.style.fontWeight = '700';
  div.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  div.style.whiteSpace = 'pre';
  div.style.textAlign = 'center';
  div.style.lineHeight = '1.3';
  if (background) {
    div.style.background = 'rgba(255,255,255,0.85)';
    div.style.padding = '2px 6px';
    div.style.borderRadius = '4px';
    div.style.border = `1px solid ${color}`;
  }
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.layers.set(0);
  return label;
}
