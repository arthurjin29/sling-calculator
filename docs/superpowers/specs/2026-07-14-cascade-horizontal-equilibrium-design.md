> ⚠️ **SUPERSEDED (2026-07-16)** by
> `2026-07-16-cascade-fixed-length-main-beam-design.md`. The pick-over-sub-COG model
> and the `mainBeamTooShort` warning described below are **retired** — the Main Beam is
> now a fixed-length bar whose picks are its two ends. Kept for history only; do not
> implement from this doc.

# Cascade Horizontal Equilibrium (Pick-Over-Sub-COG) — Design

**Config affected:** Double Spreader (Cascading) only. All other configs untouched.

**Date:** 2026-07-14

**Supersedes:** the "COG re-centring" behaviour of `2026-07-14-cascade-per-lay-angle-and-cog-recentre-design.md` (the part that moved the Main Beam onto the COG, later reverted to the LP-midpoint on branch `fix/cascade-beam-over-lps`). The per-lay angle behaviour from that spec is retained unchanged.

---

## 1. Problem

For an off-centre COG, the current cascade geometry does not hang plumb. The Main Beam ends sit at `masterCenter ± halfMaster` along the LP-midpoint axis, while the hook sits over the COG. When the COG is offset **perpendicular** to the beam axis, the hook is not on the line between the two Main-Beam ends, so the two top slings pull the hook sideways and the whole assembly leans/swings until it finds a tilted rest position.

**Measured (evidence probe, `scratchpad/residual-probe.js`), LPs at (±4, ±2, 0), 100 t, COG at (0, 1.5):**

| Geometry | Net horizontal force at hook | Top slings |
|---|---|---|
| Current | **25.82 t (25.8 % of load)** — leans | 6.71 / 6.71 m (equal — wrong for offset COG) |
| Proposed | **0.000 t** — hangs plumb | correctly asymmetric |

For an **on-axis** offset (COG at (2, 0)) the current geometry already balances at the hook (0.000 t) — confirming the imbalance is specifically the perpendicular / general-offset case — but its top-sling lengths are still less accurate than the proposed model.

## 2. The model — pick each beam over the COG of the load it carries

The imbalance is a mismatch between where each beam is **picked** (geometric midpoint) and where its load actually acts (the sub-load COG). Fix the mismatch at every level:

- **2nd-Lvl Beam A** carries its two LPs → its pick sits over the COG of *that pair's* load share.
- **2nd-Lvl Beam B** likewise.
- **Main Beam** carries the two 2nd-level sub-loads → its pick (the hook) sits over the combined COG = the **total COG** (unchanged — hook stays at COG).

Because the total COG is the load-weighted mean of the two sub-COGs, the hook lies exactly **on the line between the two Main-Beam pick points** in plan, for a COG offset in *any* direction. The two top slings then straddle the hook and their horizontal thrusts cancel → **zero net horizontal at the hook → no lean.** This is the exact, verifiable property the fix delivers.

The visible outcome: slings come out at **different lengths** — on each beam the sling toward the heavier side is shorter/steeper — which is how a rigger keeps a beam level over an offset load.

### 2.1 Fixed-length Main Beam, pick points inboard (chosen)

