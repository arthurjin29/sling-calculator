# Cascade Fixed-Length Main Beam — Derivation & Design

**Config affected:** Double Spreader (Cascading) only. All other configs untouched.

**Date:** 2026-07-16

**Commit:** `a5a3241` — `feat(cascade): fixed-length Main Beam with picks at the bar ends`

**Supersedes:** `2026-07-14-cascade-horizontal-equilibrium-design.md` and its plan
`docs/superpowers/plans/2026-07-14-cascade-horizontal-equilibrium.md` in full. Those
described a Main Beam whose **picks sit over the two sub-COGs** with the bar sized to
the pick span (and a `mainBeamTooShort` warning when the entered `masterLength` could
not reach them). That model is retired: it put connection points at the *middle* of a
physical bar, which a real spreader cannot do.

---

## 1. Problem

The Main Beam is a **physical bar of a fixed length** (`masterLength`). Its sling
connections can only be made at its **ends** — you cannot clamp a pick to the middle
of an existing spreader. The old model placed the two picks over the reaction-weighted
sub-COGs (an arbitrary interior span) and stretched/flagged the bar to suit. Correct
behaviour is the reverse: **the bar length is an input, the picks are its two ends, and
the slings splay to whatever angle balances the rig.**

## 2. Model

Every beam is a fixed rigid bar; every connection is at a beam end.

```
            Hook  (over total COG, height H)
           /    \                 top slings (2): pick → hook, each carries WA / WB
      pickA ---- pickB            Main Beam: fixed bar, ends = pickA, pickB (span = masterLength)
     /  \        /  \             middle slings (4): pick → sub-beam ends (2 per pick)
  eA0   eA1   eB0   eB1           2nd-Lvl beams A, B: fixed bars (solveHangingBeam)
   |     |     |     |            bottom slings (4): LP → sub-beam end
  LP    LP    LP    LP
```

### 2.1 Per-end vertical balance
At each pick the top sling pulls **up** with that side's total load `Ws = w0 + w1`, and
the two middle slings pull **down** with `w0 + w1 = Ws`. Net vertical at each pick is
therefore **zero** — the pick transmits only a horizontal (axial) force into the bar.
Each middle/bottom sling carries exactly its own end's LP load share `w_i`; a sling's
tension is `T = w_i · L / Δz` (vertical load ÷ sin of its own angle).

### 2.2 Bar equilibrium (the solve)
Unknowns: bar centre `(cx, cy)` and yaw `th` (3 DOF). The bar is constrained level
(both ends at one height `z`). The horizontal force a pick `p` receives is the sum of
its top sling and its two middle slings, each equal to *its vertical load × (horizontal
offset ÷ vertical offset)*:

```
h(p) = Σ  w · (target − p)_xy / Δz            (top: target = hook, Δz = H − z;
       slings                                   middle: target = sub-end e, Δz = z − e.z)
```

Residual (3 equations, 3 unknowns), solved by damped Newton with a numeric Jacobian:

```
r = [ h(pa).x + h(pb).x ,           # net horizontal force = 0 (x)
      h(pa).y + h(pb).y ,           # net horizontal force = 0 (y)
      ux·h(pa).y − uy·h(pa).x ]     # h(pa) is axial (⟂ component along the bar = 0)
```

`r[0]=r[1]=0` gives zero net horizontal force; `r[2]=0` forces the end force to lie
**along** the bar axis, so with `h(pa) = −h(pb)` the two end forces are collinear and
opposite → **zero net yaw moment** as well. Vertical is already balanced per §2.1, so
this is full rigid-body equilibrium for a level bar. The bar ends up in **pure axial
compression** (the spreader's design action — see §4).

The residual is normalised by the total load `W` so the convergence threshold is
scale-free (a fraction of load, not an absolute tonnage).

### 2.3 Height (angle floor)
Bar height is raised so **every actual middle sling** meets the middle-lay angle floor
`middleAngleRad = max(minAngle, middleAngleDeg)`:

```
z = max over the 4 middle slings of  ( e.z + horizDist(pick, e) · tan(middleAngle) )
```

The governing sling sits exactly at the floor; the rest are steeper. The floor is
honoured on the real slings, never on a pick→sub-COG proxy. Top slings meet
`topAngleRad` via the outer z-stack loop; bottom slings meet `minAngle` inside
`solveHangingBeam`. **All three lays are therefore ≥ the minimum angle.**

## 3. Coupling (calc-double-cas.js)
Heights cascade LP → 2nd-Lvl → Main → hook, so the whole z-stack is iterated to a
fixed point (≤ 40 outer sweeps): solve both 2nd-Lvl beams under the current picks
(`solveHangingBeam`) → solve the Main bar pose (`solveCascadeMainBeam`) → recompute the
hook height from the settled picks and the top-lay angle → repeat until the picks, the
Main height and the hook height stop moving. Non-convergence of any beam or of the
outer loop raises `beamEquilibriumNotConverged` and reverts to the seed pose — never a
plausible-but-unbalanced geometry.

## 4. Scope / not checked
- The Main and 2nd-Lvl bars are treated as **level, rigid, weightless**. For strongly
  asymmetric sub-loads the true hang could tilt slightly in elevation; the level
  constraint is a modelling approximation consistent with every other beam config here.
- The tool computes **geometry and per-leg statics only**. It does **not** check the
  Main/spreader bar's **axial (buckling) or bending capacity**, even though the balanced
  bar carries a real axial compression. The UI surfaces a
  `spreaderBeamCapacityNotChecked` note for this config; beam adequacy must be verified
  against AS 4991 / AS 1418 / the beam's rated chart separately.

## 5. Verification
- `node test-calc.js` — 169/169, including the cascade angle-floor, hook-balance,
  Main-beam net-horizontal, picks-at-ends and fixed-length assertions.
- Independent invariant probe (`scratchpad/verify-cascade.js`, does **not** reuse the
  solver): every beam's whole-body net-horizontal = 0, min lay angle = floor, Σ vertical
  = total load, pick span = `masterLength`, across symmetric / offset / asymmetric COG.
- Browser (fresh port): picks render at the Main-beam ends; all lays ≥ floor.
