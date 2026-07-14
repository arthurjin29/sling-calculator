# Cascade Config: Per-Lay Angle Overrides + COG Re-Centring

**Date:** 2026-07-14
**Config affected:** Double Spreader (Cascading) only (`double-cascade`)
**Files:** `index.html`, `js/app.js`, `js/calc-double-cas.js`, `test-calc.js`

## Problem

Two issues surfaced in the cascade config:

1. **No control over rigging angle per lay.** The user set "2nd Beam A = 5 m" and expected a
   middle sling of 5 m or longer, but got 4.04 m at 60°. Root cause: the beam-length input is
   the *beam* dimension, and the middle sling length is a *derived* geometric quantity — the
   user has no way to say "rig this lay at angle X." Every lay's angle is currently forced by
   the single global 30° min-angle floor.

2. **Main Beam is centred on the LP geometry, not the COG.** `calc-double-cas.js` sets
   `masterCenter = midpoint(lpMidA, lpMidB)`, while the hook is placed at the COG. When the COG
   is off-centre, the beam sits symmetric between the lifting-point groups while the hook/COG is
   off to one side, producing lopsided top slings (e.g. 73° vs 60°) and a COG that sits near a
   beam end rather than covered by the beam.

## Goals

- Let the user specify a **rigging angle per lay** (middle and top lays), angle-in → length-out.
- **Re-centre the Main Beam on the COG** so the COG is covered by the spreader and top slings
  are symmetric.
- Do not disturb the other 5 configs or Simple mode.

## Non-Goals

- Bottom lay (LP → 2nd-level beam) angle control — stays on the global min-angle. (Easy to add
  later using the same mechanism.)
- Separate A-side / B-side angle inputs — one governing angle per lay (decided during
  brainstorming).
- Honouring the beam-length input as an exact plan width when the beam exceeds the LP spread —
  pre-existing behaviour, out of scope.

## Design

### 1. Per-Lay Angle Overrides

**Semantics:** angle-in, length-out, *governing* (minimum) per lay.

- The entered angle is the **floor** for that lay. The beam is raised until the **shallowest**
  sling in the lay reaches the target angle; steeper slings stay steeper. This is a per-lay
  generalisation of the existing global min-angle behaviour, so the governing sling ends up
  exactly at the entered angle and every other sling in that lay is ≥ it.
- Raising the beam lengthens the slings in that lay, so a larger angle yields a longer sling
  (e.g. 60° gives "5 m or longer").
- **Blank = auto** — falls back to today's behaviour (global 30° min-angle floor). This keeps
  the change backward-compatible.

**UI** (`index.html`, `panel-double-cascade`, after Bottom Sling Length):

- *Middle Lay Angle (°)* — `id="dcas-middle-angle"`, `placeholder="auto"`, blank allowed.
- *Top Lay Angle (°)* — `id="dcas-top-angle"`, `placeholder="auto"`, blank allowed.

**Data flow** (`js/app.js`, `double-cascade` case ~line 628):

- Read each as an optional float into `config.middleAngleDeg` / `config.topAngleDeg`
  (`undefined` when the field is blank — use `parseFloat(...)` and store only if finite).
- No unit conversion — angles are unitless (the ft/m conversion block at ~line 412 is skipped
  for these).
- Validation: if provided, must be in `[30, 90)`. Below 30 → error (matches the global hard
  floor). 30–44 → reuse the existing amber warning surface. ≥ 90 → error.

**Math** (`js/calc-double-cas.js`):

- Compute `middleAngleRad = config.middleAngleDeg != null ? degToRad(config.middleAngleDeg) : minAngleRad`
  and `topAngleRad = config.topAngleDeg != null ? degToRad(config.topAngleDeg) : minAngleRad`.
- **Middle lay:** in the master-height iteration (currently the loop at ~lines 78–103, and the
  master-end seed at ~lines 64–71), substitute `middleAngleRad` for `minAngleRad` in the middle
  sling `requiredZ = slaveEnd.z + hd * tan(...)` check. Because the beam rises until the
  shallowest middle sling meets the target, this yields governing-angle semantics for free.
