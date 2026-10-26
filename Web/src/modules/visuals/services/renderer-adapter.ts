import { graphSegments, validateGraphRange, type GraphRange } from './graph.ts';
import type { GraphDocument, GraphResult, Plot } from '../types.ts';

export const graphColors = [
  '#d32419',
  '#b55d18',
  '#a94373',
  '#8f1b14',
  '#7a4935',
  '#bd742e',
  '#bc5044',
  '#706967',
];

/**
 * - Converts Math Audio curve samples into LearnUnlock drawing inputs.
 * - Preserves gaps at undefined points and detected discontinuities.
 * - Checks view ranges without changing expressions or using another math engine.
 */
export function graphRenderData(
  expressions: string[],
  x: GraphRange,
  y: GraphRange,
) {
  validateGraphRange(x);
  validateGraphRange(y);
  const document: GraphDocument = {
    dimension: 2,
    angleMode: 'radians',
    bounds: { ...x, y },
    expressions: [],
  };
  const plots: Plot[] = expressions.map((expression, index) => {
    const points = graphSegments(expression, x),
      positions: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (a.y !== null && b.y !== null && !b.breakBefore)
        positions.push(a.x, a.y, 0, b.x, b.y, 0);
    }
    return {
      id: `curve-${index}`,
      kind: 'line',
      color: graphColors[index],
      positions,
    };
  });
  const result: GraphResult = { plots, errors: {}, values: {}, parameters: [] };
  return { document, result };
}
