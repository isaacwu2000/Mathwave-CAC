import type { Workspace } from '../types/index.ts';
import {
  describeGraphScene,
  describeGeometry,
  describeConstruction,
  validateConstruction,
  describeConstructionValue,
} from '../../visuals/index.ts';
import {
  getParts,
  parseMath,
  speakMath,
  displayNumber,
  describeData,
  type MathNode,
} from '../../math/index.ts';
export function partsFor(s: Workspace) {
  if (s.mode === 'equation' && s.graphScene)
    return s.graphScene.rows.map((row, i) => ({
      id: `graph-row-${i}`,
      label: row.name || `Graph row ${i + 1}`,
      spoken: row.expression,
      node: { kind: 'number', value: i } as MathNode,
    }));
  if (s.mode === 'geometry' && s.construction)
    return [...validateConstruction(s.construction).values].map(
      ([name, value], i) => ({
        id: `construction-${name}`,
        label: name,
        spoken: describeConstructionValue(name, value),
        node: { kind: 'number', value: i } as MathNode,
      }),
    );
  if (s.mode === 'equation') return getParts(parseMath(s.expression));
  if (s.mode === 'statistics')
    return s.data.map((v, i) => ({
      id: `point-${i}`,
      label: `Observation ${i + 1}`,
      spoken: `Observation ${i + 1} of ${s.data.length}: ${displayNumber(v)}.`,
      node: { kind: 'number', value: v } as MathNode,
    }));
  if (s.mode === 'geometry' && s.geometry)
    return Object.entries(s.geometry.dimensions).map(([key, value]) => ({
      id: `dimension-${key}`,
      label: key,
      spoken: `${key}: ${displayNumber(value)} ${key === 'sides' ? 'sides' : key === 'angle' ? 'degrees' : 'units'}.`,
      node: { kind: 'number', value } as MathNode,
    }));
  return [];
}
export function describeWorkspace(s: Workspace) {
  if (s.mode === 'equation' && s.graphScene)
    return describeGraphScene(s.graphScene);
  if (s.mode === 'geometry' && s.construction)
    return describeConstruction(s.construction);
  if (s.mode === 'equation')
    return [
      s.expression,
      ...(s.graph && s.graphExpressions ? s.graphExpressions : []),
    ]
      .map(
        (e, i) =>
          `${s.graphExpressions?.length && s.graph ? `Graph ${i + 1}: ` : ''}${speakMath(parseMath(e))}`,
      )
      .join('. ');
  if (s.mode === 'statistics') return describeData(s.data);
  if (s.mode === 'geometry' && s.geometry) return describeGeometry(s.geometry);
  return '';
}
