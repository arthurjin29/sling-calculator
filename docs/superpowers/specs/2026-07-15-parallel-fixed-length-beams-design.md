# Fixed-Length Parallel Beams — Design

**Scope:** Double Spreader (Parallel) configuration only. Cascade already done; the
other beam configs (Spreader, Lifting Beam) are a later rollout.

**Date:** 2026-07-15

---

## 1. Goal

Make each Parallel spreader beam a **fixed physical length** (the entered
`beamLengthA/B`); the beam hangs at its own **equilibrium angle** and the bottom
slings pull in / splay out to reach the fixed ends. Today `computeBeamEndPair`
places the ends on the LP→hook lines and **derives** (silently shrinks) the beam
length — a "5 m" beam can build shorter, exactly as it did in cascade.

## 2. Why Parallel needs its own solve (not the cascade closed form)

In cascade, both ends of a slave beam go to **its own** Main pick over **its**
sub-COG, so `fixedBeamEnds` (pick over the end-weighted average) balances it in
closed form. In Parallel, each beam's two top slings go to the **shared hook over
the total COG**. Re-using the cascade formula with `subCOG = total COG` drags the
beam to the load centre (verified: for a symmetric 6×6, beam A's ends land at
(−2,0)/(2,0) instead of at its LPs near y=−3 — degenerate, overlapping beam B).

With a fixed length the ends leave the LP→hook lines (kink → the beam takes real
horizontal force). To hang correctly the beam must settle at the pose where its
**net horizontal force = 0**, accounting for **both** its two top slings (to the
hook) **and** its two bottom slings (to its own LPs). That is a small numerical
equilibrium solve, done per beam.

## 3. Locked model (confirmed)

- Each beam is a rigid **horizontal** bar of the entered length `L`; it is free to
  **yaw** (rotate in plan) to equilibrium — NOT locked to the LP-pair line. (Beams
  stay level, as everywhere else in the tool; tilt is a non-goal — see §9.)
- **Bottom Sling Length** field is a **minimum**: if the equilibrium pose would make
  a bottom sling shorter, raise the beam (increase `zB`), never shrink the beam.
- **Hook** is over the total COG (unchanged); its height `H` is an output set by the
  min top-sling angle.
- Per-LP vertical load share `w_i` comes from `CalcCore.computeSupportReactions`
  (min-norm rigid-body reactions; Σ = totalLoad; reaction-weighted centroid = COG) —
  the same basis cascade uses. Each beam carries its two LPs' shares `w_a`, `w_b`.

## 4. The equilibrium (per beam)

Beam ends `E_a`, `E_b` (E_a paired with the nearer LP `L_a`). Pose unknowns:
centre `(cx, cy)`, yaw `θ`, height `zB`; `E = C ± (L/2)(cosθ, sinθ)` at `z = zB`.

**Two-force-per-end fact:** a rigid bar loaded only at its two ends carries a net
end force **along the bar**. At each end the top sling (up to the hook) and the
bottom sling (down to the LP) are the only forces besides the bar, so their vertical
components cancel ⇒ **each end's top and bottom vertical share = that LP's load**:

```
T_top,i · sinφ_top,i = T_bot,i · sinφ_bot,i = w_i        (i = a, b)
```

so `T_top,i = w_i·|E_i→hook| / (H − zB)` and `T_bot,i = w_i·|E_i→L_i| / (zB − L_i.z)`.

The horizontal resultant the two slings apply to end `i` (a 2-D vector) is:

```
h_i = w_i · [ (hook.xy − E_i.xy)/(H − zB) + (L_i.xy − E_i.xy)/(zB − L_i.z) ]
```

**Beam equilibrium (horizontal):**
- ΣF: `h_a + h_b = 0`  (2 scalar equations)
- ΣM (yaw): with the end forces required along the bar, this reduces to `h_a ∥ û`
  (1 scalar equation), where `û = (cosθ, sinθ)`.

Three equations in `(cx, cy, θ)`; `zB` is pinned separately by the min constraints
(§5). Symmetric load ⇒ `θ` = LP-pair line, centre on the symmetry line (reduces to
the balanced collinear rig). Asymmetric load ⇒ the beam yaws and shifts off the LP
line — its "own hang angle".

## 5. Height (`zB`) and the bottom-sling minimum

