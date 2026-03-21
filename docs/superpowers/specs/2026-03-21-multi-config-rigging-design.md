# Multi-Configuration Rigging Calculator — Design Spec

**Date:** 2026-03-21
**Project:** sling-length-calculator (`D:\sling-length-calculator`)
**Status:** Review

## Overview

Extend the existing 4-point sling length calculator to support 6 rigging configurations, selectable via a dropdown. The calculator retains its vanilla HTML/CSS/JS architecture with no build system or dependencies beyond Three.js (CDN).

## Configurations

### 1. 4-Leg Direct Sling (Existing)
4 slings from hook directly to 4 lifting points.

### 2. Spreader Beam
- **Bottom tier:** 4 slings from 4 LPs to 2 beam ends (user-defined LP pairing)
- **Top tier:** 2 slings from beam ends to hook
- **Inputs:** Beam length, orientation (lengthwise/widthwise), LP pairing
- **Beam end Z:** Calculated from bottom sling min angle constraint
- **Beam end XY:** Determined by LP positions, pairing, and orientation

### 3. Stinger / Equalising Triangle
- **Bottom tier:** 4 slings from 4 LPs to 2 independent apex points
- **Top tier:** 2 slings from apex points to hook
- **Inputs:** LP pairing
- **Apex Z:** Calculated from bottom sling min angle constraint
- **Apex XY:** Determined by sling geometry (midpoint of paired LPs)

### 4. Lifting Beam
- **Single connection:** Hook to one pickup point on the beam, aligned with load COG
- **Bottom tier:** 2 slings from each beam end to paired LPs (4 slings total)
- **Inputs:** Beam length, orientation (lengthwise/widthwise), LP pairing
- **Beam end Z:** Calculated from bottom sling min angle constraint
- **Note:** Beam is loaded in bending. Beam bending capacity is NOT checked — user must verify independently.

### 5. Double Spreader (Parallel)
- **Bottom tier:** 4 slings from 4 LPs to ends of 2 independent spreader beams (1 sling per beam end)
- **Top tier:** 4 slings from 4 beam ends converging to a single hook point (same geometry as 4-leg direct, but with beam ends as the "lifting points")
- **Inputs:** 2× beam lengths, orientation per beam, LP pairing

### 6. Double Spreader (Cascading)
- **Bottom tier:** 4 slings from 4 LPs to ends of 2 slave spreader beams
- **Middle tier:** 2 slings from slave beam midpoints to ends of 1 master spreader beam
- **Top tier:** 2 slings from master beam ends to hook
- **Inputs:** Master beam length, 2× slave beam lengths, master orientation, slave orientation per beam, LP pairing
- Three-tier system.

## UI Design

### Config Selection
A dropdown placed in the toolbar area (alongside existing Preset and Units dropdowns):
- Options: `4-Leg Direct` (default), `Spreader Beam`, `Stinger / Eq. Triangle`, `Lifting Beam`, `Double Spreader (Parallel)`, `Double Spreader (Cascading)`

### Shared Inputs (always visible)
- 4 Lifting Points (X, Y, Z each)
- COG (X, Y, Z)
- Total Suspended Load
- Min Sling Angle (from horizontal) — **applies to bottom-tier slings only** for multi-tier configs. Top/middle tier angles are calculated outputs. A hardcoded 30° warning threshold flags dangerously shallow top sling angles.

### Config-Specific Panel (shown/hidden based on dropdown)
Appears below the shared inputs when a non-direct config is selected.

**Spreader Beam:**
- Beam length (number input)
- Orientation: lengthwise / widthwise (radio or select)
- LP pairing: 2 dropdown groups (Beam End A: 2 LP selections, Beam End B: 2 LP selections)
- **Pairing validation:** All 4 LPs must be assigned exactly once. If a duplicate is selected, show inline error. Default pairing: LP1+LP2 → Group A, LP3+LP4 → Group B.

**Stinger / Eq. Triangle:**
- LP pairing: 2 dropdown groups (Apex A: 2 LPs, Apex B: 2 LPs)
- Same pairing validation and defaults as above

**Lifting Beam:**
- Beam length
- Orientation: lengthwise / widthwise
- LP pairing: 2 dropdown groups

