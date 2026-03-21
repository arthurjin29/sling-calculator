# Multi-Configuration Rigging Calculator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the 4-point sling calculator to support 6 rigging configurations (direct, spreader beam, stinger/equalising triangle, lifting beam, double spreader parallel, double spreader cascading).

**Architecture:** Modular calc engine — shared core utilities in `calc-core.js`, one calc file per configuration, thin router in `calc-router.js`. All modules attach to `window` globals. Standardised result object with `tiers[]`, `beams[]`, `intermediatePoints[]` consumed by diagram/3D/UI.

**Tech Stack:** Vanilla HTML/CSS/JS, Three.js (CDN), no build system, no npm.

**Spec:** `docs/superpowers/specs/2026-03-21-multi-config-rigging-design.md`

**Note on innerHTML:** This project uses innerHTML for building SVG strings and table rows from computed numeric values only (never user-supplied text). All displayed values are numeric outputs from the calculation engine. This is acceptable for a client-side-only calculator with no external data sources.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `js/calc-core.js` | Shared math: trig, distance, polygon test, generalised load distribution (N-sling), 2-sling tension solver, linear algebra |
| `js/calc-direct.js` | 4-leg direct calculation → standardised result |
| `js/calc-spreader.js` | Spreader beam calculation → standardised result |
| `js/calc-stinger.js` | Stinger / eq. triangle calculation → standardised result |
| `js/calc-liftbeam.js` | Lifting beam calculation → standardised result |
| `js/calc-double-par.js` | Double spreader (parallel) calculation → standardised result |
| `js/calc-double-cas.js` | Double spreader (cascading) calculation → standardised result |
| `js/calc-router.js` | `SlingCalc.calculate(configType, shared, config)` → routes to correct module |

### Modified Files
| File | Changes |
|------|---------|
| `index.html` | Config dropdown in toolbar, 6 config-specific input panels, hardware weight note, new script tags, remove `calc.js` script tag |
| `js/app.js` | Config dropdown handler, show/hide panels, LP pairing UI + validation, `readInputs()` returns config-specific data, `runCalculation()` passes configType, `displayOutput()` consumes tiers[], unit conversion updated for tiers[], `convertResultsToImperial()` handles tiers/beams |
| `js/diagram.js` | `render()` consumes standardised result: draw beams as thick lines, apex points as triangles, slings colour-coded by tier, multi-tier elevation chain |
| `js/scene.js` | `update()` consumes standardised result: beam cylinders, apex spheres, tier-coloured sling tubes, intermediate point labels |
| `css/style.css` | Config panel styles, tier colour classes, beam/apex marker styles |

### Removed Files
| File | Reason |
|------|--------|
| `js/calc.js` | Replaced by `calc-core.js` + `calc-direct.js` + `calc-router.js` |

---

## Task 1: Extract `calc-core.js` from `calc.js`

**Files:**
- Create: `js/calc-core.js`
- Read: `js/calc.js` (source of extraction)

- [ ] **Step 1: Create `calc-core.js` with extracted + new utilities**

Extract `degToRad`, `radToDeg`, `round2`, `round4`, `horizontalDist`, `pointInPolygon2D`, `mat3x3Inverse` from `calc.js`. Create new: `dist3D`, `midpoint`, generalised `transpose`, `matMultiply`, `calcLoadDistribution` (N-sling), `calcTwoSlingTension`, `buildSling`, `getOrientationAxis`, `computeBeamEnds`, `computeBeamEndZ`. Expose as `window.CalcCore` IIFE.

See spec section "Shared core (calc-core.js)" for the full function list and signatures.

- [ ] **Step 2: Verify in browser console**

Open `index.html` with `calc-core.js` added as script tag. Check:
```
CalcCore.degToRad(60)        // ~1.047
CalcCore.dist3D({x:0,y:0,z:0}, {x:3,y:4,z:0})  // 5
CalcCore.round4(1.23456789)  // 1.2346
```

- [ ] **Step 3: Commit**

```bash
git add js/calc-core.js
git commit -m "feat: extract calc-core.js with shared math utilities"
```

---

## Task 2: Create `calc-direct.js` — 4-leg direct sling module

**Files:**
- Create: `js/calc-direct.js`
- Read: `js/calc.js:19-103` (existing calculate function to port)

- [ ] **Step 1: Create `calc-direct.js`**

Port the existing `SlingCalc.calculate()` logic to use `CalcCore` utilities and return the standardised result shape. Expose as `window.CalcDirect = { calculate }`.

Function signature: `calculate(shared, config)` where `shared = { liftingPoints, cog, minAngleDeg, totalLoad }` and `config = {}`.

