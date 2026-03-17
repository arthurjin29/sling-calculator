/**
 * Sling Length Calculator — Image/PDF Overlay for Plan View
 * Handles file upload, rendering, and transform controls.
 */

const SlingOverlay = (() => {
  let overlayState = {
    imageDataURL: null,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotation: 0,
    opacity: 0.4
  };

  // PDF.js loaded lazily
  let pdfjsLoaded = false;

  /**
   * Process an uploaded file (image or PDF).
   * @param {File} file
   * @param {Function} onReady - called with dataURL when ready
   */
  async function processFile(file, onReady) {
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPDF) {
      await ensurePdfJs();
      const arrayBuf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      overlayState.imageDataURL = canvas.toDataURL('image/png');
      onReady(overlayState.imageDataURL);
    } else {
      // Image file
      const reader = new FileReader();
      reader.onload = (e) => {
        overlayState.imageDataURL = e.target.result;
        onReady(overlayState.imageDataURL);
      };
      reader.readAsDataURL(file);
    }
  }

  function clearOverlay() {
    overlayState.imageDataURL = null;
    overlayState.offsetX = 0;
    overlayState.offsetY = 0;
    overlayState.scale = 1;
    overlayState.rotation = 0;
    overlayState.opacity = 0.4;
  }

  function getState() {
    return { ...overlayState };
  }

  function updateState(updates) {
    Object.assign(overlayState, updates);
  }

  /**
   * Inject overlay image into an SVG plan view.
   * Called by diagram.js after rendering the base plan SVG.
   * @param {string} containerId - the plan diagram container
   * @param {object} bounds - { minX, maxX, minY, maxY, tx, ty, scale } from diagram
   */
  function injectIntoSVG(containerId, bounds) {
    if (!overlayState.imageDataURL) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const svgW = parseFloat(svg.getAttribute('viewBox').split(' ')[2]);
    const svgH = parseFloat(svg.getAttribute('viewBox').split(' ')[3]);

    // Remove existing overlay
    const existing = svg.querySelector('.overlay-image');
    if (existing) existing.remove();

    const s = overlayState;
    const imgW = svgW * 0.6 * s.scale;
    const imgH = svgH * 0.6 * s.scale;
    const cx = svgW / 2 + s.offsetX;
    const cy = svgH / 2 + s.offsetY;

    // Create a group with transform for rotation
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'overlay-image');
    g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);

    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', s.imageDataURL);
    img.setAttribute('x', cx - imgW / 2);
    img.setAttribute('y', cy - imgH / 2);
    img.setAttribute('width', imgW);
    img.setAttribute('height', imgH);
    img.setAttribute('opacity', s.opacity);
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    g.appendChild(img);

    // Insert after the first element (title) so it's behind other geometry
    const firstChild = svg.querySelector('text') || svg.firstChild;
    if (firstChild && firstChild.nextSibling) {
      svg.insertBefore(g, firstChild.nextSibling);
    } else {
      svg.appendChild(g);
    }
  }

  async function ensurePdfJs() {
    if (pdfjsLoaded) return;
    return new Promise((resolve, reject) => {
      const script2 = document.createElement('script');
      script2.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      script2.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        pdfjsLoaded = true;
        resolve();
      };
      script2.onerror = reject;
      document.head.appendChild(script2);
    });
  }

  return { processFile, clearOverlay, getState, updateState, injectIntoSVG };
})();
