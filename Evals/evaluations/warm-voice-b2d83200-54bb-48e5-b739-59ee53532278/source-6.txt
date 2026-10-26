import { toolInstructions } from './tool-catalog.ts';
import type { Workspace } from '../../workspace/state.ts';
const instructions = `
Core 2D graph rows:
Use <=24 rows, <=2000 characters per row and ordinary scalar math: arithmetic, ^, pi/e, sqrt/cbrt, abs, sin/cos/tan and inverses, atan2, exp/ln/log, floor/ceil/round, min/max.
Examples: "x^2+y^2=4", "x=2", "y<=2*x+1", "r=2*cos(theta)", "(3*cos(t),2*sin(t))", "y={x<0:-x,x>=0:x^2}", "y=sqrt(x){x>=0 and x<=4}".
Vertical lines such as x=4 are supported: save graph.plot("x=4") or graph.scene(["x=4"]). Their x coordinate is fixed while y varies; never replace them with y=4 or the residual y=x-4. When asked to graph the current equation, preserve that equation as a relation.
Named scalar rows: "a=2". Named function rows: "f(x)=a*x^2" (drawn as a function), optionally "y=f(x)+1". Functions may take one or two named parameters. Forward references are allowed only within one complete graph.scene program; cycles, unknown names, invalid arity and nonfinite scalar assignments reject the whole scene.
Edit a scalar's definition row to update all dependent functions; preserve dependency expressions and names. Do not replace linked functions with fixed sampled coordinates.
One graph.plot replaces a collection; use graph.add on graph.current to retain existing definitions. For first creation with definitions use graph.scene(["a=2","f(x)=a*x^2"]). Save the final value once.
Implicit contours and inequality regions are numerical samples, not exact proofs. A strict inequality has a broken boundary, inclusive inequalities a solid boundary. Domain gaps remain gaps. Use finite view ranges; reduce the view to inspect small features. No lists/matrices, regression, sliders/playback, vector fields or ODEs. Existing analytic linear/quadratic tools remain for legacy explicit curves; do not apply those tools to arbitrary new relations.
For streamed builds, emit complete dependency-valid scenes/edits as soon as drawable content is available, then extend through graph.add. No extra model acceptance step is required.
`;
/** Adds only relevant graph DSL context locally, without changing ordinary algebra/function prompts or calling a selector model. */
export function graphSceneLanguageFor(text: string, state: Workspace) {
  const graphRequest = /\b(?:graph|plot|draw|sketch)\b/i.test(text);
  const currentRelation =
    state.expression.includes('=') &&
    (/\b(?:it|this|that|current|equation|result)\b/i.test(text) ||
      /^(?:please\s+)?(?:show\s+)?(?:the\s+)?graph[.!?]?$/i.test(text.trim()));
  return (graphRequest &&
    (/\b(?:vertical|line)\b|\bx\s*(?:=|equals\b|is equal to\b)/i.test(text) ||
      currentRelation)) ||
    /\b(?:name|call|label|rename)\b.{0,40}\b(?:graph|curve)\b|\b(?:graph|plot)\b.*\b(?:circle|ellipse|hyperbola|conic)\b|\by\s*(?:\^|squared|cubed)/i.test(
      text,
    ) ||
    state.graphScene ||
    /\b(?:implicit|inequalit\w*|polar|parametric|piecewise|named graph|name (?:the |this )?graph|call (?:this |the )?graph|define|let)\b|[<>]|\b[xy]\b[^=]*\b[xy]\b[^=]*\bequals\b|\br\s*(?:=|equals\b|is equal to\b)|\bf\s*\(/i.test(
      text,
    )
    ? instructions
    : '';
}

/** Adds registered scene signatures only when their language context is selected. */
export function graphSceneInstructionsFor(text: string, state: Workspace) {
  const language = graphSceneLanguageFor(text, state);
  return language ? `\n${toolInstructions('graph-scene')}\n${language}` : '';
}
