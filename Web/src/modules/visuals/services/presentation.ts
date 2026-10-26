import type { GraphDocument } from '../types.ts';

/** Resolves presentation without renaming mathematical variables or changing coordinates. */
export function graphPresentation(document: GraphDocument) {
  const preset =
    document.presentation?.preset ??
    (document.construction || document.chemistry ? 'geometry' : 'coordinate');
  return {
    preset,
    grid: document.presentation?.grid ?? preset === 'coordinate',
    axes: {
      x: preset !== 'geometry',
      y: preset !== 'geometry',
      z: preset !== 'geometry',
      ...document.presentation?.axes,
    },
    labels: { x: 'x', y: 'y', z: 'z', ...document.presentation?.labels },
  };
}
