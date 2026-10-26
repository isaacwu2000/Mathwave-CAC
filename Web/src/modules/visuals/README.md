# LearnUnlock canvas adaptation

Adapted from LearnUnlock's `Web/src/modules/grapher` at revision
`2ec7b0568` (the source checkout inspected for this implementation).

The LearnUnlock canvas lives in `ui/GraphCanvas.tsx`; its drawing services and
shared rendering types live in `services/` and `types.ts`. Math Audio's existing
mathematical engine remains in `services/`. The adapters
`services/renderer-adapter.ts` and `services/geometry-renderer.ts` supply calculated positions;
LearnUnlock's expression evaluator, specialist, browser inspection loop, and
artifact persistence are not imported.

Viewport notifications are committed after gestures/keyboard input settle, rather
than during every frame. Geometry uses equal coordinate scales. Scientific label
formatting remains plain text because chemistry is outside this integration.
The canvas loads on demand when a graph or geometry view opens.

Upstream drawing-only 3D and chemistry branches and their supporting label types
are retained to keep this renderer recognizable and ease upstream fixes. Neither
adapter emits those document types; retaining them does not enable additional
Math Audio commands or import an additional mathematical engine.

Named 2D constructions now use the adapted LearnUnlock checker and geometry
calculations, a small bounded parser, and direct canvas drawing. They do not
import LearnUnlock's graph expression engine. See the
[commands module](../commands/README.md) for exposed operations and their limits.

Core graph scenes use `graph-expression.ts`, `graph-scene.ts` and
`graph-scene-renderer.ts` for checked scalar evaluation and bounded sampling.
Implicit relations, inequalities, polar/parametric curves, restrictions,
piecewise expressions and named definitions share the existing canvas. The scene
editor loads only for extended rows. Numerical sampling has resolution limits;
see the capability document for those limits and deferred issue #11.
