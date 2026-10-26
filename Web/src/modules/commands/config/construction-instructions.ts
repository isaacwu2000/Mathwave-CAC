import { toolInstructions } from './tool-catalog.ts';
import type { Workspace } from '../../workspace/state.ts';

const constructionInstructions = `
Named 2D constructions (deterministic; numerical checks are not a theorem prover):
Source has one statement per line (<=200 lines, <=16000 characters), # comments, immutable declarations name=expression,
draw object,object; assert predicate; measure segment(A,B); label segment(A,B), h; angle A,B,C; rightangle A,B,C (vertex B).
Numbers, pi/e, scalar + - * / ^ and sqrt/cbrt/sin/cos/tan/asin/acos/atan/atan2/abs/exp/ln are supported, in radians.
point(x,y); line(A,B), segment(A,B), ray(A,B), polygon(A,B,C,...), triangle(A,B,C).
circle(center,positiveRadius) or circle(center,pointOnCircle); midpoint(A,B), distance(A,B), foot(P,line), reflection(P,line).
parallel(P,line), perpendicular(P,line), bisector(A,B,C) at B; circumcenter/centroid/orthocenter/incenter(A,B,C), circumcircle/incircle(A,B,C).
intersection(lineOrCircle,lineOrCircle,branch): branch 1 or 2 ordered by x then y; omit only for a unique intersection.
Assertions: on(point,lineOrCircleOrSegmentOrRay), equal(scalar,scalar), parallel(line,line), perpendicular(line,line).
Forward references are allowed within a complete source; undefined names, cycles, false assertions, degeneracy and ambiguous intersections reject the entire operation.
Up to 60 visible objects including angle marks. Coordinates and circle radii must stay within +/-1000000. No 3D, arbitrary code or geometric constraint solver.
Preserve names and dependency formulas when editing. Include relevant givens as assertions. Preserve supplied givens. For missing dimensions or coordinates choose valid simple defaults and state the assumptions; do not present them as supplied facts. Labels are explicit: the renderer never adds side lengths. Use measure segment(A,B) only for given or explicitly requested lengths. Use label segment(A,B), h to display an unknown side as h without assigning or revealing its computed value. Labels accept a letter-led name up to 32 characters (letters, digits, underscore). Omit measurements of right-angle marker strokes, helper lines, and unknown sides. Preserve a student’s requested variable names; use a construction instead of a dimension-based shape when selective or symbolic labels are needed. Do not solve an unknown unless asked.
For progressive builds first save a complete drawable construction, then extend it with complete dependency-valid additions; never emit incomplete source.
Use existing dimension-based geometry.create/measure for simple shapes when sufficient. Do not approximate unsupported graph features with a construction.
Example: problem.save(geometry.construct("A=point(0,0)\\nB=point(4,0)\\nC=point(0,3)\\ndraw triangle(A,B,C)\\nmeasure segment(A,B)\\nmeasure segment(A,C)\\nlabel segment(B,C), h\\nrightangle B,A,C"));
`;

/** Selects extra DSL context locally; ordinary algebra/graph requests add no text or model round trip. */
export function constructionLanguageFor(text: string, state: Workspace) {
  return (state.mode === 'geometry' && state.construction) ||
    /\b(?:geometry|construction|construct|draw|sketch|point|points|segment|ray|circle|triangle|polygon|midpoint|bisector|circumcenter|circumcircle|centroid|orthocenter|incenter|incircle|perpendicular|parallel|projection|reflect|intersection)\b/i.test(
      text,
    )
    ? constructionInstructions
    : '';
}

/** Adds registered construction signatures only when their language context is selected. */
export function constructionInstructionsFor(text: string, state: Workspace) {
  const language = constructionLanguageFor(text, state);
  return language ? `\n${toolInstructions('construction')}\n${language}` : '';
}
