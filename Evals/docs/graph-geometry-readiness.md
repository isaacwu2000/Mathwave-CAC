# Graph and geometry validation — 2026-10-10

## Delivered

- Plot expressions in x and explicit y equations; other equations in x retain the left-minus-right view.
- 201 samples, zero axes, persisted x ranges, zoom/reset, keyboard point exploration, point reading, and sampled intercept detection.
- Curve segmentation checks midpoints to avoid connecting across many poles. Sampling can miss features; roots and extrema are approximate.
- Plot limit is |y| ≤ 100,000,000. Exact point evaluation remains available beyond this display limit.
- Unsupported functions show a recoverable inline message without crashing the problem.
- Seven shape types: circle, rectangle, square, triangle, right triangle, sphere, cylinder. Triangle input accepts three sides or base/perpendicular height.
- Explicit dimension edits, formula-based measures, degree angles opposite named sides, positive-dimension and triangle-inequality checks.
- Base/height input permits area only; it does not invent a perimeter or unique triangle.
- Geometry persists in saved steps, exports, reloads, undo, and specific step cancellation. Old problems remain accepted.
- Missing dimensions ask one question at a time; numeric follow-ups work locally.
- AI command validation and backend context validation accept the new tools. No credentials changed.

## Verification

117 tests passed; TypeScript, lint, production build, and diff whitespace checks passed.

Computer-controlled browser checks:
1. New graph problem: y = x² − 4 rendered, zoom narrowed to −5..5, intercepts returned −2 and 2.
2. Range survived reload/problem switching. Keyboard End selected x = 5; Read point returned y = 21.
3. Replacing an active graph with x + y = 3 showed an inline unsupported-graph explanation; workspace remained editable.
4. Rectangle width six requested height. Answer four created exactly one saved step; area returned 24.
5. Width edit to eight saved independently; cancel step two restored width six. Reload preserved the shape; Undo restored the canceled edit.
6. Triangle base ten height six displayed a perpendicular-height guide; area returned 30, with no perimeter button.

## Remaining limits

Live AI provider responses, speech recognition, microphone input, real screen-reader operation, and dyslexic-student usability were not tested in this change. Browser checks used typed commands and keyboard controls. General implicit curves, multiple curves, geometric proofs, and mixed-unit conversion are not yet supported.
