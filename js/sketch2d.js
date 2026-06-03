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

  return { layoutElevation };
})();
if (typeof window !== 'undefined') window.Sketch2D = Sketch2D;
