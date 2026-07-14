# Advanced-Mode 3-Panel App-Shell Layout — Design

**Scope:** Advanced (3D) mode of the sling-length calculator only. Simple mode, all calculation logic, and the printed report are unchanged.

**Date:** 2026-07-14

---

## 1. Goal

Restructure Advanced mode from its current top-to-bottom stack (inputs → results → 2D diagrams → 3D view) into a viewport-filling **3-panel app-shell**: inputs on the left, the interactive 3D diagram on the right, and detailed results across the bottom. No page scroll — each panel scrolls internally.

## 2. Layout

A CSS grid fills the viewport below the page header, on screen, at widths ≥ 1001px:

```
Row 1  (auto):        toolbar  — config / preset / units / save        [spans both columns]
Row 2  (1fr):     ┌ INPUTS (left, scroll) ┬ 3D DIAGRAM (right, fills) ┐
Row 3  (≤40vh):   └ DETAIL RESULTS (spans both columns, scroll)        ┘
```

- **Left — inputs:** the existing `#calc-form` (Lifting Points, COG & Load, per-config panels). Fixed-ish width `minmax(340px, 400px)`; scrolls internally when tall.
- **Right — 3D:** `#scene-container`, moved out of `#results` into this cell; fills the cell (`height: 100%`), reuses the existing `onResize` handler.
- **Bottom — results:** `#results` (summary grid + sling-tension tables + the existing "2D Diagrams" card). Spans full width, capped at ~40vh, scrolls internally.
- **Warnings:** `#calc-warnings` (already inserted by `displayWarnings` as the first child of `#results`) is made `position: sticky; top: 0` within the results panel so the safety warnings stay pinned to the top as the results scroll.

The page header (title, subtitle, disclaimer, Simple/Advanced toggle) stays above the grid, unchanged.

## 3. DOM change

Introduce one wrapper, `<div id="advanced-layout">`, around the four existing Advanced-mode blocks in this order: toolbar, `#calc-form`, a new `<div id="diagram-panel">` containing `#scene-container` (moved here from inside `#results`), and `#results`. All existing element IDs are preserved, so `scene.js`, `app.js`, calculate wiring, and print rules keep working. Grid-area assignment is by CSS (`grid-template-areas`), not by DOM order beyond this grouping.

## 4. Behavior

- **Screen-only, wide-only.** The grid is defined under `@media screen and (min-width: 1001px)`. Everywhere else (`@media print`, and screens ≤ 1000px) `#advanced-layout` is normal block flow → the current stacked layout. This means **print is unchanged**: `.no-print` still hides the toolbar and 3D, `#results` prints as a stacked flow with the 2D diagrams.
- **Responsive fallback.** ≤ 1000px collapses to a single stacked column (inputs → 3D → results) and the page scrolls — today's behavior. No mobile redesign (remains backlog); nothing breaks.
- **Mode toggle.** `setMode()` shows/hides `#advanced-layout` (grid) vs `#simple-mode`. When switching **into** Advanced, fire the scene resize (`window.SlingApp` hook or a `resize` event) so the 3D canvas picks up its panel size after becoming visible (it has zero size while the shell is `display:none`).
- **Calc-gating unchanged.** `#results` stays `display:none` until Calculate runs (as today); before the first calculation the bottom row is simply empty.
- **Simple mode untouched.** Its own 2-pick sketch layout is not affected.

## 5. Files & responsibilities

- **`index.html`** — wrap the four Advanced blocks in `#advanced-layout`; add `#diagram-panel` and move `#scene-container` into it (out of `#results`). No content/label changes.
- **`css/style.css`** — add the `@media screen and (min-width:1001px)` grid on `#advanced-layout` (columns, rows, `grid-template-areas`, panel scroll via `overflow:auto` + `min-height:0`), give `#scene-container` `height:100%` inside its panel (keep the 500px fixed height as the stacked/print fallback), make `#calc-warnings` sticky. For the shell height: make the app container (`body` or the main `.container`) a **flex column** and let `#advanced-layout` `flex: 1` fill the remaining height below the header — avoids a hard-coded header offset. Print/existing responsive blocks unchanged except where the stacked fallback needs the old `#scene-container` height.
- **`js/app.js`** — in `setMode`, toggle `#advanced-layout` visibility and, on entering Advanced, trigger the scene resize so the canvas fits its panel. No other logic changes.
- **`js/scene.js`** — no change (already reads `container.clientWidth/clientHeight` and listens for `resize`).

## 6. Non-goals

- No change to any calculation, warning text, or the 2D/3D drawing code.
- No change to Simple mode or the printed PDF.
- No drag-to-resize panels, no persisted panel sizes (YAGNI).
- No mobile-specific redesign beyond the stacked fallback.

## 7. Testing / verification

- **Calc unaffected:** `node test-calc.js` (157) and `node test-simple.js` (33) stay green — this is CSS/DOM-only.
- **Visual (fresh port, per stale-cache rule):**
  - Desktop width: the 3 panels fill the viewport, no page scroll; inputs and results scroll internally; the 3D fills the right panel and **resizes** when the window resizes.
  - Enter Advanced from Simple → 3D renders at the correct size (resize fired).
  - Run a calculation → results + tables populate the bottom panel; warnings pin to the top of it and stay visible while scrolling results.
  - Narrow width (≤ 1000px): collapses to the stacked single column, page scrolls.
  - **Print / PDF** still produces the stacked report (summary + tables + 2D diagrams), 3D omitted.
  - Browser console clean (0 errors) at both widths.

## 8. Global constraints

- Vanilla HTML/CSS/JS; no new dependencies; no build step.
- Svelte/Tauri conventions N/A (this is the static web calculator).
- Deploy remains gated on `/eng-review` (calc) + CPEng — a layout-only change does not alter that gate, but visual verification is required before the public URL.
