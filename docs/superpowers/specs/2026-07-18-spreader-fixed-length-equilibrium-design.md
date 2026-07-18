# Spreader Beam Fixed-Length Free-Hang Equilibrium — Derivation & Design

**Config affected:** Spreader Beam (single beam) only. All other configs untouched.

**Date:** 2026-07-18

**Commit:** `8987f10` — `feat(spreader): free-hang equilibrium solve — fixed length, plumb hang`

**Related:** generalises `CalcCore.solveHangingBeam` (see
`2026-07-15-parallel-fixed-length-beams-design.md`) from one LP per end to N LPs per
end. Same rigid-bar equilibrium family as the cascade Main Beam
(`2026-07-16-cascade-fixed-length-main-beam-design.md`).

---

## 1. Problem

The single Spreader Beam already connected all slings at its two ends with a fixed
`beamLength`, but placed the beam **heuristically** — shift the beam axis so it passes
over the COG, then project the hook onto that axis. That is not a force-equilibrium
solve, so for an offset COG the bar **leaned**: measured net-horizontal on the beam was
**22.4%** of load (COG offset along the axis), 9.1% (perpendicular), 14.7% (diagonal).
A leaning rig means the drawn geometry is not the resting geometry and the leg loads are
wrong.

## 2. Model

A fixed rigid bar of `beamLength`, both ends level at height `z`, hanging from the hook
(over the COG, height `H`) by one top sling per end, and supporting 4 LPs split between
the two ends (nearest-end assignment, any per-end count 1..3).

### 2.1 Per-LP loads
Per-LP vertical shares come from the min-norm rigid-body reaction solve
(`computeSupportReactions`), clamped ≥ 0 (a negative share → `subCogFallback`, same as
parallel/cascade). Each end's top sling carries the **sum** of its LPs' shares; each
bottom sling carries its own LP's share.

### 2.2 Bar equilibrium (`solveSpreaderBeam`)
Unknowns: bar centre `(cx, cy)` and yaw `th` (3 DOF). The horizontal force an end `e`
receives is its top sling (toward the hook) plus **every actual bottom sling** on that
end, each equal to *its vertical load × (horizontal offset ÷ vertical drop)*:

```
h(e) = Wend·(hook − e)_xy / (H − z)  +  Σ  w_i·(lp_i − e)_xy / (z − lp_i.z)
                                      i on e
```

Summing the **real** slings (not a single load-weighted sub-point) makes this exact for
any per-end LP count and for LPs at differing heights. Residual (damped Newton, numeric
Jacobian, normalised by total load so the tolerance is scale-free):

```
r = [ h(ea).x + h(eb).x ,          # net horizontal force = 0
      h(ea).y + h(eb).y ,
      ux·h(ea).y − uy·h(ea).x ]    # end-A resultant is axial (⟂-to-bar component = 0)
```

With `h(ea) = −h(eb)` and both axial, the two end resultants are collinear and opposite
→ zero net force **and** zero net yaw moment. Vertical is balanced per end (top up =
bottom-slings down), so this is full rigid-body equilibrium for a level bar; the bar
carries axial compression only.

### 2.3 Height & angle floor
`z` is set to the max over **every actual bottom sling** of the min-angle height
(`lp.z + horizDist·tan(minAngle)`) and, when a `bottomSlingLen` minimum is supplied, the
min-sling-length height. The min-angle floor is therefore honoured on the **real** slings,
never a proxy. The hook height is then set from the min top-sling angle over the two ends;
pose and hook height are mutually dependent, so `calc-spreader.js` iterates them to a
fixed point (≤ 12 sweeps). Non-convergence → `beamEquilibriumNotConverged` + revert to
the seed pose.

## 3. Scope / not checked
- Bar treated as level, rigid, weightless. Beam **capacity (axial/bending) is not sized**
  (shared caveat with every beam config; the global disclaimer applies).
- The **Lifting Beam is intentionally not given this treatment** — its single interior
  pickup over the COG is the defining feature of a bending strongback; picking at an end
  would defeat the config.

## 4. Verification
- `node test-calc.js` — 179/179, incl. `spreader-balanced-*` (centred / offset-x / offset-y
  / diagonal / odd-split 3-1 / elevated mixed-z): drawn length == `beamLength`, beam
  net-horizontal < 0.5% of load, hook over COG, min bottom angle ≥ floor.
- Lean probe (`scratchpad/probe-spreader.js`): 22.4% / 9.1% / 14.7% → **0.0%** after the fix.
- Browser (fresh port): offset-COG spreader renders level, hook over COG, asymmetric top
  slings; console clean.