Key mapping from old to new result:
- `slings[i]` → `tiers[0].slings[i]` with `from: {...lp, label}` and `to: {...hook, label}`
- `criticalSlingId` → `criticalSling: { tier: 'bottom', id }`
- Single tier named 'Slings', empty `beams[]` and `intermediatePoints[]`

- [ ] **Step 2: Commit**

```bash
git add js/calc-direct.js
git commit -m "feat: add calc-direct.js for 4-leg sling calculation"
```

---

## Task 3: Create `calc-router.js` and wire up

**Files:**
- Create: `js/calc-router.js`
- Modify: `index.html` (swap script tags)

- [ ] **Step 1: Create `calc-router.js`**

Expose `window.SlingCalc = { calculate(configType, shared, config) }`. Use lazy module resolution (check `typeof` at call time, not at load time) so modules can load in any order.

- [ ] **Step 2: Update `index.html` script tags**

Replace `<script src="js/calc.js"></script>` with:
```html
<script src="js/calc-core.js"></script>
<script src="js/calc-direct.js"></script>
<script src="js/calc-router.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add js/calc-router.js index.html
git commit -m "feat: add calc-router.js, swap script tags in index.html"
```

---

## Task 4: Update `app.js` to consume standardised result

**Files:**
- Modify: `js/app.js:289-337` (`runCalculation`)
- Modify: `js/app.js:349-371` (`convertResultsToImperial`)
- Modify: `js/app.js:458-489` (`displayOutput`)
- Modify: `js/app.js:491-517` (`displayWarnings`)
- Modify: `index.html` (results section containers)

Critical migration — after this, 4-leg direct works end-to-end with new architecture.

- [ ] **Step 1: Refactor `readInputs()` to separate shared + config inputs**

`readInputs()` currently returns `{ liftingPoints, cog, totalLoad, minAngle }`. Change it to also return `configType: 'direct'` and `configData: {}`. Config-specific panels don't exist until Task 7, so hardcode `'direct'` and `{}` for now:

```javascript
return { liftingPoints, cog, totalLoad, minAngle, configType: 'direct', configData: {} };
```

- [ ] **Step 2: Update `runCalculation()` call signature**

Change `SlingCalc.calculate(lps, cog, angle, load)` to `SlingCalc.calculate(inputs.configType, { liftingPoints, cog, minAngleDeg, totalLoad }, inputs.configData)`.

- [ ] **Step 2b: Update save/load to handle missing configType**

In `loadConfig()`, default missing `_configType` to `'direct'`:
```javascript
const configType = data._configType || 'direct';
```
In `saveConfig()`, include `formData._configType = currentConfig || 'direct';`
This prevents breakage when loading configs saved before multi-config support.

- [ ] **Step 3: Update `convertResultsToImperial()`**

Handle `tiers[].slings[]` (with `from`/`to` instead of `liftingPoint`), `beams[]`, `intermediatePoints[]`.

- [ ] **Step 4: Update `displayOutput()`**

Iterate `r.tiers` to build one table per tier. Replace static `sling-table-body` with dynamic `sling-tables-container`. Add `beam-details-container` for beam info. Update critical sling label to include tier name.

- [ ] **Step 5: Update `displayWarnings()`**

Add `topSlingAngleLow` and `liftBeamBendingNotChecked` warning messages.

- [ ] **Step 6: Update `index.html` results section**

Replace the static sling `<table>` with `<div id="sling-tables-container"></div>`. Add two new cards after sling details:
```html
<div class="card" id="beam-details-container" style="display:none">
  <h2>Beam Details</h2>
</div>
<div class="card" id="intermediate-points-container" style="display:none">
  <h2>Intermediate Points</h2>
</div>
```

Also update `displayOutput()` to populate the intermediate points container when `r.intermediatePoints.length > 0` (shows apex positions for stinger config, beam end positions for beam configs).

- [ ] **Step 7: Verify — load preset, calculate, confirm identical results**

Expected: same numbers as before. Table shows "Slings" heading. No beam details. No console errors.

- [ ] **Step 8: Commit**

```bash
git add js/app.js index.html
git commit -m "feat: migrate app.js to consume standardised result from calc-router"
```

---

## Task 5: Update `diagram.js` for standardised result

**Files:**
- Modify: `js/diagram.js`

- [ ] **Step 1: Update `renderPlanView` and `renderElevationView`**

