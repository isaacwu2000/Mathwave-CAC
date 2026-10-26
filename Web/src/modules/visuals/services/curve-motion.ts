import type { MathNode } from '../../math/index.ts';
import type { GraphResult } from '../types.ts';
import { graphFunction } from './graph.ts';

// Accept only everywhere-defined polynomials through degree two, or one sine
// with an affine argument, constant amplitude and constant vertical offset.
function shape(node: MathNode): { degree: number; sine: boolean } | null {
  if (node.kind === 'number')
    return Number.isFinite(node.value) ? { degree: 0, sine: false } : null;
  if (node.kind === 'variable')
    return node.name === 'x'
      ? { degree: 1, sine: false }
      : ['pi', 'e'].includes(node.name)
        ? { degree: 0, sine: false }
        : null;
  if (node.kind === 'unary') return shape(node.operand);
  if (node.kind === 'call') {
    const arg = shape(node.argument);
    return node.name === 'sin' && arg && !arg.sine && arg.degree <= 1
      ? { degree: 0, sine: true }
      : null;
  }
  if (node.kind !== 'binary') return null;
  const a = shape(node.left),
    b = shape(node.right);
  if (!a || !b || (a.sine && b.sine)) return null;
  if (node.op === '+' || node.op === '-') {
    if ((a.sine && b.degree > 0) || (b.sine && a.degree > 0)) return null;
    return { degree: Math.max(a.degree, b.degree), sine: a.sine || b.sine };
  }
  if (node.op === '*') {
    if (
      (a.sine && b.degree > 0) ||
      (b.sine && a.degree > 0) ||
      a.degree + b.degree > 2
    )
      return null;
    return { degree: a.degree + b.degree, sine: a.sine || b.sine };
  }
  if (
    node.op === '^' &&
    !a.sine &&
    node.right.kind === 'number' &&
    [0, 1, 2].includes(node.right.value) &&
    a.degree * node.right.value <= 2
  )
    return { degree: a.degree * node.right.value, sine: false };
  return null;
}

/** Returns a family and expression key only for a single supported explicit curve. */
export function curveMotionKey(expressions: string[]): string | undefined {
  if (expressions.length !== 1) return;
  try {
    const graph = graphFunction(expressions[0]);
    if (graph.label !== 'y') return;
    const family = shape(graph.node);
    if (family)
      return `${family.sine ? 'sine' : 'polynomial'}:${expressions[0]}`;
  } catch {
    /* Unsupported expressions keep their ordinary redraw. */
  }
}

/** Interpolates matching samples only; never bridges gaps or changes the saved math. */
export function interpolateCurves(
  from: GraphResult,
  to: GraphResult,
  progress: number,
): GraphResult | null {
  if (from.plots.length !== to.plots.length) return null;
  const plots = to.plots.map((plot, index) => {
    const old = from.plots[index];
    if (
      old.id !== plot.id ||
      old.kind !== plot.kind ||
      old.positions.length !== plot.positions.length
    )
      return null;
    if (
      plot.positions.some(
        (value, i) =>
          !Number.isFinite(value) ||
          !Number.isFinite(old.positions[i]) ||
          (i % 3 !== 1 && value !== old.positions[i]),
      )
    )
      return null;
    return {
      ...plot,
      positions: plot.positions.map(
        (value, i) => old.positions[i] + (value - old.positions[i]) * progress,
      ),
    };
  });
  return plots.some((plot) => !plot)
    ? null
    : { ...to, plots: plots as GraphResult['plots'] };
}