- **Top lay:** in the hook-height calc (~lines 114–121), substitute `topAngleRad` for
  `minAngleRad`: `hook.z = masterZ + max(hDistHA, hDistHB) * tan(topAngleRad)`.
- The bottom-lay slings (LP → 2nd-level beam) still fall out of the geometry; they continue to
  be validated against the global min-angle via the existing warnings.

**Feasibility:** steepening a lay is always geometrically achievable (raise the beam higher),
so there is no hard failure mode — the only cost is more headroom, which the result already
reports (`headroom`, `hookHeight`).

### 2. COG Re-Centring

**Math** (`js/calc-double-cas.js`, ~lines 41–55):

- Change the beam centre from the LP-group midpoint to the COG:
  - Now: `const masterCenter = C.midpoint(lpMidA, lpMidB);`
  - New: `const masterCenter = { x: cog.x, y: cog.y };`
- **Keep the beam axis** derived from `lpMidA → lpMidB` (the `mUx`, `mUy` unit vector) so the
  beam still runs along the load's long axis; only the centre moves.
- Master ends become `cog ± halfMaster` along that axis. Since the hook is already at the COG,
  the hook now sits at the beam centre → **symmetric top slings**, and the COG is bracketed by
  the two master ends.
- The existing height solver recomputes master-end Z from the new horizontal distances, so no
  other math changes are required.

**Out-of-group warning:** if a master end lands outside the plan span of its own LP group
(e.g. master end B ends up inboard of both LP3 and LP4 along the beam axis), the middle slings
of that 2nd-level beam splay. The rig is still valid, but add a warning flag
`masterEndOutsideGroup` → surfaced as *"Main beam end falls outside its lifting-point group —
consider a longer Main Beam."* Detection: project each LP group's points and its master end
onto the beam axis; warn if the master end's projected coordinate is outside the
[min, max] range of that group's projected LP coordinates.

## Data Flow Summary

```
index.html (2 new optional inputs)
  → app.js buildConfig (double-cascade): config.middleAngleDeg, config.topAngleDeg (optional)
    → calc-double-cas.js calculate():
        masterCenter = COG (was LP midpoint)          [change 2]
        middleAngleRad / topAngleRad (default minAngleRad)  [change 1]
        height solver uses per-lay angles
        masterEndOutsideGroup warning                 [change 2]
    → result.warnings, result.tiers (unchanged shape)
```

Result object shape is unchanged except one new boolean in `warnings`.

## Testing (`test-calc.js`)

- **Angle — middle:** symmetric load, `middleAngleDeg = 60` → all middle slings ≈ 60°, longer
  than the blank baseline; one hand-calculated analytical check of the governing middle sling
  length.
- **Angle — top:** `topAngleDeg = 45` → governing (shallower) top sling = 45°, other ≥ 45°.
- **Angle — blank regression:** with both angle fields blank, cascade output equals the
  post-re-centring baseline (angle path adds nothing when blank).
- **COG re-centring:** symmetric load → top slings symmetric (equal angle, equal length);
  hand-checked. Off-centre COG → top slings symmetric about the beam centre and COG bracketed
  by master ends.
- **Out-of-group warning:** short Main Beam + off-centre COG → `masterEndOutsideGroup === true`.
- **Other configs frozen:** all non-cascade expectations in the 139-case suite unchanged.
- **Cascade rebaseline:** re-centring deliberately changes existing cascade test numbers.
  Rebaseline cascade expectations against hand-checked symmetric cases; freeze all other
  configs.

## Risks / Notes

- Re-centring changes existing cascade test expectations **on purpose** — this is the one place
  the suite numbers move. Everything else stays green.
- The two changes are coupled (both touch beam geometry in `calc-double-cas.js`) and are
  specced together, but implement + verify **one at a time** per the geometry-work rule:
  COG re-centring first (rebaseline tests), then per-lay angles on top.
