/**
 * Sling Length Calculator — Calculation Engine
 * Pure functions, no DOM, no side effects.
 *
 * Coordinate system: X = East, Y = North, Z = Up
 * Angle convention: from horizontal (degrees in API, radians internally)
 */

const SlingCalc = (() => {

  /**
   * Main calculation entry point.
   * @param {Array<{x,y,z}>} liftingPoints - 4 lifting point coords (metres)
   * @param {{x,y,z}} cog - Centre of gravity (metres)
   * @param {number} minAngleDeg - Minimum sling angle from horizontal (degrees)
   * @param {number} totalLoad - Total suspended load (tonnes)
   * @returns {object} Full results object
   */
  function calculate(liftingPoints, cog, minAngleDeg, totalLoad) {
    const minAngleRad = degToRad(minAngleDeg);

    // Validate COG is inside the LP polygon (2D, XY plane)
    const cogInsidePolygon = pointInPolygon2D(
      cog,
      liftingPoints.map(lp => ({ x: lp.x, y: lp.y }))
    );

    // Hook X,Y = COG X,Y (vertical lift)
    const hookXY = { x: cog.x, y: cog.y };

    // Horizontal distance from each LP to hook
    const hDists = liftingPoints.map(lp => horizontalDist(lp, hookXY));

    // Required hook Z for each LP to satisfy min angle
    // tan(angle) = vertical / horizontal → vertical = horizontal * tan(angle)
    const requiredHookZs = liftingPoints.map((lp, i) => {
      return lp.z + hDists[i] * Math.tan(minAngleRad);
    });

    const hookZ = Math.max(...requiredHookZs);
    const hook = { x: hookXY.x, y: hookXY.y, z: hookZ };

    // Per-sling results
    const slings = liftingPoints.map((lp, i) => {
      const hd = hDists[i];
      const vd = hookZ - lp.z;
      const length = Math.sqrt(hd * hd + vd * vd);
      const angleRad = Math.atan2(vd, hd);
      const angleDeg = radToDeg(angleRad);
      const angleFromVertDeg = 90 - angleDeg;

      return {
        id: i + 1,
        liftingPoint: lp,
        horizontalDist: round4(hd),
        verticalDist: round4(vd),
        length: round4(length),
        angleDegFromHoriz: round2(angleDeg),
        angleDegFromVert: round2(angleFromVertDeg),
        governsHookHeight: Math.abs(requiredHookZs[i] - hookZ) < 0.0001,
        isCritical: false
      };
    });

    // Sling load distribution (minimum-norm least squares)
    const tensions = calcLoadDistribution(liftingPoints, hook, totalLoad);
    let hasNegativeTension = false;
    slings.forEach((s, i) => {
      s.tension = round4(tensions[i]);
      if (tensions[i] < -0.001) hasNegativeTension = true;
      // Vertical component of tension
      s.verticalLoad = round4(tensions[i] * Math.sin(degToRad(s.angleDegFromHoriz)));
    });

    // Critical sling = highest tension (most loaded)
    let maxTension = -Infinity;
    let criticalIndex = 0;
    slings.forEach((s, i) => {
      if (s.tension > maxTension) {
        maxTension = s.tension;
        criticalIndex = i;
      }
    });
    slings[criticalIndex].isCritical = true;

    // Headroom: hook height above highest lifting point
    const maxLPz = Math.max(...liftingPoints.map(lp => lp.z));
    const headroom = hookZ - maxLPz;

    return {
      hook,
      hookHeight: round4(hookZ),
      headroom: round4(headroom),
      heightAboveCOG: round4(hookZ - cog.z),
      minAngleDeg,
      totalLoad,
      criticalSlingId: criticalIndex + 1,
      slings,
      warnings: {
        cogOutsidePolygon: !cogInsidePolygon,
        negativeTension: hasNegativeTension
      }
    };
  }

  /**
   * Sling load distribution using minimum-norm least squares.
   *
   * System: A * t = b  (3 equations, 4 unknowns)
   * where rows are: ΣFx=0, ΣFy=0, ΣFz=W
   *
   * Solution: t = Aᵀ(AAᵀ)⁻¹b  (minimum ||t||² solution)
   */
  function calcLoadDistribution(lps, hook, totalLoad) {
    // Build A matrix (3x4) and b vector (3x1)
    const A = [[], [], []];
    const b = [0, 0, totalLoad];

    for (let i = 0; i < 4; i++) {
      const dx = lps[i].x - hook.x;
      const dy = lps[i].y - hook.y;
      const dz = lps[i].z - hook.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (L < 0.0001) {
        // LP at hook — degenerate, assign equal share
        A[0][i] = 0;
        A[1][i] = 0;
        A[2][i] = 1;
      } else {
        // Unit direction from hook to LP (sling pulls hook→LP on the load)
        // Force on load is tension directed from LP toward hook
        A[0][i] = (hook.x - lps[i].x) / L;
        A[1][i] = (hook.y - lps[i].y) / L;
        A[2][i] = (hook.z - lps[i].z) / L;
      }
    }

    // AAᵀ (3x3)
    const AAT = mat3x3Multiply(A, transpose4x3(A));

    // (AAᵀ)⁻¹
    const AATinv = mat3x3Inverse(AAT);
    if (!AATinv) {
      // Fallback: equal distribution
      return [totalLoad / 4, totalLoad / 4, totalLoad / 4, totalLoad / 4];
    }

    // (AAᵀ)⁻¹ * b  → 3x1
    const AATinvB = [
      AATinv[0][0] * b[0] + AATinv[0][1] * b[1] + AATinv[0][2] * b[2],
      AATinv[1][0] * b[0] + AATinv[1][1] * b[1] + AATinv[1][2] * b[2],
      AATinv[2][0] * b[0] + AATinv[2][1] * b[1] + AATinv[2][2] * b[2],
    ];

    // t = Aᵀ * (AAᵀ)⁻¹ * b  → 4x1
    const t = [];
    for (let i = 0; i < 4; i++) {
      t[i] = A[0][i] * AATinvB[0] + A[1][i] * AATinvB[1] + A[2][i] * AATinvB[2];
    }

    return t;
  }

  // --- Linear algebra helpers ---

  function transpose4x3(A) {
    // A is 3x4, returns 4x3
    const T = [];
    for (let i = 0; i < 4; i++) {
      T[i] = [A[0][i], A[1][i], A[2][i]];
    }
    return T;
  }

  function mat3x3Multiply(A, B) {
    // A is 3x4, B is 4x3, result is 3x3
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 4; k++) {
          C[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return C;
  }

  function mat3x3Inverse(m) {
    const det =
      m[0][0] * (m[1][1]*m[2][2] - m[1][2]*m[2][1]) -
      m[0][1] * (m[1][0]*m[2][2] - m[1][2]*m[2][0]) +
      m[0][2] * (m[1][0]*m[2][1] - m[1][1]*m[2][0]);

    if (Math.abs(det) < 1e-12) return null;

    const invDet = 1 / det;
    return [
      [
        (m[1][1]*m[2][2] - m[1][2]*m[2][1]) * invDet,
        (m[0][2]*m[2][1] - m[0][1]*m[2][2]) * invDet,
        (m[0][1]*m[1][2] - m[0][2]*m[1][1]) * invDet
      ],
      [
        (m[1][2]*m[2][0] - m[1][0]*m[2][2]) * invDet,
        (m[0][0]*m[2][2] - m[0][2]*m[2][0]) * invDet,
        (m[0][2]*m[1][0] - m[0][0]*m[1][2]) * invDet
      ],
      [
        (m[1][0]*m[2][1] - m[1][1]*m[2][0]) * invDet,
        (m[0][1]*m[2][0] - m[0][0]*m[2][1]) * invDet,
        (m[0][0]*m[1][1] - m[0][1]*m[1][0]) * invDet
      ]
    ];
  }

  // --- Utility ---

  function horizontalDist(lp, hookXY) {
    const dx = lp.x - hookXY.x;
    const dy = lp.y - hookXY.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  /**
   * Ray-casting point-in-polygon test (2D, XY plane).
   * Works for convex and concave polygons.
   */
  function pointInPolygon2D(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  return { calculate };
})();