**Double Spreader (Parallel):**
- 2× beam lengths
- Orientation per beam
- LP pairing: 2 dropdown groups

**Double Spreader (Cascading):**
- Master beam length
- 2× slave beam lengths
- Master beam orientation: lengthwise / widthwise
- Slave beam orientation per beam: lengthwise / widthwise
- LP pairing: 2 dropdown groups

### Hardware Weight Note
Below the Total Suspended Load input:
> *"Include rigging hardware weight (slings, shackles, beams) in the total suspended load."*

## Calculation Architecture

### Approach: Modular — One calc file per configuration

**Shared core (`calc-core.js`):**
Extracted from current `calc.js` plus new utilities:

*Extracted (existing in calc.js):*
- `degToRad`, `radToDeg`, `round2`, `round4`
- `horizontalDist`
- `pointInPolygon2D`

*New (to be created):*
- `dist3D(a, b)` — 3D Euclidean distance between two {x,y,z} points (currently computed inline in calc.js)
- `transposeNxM(A, rows, cols)` — generalised matrix transpose (replaces hardcoded `transpose4x3`)
- `matMxNMultiply(A, B, m, n, p)` — generalised matrix multiplication
- `mat3x3Inverse` — kept as-is (always 3x3 for equilibrium)

*Generalised load distribution:*
- `calcLoadDistribution(points, hook, totalLoad)` — generalised to N slings (not hardcoded to 4). Builds a 3×N matrix A, solves via minimum-norm least squares `t = Aᵀ(AAᵀ)⁻¹b`. For N=4 (direct, bottom tiers), this is the under-determined min-norm solution. For N=2 (top tiers of spreader/stinger/cascade), the system is statically determinate (3 equations, 2 unknowns) — use the simpler direct solution via 2-sling moment equilibrium instead of least-squares. Each config module calls the appropriate variant.
- `calcTwoSlingTension(pointA, pointB, hook, totalLoad)` — direct solution for statically determinate 2-sling case using moment balance

**Module pattern:**
Each file attaches to a global namespace. `calc-core.js` exposes `window.CalcCore = { ... }`. Each config module exposes its own global (e.g. `window.CalcDirect = { calculate }`, `window.CalcSpreader = { calculate }`). `calc-router.js` exposes `window.SlingCalc = { calculate(configType, sharedInputs, configInputs) }` — this preserves the `SlingCalc` global name so existing code has a clear migration path, though `app.js` will be updated to pass the new arguments and consume the new result shape.

**Per-config modules:**
Each exposes a single `calculate(sharedInputs, configInputs)` function via its global.

| File | Config |
|------|--------|
| `js/calc-core.js` | Shared utilities |
| `js/calc-direct.js` | 4-leg direct |
| `js/calc-spreader.js` | Spreader beam |
| `js/calc-stinger.js` | Stinger / eq. triangle |
| `js/calc-liftbeam.js` | Lifting beam |
| `js/calc-double-par.js` | Double spreader (parallel) |
| `js/calc-double-cas.js` | Double spreader (cascading) |
| `js/calc-router.js` | Routes to correct module |

**Loading order (script tags):**
`calc-core.js` → 6 config modules → `calc-router.js` → `diagram.js` → `overlay.js` → `cadimport.js` → `app.js` → `scene.js` (ES module)

### Standardised Result Object

All config modules return the same shape:

