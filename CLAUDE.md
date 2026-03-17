# CLAUDE.md — Sling Length Calculator

## What This Is
Web-based 4-point lift sling length calculator for crane rigging engineers.
Single-page app — no build system, no backend, open index.html and go.

## Tech Stack
- HTML/CSS/JS (vanilla, no frameworks)
- Three.js via CDN for 3D visualization
- All calculations client-side in `js/calc.js`

## Conventions
- **Sling angle convention**: Always measured from horizontal. Default 60°. Display both "from horizontal" and "from vertical" in output for clarity.
- **Units**: Metres and tonnes (Australian standard). Phase 3 adds unit toggle.
- **Coordinate system**: X = East, Y = North, Z = Up (right-hand rule)
- **Hook position**: Always directly above COG (X,Y). Only Z is calculated.

## File Responsibilities
| File | Does | Does NOT |
|------|------|----------|
| `js/calc.js` | All math: hook height, sling lengths, angles, load distribution | Touch the DOM or Three.js |
| `js/scene.js` | Three.js scene setup, rendering, labels | Calculations |
| `js/app.js` | Form handling, input validation, wiring calc→scene | Math or 3D rendering |
| `css/style.css` | All styling | — |
| `index.html` | Structure, script/style imports | Inline JS or CSS |

## Calculation Notes
- **Hook height**: `hook_z = max(lp_z_i + h_dist_i × tan(min_angle))` for all 4 LPs
- **Sling length**: `sqrt(h_dist² + (hook_z - lp_z)²)` per lifting point
- **Headroom**: `hook_z - max(lp_z)` — clearance above highest lifting point
- **Load distribution**: 4-point moment equilibrium about X and Y axes through COG
- All trig uses radians internally, degrees in UI

## Rules
- Keep `calc.js` pure functions with no side effects — it may be reused in other projects
- No npm, no bundler — CDN imports only
- Do not over-engineer: this is a calculator, not a platform
- Validate inputs at the UI layer (`app.js`), not in calc
- Print/PDF layout must include results + 2D diagram with dimensions
