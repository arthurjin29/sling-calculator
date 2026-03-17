# Sling Length Calculator — Project Plan

## Overview
Web-based 4-point lift sling calculator for crane rigging engineers.
Given lifting point coordinates, COG, load weight, and minimum sling angle → outputs sling lengths, load distribution, hook height, and a 3D interactive diagram with print-to-PDF.

## Tech Stack
- Single-page HTML/CSS/JS (no build system, no backend)
- Three.js for 3D visualization (CDN)
- Pure client-side calculations
- Hosted locally — just open index.html

## Inputs
| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Lifting Point 1–4 | X, Y, Z (metres) | — | 3D coordinates of each lug |
| Centre of Gravity | X, Y, Z (metres) | — | Load COG position |
| Total Suspended Load | Tonnes | — | Weight of load + rigging below hook |
| Minimum Sling Angle | Degrees from horizontal | 60° | Convention: always from horizontal |

## Calculations
1. **Hook position**: Hook X,Y = COG X,Y (vertical lift assumption)
2. **Hook height**: For each LP, compute horizontal distance to hook and required height to satisfy min angle. Hook Z = max of all required heights.
3. **Sling lengths**: 3D Euclidean distance from hook to each LP.
4. **Actual angles**: Per-sling angle from horizontal. Only the critical sling equals the minimum; others are steeper.
5. **Headroom**: Hook height above the load's highest lifting point — determines if crane has enough hook height.
6. **Sling load distribution**: Moment equilibrium about two axes through COG for 4-point statically determinate lift. Force per sling in tonnes.

## Outputs
| Output | Description |
|--------|-------------|
| Sling lengths | Per-sling length in metres |
| Actual sling angles | Per-sling angle from horizontal (degrees) |
| Sling loads | Per-sling force in tonnes |
| Hook height (absolute) | Z coordinate of hook block |
| Minimum headroom | Hook height above highest lifting point |
| Critical sling | Which sling governs (at minimum angle) |
| 3D diagram | Interactive Three.js scene |
| PDF export | Print-friendly layout with results + 2D diagram |

## Phases

### Phase 1 — Core Calculator + UI
- HTML form: 4 LPs (X,Y,Z each), COG (X,Y,Z), TSL (tonnes), min angle (default 60°)
- Calculation engine: hook position, sling lengths, actual angles, headroom
- Sling load distribution via moment equilibrium
- Results table: sling ID, length, angle, horizontal distance, sling load
- Summary: hook height, headroom, critical sling ID
- Responsive CSS layout
- Input validation

### Phase 2 — 3D Visualization
- Three.js scene with orbit controls
- Render: load footprint (rectangle between LPs), lifting points (spheres), hook block, sling lines
- Labels: sling length + angle on each line
- Colour coding: critical sling red/orange, others green
- Sling load labels
- Camera auto-framing to fit the rig
- COG marker on load

### Phase 3 — Print & Polish (COMPLETE)
- Print-to-PDF layout: results table + 2D plan view + elevation view with dimensions
- Preset templates (rectangular symmetric, offset COG examples)
- Unit toggle (metres ↔ feet, tonnes ↔ US tons)
- Save/load configurations (localStorage)
- Disclaimer banner (rigging estimation only, refer to AS)

### Phase 4a — Image & PDF Import
- File upload for PNG/JPG/PDF (GA drawings, photos)
- Display as background overlay in plan view (2D SVG diagram)
- Scale, position, and rotation controls to align with lifting points
- Opacity slider to adjust overlay transparency
- PDF rendered to canvas via pdf.js, then used as image overlay

### Phase 4b — DXF & STL Import
- DXF: parse 2D geometry (lines, polylines, circles, arcs) via dxf-parser library (CDN)
- Overlay DXF linework on the plan view diagram
- STL: load 3D mesh into Three.js scene via built-in STLLoader
- Position/scale/rotation controls to align model with lifting points
- Auto-detect bounding box from imported geometry

## File Structure
```
D:/Claude_project/
├── index.html          # Main app
├── css/
│   └── style.css       # Styling
├── js/
│   ├── calc.js         # Calculation engine
│   ├── scene.js        # Three.js 3D visualization
│   └── app.js          # UI logic, form handling
├── js/
│   ├── calc.js         # Calculation engine
│   ├── scene.js        # Three.js 3D visualization (ES module)
│   ├── diagram.js      # 2D SVG plan + elevation diagrams
│   ├── overlay.js      # Image/PDF overlay on plan view (Phase 4a)
│   └── app.js          # UI logic, form handling
├── PLAN.md             # This file
└── CLAUDE.md           # Project instructions
```

## Key Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| No framework | Overkill for a single-page calculator | 2026-03-17 |
| Three.js over Plotly | Better 3D control, labels, interactivity | 2026-03-17 |
| Separate JS modules | Clean separation of calc / render / UI | 2026-03-17 |
| Metres as default unit | Australian engineering standard | 2026-03-17 |
| Angle from horizontal | Consistent convention, default 60° | 2026-03-17 |
| TSL in Phase 1 | Sling load distribution is core, not optional | 2026-03-17 |
| Print-to-PDF in Phase 3 | Riggers need paper on site | 2026-03-17 |
| DXF over DWG | DWG is proprietary binary, no reliable browser parser; DXF is one-click export from AutoCAD | 2026-03-17 |
| pdf.js for PDF import | Mozilla's PDF renderer, renders pages to canvas for overlay use | 2026-03-17 |
| dxf-parser for DXF | Lightweight JS library, handles lines/polylines/circles/arcs | 2026-03-17 |