For a candidate pose, `zB` is the smallest height such that BOTH bottom slings meet
the min angle AND the min bottom-sling length (identical rule to cascade):

```
zB = max over i of  max( L_i.z + hd_i·tan(minAngle),                         // min angle
                         (minSling > hd_i) ? L_i.z + √(minSling² − hd_i²) : L_i.z )  // min length
```

with `hd_i = horizontalDist(L_i, E_i)`. Raising `zB` re-enters the equilibrium (the
`h_i` depend on `zB`), so `zB` and the pose are solved together (§6).

## 6. Algorithm

Per beam, seed from the **current collinear placement** (`computeBeamEndPair` on the
LP→hook lines at the fixed length) — already close to balanced — then relax to
equilibrium:

1. Compute `w_a`, `w_b` (reactions) and the hook (over total COG; `H` from the min
   top-angle over a first pose).
2. Iterate (damped fixed-point, ≤ ~40 iters, damping ~0.5 like the stinger hookZ
   solver `cb3149e`):
   a. Given the current pose, set `zB` from §5.
   b. Compute `h_a`, `h_b`; form the 3 residuals `[h_a + h_b, (h_a × û)]`.
   c. Newton/gradient step on `(cx, cy, θ)` (numeric Jacobian, 3×3) with damping.
   d. Stop when `|residual| < 1e-6` or the pose moves < 1e-6.
3. Recompute `H` (min top-angle over the final ends) and, if it changed materially,
   repeat the outer pass (hook height ↔ poses) until stable.

New pure helper in `CalcCore`, e.g.
`solveHangingBeam(L_a, L_b, w_a, w_b, hook, length, minAngleRad, minSling) →
{ end0, end1 }` (returns the two 3-D end positions), unit-tested against §8.

**Convergence:** the seed is near the solution and the map is contractive with
damping (as with the existing stinger solver). If it fails to converge, fall back to
the seed placement and raise a warning (`beamEquilibriumNotConverged`) — never emit a
NaN or an un-flagged unbalanced rig.

## 7. Tensions (replaces `calcLoadDistribution` for this config)

Top tensions come from the determinate per-beam solve (`T_top,i = w_i·|E_i→hook|/
(H−zB)`), NOT the 4-leg least-squares. Bottom tensions follow as today (each bottom
sling carries its end's vertical load). Check: the 4 top slings' horizontal
components sum to ~0 at the hook (hook stays over the total COG) — assert in tests.

## 8. Testing / verification

- **Hand-check symmetric first:** symmetric rectangle, equal shares ⇒ `θ` = LP-pair
  line, centre = sub-COG, beam length == entered, net horizontal on each beam ~0,
  hook horizontal resultant ~0. Must be a sensible rig sitting just inboard of its LPs
  (NOT dragged to centre).
- **Offset / asymmetric case:** unequal shares ⇒ beam yaws; assert (a) length ==
  entered, (b) net horizontal on each beam ~0, (c) solver converged, (d) the beam sits
  near its own LPs (sanity bound on centre-to-sub-COG distance).
- `node test-calc.js` + `node test-simple.js` stay green; add the new
  `solveHangingBeam` unit tests (hand-calculated) and ≥2 `dbl-par-fixed-len-*`
  integration tests (length honoured + both beams balanced + hook resultant ~0).
  Tests must **discriminate** old vs new (a case the old code shrank).
- Visual on a fresh port (stale-cache rule): 5 m beams build at 5 m, hang plausibly
  over their LPs, no lean at the hook, 0 console errors.

## 9. Non-goals

- Beam **tilt** (out-of-horizontal) — beams stay level; only yaw is solved.
- Other configs (Spreader, Lifting Beam, Stinger) — later rollout.
- No change to the hook-over-COG rule, `computeSupportReactions`, Simple mode, or any
  other config. Cascade's `fixedBeamEnds` is left as-is (different topology).

## 10. Global constraints

- Vanilla HTML/CSS/JS; no new dependencies; no build step.
- Cite the derivation (this doc §4) for the new solver; hand-calculate the symmetric
  expected values before writing tests.
- One geometry function at a time; full suite + visual confirm before the next change;
  revert on any regression (per the stinger-solver precedent, watch convergence).
- Deploy remains gated on `/eng-review` + CPEng.
