import {
  graphFunction,
  numberedGraphs,
  constructionRenderData,
  validateConstruction,
} from '../../Web/src/modules/visuals/index.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';

/** Checks a chosen circle's actual engine objects, including a positive finite radius. */
export function chosenCircle(state: Workspace) {
  if (state.mode !== 'geometry') return false;
  if (state.construction) {
    const objects = validateConstruction(state.construction).objects;
    return (
      objects.length === 1 &&
      objects[0].kind === 'circle' &&
      objects[0].radius > 0
    );
  }
  return (
    state.geometry?.shape === 'circle' && state.geometry.dimensions.radius > 0
  );
}

/** Accepts one of three authored replacements in 2*x+3=9, preserving unrelated workspace fields. */
export function oneNumberToFive(before: Workspace, after: Workspace) {
  return ['5 * x + 3 = 9', '2 * x + 5 = 9', '2 * x + 3 = 5'].some(
    (expression) =>
      JSON.stringify(after) === JSON.stringify({ ...before, expression }),
  );
}

/** This case's obvious missing divisor is the coefficient two; accepts the raw or simplified result. */
export function divideByCoefficient(before: Workspace, after: Workspace) {
  return ['2 * x / 2 = 8 / 2', 'x = 4'].some(
    (expression) =>
      JSON.stringify(after) === JSON.stringify({ ...before, expression }),
  );
}

/** Checks the authored default viewport movement, preserving both curves and their expressions. */
export function panDown(before: Workspace, after: Workspace) {
  return (
    JSON.stringify(after) ===
    JSON.stringify({
      ...before,
      graphRange: { min: -10, max: 10 },
      graphYRange: { min: -15, max: 5 },
    })
  );
}

/** Authored y=x², then y=x+1, including the independently drawable first preview. */
export function expectedGraphCurves(state: Workspace, count: 1 | 2) {
  if (!state.graph) return false;
  const curves = numberedGraphs(state);
  if (curves.length !== count) return false;
  try {
    return curves.every((curve, i) =>
      [-2, -1, 0, 1, 2].every((x) => {
        const actual = graphFunction(curve.expression).value(x);
        return (
          typeof actual === 'number' &&
          Math.abs(actual - (i === 0 ? x * x : x + 1)) < 1e-9
        );
      }),
    );
  } catch {
    return false;
  }
}

/** Authored endpoints and drawable AB, rather than an arbitrary matching length label. */
export function expectedSegment(state: Workspace) {
  if (state.mode !== 'geometry' || !state.construction) return false;
  const scene = validateConstruction(state.construction);
  const A = scene.values.get('A'),
    B = scene.values.get('B');
  if (
    A?.kind !== 'point' ||
    B?.kind !== 'point' ||
    A.x !== 0 ||
    A.y !== 0 ||
    B.x !== 3 ||
    B.y !== 4
  )
    return false;
  return (
    scene.objects.some(
      (object) =>
        object.kind === 'segment' &&
        ((object.a.x === 0 &&
          object.a.y === 0 &&
          object.b.x === 3 &&
          object.b.y === 4) ||
          (object.b.x === 0 &&
            object.b.y === 0 &&
            object.a.x === 3 &&
            object.a.y === 4)),
    ) &&
    constructionRenderData(state.construction).result.labels?.some(
      (label) => label.text === '5',
    ) === true
  );
}