The Main Beam is a physical bar of the entered `masterLength`. Its two **sling pick points** (where the top slings and each side's middle slings attach) slide **inboard** to sit over the two sub-COGs. The bar's physical ends extend beyond the picks by a symmetric overhang. This honours the user's `masterLength` input and matches real rigging (you attach slings inboard on a beam you own), using the existing `pickupPoint` result field.

- `pickSpacing = horizontalDist(subCOG_A, subCOG_B)`
- `physicalLength = max(masterLength, pickSpacing)`
- `overhang = (physicalLength − pickSpacing) / 2` (each end, along the beam axis)
- Beam axis = unit vector `subCOG_A → subCOG_B`.
- If `masterLength < pickSpacing`: the entered bar is too short to reach both sub-COGs → emit warning `mainBeamTooShort` and render the bar at `pickSpacing` (statics stay correct; the warning tells the user to size up). The picks remain over the sub-COGs regardless.

The **2nd-Lvl (slave) beams are unchanged in structure**: their ends remain both the bottom-sling and middle-sling attachment points, placed by the existing `computeBeamEndPair` (input length is a target, actual is derived). Only their *target* changes — they now aim at the Main Beam pick points (over the sub-COGs) instead of the old `masterCenter ± half` ends. This is sufficient: with a pick over `subCOG_A`, the load-weighted midpoint of the two slave ends stays directly under the pick for any placement fraction `t` (algebraically: `subCOG_A + t·(pick − subCOG_A) = subCOG_A` since `pick` is at `subCOG_A` in plan), so each slave beam is balanced under its pick.

## 3. Load-share convention — min-norm rigid-body reactions

Per-LP vertical share drives the sub-COGs. Use the **minimum-norm rigid-body support reaction** distribution — the standard convention for a statically indeterminate 4-point support:

Solve `A·R = b` with
- rows: `[1,1,1,1]`, `[x_i − cog.x]`, `[y_i − cog.y]`; `b = [totalLoad, 0, 0]`
- min-norm solution `R = Aᵀ(AAᵀ)⁻¹b` (reuses `transposeNxM`, `matMxNMultiply`, `mat3x3Inverse`).

Properties: `ΣR_i = totalLoad`, and the reaction-weighted centroid of the LPs equals the COG exactly, so the two sub-COGs and the total COG nest consistently (hook automatically collinear with the picks). Coordinate-free — no axis assumption. Matches the codebase's existing "least-squares / min-norm for N≥3" philosophy in `calcLoadDistribution`.

**Sub-COG:** `subCOG_side = Σ(R_i · LP_i) / Σ(R_i)` over that side's LP indices (plan x,y only).

**Edge case — negative reaction:** near or outside the LP polygon a reaction can go negative, making a sub-COG unreliable. `cogOutsidePolygon` already flags COG outside the polygon; additionally, if any reaction `< 0`, fall back to that side's geometric LP midpoint for its sub-COG and set warning `subCogFallback`. Within a convex polygon reactions are non-negative and the primary path is used.

## 4. Files & responsibilities

- **`js/calc-core.js`** — add `computeSupportReactions(liftingPoints, cog, totalLoad)` returning `number[4]` (min-norm reactions). Pure, reuses existing linear-algebra helpers. Export it. No change to existing functions.
- **`js/calc-double-cas.js`** — the substantive change:
  - Replace `masterCenter = midpoint(lpMidA, lpMidB)` + `masterEnd{A,B}xy = masterCenter ± half·u` with: compute reactions → sub-COGs → `pickA`/`pickB` (plan positions at the sub-COGs).
  - The Z-solve iteration, `computeBeamEndPair` calls, and per-lay angle logic are retained, but the "master end" fed to them becomes the **pick point** (`{...pickA, z: masterZ}`), not the old geometric end.
  - Top slings: `pickA → hook`, `pickB → hook`. Middle slings: slave ends `→ pickA` / `→ pickB`. Tensions: `calcTwoSlingTension(pickA, pickB, hook, …)` and `calcTwoSlingTension(slaveA1, slaveA2, pickA, …)` etc. (pick points replace the old ends).
  - Compute Main Beam **physical ends** from `pickA`/`pickB`, beam axis, and `physicalLength`/`overhang` (§2.1). `result.beams[0].endA/endB` = physical ends; `length` = `round4(physicalLength)`; `pickupPoint` unchanged as `null` (two picks are exposed via `intermediatePoints`, see below).
  - `intermediatePoints`: rename the two Main-Beam entries `'Main End A'/'B'` → `'Main Pick A'/'B'` at `pickA`/`pickB` (these are the actual sling attach points the 3D view marks).
  - New warnings: `mainBeamTooShort`, `subCogFallback`.
- **`js/scene.js`** — no structural change required. The beam bar draws between `endA`/`endB` (now physical ends); slings draw from tier `from`/`to` (now pick points). Verify visually only.
- **`js/app.js`** — no change required for the two-pick case (picks display via `intermediatePoints`, which app.js already renders). Confirm the new warning keys surface if a warnings panel enumerates them; if warnings are enumerated explicitly, add `mainBeamTooShort` and `subCogFallback` to the display map.
- **`test-calc.js`** — add equilibrium + geometry assertions (§6). Replace/extend the existing `runCascadeBeamOverLpsTest`.

## 5. Data flow

`liftingPoints, cog, totalLoad` → `computeSupportReactions` → `R[4]` → sub-COGs `subCOG_A/B` → pick points `pickA/pickB` (plan) → masterZ iterative solve (unchanged, using picks) → slave ends via `computeBeamEndPair(…, pick, …)` → hook at `{cog.x, cog.y, masterZ + …·tan(topAngle)}` → slings built from picks/slave-ends/LPs → cascade tension solve (unchanged, using picks) → Main Beam physical ends from picks + `masterLength` → result.

## 6. Equilibrium scope — what is and isn't guaranteed

**Guaranteed and verified:** zero net **horizontal force at the hook** (the pendulum/lean DOF) for a COG offset in any in-plan direction, because the hook is collinear with the two picks. The load hangs plumb with the hook over the true COG. Each beam is level (Z-solve sets both ends to one Z) and picked over its sub-load COG.

**Not claimed:** this is **not** a fully coupled node-equilibrium solver. Horizontal thrust at the intermediate beam pick points is carried by the rigid spreader beams themselves (that is what a spreader beam does — it takes the compression/thrust); it is not a free swing DOF. The cascade tension solve remains vertical-exact and tier-by-tier, now operating on balanced geometry. Reporting per-member internal thrust or a global stiffness solve is explicitly **out of scope** for this change.

## 7. Testing

Add to `test-calc.js` (Node harness, invariant assertions). All existing tests must continue to pass (146 currently).

- `dbl-cas-perp-cog-hook-balanced`: LPs (±4,±2,0), COG (0,1.5), 100 t, min-angle 60. Assert **net horizontal force at the hook < 0.5 t** (0.5 % of load), computed as `Σ topSling.tension · unit(hook→pick)` over the two top slings. Top slings are equal here by x-symmetry (assert equal within 1e-3); the asymmetry shows in the middle/bottom shares.
- `dbl-cas-onaxis-cog-asym-top`: COG (2,0). Assert hook horizontal < 0.5 t AND the two top slings differ by > 0.1 m (asymmetric).
- `dbl-cas-picks-over-subcog`: assert `pickA`/`pickB` (from `intermediatePoints` 'Main Pick A'/'B') equal the reaction-weighted sub-COGs within 1e-3, and the hook plan position equals the COG.
- `dbl-cas-main-beam-honors-length`: with `masterLength` ≥ pickSpacing, assert `result.beams[0].length === masterLength` and picks lie within the bar span. With `masterLength` < pickSpacing, assert `mainBeamTooShort` warning is set.
- `dbl-cas-centred-cog-regression`: centred COG (0,0) — assert picks equal LP-pair midpoints (sub-COG = midpoint when load is balanced) and top slings are symmetric, i.e. no behaviour change for the symmetric case.
- Retain the existing per-lay angle and floor tests unchanged.

Hand-check reference: for the §1 perpendicular case, reactions = [6.25, 6.25, 43.75, 43.75] t, sub-COGs at (±4, 1.5), hook at (0, 1.5), hook horizontal residual = 0.

## 8. Out of scope

- Coupled 3D node-equilibrium / stiffness solver; per-member internal thrust reporting.
- Changing the 2nd-Lvl beams to a fixed-length + inboard-pick model (they stay ends-as-attach, derived length).
- Any non-cascade config.
- The N=2 unsigned-arm tension solver in `calc-core.js`: on the primary (reaction-weighted) path the sub-COG geometry keeps the hook within the pick span and each pick within its LP span, so the "hook beyond span → hidden negative tension" pathology cannot arise. Under the `subCogFallback` path, however — which only fires when the rig is already flagged invalid by both `cogOutsidePolygon` and `subCogFallback` — picks revert to LP midpoints and the hook can fall outside the pick span, re-exposing the solver's sign-hiding (both top tensions can report positive when true statics need one negative, and `negativeTension` does not fire). Left unchanged; flagged for `/eng-review`, out of scope to fix here.

## 9. Global constraints

- Vanilla JS, ES-module-free `IIFE` modules attached to `window` / `CalcCore`; no new dependencies.
- Node test harness (`node test-calc.js`) is the gate; browser visual confirmation on a **fresh port** before any deploy.
- Deploy remains gated on `/eng-review` and CPEng sign-off (unchanged).
- Coordinate system: X=East, Y=North, Z=Up. Distances are plan (x,y) unless noted.
