# Partial baseline visual review

This reviews the 48 predictions saved before the original Mac run was interrupted. It is **not** the complete GPU baseline and is never substituted into the GPU before/after comparison.

- Inspected all 38 distinct actual-app screenshots covering 48 rows: 27 mobile (390 × 844), 11 desktop (1280 × 900). Cases: 26 algebra and 22 graph turns.
- **0/48 valid tool responses.** The model returned unstructured text; no requested changes execute. This does not mean every prose mathematical answer is wrong. Screenshots explicitly show unchanged authored prior state.
- Found and fixed a mobile layout bug: parameter and named-function graph editors took the entire panel height, leaving the plot invisible. The scoped CSS correction reserves drawing space. Four fresh-page screenshots were inspected; mobile Hide/Show and desktop rendering were checked independently. Original failure captures remain available.
- Long unsimplified equations extend beyond the mobile screenshot edge; horizontal recovery was not verified. Some graph-scene text assertions fail even where curves are visible, so they are retained as limitations.
- No generated intermediate step exists for these invalid responses. This review does not establish streaming, STT, native iPhone, geometry/statistics, or student usability.

[Case-mapped gallery](visual/index.html) · [Inspected image mapping](visual-review.json) · [Graph fix verification](mobile-graph-diagnostic/fixed-verification.json)

The full GPU experiment and its complete baseline/adapted visual review remain in progress.
