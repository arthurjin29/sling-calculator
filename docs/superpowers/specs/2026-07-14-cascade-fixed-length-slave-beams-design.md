# Fixed-Length 2nd-Level (Slave) Beams — Cascade — Design

**Scope:** Double Spreader (Cascading) configuration only, for now. Same fixed-length
rule will be rolled out to the other beam configs (starting with Double Spreader
Parallel, which shares `computeBeamEndPair`) in a follow-up once this is proven.

**Date:** 2026-07-14

---

## 1. Goal

Make each 2nd-Level (slave) beam a **fixed physical length** equal to the value the
user enters (`slaveLengthA` / `slaveLengthB`). Today the slave beam length is
*derived* — `computeBeamEndPair` slides the ends along the LP→Main-pick lines and
the beam silently shrinks to suit the min bottom-sling length and the LP spread
(a "5 m" beam builds as ~4 m, so the middle slings come out ~4 m instead of 5 m).

Under the fixed-length rule the beam stays the length you type and the **bottom
slings pull in / splay out** to reach the fixed ends.

## 2. The rule and why the centre must be solved

**Rule (already applied to the Main Beam):** physical beams are fixed length; the
slings adjust to suit.

Today each slave end sits **on the straight LP→Main-pick line**, so the bottom sling
and middle sling are **collinear** at the end — the sling passes straight through and
the beam carries **zero net horizontal force**; the length is just whatever that line
gives.

Once the length is **fixed**, the ends move *off* those lines → a **kink** appears at
each end → the bottom and middle slings are no longer collinear → the beam genuinely
takes a **horizontal force**. To hang plumb under the Main pick, the beam centre must
be positioned so those horizontal forces **cancel**.

**Simplifying fact:** the sub-COG is the reaction-weighted average of exactly two LPs,
so it lies **on the LP-pair line**. The whole side assembly (2 LPs, 2 ends, Main pick)
therefore sits in **one vertical plane**, and horizontal balance is a 1-D problem along
the LP axis.

## 3. Closed-form beam centre

Per side, let the two LPs be `a` and `b` with vertical load shares `wₐ`, `w_b` (from
the existing min-norm rigid-body reactions, clamped ≥ 0 exactly as `subCogOf` does),
`W = wₐ + w_b`. Let `û` be the in-plan unit vector from LP `a` to LP `b`, and `subCOG`
the reaction-weighted plan centroid (= `pickXY`, already computed).

Beam ends (fixed length `L`): `Eₐ = C − û·L/2`, `E_b = C + û·L/2`.

A rigid bar loaded only at its two ends must carry a net force **along the bar** at
each end (moment balance) ⇒ the vertical components at each end cancel ⇒ each middle
sling carries its own end's LP load: `Tm_i,vert = w_i`. For the two middle slings'
horizontal thrusts at the Main pick to cancel (plumb), the pick must sit over the
load-weighted average of the **ends**:

```
wₐ·Eₐ + w_b·E_b = W · subCOG           (in plan, along û)
```

Substituting the end positions and solving for the centre:

```
C = subCOG − û · (L/2) · (w_b − wₐ) / W
```

- Symmetric load (`wₐ = w_b`): `C = subCOG` = midpoint — reproduces today's balanced rig.
- Offset load: centre shifts along the axis toward the **lighter** LP.
- `C` is **independent of beam height z** (the balance equation is purely in-plan), so
  the centre is computed once, then z is solved separately.

Fallback: if `W < 1e-9` (both shares clamped to zero — the existing `subCogFallback`
state), use the LP-pair midpoint for `C` and keep raising the existing
`subCogFallback` warning. No change to that warning's meaning.

## 4. Beam height (z) and the bottom-sling minimum

The slave beam is horizontal at height `zB`. `zB` is raised (inside the existing
`masterZ` iteration loop) until **all** of the following hold at both ends:

- **Bottom-sling min angle** — `LP_i → E_i` meets the global min angle.
- **Bottom-sling minimum length** — the "Bottom Sling Length" field is a **minimum**;
  if fixed geometry makes `|LP_i → E_i|` shorter than it, raise `zB` (lift the beam) —
  **never** shrink the beam.
- **Middle-lay target angle** — `E_i → Main pick` meets the middle target angle
  (`middleAngleRad`), as today.

`masterZ` (the Main-pick height, shared with the top lay) continues to be the driver
that the loop raises; the slave `zB` tracks it via the same geometry. The centre `C`
from §3 does not change as z rises.

## 5. What changes / what doesn't

**Changes (geometry only):**
- Replace the `computeBeamEndPair(...)` call for **slave** beams (`calc-double-cas.js`
  lines ~116-122) with fixed-length end placement: centre from §3, ends `C ± û·L/2`,
  `z = zB`.
- Add one `CalcCore` helper, e.g. `fixedBeamEnds(lpA, lpB, wA, wB, subCOG, length)`
  returning the two end plan-positions (pure, unit-tested).
- Reported `2nd Lvl Beam A/B — Length` now equals the entered length (barring the
  degenerate midpoint fallback).

**Unchanged:**
- Main Beam (already fixed-length: bar + sliding picks + symmetric overhang).
- Reactions / sub-COG / hook-over-COG / top-lay horizontal balance.
- Tension cascade (`calcTwoSlingTension`, vertical-load pass-down). With the balanced
  centre the middle tensions resolve to `Tm_i,vert = w_i` automatically; no tension
  code is rewritten. (The absolute tensions shift slightly vs today because the
  collinear pass-through is gone — expected and correct.)
- Bottom / middle / top sling wiring and labels; `scene.js` (reads beam ends).

## 6. Edge cases

- **Beam longer than LP span** → ends sit **outboard** of the LPs → bottom slings splay
  outward. Allowed provided the min bottom angle still holds (else `zB` is raised).
- **End directly above its LP** → vertical bottom sling (0 horizontal run).
- **`subCogFallback` (a negative/all-clamped reaction)** → `W`-guarded midpoint centre;
  existing UNRELIABLE warning still fires.
- **Entered length ≤ 0 / coincident LP pair** → guard (min length enforced by the input
  `min=0.1`; coincident pair → `û` undefined → fall back to midpoint / current handling).

## 7. Testing / verification

- **Hand-check a symmetric case first:** equal LP shares must give `C = subCOG` and
  reproduce today's balanced middle-sling geometry (net horizontal at pick = 0).
- **Hand-check an offset case:** unequal shares; verify (a) actual beam length ==
  entered length, (b) net horizontal force on the beam == 0 (pick over end-weighted
  average), (c) middle-sling length == entered beam length at 60° with the pick centred.
- `node test-calc.js` (157) + `node test-simple.js` (33) stay green; add ≥2 new
  cascade tests (fixed length honoured; horizontal balance) with hand-calculated
  expected values.
- Visual confirm in Advanced mode on a fresh port (stale-cache rule): 5 m slave beam
  builds as 5 m; middle slings ≈ 5 m at 60°; rig hangs plumb; 0 console errors.

## 8. Non-goals

- Double Spreader (Parallel) and any other config — **follow-up** after this is proven.
- No change to the Main Beam, the load/reaction model, the tension solver, or Simple mode.
- No new UI inputs (the existing 2nd-Lvl beam length + Bottom Sling Length fields are reused).

## 9. Global constraints

- Vanilla HTML/CSS/JS; no new dependencies; no build step.
- Cite the geometric derivation (this doc §3) for the new helper; hand-check expected
  values before writing tests.
- One geometry function at a time; full test suite + visual confirm before the next
  change; revert immediately on any regression.
- Deploy remains gated on `/eng-review` + CPEng.