```javascript
{
  configType: "spreader-beam",        // string identifier
  hook: { x, y, z },                  // hook position
  hookHeight: number,                 // hook Z
  headroom: number,                   // hook Z - max LP Z
  heightAboveCOG: number,             // hook Z - COG Z
  totalLoad: number,
  minAngleDeg: number,
  criticalSling: { tier: "bottom", id: 2 },

  tiers: [
    {
      name: "Bottom Slings",
      slings: [
        {
          id: 1,
          from: { x, y, z, label: "LP1" },
          to: { x, y, z, label: "Beam End A" },
          length: number,
          horizontalDist: number,
          verticalDist: number,
          angleDegFromHoriz: number,
          angleDegFromVert: number,
          tension: number,
          verticalLoad: number,
          isCritical: boolean,
          governsHookHeight: boolean
        },
        // ... more slings
      ]
    },
    {
      name: "Top Slings",
      slings: [ /* same shape */ ]
    }
    // cascading config adds { name: "Middle Slings", slings: [...] }
  ],

  beams: [
    {
      name: "Spreader Beam",
      endA: { x, y, z },
      endB: { x, y, z },
      length: number,
      pickupPoint: null   // only set for lifting beam
    }
  ],

  intermediatePoints: [
    { x, y, z, label: "Beam End A" }   // or "Apex A" for stinger
  ],

  warnings: {
    cogOutsidePolygon: boolean,
    negativeTension: boolean,
    topSlingAngleLow: boolean,          // any top sling < 30° from horizontal (hardcoded threshold, not user-configurable — industry practice minimum)
    liftBeamBendingNotChecked: boolean  // true for lifting beam config
  }
}
```

### Calculation Chain Per Config

**4-Leg Direct:**
LP positions + min angle → hook Z → sling lengths → load distribution (min-norm least squares) → tensions

**Spreader Beam:**
1. Group LPs by user-defined pairing (Group A, Group B)
2. Beam centre XY = midpoint between the two group midpoints (i.e. midpoint of [midpoint(LP_A1, LP_A2), midpoint(LP_B1, LP_B2)])
3. Beam end XY: beam centre ± (beam_length / 2) along the chosen orientation axis (lengthwise = along the longer span of the LP layout, widthwise = perpendicular)
4. Beam end A is the end closest to Group A midpoint, beam end B closest to Group B
5. Beam end Z = max(LP_z + h_dist_to_beam_end × tan(minAngle)) for each LP in that group
6. Top sling lengths from beam ends to hook (hook XY = COG XY)
7. Hook Z = beam_end_Z + top_h_dist × tan(computed_top_angle) — top angle is a calculated output, NOT constrained by minAngle
8. Bottom sling tensions from load distribution within each pair (2-sling per group, statically determinate)
9. Top sling tensions = sum of vertical loads per beam end (2-sling, statically determinate)

**Stinger / Eq. Triangle:**
1. Group LPs by user-defined pairing
2. Apex XY = midpoint of paired LPs (in plan view)
3. Apex Z = max(LP_z + h_dist × tan(minAngle)) for paired LPs
4. Top slings from apex points to hook
5. Hook Z derived from apex positions
6. Bottom sling tensions from load distribution per pair
7. Top sling tensions = sum of vertical loads per apex

**Lifting Beam:**
1. Group LPs by user-defined pairing
2. Beam centre XY and end XY: same logic as spreader beam (centre between group midpoints, ends along orientation axis)
3. Beam end Z from bottom sling min angle (same as spreader beam)
4. Beam is horizontal: both ends at same Z = max of the two computed beam end Zs
5. Single pickup point on beam at COG (X, Y), pickup Z = beam Z (interpolated along beam, but since beam is horizontal, same Z)
6. Hook XY = pickup XY = COG XY. Hook Z = pickup Z (the hook connects directly to the beam via shackle/pin — the connection is essentially zero-length vertically). The headroom output reflects the distance from highest LP to the beam, not to the hook.
7. Bottom sling tensions from load distribution per pair (2-sling per group, statically determinate)
8. **No top sling tier** — the lifting beam result has only a bottom sling tier and a beam. The "top connection" is a single vertical attachment, not a sling.

**Double Spreader (Parallel):**
1. Group LPs by pairing → 2 beam groups
2. Each beam: end XY from paired LP midpoints + orientation + beam length
3. Beam end Z from bottom sling min angle
4. 4 top slings from 4 beam ends to hook
5. Hook Z from top sling geometry
6. Tensions calculated per tier

**Double Spreader (Cascading):**
1. Group LPs by pairing → 2 slave beam groups
2. Slave beam ends from LP geometry + bottom sling angle
3. Middle slings from slave beam midpoints to master beam ends
4. Master beam ends from slave positions + master beam length + orientation
5. Top slings from master beam ends to hook
6. Hook Z from top tier geometry
7. Tensions cascade upward through tiers

## Results Display

