import {
  compileGraphScene,
  describeGraphScene,
  type GraphScene,
} from '../../visuals/index.ts';
import type { Workspace } from '../../workspace/state.ts';

/** Keeps legacy function requests on their existing path; extended syntax opts into a checked row collection. */
export function needsGraphScene(source: string) {
  const expression = source.trim();
  return (
    /[{}<>,]|theta|θ/.test(expression) ||
    (/^y\s*=/.test(expression) &&
      /\by\b/.test(expression.slice(expression.indexOf('=') + 1))) ||
    (/=\s*y$/.test(expression) &&
      /\by\b/.test(expression.slice(0, expression.indexOf('=')))) ||
    (/^[A-Za-z]\w*\s*\(/.test(expression) && /=/.test(expression)) ||
    (/^[A-Za-z]\w*\s*=/.test(expression) && !/^y\s*=/.test(expression)) ||
    (expression.includes('=') &&
      !/^y\s*=/.test(expression) &&
      !/=\s*y$/.test(expression))
  );
}

/** Captures current graph rows without changing them; legacy curves keep their numbering when upgraded. */
export function currentGraphScene(state: Workspace): GraphScene {
  return (
    state.graphScene ??
    state.retainedGraph ?? {
      rows: [state.expression, ...(state.graphExpressions ?? [])].map(
        (expression) => ({ expression }),
      ),
    }
  );
}

/** Checks the complete collection before returning a graph workspace; invalid edits never escape as partial state. */
export function graphSceneState(
  state: Workspace,
  scene: GraphScene,
): Workspace {
  compileGraphScene(scene);
  const next: Workspace = {
    ...state,
    mode: 'equation',
    expression: '0',
    graph: true,
    selection: 0,
    graphScene: scene,
  };
  delete next.retainedGraph;
  delete next.graphExpressions;
  delete next.graphTrace;
  delete next.graphComparison;
  return next;
}

/** Resolves one-based rows or a unique saved name against this exact scene. */
export function graphSceneIndex(scene: GraphScene, target: unknown): number {
  const index =
    typeof target === 'string'
      ? scene.rows.findIndex(
          (row) => row.name?.toLowerCase() === target.toLowerCase(),
        ) + 1
      : target;
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > scene.rows.length
  )
    throw new Error('That graph row or name does not exist.');
  return index;
}

/** Returns the computed graph description through the same command readback used by voice and typed requests. */
export function graphSceneMessage(scene: GraphScene) {
  return describeGraphScene(scene);
}

/** Keeps the displayed graph independent when an equation is written or transformed. */
export function equationWorkspace(state: Workspace): Workspace {
  const next = { ...state };
  if (state.graph) next.retainedGraph = currentGraphScene(state);
  delete next.graphScene;
  delete next.graphExpressions;
  return next;
}
