import {
  parseMath,
  formatMath,
  speakMath,
  getParts,
  evaluateMath,
  displayNumber,
  type MathNode,
} from '../../math/index.ts';
import { graphFunction, validateGraphRange, type GraphRange } from './graph.ts';
export type Exploration = {
  title: string;
  description: string;
  controls: {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
  }[];
  plots: string[];
  readouts: { label: string; expression: string }[];
  xRange: GraphRange;
  yRange: GraphRange;
};
export type Presentation =
  | { action: 'show'; content: Exploration }
  | { action: 'hide' };
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= max
  );
}
export function validateExploration(value: unknown): Exploration {
  if (
    !value ||
    typeof value !== 'object' ||
    JSON.stringify(value).length > 8000
  )
    throw new Error('Invalid interactive explanation.');
  const v = value as Exploration;
  if (
    !text(v.title, 100) ||
    !text(v.description, 800) ||
    !Array.isArray(v.controls) ||
    v.controls.length > 3 ||
    !Array.isArray(v.plots) ||
    v.plots.length > 3 ||
    !Array.isArray(v.readouts) ||
    v.readouts.length > 4 ||
    (!v.plots.length && !v.readouts.length)
  )
    throw new Error('Invalid interactive explanation.');
  const names = new Set<string>();
  const controls = v.controls.map((c) => {
    if (
      !c ||
      !text(c.name, 1) ||
      !/^[a-df-wz]$/.test(c.name) ||
      names.has(c.name) ||
      !text(c.label, 80) ||
      ![c.min, c.max, c.step, c.value].every(Number.isFinite) ||
      c.min >= c.max ||
      Math.abs(c.min) > 10000 ||
      Math.abs(c.max) > 10000 ||
      c.step <= 0 ||
      (c.max - c.min) / c.step > 2000 ||
      c.value < c.min ||
      c.value > c.max ||
      Math.abs(
        (c.value - c.min) / c.step - Math.round((c.value - c.min) / c.step),
      ) > 1e-7
    )
      throw new Error('Invalid interactive control.');
    names.add(c.name);
    return {
      name: c.name,
      label: c.label,
      min: c.min,
      max: c.max,
      step: c.step,
      value: c.value,
    };
  });
  const expression = (source: unknown) => {
    if (!text(source, 300)) throw new Error('Invalid interactive math.');
    const tree = parseMath(source);
    for (const p of getParts(tree))
      if (
        p.node.kind === 'variable' &&
        !names.has(p.node.name) &&
        !['x', 'y', 'pi', 'e'].includes(p.node.name)
      )
        throw new Error(`Unknown interactive variable: ${p.node.name}.`);
    return formatMath(tree);
  };
  const lesson = {
    title: v.title,
    description: v.description,
    controls,
    plots: v.plots.map((p) => {
      const source = expression(p),
        node = parseMath(source);
      if (
        node.kind === 'equation' &&
        !(node.left.kind === 'variable' && node.left.name === 'y')
      )
        throw new Error(
          'Interactive plots support y = a function of x; vertical and implicit curves are unavailable.',
        );
      const right = node.kind === 'equation' ? node.right : node;
      if (
        getParts(right).some(
          (part) => part.node.kind === 'variable' && part.node.name === 'y',
        )
      )
        throw new Error('Interactive plots must be explicit functions of x.');
      return source;
    }),
    readouts: v.readouts.map((r) => {
      if (!r || !text(r.label, 100))
        throw new Error('Invalid interactive readout.');
      return { label: r.label, expression: expression(r.expression) };
    }),
    xRange: validateGraphRange(v.xRange),
    yRange: validateGraphRange(v.yRange),
  };
  const view = explorationView(lesson);
  view.plots.forEach(graphFunction);
  return lesson;
}
export function validatePresentation(value: unknown): Presentation | undefined {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object')
    throw new Error('Invalid presentation.');
  const p = value as Presentation;
  if (p.action === 'hide') return { action: 'hide' };
  if (p.action === 'show')
    return { action: 'show', content: validateExploration(p.content) };
  throw new Error('Invalid presentation.');
}
function bind(node: MathNode, values: Record<string, number>): MathNode {
  switch (node.kind) {
    case 'variable':
      return Object.hasOwn(values, node.name)
        ? { kind: 'number', value: values[node.name] }
        : node;
    case 'number':
      return node;
    case 'unary':
      return { ...node, operand: bind(node.operand, values) };
    case 'call':
      return { ...node, argument: bind(node.argument, values) };
    default:
      return {
        ...node,
        left: bind(node.left, values),
        right: bind(node.right, values),
      };
  }
}
export function explorationView(lesson: Exploration) {
  const values = Object.fromEntries(
    lesson.controls.map((c) => [c.name, c.value]),
  );
  return {
    plots: lesson.plots.map((p) => formatMath(bind(parseMath(p), values))),
    readouts: lesson.readouts.map((r) => {
      const node = bind(parseMath(r.expression), values);
      let value: string | undefined;
      try {
        value =
          node.kind === 'equation'
            ? `${displayNumber(evaluateMath(node.left))} = ${displayNumber(evaluateMath(node.right))}`
            : displayNumber(evaluateMath(node));
      } catch {
        value = getParts(node).some(
          (p) =>
            p.node.kind === 'variable' && !['pi', 'e'].includes(p.node.name),
        )
          ? undefined
          : 'Undefined at these values';
      }
      return {
        ...r,
        expression: formatMath(node),
        spoken: speakMath(node),
        value,
      };
    }),
  };
}
export function setExplorationValue(
  lesson: Exploration,
  name: string,
  value: number,
): Exploration {
  const control = lesson.controls.find((c) => c.name === name);
  if (
    !control ||
    !Number.isFinite(value) ||
    value < control.min ||
    value > control.max
  )
    throw new Error('Choose a value inside the interactive range.');
  return validateExploration({
    ...lesson,
    controls: lesson.controls.map((c) =>
      c.name === name ? { ...c, value } : c,
    ),
  });
}