### Summary Card
Same layout as current. Critical sling label includes tier: e.g. "Bottom Sling 2".

### Sling Details
One table per tier:
- **Bottom Slings** table: sling ID, from/to labels, length, angle (horiz/vert), H.dist, V.dist, tension, V.load, status
- **Top Slings** table: same columns
- **Middle Slings** table (cascading only): same columns

### Beam Details (new card, beam configs only)
- Beam name, length, orientation
- End A position (X, Y, Z)
- End B position (X, Y, Z)
- For lifting beam: pickup point position, note about bending capacity

### Intermediate Points (new card, stinger config)
- Label, position (X, Y, Z)

### Warnings
- COG outside LP polygon (existing)
- Negative tension in any sling (existing)
- Top sling angle below 30° from horizontal (new)
- Lifting beam bending not checked (new, lifting beam only)

## 2D Diagrams

### Plan View
- Beams drawn as thick coloured lines between end points
- Apex points drawn as triangles (stinger)
- Slings colour-coded by tier (e.g. blue = bottom, orange = top, purple = middle)
- LP pairing indicated by matching labels (A/B)
- Pickup point on lifting beam shown as dot on beam line
- Dimensions labelled per sling segment

### Elevation View
- Full vertical chain: LPs → beam ends / apex points → hook
- Beams as thick horizontal lines at their elevation
- Tier heights labelled
- Slings colour-coded same as plan view

## 3D Visualisation

- Beams rendered as thick lines or cylinders
- Apex points as small spheres
- Slings colour-coded by tier (matching 2D colours)
- CSS2D labels on beams and intermediate points
- Lifting beam pickup point highlighted
- Existing overlay/DXF/STL features unchanged

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `js/calc-core.js` | Shared math utilities (extracted from calc.js) |
| `js/calc-direct.js` | 4-leg direct calculation |
| `js/calc-spreader.js` | Spreader beam calculation |
| `js/calc-stinger.js` | Stinger / eq. triangle calculation |
| `js/calc-liftbeam.js` | Lifting beam calculation |
| `js/calc-double-par.js` | Double spreader (parallel) calculation |
| `js/calc-double-cas.js` | Double spreader (cascading) calculation |
| `js/calc-router.js` | Routes config type to correct module |

### Modified Files
| File | Changes |
|------|---------|
| `index.html` | Config dropdown, config-specific input panels, extra script tags, hardware weight note |
| `js/app.js` | Config dropdown handler, show/hide logic, LP pairing UI, pass config to calc-router |
| `js/diagram.js` | Multi-tier sling rendering, beam drawing, apex points, tier colour-coding |
| `js/scene.js` | 3D beams, apex spheres, colour-coded slings, intermediate point labels |
| `css/style.css` | Config panel styles, tier colour classes, beam/apex styles |

### Removed Files
| File | Reason |
|------|--------|
| `js/calc.js` | Replaced by `calc-core.js` + `calc-direct.js` + `calc-router.js` |

### No New Dependencies
Vanilla JS only. No npm, no bundler. All new files loaded via `<script>` tags.

## Backward Compatibility

- Default config is "4-Leg Direct" — produces identical numerical results to current calculator
- **Result object shape changes for ALL configs** including 4-leg direct: `slings[]` becomes `tiers[0].slings[]`, `criticalSlingId` becomes `criticalSling: { tier, id }`. All consumers (`app.js`, `diagram.js`, `scene.js`) must be updated to consume the new shape. There is no legacy result format.
- `SlingCalc.calculate()` call signature changes: `calculate(configType, sharedInputs, configInputs)` — `app.js` call sites must be updated
- Existing saved configs (localStorage) load as 4-leg direct (configType defaults to "direct" if absent)
- Print/PDF layout adapts to show relevant tiers and beams
- Existing presets still work for 4-leg direct
- `js/calc.js` is removed entirely — replaced by `calc-core.js` + `calc-direct.js` + `calc-router.js`

## Out of Scope

- Beam structural analysis (bending, shear, buckling) — user responsibility
- Sling WLL checking — listed as future TODO
- More than 4 lifting points
- Non-symmetric beam loading (beam self-weight distribution)
- Automated LP pairing suggestions