- Extract slings from `results.tiers[].slings` using `sling.from` / `sling.to`
- Colour-code by tier: blue (#2980b9) = bottom, orange (#e67e22) = top, purple (#9b59b6) = middle
- Draw beams as thick red lines with end markers
- Draw intermediate points (apex markers for stinger)
- Update bounds calculation to include beam ends and intermediate points

- [ ] **Step 2: Verify plan + elevation views render correctly for direct config**

- [ ] **Step 3: Commit**

```bash
git add js/diagram.js
git commit -m "feat: update diagram.js for standardised multi-tier result"
```

---

## Task 6: Update `scene.js` for standardised result

**Files:**
- Modify: `js/scene.js:104-252` (`update` function)

- [ ] **Step 1: Update `update()` function**

- Iterate `results.tiers[].slings` for sling tubes (colour by tier)
- Add beam rendering: thick tube geometry for each beam in `results.beams[]`
- Add intermediate point markers: spheres + labels for `results.intermediatePoints[]`
- Update `fitCameraToScene` to include beam ends and intermediate points

- [ ] **Step 2: Verify 3D view for direct config (same as before)**

- [ ] **Step 3: Commit**

```bash
git add js/scene.js
git commit -m "feat: update scene.js for standardised multi-tier result"
```

---

## Task 7: Add config UI — dropdown, panels, LP pairing

**Files:**
- Modify: `index.html` (dropdown + 6 panels)
- Modify: `js/app.js` (handler, show/hide, pairing validation, readInputs extended)
- Modify: `css/style.css` (panel styles)

- [ ] **Step 1: Add config dropdown to toolbar in `index.html`**

Options: `direct`, `spreader-beam`, `stinger`, `lifting-beam`, `double-parallel`, `double-cascade`.

- [ ] **Step 2: Add 5 config-specific panels in `index.html`**

Each panel contains the relevant inputs per spec:
- Spreader: beam length, orientation, LP pairing (4 dropdowns)
- Stinger: LP pairing only
- Lifting beam: beam length, orientation, LP pairing
- Double parallel: 2x beam length, 2x orientation, LP pairing
- Double cascade: master length/orientation, 2x slave length/orientation, LP pairing

Default pairing: LP1+LP2 → Group A, LP3+LP4 → Group B.

- [ ] **Step 3: Add hardware weight note below Total Load**

- [ ] **Step 4: Add CSS for config panels, pairing grid, error styling**

- [ ] **Step 5: Add JS logic: config dropdown handler, panel show/hide, LP pairing validation, `readConfigInputs()`, update `runCalculation()` to pass configType**

- [ ] **Step 6: Verify — dropdown switches panels, direct still calculates**

- [ ] **Step 7: Commit**

```bash
git add index.html js/app.js css/style.css
git commit -m "feat: add config dropdown, config-specific panels, LP pairing UI"
```

---

## Task 8: Implement `calc-spreader.js`

**Files:**
- Create: `js/calc-spreader.js`
- Modify: `index.html` (add script tag)

**Note:** `calc-router.js` uses lazy `typeof` checks at call time — no router modification needed when adding new config modules. Just add the script tag before `calc-router.js`.

- [ ] **Step 1: Create `calc-spreader.js`**

Expose `window.CalcSpreader = { calculate }`. Implementation per spec:
1. Group LPs by pairing
2. Beam centre = midpoint of group midpoints
3. Beam ends via `CalcCore.computeBeamEnds(centre, length, axis)`
4. Assign End A closest to Group A midpoint
5. Beam end Z via `CalcCore.computeBeamEndZ(groupLPs, beamEndXY, minAngleRad)`
6. Hook at COG XY, hook Z from beam end geometry
7. Bottom slings: 4 slings (each LP → its beam end)
8. Top slings: 2 slings (each beam end → hook)
9. Tensions via `CalcCore.calcTwoSlingTension` per group
10. Check top sling angles for < 30deg warning
11. Return with `beams: [{ name, endA, endB, length }]` and `intermediatePoints` for beam ends

- [ ] **Step 2: Add script tag in `index.html`** (after `calc-direct.js`, before `calc-router.js`)

- [ ] **Step 3: Verify with rectangular preset, 6m beam, lengthwise**

- [ ] **Step 4: Commit**

```bash
git add js/calc-spreader.js index.html
git commit -m "feat: implement spreader beam configuration"
```

---

## Task 9: Implement `calc-stinger.js`

**Files:**
- Create: `js/calc-stinger.js`
- Modify: `index.html` (add script tag)

- [ ] **Step 1: Create `calc-stinger.js`**

Like spreader beam but no rigid beam:
1. Apex XY = midpoint of each paired group
2. Apex Z from `computeBeamEndZ` logic
3. No beams in result — `intermediatePoints` for apex markers
4. Bottom + top slings as per spreader

- [ ] **Step 2: Add script tag, verify, commit**

```bash
git add js/calc-stinger.js index.html
git commit -m "feat: implement stinger / equalising triangle configuration"
```

---

## Task 10: Implement `calc-liftbeam.js`

**Files:**
- Create: `js/calc-liftbeam.js`
- Modify: `index.html` (add script tag)

- [ ] **Step 1: Create `calc-liftbeam.js`**

Key differences from spreader:
1. Beam horizontal — both ends at max computed Z
2. Single pickup point at COG XY, beam Z
3. Hook Z = beam Z (zero-length vertical connection)
4. Only 1 tier (bottom slings) — no top sling tier
5. `warnings.liftBeamBendingNotChecked = true`

- [ ] **Step 2: Add script tag, verify, commit**

```bash
git add js/calc-liftbeam.js index.html
git commit -m "feat: implement lifting beam configuration"
```

---

## Task 11: Implement `calc-double-par.js`

**Files:**
- Create: `js/calc-double-par.js`
- Modify: `index.html` (add script tag)

- [ ] **Step 1: Create `calc-double-par.js`**

Two independent beams:
1. Each beam: group midpoint as centre, own length/orientation
2. Beam end Z from bottom sling angle per group
3. Top tier: 4 slings from 4 beam ends to hook. The total load for the top-tier distribution is the original `totalLoad` (since all load passes through to the hook). Use `calcLoadDistribution(beamEndPoints, hook, totalLoad)` with N=4.
4. Hook Z from top sling geometry
5. Two beams in result

- [ ] **Step 2: Add script tag, verify, commit**

```bash
git add js/calc-double-par.js index.html
git commit -m "feat: implement double spreader (parallel) configuration"
```

---

## Task 12: Implement `calc-double-cas.js`

**Files:**
- Create: `js/calc-double-cas.js`
- Modify: `index.html` (add script tag)

- [ ] **Step 1: Create `calc-double-cas.js`**

Three-tier cascading:
1. Slave beam ends from LP geometry + bottom angle
2. Slave midpoints = geometric midpoints of slave beam ends
3. Master centre = midpoint of slave midpoints, master ends along master orientation
4. Master end Z from middle sling geometry
5. Top slings: master ends → hook
6. Three tiers: bottom, middle, top. Three beams in result.

- [ ] **Step 2: Add script tag, verify, commit**

```bash
git add js/calc-double-cas.js index.html
git commit -m "feat: implement double spreader (cascading) configuration"
```

---

## Task 13: Final cleanup and integration testing

**Files:**
- Remove: `js/calc.js`
- Modify: `js/app.js` (save/load includes configType)

- [ ] **Step 1: Delete `js/calc.js`**

- [ ] **Step 2: Verify save/load persists configType correctly**

(Basic configType save/load was added in Task 4 Step 2b. Here, also persist config-specific fields like beam lengths and LP pairing selections.)

- [ ] **Step 3: Verify print/PDF layout**

The existing print CSS (`css/style.css` `.no-print` class) hides overlays/DXF/STL controls. Verify that the new multi-tier sling tables, beam details card, and intermediate points card render correctly in print view for each config type. The 2D diagrams should show beams/apex points in print.

- [ ] **Step 4: Verify `cadimport.js` and `overlay.js` are unaffected**

These files do NOT consume `SlingCalc` results — they only interact with the plan-view SVG and 3D scene. Confirm no console errors when using DXF/STL/overlay features with a non-direct config.

- [ ] **Step 5: End-to-end test all 6 configs**

With "Rectangular (symmetric)" preset:
1. 4-Leg Direct — identical to original
2. Spreader Beam (6m, lengthwise)
3. Stinger (default pairing)
4. Lifting Beam (6m, lengthwise)
5. Double Parallel (4m each, lengthwise)
6. Double Cascade (8m master, 4m slaves)

Check: results, 2D diagrams, 3D view, print layout, unit switching, save/load.

- [ ] **Step 6: Commit**

```bash
git rm js/calc.js
git add js/app.js
git commit -m "feat: complete multi-config rigging calculator — remove legacy calc.js"
```

---

## Summary

| Task | Description | Depends On |
|------|------------|------------|
| 1 | Extract calc-core.js | — |
| 2 | Create calc-direct.js | 1 |
| 3 | Create calc-router.js + wire up | 2 |
| 4 | Migrate app.js to new result shape | 3 |
| 5 | Update diagram.js | 4 |
| 6 | Update scene.js | 4 |
| 7 | Config UI (dropdown, panels, pairing) | 4 |
| 8 | Spreader beam calc | 7 |
| 9 | Stinger calc | 7 |
| 10 | Lifting beam calc | 7 |
| 11 | Double parallel calc | 7 |
| 12 | Double cascade calc | 7 |
| 13 | Cleanup + integration test | 8-12 |

Tasks 5, 6, 7 can run in parallel after Task 4. Tasks 8-12 can run in parallel after Task 7. **Note:** Beam/apex rendering in Tasks 5-6 can only be visually verified after a beam config module exists (Tasks 8+). For Tasks 5-6, verify only that the direct config still renders correctly.
