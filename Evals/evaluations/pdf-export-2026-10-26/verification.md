# PDF export verification — 26 October 2026

Starting revision: `dfb7c46`; checkout initially clean. Changes extend Web only.
LearnUnlock's dedicated export renderer and figure-readiness approach informed
this implementation. Saved work is exported; conversation transcripts are omitted.

## Acceptance checklist

- [x] Export all problems into one PDF, with each problem identified.
- [x] Export the current problem or any saved problem without switching problems.
- [x] Typeset fractions, roots, superscripts and graph collection notation.
- [x] Include graphs, geometry, geometry retained beside equation steps, and statistics.
- [x] Preserve ordered statistics data, current camera bounds and recovered drafts.
- [x] Keep long worksheets paginated and empty problems explicitly labeled.
- [x] Show export progress, prevent duplicate exports, and recover after a renderer failure.
- [x] Visually review desktop/mobile controls and all visible PDF cases.
- [x] Run full verification, code review and independent visual review.

## Automated evidence

`bun run verify` passed: module boundaries, 710 tests passed (5 intentionally
skipped), TypeScript, lint and production build. Four focused PDF-planning tests
cover scope, drafts, immutable state, latest camera bounds, current work, missing
IDs and blank problems. The Impeccable detector returned no findings.

`bun Evals/scripts/check-pdf-export.ts http://localhost:3047` passed against the
actual local app, using an isolated browser context with synthetic account and
problem API responses. No live provider or production acceptance is claimed.
It exercised all/current/library downloads, mobile export, cleanup, library
preservation, recovered draft export, WebGL failure and successful retry.
Statistics retained stale geometry/graph fields in the fixture to verify that
statistics output does not show a previous figure.

## Visual review

Chromium, 100% zoom, desktop 1440 × 1000 and mobile 390 × 844; button clicks and
keyboard focus through Playwright. Reviewed Settings in loaded/success/error
states. Both PDF scope controls remain visible and wrap within the mobile width.
The existing unsaved-draft warning is expected: the mocked API deliberately
returns an older draft while a newer session draft remains recoverable.

Rendered and visually inspected every page of the 11-page all-problems PDF:

| Pages | Reviewed content |
| --- | --- |
| 1 | Fraction and square-root equation, then x = 11 |
| 2 | Parabola, axes, origin and labels |
| 3–4 | Labeled 3–4–5 triangle, retained beside a later equation |
| 5 | All five data values, descriptive statistics and chart; no stale figure |
| 6 | Circle x² + y² = 9 and shaded strict inequality y > x |
| 7–10 | All 24 numbered steps in order, without clipped equations |
| 11 | Empty-state text and latest recovered draft |

Also reviewed the separate current-problem, algebra and retry PDFs. The mobile
PDF uses the same paper layout. Reviewed circle proportions after changing
coordinate plots to a square export surface. All final all-problem page rasters
matched the already reviewed confirmed rasters byte-for-byte after the final
statistics regression fixture was added; page 5 was inspected again.

Local evidence is under ignored `output/pdf-export/`: PDFs, page PNGs,
`settings-desktop.png`, `settings-mobile.png`, `error-mobile.png`, `checks.json`,
`design-detector.json`, and `verify-final.log`. These files can be regenerated
with the browser script and Poppler. Independent finish review confirmed mobile
controls, circle proportions, and current PDF content; both material findings
were resolved. Static code-review findings about drafts, raw data, planning
ownership and stale statistics figures were fixed.

No provider prompt or mathematical engine changed, so no paid/live agent suite
was run. Native export, production behavior and real-student usability were not
tested in this Web change. PDFs preserve rendered appearance as static images;
they do not contain editable LaTeX source or tagged PDF reading structure.

## Follow-up: clean worksheet export and app fonts

The user's follow-up supersedes the initial inclusion of drafts and descriptive
text above. Export now contains recorded equations and figures, with the problem
name and the same small equation-step numbers used in the UI. Spoken commands,
generated geometry/statistics descriptions, drafts, recovery transcripts, and
branding footers are excluded. Geometry retains its diagram labels. Statistics
retains its mathematical data values and chart.

The worksheet uses the app's `--font-ui` (Instrument Sans) and
`--font-graph-math` (STIX Two Math) tokens. The browser check asserts the computed
families and that both bundled font faces are loaded during export. The capture
library embeds those font faces in its rendered output.

The browser fixture now includes the recorded sequence 2x + 3 = 11, 2x = 8,
x = 4 and a separate fractions/roots example. `output/pdf-export/algebra.pdf`
and `multiple-steps-1.png` demonstrate the complete three-step export. The clean
all-problems sample and its `clean-page-*.png` renders replace the earlier local
sample outputs. The earlier review notes describe the initial implementation;
this follow-up's acceptance is based on the clean outputs.

Follow-up acceptance completed: all 11 clean PDF pages were visually reviewed,
including three algebra steps, fractions/roots, parabola, triangle, retained
triangle beside an equation, numeric statistics/chart, circle/inequality and
24-step pagination. Browser font checks returned Instrument Sans and STIX Two
Math, both loaded. Independent visual review passed the mathematical content,
fonts, and clipping checks; its final finding about the empty-state sentence
was fixed. Empty exports now show only their problem title. Final page rasters
1–10 match the reviewed clean renders byte-for-byte, and page 11 was inspected
after that change. Full verification passed 712 tests (5 skipped), boundaries,
TypeScript, lint and build; focused tests/typecheck/lint were repeated after the
empty-state sentence was removed. Updated local evidence uses
`verify-clean.log`, `checks.json`, `design-detector-clean.json`,
`clean-final-page-*.png`, and `Mathwave-multiple-steps.pdf`.

## Follow-up: number alignment and app background

- [x] Step numbers and mathematical notation now share a grid row and vertical
  center, instead of placing numbers above the equations.
- [x] The app's `--background` token fills exported content and every entire PDF
  page, including outer margins and continuation pages. Graph panels keep the
  same white surface they use in the app.

The browser check measured a 0-pixel difference between number/equation centers
on a recorded equation row. Both app and export backgrounds resolved to
`rgb(255, 249, 245)` (`#fff9f5`). The font assertions, all/current/library/mobile
exports and renderer failure/retry checks passed. The font/layout assertion now
reads a currently attached equation row after fonts settle, avoiding a stale
DOM reference while export advances between blocks.

Visually reviewed `aligned-steps-1.png` and all 10 `aligned-page-*.png` pages:
algebra, fractions, powers, parabola, geometry, statistics, graph collection,
24-step continuation and empty-problem output. Numbers align with mathematical
rows; page backgrounds cover all margins without white strips. No clipped
content was found. Independent finish review passed both requested changes.
The mechanical detector returned no findings. Focused tests, TypeScript, lint,
module boundaries and production build passed. Evidence is under the same
ignored `output/pdf-export/` directory, including `checks.json`,
`design-detector-alignment.json`, and `build-alignment.log`.
