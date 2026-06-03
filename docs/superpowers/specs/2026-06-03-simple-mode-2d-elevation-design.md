# Simple Mode — 2D Elevation Front-End for the Sling Calculator

**Date:** 2026-06-03
**Status:** Design approved, pending spec review
**Project:** `sling-length-calculator`

## Problem

User feedback: the calculator is too hard to understand and use. It was built for engineers, but the real users are a **mix — mostly coordinators** — who are not rigging engineers. Today the tool requires entering **15+ raw XYZ coordinates** (4 lift points × X/Y/Z, plus COG × X/Y/Z) in a 3D Cartesian frame, then choosing pairings from dropdowns. That mental model defeats non-engineer users.

The output they actually need is an **estimate** — guidance on what rigging to grab (rough sling length, angle, whether it's safe, leg load) — not precision cut lengths. They use it on **both phone and desktop**.

## Decision summary

Introduce a **Simple mode**: a 2D elevation where the user sketches the lift geometry directly on the drawing and gets a plain-language estimate. The existing full **Advanced (3D)** tool is left untouched. Simple mode loads first; jobs that outgrow it **transfer into the 3D calculator** with no data re-keyed.

**Rejected alternative — read from drawing snapshot (OCR/CV):** high-effort computer-vision problem (engineering drawings vary wildly) whose payoff evaporates exactly for the target users, who rarely have a dimensioned drawing on a phone. The existing image/PDF *overlay* feature (`index.html:386`) already serves engineers who do have drawings.

## Goal & principle

A coordinator-friendly **front door** giving a ballpark *"use ~X m slings at ~Y°, leg load ≈ Z t"* answer from geometry sketched on a 2D elevation. Estimate-grade precision. Phone- and desktop-friendly. The existing structure is preserved — Simple mode is additive.

## Scope

- **Two configurations only:** 4-Leg Direct + Spreader Beam. Everything else remains Advanced-only.
- **Inputs (all entered on the graph; hybrid drag + type):**
  - Load weight
  - Load outline W × H (provides the "from left / from bottom" reference and draws the box)
  - **COG** — distance from left, distance from bottom
  - **LP1** — distance from left, distance from bottom
  - **LP2** — distance from LP1 (horizontal), distance from bottom
  - **Headroom** — hook height above the load (the single vertical driver)
  - Spreader Beam adds: beam length + top-sling length
- The hook hangs **plumb above the COG**; COG position therefore drives the load share between the two legs.

**Out of scope:** sling WLL catalogue / sling-type selection (consistent with Advanced, where it was de-scoped); configs beyond the two workhorses; precision cut-length output; 3+ point lifts in Simple mode (handled by transferring to 3D).

## Interaction model

**Hybrid drag + type.** Each point (COG, LP1, LP2) has a draggable handle on the SVG elevation; each dimension is an editable chip pinned to the drawing. Rough it in by dragging, fine-tune by typing an exact value. Works on touch and mouse without a mode switch. The drawing redraws live as values change.

## Architecture

Fits the existing vanilla HTML / ES-module structure. New units:

| Unit | Responsibility | Depends on |
|---|---|---|
| `js/calc-simple.js` | **Pure math** — 2-point asymmetric elevation lift: per-leg sling length, angle, tension, and load share derived from COG position; spreader-beam variant | `calc-core.js` (reuse trig / tension / load-share math — single source of truth) |
| `js/sketch2d.js` | **SVG elevation renderer + interaction** — draws hook, slings, load box, COG, lift points; draggable handles; editable dimension chips; emits geometry on change | — |
| `js/simple-app.js` | Wires inputs ↔ sketch ↔ results ↔ handoff; owns the `simpleState` object | `calc-simple`, `sketch2d` |
| `js/app.js` (existing) | Add a top-level **Simple / Advanced** mode toggle; Simple is the default view | — |
| `buildAdvancedModel()` (in `calc-simple.js` or a small `handoff.js`) | Maps `simpleState` → 4-lift-point XYZ model for the 3D tool | `calc-core.js` |

Simple mode uses **no Three.js** — the elevation is lightweight SVG, fast on phones. Advanced mode keeps `scene.js` (Three.js) unchanged.

## Data flow

```
drag / type
  → sketch2d emits geometry
    → simple-app updates simpleState
      → calc-simple computes results
        → results panel + live SVG redraw
```

One `simpleState` object (weight, load W×H, COG, LP1, LP2, headroom, config, and for spreader: beam length + top-sling length) is the single source of truth and the payload handed to 3D.

## The 3D handoff

The defining feature. Simple mode lives in **one vertical plane with 2 lift points**; the Advanced tool is built around **4 lift points in space** (its engine already handles N=2 via moment balance, per `calc-core` notes).

- **"Continue in 3D →"** calls `buildAdvancedModel(simpleState, depthOffset)`.
- **Default = mirror to a symmetric 4-point load:** the elevation is treated as the side view; `LP1 → {LP1, LP3}` and `LP2 → {LP2, LP4}`, each offset by ± `depthOffset` along the depth axis; COG centred across depth.
- **`depthOffset` is editable**, presented with a sensible default (e.g. 2.0 m) that the user can overwrite before jumping.
- The result prefills the Advanced inputs and switches mode, so the user lands on a complete, working 3D model and only needs to refine it.

## Results / guidance

- **Plain-language line:** e.g. *"Use ~3.3 m slings; both legs ≥ 45° ✓; choose slings rated ≥ 5.4 t at this angle."*
- **Per-leg table:** length / angle / tension for each leg (they differ under an off-centre COG).
- Reuses existing angle thresholds: **30° hard floor, 30–44° amber warning, 45°+ normal.**
- WLL guidance stays light: report required leg tension and "pick slings above this." No sling catalogue.

## Error handling / edge cases

- **COG outside the LP horizontal span** → load will not balance: clear *"COG is outside the pick points — load will swing"* warning.
- **Leg angle below 30°** → blocked with the existing floor message.
- **Degenerate geometry** (LP1 == LP2, zero or negative headroom, zero load) → guarded with friendly messages.
- **Spreader:** top-sling length / beam length producing < 30° top angle → amber/blocked consistent with bottom-leg handling.

## Testing

Extend `test-calc.js` (all **103 existing tests must stay green**) with hand-derived Simple-mode vectors:

1. Symmetric pick — equal legs, COG centred (sanity baseline).
2. Asymmetric COG — verify load share and the two differing leg tensions/angles.
3. Spreader-beam variant — top + bottom slings.
4. Handoff — assert `buildAdvancedModel` emits the expected 4-lift-point coordinates for a known `simpleState` + `depthOffset`.

## Open items / deferred

- Mobile responsiveness polish (Simple mode is designed phone-first, but CSS refinement may be a follow-up pass).
- Spreader-beam Simple-mode input ergonomics may need a visual iteration during implementation.
