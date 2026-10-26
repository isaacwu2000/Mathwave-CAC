# Core graph delivery

## Checklist

- [x] Implicit relations and vertical curves retain both coordinates.
- [x] Inequalities shade regions and distinguish strict/inclusive boundaries.
- [x] Polar and parametric curves retain saved finite parameter ranges.
- [x] Restrictions and ordered piecewise functions retain domain gaps.
- [x] Named graph rows support selection, editing and readback.
- [x] Scalar/function definitions recalculate dependencies and reject invalid edits.
- [x] Direct edits, saved reloads, undo/redo, retry and revision checks are covered.
- [x] Ordinary requests use no added graph DSL text or selector provider call.
- [x] Advanced math moved to GitHub #11; 3D remains #3.
- [x] Multiline/voice candidate cases are recorded with independent expected answers.
- [x] Desktop/mobile review and automated verification completed.

## Evidence boundaries

Starting revision: `599dbaa`, with task changes on main. The full Web verification
checks module boundaries, colocated tests, TypeScript, lint and production build.
Browser evidence is real Chromium at 1440×1000 and 390×844, with an in-memory
synthetic store and mocked transport using the actual deterministic API. No live
provider, recorded audio or student study was performed.

Final browser report and screenshots:
`Evals/evaluations/core-graphs-5bd07999-800a-464f-a8ff-2a139491c819/`.
Intermediate captures and the failed readiness run are retained. The browser
script now waits for the mathematical editor custom element before editing.

Local timing report:
`Evals/evaluations/core-graph-latency-555698d3-fbe0-4fe3-9651-87b1cad784aa.json`.
There are zero extra provider calls and zero additional graph-scene prompt
characters for ordinary algebra and explicit graph requests. Warm command median
changes are below 0.001 ms. A seven-row scene prepares drawing data in 8.107 ms
median, 9.178 ms p95. These are local CPU measurements, not end-to-end voice,
Chromebook, production or student-perceived latency guarantees.

## Final independent visual verdict

| Finding | Verdict |
| --- | --- |
| Piecewise value/condition spacing | Resolved on desktop and mobile |
| Graph-name interface typography | Unresolved visually; cosmetic follow-up [#12](https://github.com/RealUnknownDeath/Math-Audio/issues/12) |

The final review found no regressions introduced by the visual fixes. The
follow-up does not block graph calculations or persistence. Numeric sampling
limitations and unsupported legacy analyses are documented in
`docs/GRAPH_CAPABILITIES.md`. Candidate voice cases in
`Evals/inputs/core-graph-candidates.json` are unrun proposals, not acceptance scores.
