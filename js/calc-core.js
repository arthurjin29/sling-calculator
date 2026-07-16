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

  /**
   * Minimum-norm rigid-body support reactions for a load on N support points.
   * Solves A·R = b with rows [1..], [x_i - cog.x], [y_i - cog.y] and
   * b = [totalLoad, 0, 0] (vertical equilibrium + moment balance about the COG).
   * Statically indeterminate for N>3 → min-norm solution R = Aᵀ(AAᵀ)⁻¹b.
   * By construction ΣR = totalLoad and the reaction-weighted centroid of the
   * points equals the COG. Entries may be negative when the COG is near or
   * outside the support hull (caller should guard).
   *
   * @param {Array<{x,y}>} points - support points (plan)
   * @param {{x,y}} cog - centre of gravity (plan)
   * @param {number} totalLoad - total vertical load
   * @returns {number[]} reaction per point
   */
  function computeSupportReactions(points, cog, totalLoad) {
    const N = points.length;
    const A = [[], [], []];
    for (let i = 0; i < N; i++) {
      A[0][i] = 1;
      A[1][i] = points[i].x - cog.x;
      A[2][i] = points[i].y - cog.y;
    }
    const b = [totalLoad, 0, 0];
    const AT = transposeNxM(A, 3, N);
    const AAT = matMxNMultiply(A, AT, 3, N, 3);
    const AATinv = mat3x3Inverse(AAT);
    if (!AATinv) return Array(N).fill(totalLoad / N);
    const y = [];
    for (let i = 0; i < 3; i++) {
      y[i] = AATinv[i][0] * b[0] + AATinv[i][1] * b[1] + AATinv[i][2] * b[2];
    }
    const R = [];
    for (let i = 0; i < N; i++) {
      R[i] = AT[i][0] * y[0] + AT[i][1] * y[1] + AT[i][2] * y[2];
    }
    return R;
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
   * Place beam ends on direct sling paths from each LP toward a target point.
   * Path: P(t) = LP + t * (target - LP); pair horizontal spread shrinks with t.
   * - If beam length >= LP horizontal spread, beam handles the short axis fully:
   *   ends sit on the LP's vertical X-Z path, sharing the LP's Y, with
   *   minSlingLen along the path.
   * - Otherwise, ends sit on the direct sling paths at the t where horizontal
   *   spread equals beamLength, clamped by minSlingLen and t<=0.95.
   */
  function computeBeamEndPair(lp0, lp1, target, beamLength, minSlingLen) {
    const spreadAtZero = horizontalDist(lp0, lp1);

    if (spreadAtZero < 0.0001 || beamLength >= spreadAtZero) {
      function placeOnXZpath(lp) {
        const dx = target.x - lp.x;
        const dz = target.z - lp.z;
        const xzDist = Math.sqrt(dx * dx + dz * dz);
        if (xzDist < 0.0001) return { x: lp.x, y: lp.y, z: lp.z + minSlingLen };
        const frac = Math.min(minSlingLen / xzDist, 0.95);
        return { x: lp.x + frac * dx, y: lp.y, z: lp.z + frac * dz };
      }
      return { end0: placeOnXZpath(lp0), end1: placeOnXZpath(lp1) };
    }

    let t = 1 - beamLength / spreadAtZero;
    const fullLen0 = dist3D(lp0, target);
    const fullLen1 = dist3D(lp1, target);
    const minT = Math.max(
      fullLen0 > 0 ? minSlingLen / fullLen0 : 0,
      fullLen1 > 0 ? minSlingLen / fullLen1 : 0
    );
    t = Math.max(t, minT);
    t = Math.min(t, 0.95);

    return {
      end0: lerp3D(lp0, target, t),
      end1: lerp3D(lp1, target, t)
    };
  }

  /**
   * Fixed-length beam end placement for a 2-LP group.
   * The beam is a rigid bar of `length`, axis along the LP-pair line, positioned
   * so it hangs plumb under a pick over `subCOG`. A rigid bar loaded only at its
   * two ends carries a net force along the bar, so each middle sling carries its
   * own end's load; for the two middle thrusts to cancel the pick must sit over
   * the load-weighted average of the ENDS, giving
   *   C = subCOG - u * (length/2) * (wB - wA) / (wA + wB)
   * with u the unit vector from lpA to lpB. Returns plan (x,y); caller sets z.
   * end0 is on the lpA side, end1 on the lpB side.
   * See docs/superpowers/specs/2026-07-14-cascade-fixed-length-slave-beams-design.md §3.
   */
  function fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length) {
    const dx = lpB.x - lpA.x, dy = lpB.y - lpA.y;
    const axisLen = Math.sqrt(dx * dx + dy * dy);
    const half = length / 2;
    if (axisLen < 1e-9) {
      return { end0: { x: subCOG.x, y: subCOG.y }, end1: { x: subCOG.x, y: subCOG.y } };
    }
    const ux = dx / axisLen, uy = dy / axisLen;
    const W = wA + wB;
    let cx, cy;
    if (W < 1e-9) {
      cx = (lpA.x + lpB.x) / 2; cy = (lpA.y + lpB.y) / 2;
    } else {
      const shift = half * (wB - wA) / W;
      cx = subCOG.x - ux * shift; cy = subCOG.y - uy * shift;
    }
    return {
      end0: { x: cx - ux * half, y: cy - uy * half },
      end1: { x: cx + ux * half, y: cy + uy * half }
    };
  }

  /**
   * Solve a fixed-length spreader beam's free-hanging equilibrium pose.
   * The beam (rigid, horizontal, length `length`, axis free to yaw) carries its
   * two LPs via bottom slings and hangs from `hook` (over the total COG, height
   * `H`) via two top slings. A rigid bar loaded only at its two ends carries a
   * net end force along the bar, so each end's top and bottom vertical share =
   * that LP's load `w_i`. Solve centre (cx,cy) + yaw (th) so the beam's net
   * horizontal force is zero (h_a + h_b = 0 and h_a parallel to the bar) via a
   * damped Newton iteration seeded from the sub-COG / LP-pair line. Beam height
   * (zB) is set by the min bottom-sling angle AND the min bottom-sling length
   * (a MINIMUM — raises the beam, never shrinks it).
   * See docs/superpowers/specs/2026-07-15-parallel-fixed-length-beams-design.md §4-§6.
   */
  function solveHangingBeam(lpA, lpB, wA, wB, hook, H, length, minAngleRad, minSling) {
    const half = length / 2;
    const tan = Math.tan(minAngleRad);
    const W = wA + wB;
    const subx = (W > 1e-9) ? (wA * lpA.x + wB * lpB.x) / W : (lpA.x + lpB.x) / 2;
    const suby = (W > 1e-9) ? (wA * lpA.y + wB * lpB.y) / W : (lpA.y + lpB.y) / 2;
    let cx = subx, cy = suby, th = Math.atan2(lpB.y - lpA.y, lpB.x - lpA.x);
    const cx0 = cx, cy0 = cy, th0 = th;

    const endsOf = (cx, cy, th) => {
      const ux = Math.cos(th), uy = Math.sin(th);
      return {
        ea: { x: cx - ux * half, y: cy - uy * half },
        eb: { x: cx + ux * half, y: cy + uy * half },
        ux, uy
      };
    };
    const zBof = (ea, eb) => {
      const req = (e, lp) => {
        const hd = Math.hypot(e.x - lp.x, e.y - lp.y);
        const za = lp.z + hd * tan;
        const zl = (minSling > hd) ? lp.z + Math.sqrt(Math.max(0, minSling * minSling - hd * hd)) : lp.z;
        return Math.max(za, zl);
      };
      return Math.max(req(ea, lpA), req(eb, lpB));
    };
    const residual = (cx, cy, th) => {
      const { ea, eb, ux, uy } = endsOf(cx, cy, th);
      const z = zBof(ea, eb);
      const hvec = (e, lp, w) => {
        const dzTop = H - z, dzBot = z - lp.z;
        return {
          x: w * ((hook.x - e.x) / dzTop + (lp.x - e.x) / dzBot),
          y: w * ((hook.y - e.y) / dzTop + (lp.y - e.y) / dzBot)
        };
      };
      const ha = hvec(ea, lpA, wA), hb = hvec(eb, lpB, wB);
      return [ha.x + hb.x, ha.y + hb.y, ux * ha.y - uy * ha.x];
    };

    let converged = false;
    const damp = 0.6, eps = 1e-6;
    for (let it = 0; it < 80; it++) {
      const r = residual(cx, cy, th);
      if (!isFinite(r[0] + r[1] + r[2])) break;
      if (Math.hypot(r[0], r[1], r[2]) < 1e-7) { converged = true; break; }
      const r1 = residual(cx + eps, cy, th), r2 = residual(cx, cy + eps, th), r3 = residual(cx, cy, th + eps);
      const J = [
        [(r1[0] - r[0]) / eps, (r2[0] - r[0]) / eps, (r3[0] - r[0]) / eps],
        [(r1[1] - r[1]) / eps, (r2[1] - r[1]) / eps, (r3[1] - r[1]) / eps],
        [(r1[2] - r[2]) / eps, (r2[2] - r[2]) / eps, (r3[2] - r[2]) / eps]
      ];
      const Ji = mat3x3Inverse(J);
      if (!Ji) break;   // singular Jacobian — stop; caller flags non-convergence
      const d = [
        -(Ji[0][0] * r[0] + Ji[0][1] * r[1] + Ji[0][2] * r[2]),
        -(Ji[1][0] * r[0] + Ji[1][1] * r[1] + Ji[1][2] * r[2]),
        -(Ji[2][0] * r[0] + Ji[2][1] * r[1] + Ji[2][2] * r[2])
      ];
      if (!isFinite(d[0] + d[1] + d[2])) break;
      cx += damp * d[0]; cy += damp * d[1]; th += damp * d[2];
    }
    if (!converged) { cx = cx0; cy = cy0; th = th0; }
    const { ea, eb } = endsOf(cx, cy, th);
    const z = zBof(ea, eb);
    return { end0: { x: ea.x, y: ea.y, z }, end1: { x: eb.x, y: eb.y, z }, converged };
  }

  /**
   * Solve the cascade Main beam's free-hang pose (fixed length `length`, axis free
   * to yaw). Unlike solveHangingBeam, each end carries a whole sub-spreader via TWO
   * middle slings — end A to sub-A ends eA0/eA1 (loads wA0/wA1), end B to sub-B ends
   * eB0/eB1 (loads wB0/wB1) — plus one top sling up to `hook` (height H) that carries
   * that side's total load. Solve centre (cx,cy) + yaw (th) so the beam's net
   * horizontal force is zero and axial (damped Newton). Beam height z is raised so
   * EVERY middle sling (pick → sub end) meets `middleAngleRad` — a floor, honoured on
   * the actual slings, never the pick→sub-COG proxy. Returns the two ends + z.
   */
  function solveCascadeMainBeam(eA0, eA1, wA0, wA1, eB0, eB1, wB0, wB1, hook, H, length, middleAngleRad) {
    const half = length / 2;
    const tanMid = Math.tan(middleAngleRad);
    const WA = wA0 + wA1, WB = wB0 + wB1, W = WA + WB;
    const subAx = WA > 1e-9 ? (wA0 * eA0.x + wA1 * eA1.x) / WA : (eA0.x + eA1.x) / 2;
    const subAy = WA > 1e-9 ? (wA0 * eA0.y + wA1 * eA1.y) / WA : (eA0.y + eA1.y) / 2;
    const subBx = WB > 1e-9 ? (wB0 * eB0.x + wB1 * eB1.x) / WB : (eB0.x + eB1.x) / 2;
    const subBy = WB > 1e-9 ? (wB0 * eB0.y + wB1 * eB1.y) / WB : (eB0.y + eB1.y) / 2;
    let cx = W > 1e-9 ? (WA * subAx + WB * subBx) / W : (subAx + subBx) / 2;
    let cy = W > 1e-9 ? (WA * subAy + WB * subBy) / W : (subAy + subBy) / 2;
    let th = Math.atan2(subBy - subAy, subBx - subAx);
    const cx0 = cx, cy0 = cy, th0 = th;

    const endsOf = (cx, cy, th) => {
      const ux = Math.cos(th), uy = Math.sin(th);
      return { pa: { x: cx - ux * half, y: cy - uy * half }, pb: { x: cx + ux * half, y: cy + uy * half }, ux, uy };
    };
    const zOf = (pa, pb) => {
      const req = (p, e) => e.z + Math.hypot(p.x - e.x, p.y - e.y) * tanMid;
      return Math.max(req(pa, eA0), req(pa, eA1), req(pb, eB0), req(pb, eB1));
    };
    const residual = (cx, cy, th) => {
      const { pa, pb, ux, uy } = endsOf(cx, cy, th);
      const z = zOf(pa, pb);
      const dzTop = H - z;
      // Net horizontal at a pick = top sling (carries the side's total load Ws toward
      // the hook) + the two middle slings (each carries its sub-end load toward eX).
      const hvec = (p, e0, e1, w0, w1) => {
        const Ws = w0 + w1, dz0 = z - e0.z, dz1 = z - e1.z;
        return {
          x: Ws * (hook.x - p.x) / dzTop + w0 * (e0.x - p.x) / dz0 + w1 * (e1.x - p.x) / dz1,
          y: Ws * (hook.y - p.y) / dzTop + w0 * (e0.y - p.y) / dz0 + w1 * (e1.y - p.y) / dz1
        };
      };
      const ha = hvec(pa, eA0, eA1, wA0, wA1), hb = hvec(pb, eB0, eB1, wB0, wB1);
      return [ha.x + hb.x, ha.y + hb.y, ux * ha.y - uy * ha.x];
    };

    let converged = false;
    const damp = 0.6, eps = 1e-6;
    for (let it = 0; it < 80; it++) {
      const r = residual(cx, cy, th);
      if (!isFinite(r[0] + r[1] + r[2])) break;
      if (Math.hypot(r[0], r[1], r[2]) < 1e-7) { converged = true; break; }
      const r1 = residual(cx + eps, cy, th), r2 = residual(cx, cy + eps, th), r3 = residual(cx, cy, th + eps);
      const J = [
        [(r1[0] - r[0]) / eps, (r2[0] - r[0]) / eps, (r3[0] - r[0]) / eps],
        [(r1[1] - r[1]) / eps, (r2[1] - r[1]) / eps, (r3[1] - r[1]) / eps],
        [(r1[2] - r[2]) / eps, (r2[2] - r[2]) / eps, (r3[2] - r[2]) / eps]
      ];
      const Ji = mat3x3Inverse(J);
      if (!Ji) break;
      const d = [
        -(Ji[0][0] * r[0] + Ji[0][1] * r[1] + Ji[0][2] * r[2]),
        -(Ji[1][0] * r[0] + Ji[1][1] * r[1] + Ji[1][2] * r[2]),
        -(Ji[2][0] * r[0] + Ji[2][1] * r[1] + Ji[2][2] * r[2])
      ];
      if (!isFinite(d[0] + d[1] + d[2])) break;
      cx += damp * d[0]; cy += damp * d[1]; th += damp * d[2];
    }
    if (!converged) { cx = cx0; cy = cy0; th = th0; }
    const { pa, pb } = endsOf(cx, cy, th);
    const z = zOf(pa, pb);
    return { end0: { x: pa.x, y: pa.y, z }, end1: { x: pb.x, y: pb.y, z }, z, converged };
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

  /**
   * Slack-leg sensitivity analysis for a single-junction sling group.
   * For each sling in turn, set its tension to 0 and redistribute the load
   * across the remaining N-1 slings via least-squares (calcLoadDistribution).
   * Returns per-scenario tensions + the worst-case scenario across all slings.
   *
   * Only meaningful when N >= 4 — with N=3, dropping one leaves 2 slings which
   * is statically determinate and the redistribution is unphysical without a
   * geometric perturbation model. Returns null for N<4 so the caller can flag
   * the analysis as not applicable.
   *
   * @param {Array<{x,y,z}>} points - sling lower attachments (e.g. LPs)
   * @param {{x,y,z}} hook - common upper convergence point
   * @param {number} totalLoad - total suspended load
   * @returns {object|null} { scenarios:[...], worstCase:{...} } or null if N<4
   */
  function analyzeSlackLeg(points, hook, totalLoad) {
    const N = points.length;
    if (N < 4) return null;

    const scenarios = [];
    let worstMaxTension = -Infinity;
    let worstSlackIdx = 0;
    let worstCriticalIdx = 0;

    for (let slackIdx = 0; slackIdx < N; slackIdx++) {
      const remaining = points.filter((_, j) => j !== slackIdx);
      const partial = calcLoadDistribution(remaining, hook, totalLoad);

      const fullTensions = Array(N).fill(0);
      let k = 0;
      for (let j = 0; j < N; j++) {
        if (j === slackIdx) continue;
        fullTensions[j] = partial[k++];
      }

      let maxT = -Infinity;
      let critIdx = 0;
      let hasNeg = false;
      for (let j = 0; j < N; j++) {
        if (fullTensions[j] < -0.001) hasNeg = true;
        if (fullTensions[j] > maxT) {
          maxT = fullTensions[j];
          critIdx = j;
        }
      }

      scenarios.push({
        slackSlingIndex: slackIdx,
        tensions: fullTensions.map(round4),
        maxTension: round4(maxT),
        criticalSlingIndex: critIdx,
        infeasible: hasNeg
      });

      if (maxT > worstMaxTension) {
        worstMaxTension = maxT;
        worstSlackIdx = slackIdx;
        worstCriticalIdx = critIdx;
      }
    }

    return {
      scenarios,
      worstCase: {
        slackSlingIndex: worstSlackIdx,
        criticalSlingIndex: worstCriticalIdx,
        maxTension: round4(worstMaxTension)
      }
    };
  }

  /**
   * Load-sharing tolerance factor — applies an empirical multiplier to the
   * theoretical max-loaded sling tension to account for real-world sling-length
   * tolerance. Factors are from Nobles "Lifting the Bar" Edition 2 (crane-scale
   * measurements on 4-leg sling lifts with one leg shortened).
   *
   * Tolerance is expressed as a PROPORTION of sling length, not an absolute
   * length, because load-share degradation is governed by the ratio (Δ/L), not
   * by mm. Nobles' "1 chain link" and "5 chain links" data points are mapped to
   * the closest standard percentage points: 2.5% and 12.5% respectively.
   *
   * Each calculator's configType is mapped to one of three Nobles arrangements:
   *   direct          → Nobles A (Single Point)
   *   spreader-beam   → Nobles D (Spreader Beam)
   *   lifting-beam    → spreader-equivalent (top-suspended beam separates legs)
   *   double-parallel → spreader-equivalent (two parallel beams)
   *   stinger         → Nobles C (Stinger)
   *   double-cascade  → stinger-equivalent (master + 2 slaves cascade)
   *
   * Modes:
   *   'theoretical' → factor=1.0 (rigid-body solver result, no tolerance)
   *   'pct2_5'      → ±2.5% length deviation (matched / measured chain slings)
   *   'pct12_5'     → ±12.5% length deviation (unmatched / site-modified slings)
   */
  const LOAD_SHARING_FACTORS = {
    'direct':          { pct2_5: 1.88, pct12_5: null },  // Nobles A: 47% / 25%; heavy tolerance not tested
    'spreader-beam':   { pct2_5: 1.18, pct12_5: 1.68 },  // Nobles D: 29.5% / 25%, 42% / 25%
    'lifting-beam':    { pct2_5: 1.18, pct12_5: 1.68 },  // mapped to spreader
    'double-parallel': { pct2_5: 1.18, pct12_5: 1.68 },  // mapped to spreader
    'stinger':         { pct2_5: 1.36, pct12_5: 2.00 },  // Nobles C: 34% / 25%, 50% / 25%
    'double-cascade':  { pct2_5: 1.36, pct12_5: 2.00 }   // mapped to stinger
  };

  function applyLoadSharingFactor(tensions, configType, toleranceMode) {
    const baseMaxTension = round4(Math.max(...tensions));
    const noblesSource = "Nobles 'Lifting the Bar' Edition 2 — empirical 4-leg testing";

    if (toleranceMode === 'theoretical' || toleranceMode == null) {
      return {
        toleranceMode: 'theoretical',
        applicable: true,
        factor: 1.0,
        baseMaxTension,
        adjustedMaxTension: baseMaxTension,
        source: 'Theoretical (rigid-body geometric solver, no tolerance applied)',
        note: ''
      };
    }

    const cfg = LOAD_SHARING_FACTORS[configType];
    if (!cfg) {
      return {
        toleranceMode, applicable: false, factor: null,
        baseMaxTension, adjustedMaxTension: null, source: noblesSource,
        note: `No tolerance factor available for configType '${configType}'.`
      };
    }

    const factor = cfg[toleranceMode];
    if (factor == null) {
      return {
        toleranceMode, applicable: false, factor: null,
        baseMaxTension, adjustedMaxTension: null, source: noblesSource,
        note: `Nobles did not measure ${toleranceMode === 'pct12_5' ? '±12.5%' : '±2.5%'} length deviation for this arrangement — use a lighter tolerance or theoretical.`
      };
    }

    return {
      toleranceMode, applicable: true, factor,
      baseMaxTension,
      adjustedMaxTension: round4(baseMaxTension * factor),
      source: noblesSource,
      note: ''
    };
  }

  return {
    degToRad, radToDeg, round2, round4,
    horizontalDist, dist3D, midpoint, lerp3D,
    autoPairLPs,
    pointInPolygon2D,
    mat3x3Inverse, mat2x2Inverse,
    transposeNxM, matMxNMultiply,
    calcLoadDistribution, calcTwoSlingTension, computeSupportReactions,
    buildSling, computeVerticalLoad,
    analyzeSlackLeg,
    applyLoadSharingFactor,
    LOAD_SHARING_FACTORS,
    getOrientationAxis,
    computeBeamEnds, computeBeamEndZ, computeBeamEndZWithMinSling,
    computeBeamEndPair, fixedBeamEnds, solveHangingBeam, solveCascadeMainBeam
  };
})();
