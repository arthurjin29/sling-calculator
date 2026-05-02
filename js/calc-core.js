/**
 * Sling Length Calculator — Shared Core Utilities
 * Pure math functions used by all config modules.
 *
 * Coordinate system: X = East, Y = North, Z = Up
 */

const CalcCore = (() => {

  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function horizontalDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  function lerp3D(a, b, t) {
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
  }

  /**
   * Pair 4 lifting points into the two pairs that minimise total in-pair
   * horizontal distance. Returns [[i,j], [k,l]] — index pairs for groups A and B.
   */
  function autoPairLPs(liftingPoints) {
    const pairings = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
    let bestPairing = pairings[0];
    let bestDist = Infinity;
    for (const p of pairings) {
      const d = horizontalDist(liftingPoints[p[0][0]], liftingPoints[p[0][1]])
              + horizontalDist(liftingPoints[p[1][0]], liftingPoints[p[1][1]]);
      if (d < bestDist) { bestDist = d; bestPairing = p; }
    }
    return bestPairing;
  }

  /**
   * Ray-casting point-in-polygon test (2D, XY plane).
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

  // --- Linear algebra ---

  /** Transpose m×n matrix → n×m */
  function transposeNxM(A, m, n) {
    const T = [];
    for (let j = 0; j < n; j++) {
      T[j] = [];
      for (let i = 0; i < m; i++) {
        T[j][i] = A[i][j];
      }
    }
    return T;
  }

  /** Multiply m×n by n×p → m×p */
  function matMxNMultiply(A, B, m, n, p) {
    const C = [];
    for (let i = 0; i < m; i++) {
      C[i] = [];
      for (let j = 0; j < p; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += A[i][k] * B[k][j];
        C[i][j] = sum;
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

  function mat2x2Inverse(m) {
    const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    if (Math.abs(det) < 1e-12) return null;
    const invDet = 1 / det;
    return [
      [m[1][1] * invDet, -m[0][1] * invDet],
      [-m[1][0] * invDet, m[0][0] * invDet]
    ];
  }

  // --- Load distribution ---

  /**
   * N-sling load distribution.
   * Builds 3×N equilibrium matrix A, solves A·t = b where b = [0, 0, totalLoad].
   * N >= 3: under/exactly determined → min-norm: t = Aᵀ(AAᵀ)⁻¹b
   * N = 2: over-determined → least-squares: t = (AᵀA)⁻¹Aᵀb
   *
   * @param {Array<{x,y,z}>} points - sling attachment points (LP end)
   * @param {{x,y,z}} hook - common upper connection point
   * @param {number} totalLoad - total suspended load
   * @returns {number[]} tension per sling
   */
  function calcLoadDistribution(points, hook, totalLoad) {
    const N = points.length;
    const A = [[], [], []];
    const b = [0, 0, totalLoad];

    for (let i = 0; i < N; i++) {
      const dx = points[i].x - hook.x;
      const dy = points[i].y - hook.y;
      const dz = points[i].z - hook.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (L < 0.0001) {
        A[0][i] = 0;
        A[1][i] = 0;
        A[2][i] = 1;
      } else {
        A[0][i] = (hook.x - points[i].x) / L;
        A[1][i] = (hook.y - points[i].y) / L;
        A[2][i] = (hook.z - points[i].z) / L;
      }
    }

    if (N >= 3) {
      const AT = transposeNxM(A, 3, N);
      const AAT = matMxNMultiply(A, AT, 3, N, 3);
      const AATinv = mat3x3Inverse(AAT);
      if (!AATinv) return Array(N).fill(totalLoad / N);

      const AATinvB = [];
      for (let i = 0; i < 3; i++) {
        AATinvB[i] = AATinv[i][0] * b[0] + AATinv[i][1] * b[1] + AATinv[i][2] * b[2];
      }
      const t = [];
      for (let i = 0; i < N; i++) {
        t[i] = AT[i][0] * AATinvB[0] + AT[i][1] * AATinvB[1] + AT[i][2] * AATinvB[2];
      }
      return t;
    } else {
      // N = 2: enforce vertical equilibrium exactly via moment balance.
      const uz0 = A[2][0], uz1 = A[2][1];

      if (Math.abs(uz0) < 0.0001 && Math.abs(uz1) < 0.0001) {
        return [totalLoad / 2, totalLoad / 2];
      }

      // Moment balance about hook in XY plane to split vertical load
      const dx0 = points[0].x - hook.x, dy0 = points[0].y - hook.y;
      const dx1 = points[1].x - hook.x, dy1 = points[1].y - hook.y;
      const arm0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const arm1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const totalArm = arm0 + arm1;

      let vLoad0, vLoad1;
      if (totalArm < 0.0001) {
        vLoad0 = totalLoad / 2;
        vLoad1 = totalLoad / 2;
      } else {
        vLoad0 = totalLoad * arm1 / totalArm;
        vLoad1 = totalLoad * arm0 / totalArm;
      }

      // Convert vertical loads to sling tensions: T = vLoad / uz
      const t0 = Math.abs(uz0) > 0.0001 ? vLoad0 / uz0 : vLoad0;
      const t1 = Math.abs(uz1) > 0.0001 ? vLoad1 / uz1 : vLoad1;
      return [t0, t1];
    }
  }

  /**
   * 2-sling tension (convenience wrapper).
   * @returns {number[]} [tensionA, tensionB]
   */
  function calcTwoSlingTension(pointA, pointB, hook, totalLoad) {
    return calcLoadDistribution([pointA, pointB], hook, totalLoad);
  }

  // --- Sling builder ---

  /**
   * Build a standardised sling object.
   * @param {number} id - sling number
   * @param {{x,y,z,label}} from - lower attachment (LP or beam end)
   * @param {{x,y,z,label}} to - upper attachment (beam end, apex, or hook)
   */
  function buildSling(id, from, to) {
    const hd = horizontalDist(from, to);
    const vd = Math.abs(to.z - from.z);
    const length = dist3D(from, to);
    const angleRad = Math.atan2(vd, hd);
    const angleDeg = radToDeg(angleRad);
    return {
      id,
      from,
      to,
      length: round4(length),
      horizontalDist: round4(hd),
      verticalDist: round4(vd),
      angleDegFromHoriz: round2(angleDeg),
      angleDegFromVert: round2(90 - angleDeg),
      tension: 0,
      verticalLoad: 0,
      isCritical: false,
      governsHookHeight: false
    };
  }

  // --- Beam geometry helpers ---

  /**
   * Get orientation axis from LP layout.
   * 'lengthwise' = along the longer LP span, 'widthwise' = perpendicular.
   * @returns {{x: number, y: number}} unit vector in XY plane
   */
  function getOrientationAxis(liftingPoints, orientation) {
    const xs = liftingPoints.map(p => p.x);
    const ys = liftingPoints.map(p => p.y);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const lengthwiseIsX = rangeX >= rangeY;

    if (orientation === 'lengthwise') {
      return lengthwiseIsX ? { x: 1, y: 0 } : { x: 0, y: 1 };
    } else {
      return lengthwiseIsX ? { x: 0, y: 1 } : { x: 1, y: 0 };
    }
  }

  /**
   * Compute beam end XY positions from centre, length, and axis direction.
   * Z is set to centre.z (caller adjusts Z separately).
   */
  function computeBeamEnds(centre, length, axis) {
    const halfLen = length / 2;
    return {
      endA: { x: centre.x - axis.x * halfLen, y: centre.y - axis.y * halfLen, z: centre.z },
      endB: { x: centre.x + axis.x * halfLen, y: centre.y + axis.y * halfLen, z: centre.z }
    };
  }

  /**
   * Compute required Z for a beam end / apex point given a group of LPs
   * and the min sling angle constraint.
   * @param {Array<{x,y,z}>} groupLPs - lifting points in this group
   * @param {{x,y}} beamEndXY - horizontal position of beam end
   * @param {number} minAngleRad - minimum angle from horizontal (radians)
   * @returns {number} required Z
   */
  function computeBeamEndZ(groupLPs, beamEndXY, minAngleRad) {
    let maxZ = -Infinity;
    for (const lp of groupLPs) {
      const hd = horizontalDist(lp, beamEndXY);
      const requiredZ = lp.z + hd * Math.tan(minAngleRad);
      if (requiredZ > maxZ) maxZ = requiredZ;
    }
    return maxZ;
  }

  /**
   * Compute beam end Z with both min angle AND min sling length constraints.
   * Returns the Z that satisfies both.
   */
  function computeBeamEndZWithMinSling(groupLPs, beamEndXY, minAngleRad, minSlingLen) {
    let maxZ = -Infinity;
    for (const lp of groupLPs) {
      const hd = horizontalDist(lp, beamEndXY);
      // From min angle constraint
      const zFromAngle = lp.z + hd * Math.tan(minAngleRad);
      // From min sling length constraint
      const zFromLen = (minSlingLen > hd) ? lp.z + Math.sqrt(minSlingLen * minSlingLen - hd * hd) : lp.z;
      const requiredZ = Math.max(zFromAngle, zFromLen);
      if (requiredZ > maxZ) maxZ = requiredZ;
    }
    return maxZ;
  }

  /**
   * Compute vertical load from raw tension and endpoint geometry.
   * Avoids rounding error from using rounded angles.
   */
  function computeVerticalLoad(tension, from, to) {
    const length = dist3D(from, to);
    if (length < 0.0001) return 0;
    const vd = Math.abs(to.z - from.z);
    return tension * vd / length;
  }

  return {
    degToRad, radToDeg, round2, round4,
    horizontalDist, dist3D, midpoint, lerp3D,
    autoPairLPs,
    pointInPolygon2D,
    mat3x3Inverse, mat2x2Inverse,
    transposeNxM, matMxNMultiply,
    calcLoadDistribution, calcTwoSlingTension,
    buildSling, computeVerticalLoad,
    getOrientationAxis,
    computeBeamEnds, computeBeamEndZ, computeBeamEndZWithMinSling
  };
})();
