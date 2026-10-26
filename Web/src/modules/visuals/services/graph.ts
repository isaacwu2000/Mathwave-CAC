import {
  parseMath,
  evaluateMath,
  formatMath,
  type MathNode,
} from '../../math/index.ts';
export type GraphRange = { min: number; max: number };
export const defaultGraphRange: GraphRange = { min: -10, max: 10 };
export function validateGraphRange(range: GraphRange) {
  if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min >= range.max ||
    Math.max(Math.abs(range.min), Math.abs(range.max)) > 1e6 ||
    range.max - range.min < 1e-6
  )
    throw new Error(
      'Use an increasing x range between −1,000,000 and 1,000,000, at least 0.000001 wide.',
    );
  return range;
}
export function graphFunction(expression: string) {
  const parsed = parseMath(expression);
  let node: MathNode = parsed;
  let label = 'y';
  if (parsed.kind === 'equation') {
    if (parsed.left.kind === 'variable' && parsed.left.name === 'y')
      node = parsed.right;
    else if (parsed.right.kind === 'variable' && parsed.right.name === 'y')
      node = parsed.left;
    else {
      node = {
        kind: 'binary',
        op: '-',
        left: parsed.left,
        right: parsed.right,
      };
      label = 'left minus right';
    }
  }
  function check(n: MathNode): void {
    if (n.kind === 'variable' && !['x', 'pi', 'e'].includes(n.name))
      throw new Error(
        'Graph an expression in x, or an equation such as y = x squared.',
      );
    if (n.kind === 'binary' || n.kind === 'equation') {
      check(n.left);
      check(n.right);
    }
    if (n.kind === 'unary') check(n.operand);
    if (n.kind === 'call') check(n.argument);
  }
  check(node);
  const value = (x: number): number | null => {
    try {
      const y = evaluateMath(node, { x });
      return Number.isFinite(y) ? y : null;
    } catch {
      return null;
    }
  };
  return { value, label, node };
}
export function curvePoints(expression: string, range = defaultGraphRange) {
  validateGraphRange(range);
  const { value } = graphFunction(expression);
  return Array.from({ length: 201 }, (_, i) => {
    const x = range.min + ((range.max - range.min) * i) / 200;
    const y = value(x);
    return { x, y: y !== null && Math.abs(y) <= 1e8 ? y : null };
  });
}
// Separate curve segments across poles, including poles between sample positions.
export function graphSegments(expression: string, range = defaultGraphRange) {
  const pts = curvePoints(expression, range),
    { value } = graphFunction(expression);
  return pts.map((p, i) => {
    const prev = pts[i - 1];
    const mid = prev ? value((prev.x + p.x) / 2) : null;
    const broken =
      !prev ||
      prev.y === null ||
      p.y === null ||
      mid === null ||
      Math.abs(mid - ((prev.y ?? 0) + (p.y ?? 0)) / 2) >
        Math.max(1, Math.abs(mid ?? 0) * 0.5);
    return { ...p, breakBefore: broken };
  });
}
// Coefficients in ascending order, for expressions provably polynomial in x.
function quadraticCoefficients(node: MathNode): number[] | null {
  if (node.kind === 'number') return [node.value];
  if (node.kind === 'variable')
    return node.name === 'x'
      ? [0, 1]
      : node.name === 'pi'
        ? [Math.PI]
        : node.name === 'e'
          ? [Math.E]
          : null;
  if (node.kind === 'unary')
    return (
      quadraticCoefficients(node.operand)?.map((v) =>
        node.op === '-' ? -v : v,
      ) ?? null
    );
  if (node.kind !== 'binary') return null;
  // Cancel identical literal offsets before coefficient arithmetic to avoid
  // inventing two roots from rounding in a tangent intersection.
  if (
    node.op === '-' &&
    node.right.kind === 'number' &&
    Number.isFinite(node.right.value) &&
    node.left.kind === 'binary' &&
    node.left.op === '+'
  ) {
    if (
      node.left.right.kind === 'number' &&
      node.left.right.value === node.right.value
    )
      return quadraticCoefficients(node.left.left);
    if (
      node.left.left.kind === 'number' &&
      node.left.left.value === node.right.value
    )
      return quadraticCoefficients(node.left.right);
  }

  const left = quadraticCoefficients(node.left),
    right = quadraticCoefficients(node.right);
  if (!left || !right) return null;
  const multiply = (a: number[], b: number[]) => {
    const result = Array(a.length + b.length - 1).fill(0) as number[];
    a.forEach((v, i) => b.forEach((w, j) => (result[i + j] += v * w)));
    while (result.length > 1 && result.at(-1) === 0) result.pop();
    return result.length <= 3 && result.every(Number.isFinite) ? result : null;
  };
  if (node.op === '+' || node.op === '-')
    return Array.from(
      { length: Math.max(left.length, right.length) },
      (_, i) => (left[i] ?? 0) + (node.op === '-' ? -1 : 1) * (right[i] ?? 0),
    );
  if (node.op === '*') return multiply(left, right);
  if (node.op === '/' && right.length === 1 && right[0] !== 0)
    return left.map((v) => v / right[0]);
  if (node.op === '^' && right.length === 1 && [0, 1, 2].includes(right[0]))
    return right[0] === 0 ? [1] : right[0] === 1 ? left : multiply(left, left);
  return null;
}
export type GraphKeyPoint = { name: string; x: number; y: number };
export function graphKeyPoints(
  expression: string,
  range = defaultGraphRange,
): GraphKeyPoint[] {
  validateGraphRange(range);
  const { value, node } = graphFunction(expression);
  const points: GraphKeyPoint[] = graphRoots(expression, range).map((x) => ({
    name: 'x-intercept',
    x,
    y: 0,
  }));
  const y = value(0);
  if (y !== null) points.push({ name: 'y-intercept', x: 0, y });
  const coefficients = quadraticCoefficients(node);
  if (coefficients?.every(Number.isFinite)) {
    const [, b = 0, a = 0] = coefficients;
    if (a !== 0) {
      const x = -0.5 * (b / a);
      const y = Number.isFinite(x) ? value(x) : null;
      if (y !== null)
        points.push({
          name: a > 0 ? 'minimum vertex' : 'maximum vertex',
          x: x === 0 ? 0 : x,
          y,
        });
    }
  }
  return points;
}
export function graphRoots(expression: string, range = defaultGraphRange) {
  validateGraphRange(range);
  const { value, node } = graphFunction(expression);
  const coefficients = quadraticCoefficients(node);
  if (coefficients && coefficients.every(Number.isFinite)) {
    const [c = 0, b = 0, a = 0] = coefficients;
    let roots: number[] = [];
    if (a === 0) roots = b === 0 ? [] : [-c / b];
    else {
      const direct = b * b - 4 * a * c;
      if (direct === 0) roots = [-b / (2 * a)];
      else {
        const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
        const aa = a / scale,
          bb = b / scale,
          cc = c / scale;
        const discriminant = bb * bb - 4 * aa * cc;
        if (discriminant >= 0) {
          const q = -0.5 * (bb + (bb < 0 ? -1 : 1) * Math.sqrt(discriminant));
          roots = q === 0 ? [0] : [q / aa, cc / q];
        }
      }
    }
    return [...new Set(roots.map((x) => (x === 0 ? 0 : x)))]
      .filter((x) => Number.isFinite(x) && x >= range.min && x <= range.max)
      .sort((a, b) => a - b);
  }
  const points = curvePoints(expression, range),
    roots: number[] = [];
  const add = (x: number) => {
    if (!roots.some((r) => Math.abs(r - x) < (range.max - range.min) * 1e-8))
      roots.push(x);
  };
  points.forEach((p, i) => {
    if (p.y === 0) add(p.x);
    const previous = points[i - 1];
    if (
      !previous ||
      previous.y === null ||
      p.y === null ||
      Math.sign(previous.y) === Math.sign(p.y) ||
      previous.y === 0 ||
      p.y === 0
    )
      return;
    let a = previous.x,
      b = p.x,
      fa = previous.y;
    const initialResidual = Math.max(Math.abs(previous.y), Math.abs(p.y));
    for (let k = 0; k < 50; k++) {
      const mid = (a + b) / 2,
        fm = value(mid);
      if (fm === null) return;
      if (fm === 0) {
        add(mid);
        return;
      }
      if (Math.sign(fa) !== Math.sign(fm)) b = mid;
      else {
        a = mid;
        fa = fm;
      }
    }
    const root = (a + b) / 2,
      residual = value(root);
    // A sign change at a pole or jump is not enough; the residual must shrink.
    if (residual !== null && Math.abs(residual) <= initialResidual * 1e-7)
      add(root);
  });
  return roots.sort((a, b) => a - b);
}
export function fitGraphY(
  expressions: string[],
  range = defaultGraphRange,
): GraphRange {
  const values = expressions
    .flatMap((expression) => curvePoints(expression, range))
    .flatMap((p) => (p.y === null ? [] : [p.y]));
  if (!values.length)
    throw new Error('No finite graph samples in this x range.');
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, Math.abs(max) * 0.02, 0.5);
  return validateGraphRange({ min: min - padding, max: max + padding });
}
const num = (n: number) => Number(n.toPrecision(6)).toString();
export function describeGraph(expression: string, range = defaultGraphRange) {
  const pts = curvePoints(expression, range),
    { label } = graphFunction(expression);
  const valid = pts.filter((p): p is { x: number; y: number } => p.y !== null);
  if (!valid.length)
    return `No finite graph samples from x ${num(range.min)} to ${num(range.max)}.`;
  const min = valid.reduce((a, b) => (a.y < b.y ? a : b)),
    max = valid.reduce((a, b) => (a.y > b.y ? a : b));
  return `Sampled graph of ${label}, x from ${num(range.min)} to ${num(range.max)}. Lowest sampled value ${num(min.y)} at x ${num(min.x)}; highest ${num(max.y)} at x ${num(max.x)}. ${pts.length - valid.length} unplotted samples (undefined or outside the plotting limit). Sampling may miss extrema, roots, or discontinuities; this is not a proof of global extrema.`;
}

export function validateGraphExpressions(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 7 ||
    !value.every((v) => typeof v === 'string' && v.length <= 2000)
  )
    throw new Error('Use up to eight graph expressions.');
  value.forEach((expression) => graphFunction(expression));
  return value;
}
export function graphTicks(range: GraphRange): number[] {
  validateGraphRange(range);
  const raw = (range.max - range.min) / 8;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
  const first = Math.ceil(range.min / step);
  const last = Math.floor(range.max / step);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) =>
    Number(((first + i) * step).toPrecision(12)),
  );
}
export function shiftGraphRange(
  range: GraphRange,
  fraction: number,
): GraphRange {
  const shift = (range.max - range.min) * fraction;
  return validateGraphRange({ min: range.min + shift, max: range.max + shift });
}
export function graphIntersections(
  first: string,
  second: string,
  range = defaultGraphRange,
) {
  const a = graphFunction(first),
    b = graphFunction(second);
  const residual = (expression: string) => {
    const node = parseMath(expression);
    if (node.kind === 'equation') {
      if (node.left.kind === 'variable' && node.left.name === 'y')
        return node.right;
      if (node.right.kind === 'variable' && node.right.name === 'y')
        return node.left;
      return {
        kind: 'binary',
        op: '-',
        left: node.left,
        right: node.right,
      } as MathNode;
    }
    return node;
  };
  // Use the same tested root finder on the difference between the functions.
  const difference: MathNode = {
    kind: 'binary',
    op: '-',
    left: residual(first),
    right: residual(second),
  };
  const points = curvePoints(formatMath(difference), range);
  if (points.every((p) => p.y === 0))
    throw new Error(
      'These sampled curves coincide; there are no isolated intersections to report.',
    );
  return graphRoots(formatMath(difference), range)
    .map((x) => ({ x, y: a.value(x)! }))
    .filter((p) => p.y !== null && b.value(p.x) !== null);
}

/** Five exact x locations; missing values stay explicit rather than interpolated. */
export function graphValueTable(expression: string, range = defaultGraphRange) {
  validateGraphRange(range);
  const { value } = graphFunction(expression);
  return Array.from({ length: 5 }, (_, i) => {
    const x = range.min + ((range.max - range.min) * i) / 4;
    return { x, y: value(x) };
  });
}

export function graphAverageRate(
  expression: string,
  start: number,
  end: number,
) {
  if (
    ![start, end].every((x) => Number.isFinite(x) && Math.abs(x) <= 1e6) ||
    start === end
  )
    throw new Error(
      'Use two distinct finite x values between minus one million and one million.',
    );
  const { value } = graphFunction(expression),
    a = value(start),
    b = value(end);
  if (a === null || b === null)
    throw new Error('The graph is undefined at one of those x values.');
  const rate = (b - a) / (end - start);
  if (!Number.isFinite(rate))
    throw new Error(
      'That rate of change is outside the supported numerical range.',
    );
  return { start: { x: start, y: a }, end: { x: end, y: b }, rate };
}

export function graphSecant(expression: string, start: number, end: number) {
  const rate = graphAverageRate(expression, start, end);
  // Preserve full numeric precision in the saved line, not display rounding.
  const equation = formatMath(
    parseMath(`y = (${rate.rate}) * (x - (${start})) + (${rate.start.y})`),
  );
  graphFunction(equation);
  return { ...rate, equation };
}

export function shiftGraph(
  expression: string,
  right: number,
  up: number,
): string {
  if (![right, up].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6))
    throw new Error(
      'Use finite shifts between minus one million and one million.',
    );
  const parsed = parseMath(expression);
  if (
    parsed.kind === 'equation' &&
    ![parsed.left, parsed.right].some(
      (n) => n.kind === 'variable' && n.name === 'y',
    )
  )
    throw new Error(
      'Shift a function of x such as y = x squared; implicit equations are not supported.',
    );
  const { node } = graphFunction(expression);
  const visit = (n: MathNode): MathNode => {
    if (n.kind === 'variable' && n.name === 'x' && right !== 0)
      return {
        kind: 'binary',
        op: '-',
        left: n,
        right: { kind: 'number', value: right },
      };
    if (n.kind === 'binary' || n.kind === 'equation')
      return { ...n, left: visit(n.left), right: visit(n.right) };
    if (n.kind === 'unary') return { ...n, operand: visit(n.operand) };
    if (n.kind === 'call') return { ...n, argument: visit(n.argument) };
    return { ...n };
  };
  let translated = visit(node);
  if (up !== 0)
    translated = {
      kind: 'binary',
      op: '+',
      left: translated,
      right: { kind: 'number', value: up },
    };
  const result = formatMath({
    kind: 'equation',
    left: { kind: 'variable', name: 'y' },
    right: translated,
  });
  parseMath(result); // Repeated shifts must still obey parser bounds.
  return result;
}

export function numberedGraphs(state: {
  retainedGraph?: { rows: { expression: string; name?: string }[] };
  graphScene?: { rows: { expression: string; name?: string }[] };
  expression: string;
  graphExpressions?: string[];
}) {
  const scene = state.graphScene ?? state.retainedGraph;
  if (scene) return scene.rows.map((row, i) => ({ graph: i + 1, ...row }));
  return [state.expression, ...(state.graphExpressions || [])].map(
    (expression, i) => ({ graph: i + 1, expression }),
  );
}

/** Analytic tangent for provably linear/quadratic functions; no numerical derivative guesses. */
export function graphTangent(expression: string, x: number) {
  if (!Number.isFinite(x) || Math.abs(x) > 1e6)
    throw new Error(
      'Use a finite x value between minus one million and one million.',
    );
  const { node, value } = graphFunction(expression),
    coefficients = quadraticCoefficients(node);
  if (!coefficients || !coefficients.every(Number.isFinite))
    throw new Error(
      'Tangent exploration currently supports linear and quadratic functions of x.',
    );
  const [, b = 0, a = 0] = coefficients;
  const y = value(x),
    slope = b + 2 * a * x;
  if (y === null || !Number.isFinite(slope))
    throw new Error('The tangent cannot be evaluated at that point.');
  const tangent: MathNode = {
    kind: 'equation',
    left: { kind: 'variable', name: 'y' },
    right:
      slope === 0
        ? { kind: 'number', value: y }
        : {
            kind: 'binary',
            op: '+',
            left: {
              kind: 'binary',
              op: '*',
              left: { kind: 'number', value: slope },
              right: {
                kind: 'binary',
                op: '-',
                left: { kind: 'variable', name: 'x' },
                right: { kind: 'number', value: x },
              },
            },
            right: { kind: 'number', value: y },
          },
  };
  const equation = formatMath(tangent);
  parseMath(equation);
  return { x, y, slope, equation };
}

export function graphDerivative(expression: string): string {
  const coefficients = quadraticCoefficients(graphFunction(expression).node);
  if (!coefficients || !coefficients.every(Number.isFinite))
    throw new Error(
      'Derivative curves currently support linear and quadratic functions of x.',
    );
  const [, b = 0, a = 0] = coefficients;
  const equation = formatMath(
    parseMath(
      a === 0
        ? `y = (${b})`
        : `y = (${2 * a}) * x${b === 0 ? '' : ` + (${b})`}`,
    ),
  );
  graphFunction(equation);
  return equation;
}

export function graphNormal(expression: string, x: number) {
  const tangent = graphTangent(expression, x);
  if (tangent.slope === 0)
    return {
      x,
      y: tangent.y,
      slope: null,
      equation: `x = ${x}`,
      vertical: true,
    };
  const slope = -1 / tangent.slope;
  if (!Number.isFinite(slope))
    throw new Error(
      'The normal slope is outside the supported numerical range.',
    );
  const equation = formatMath(
    parseMath(`y = (${slope}) * (x - (${x})) + (${tangent.y})`),
  );
  graphFunction(equation);
  return { x, y: tangent.y, slope, equation, vertical: false };
}

export function transformGraph(
  expression: string,
  inputFactor: number,
  outputFactor: number,
): string {
  if (
    ![inputFactor, outputFactor].every(
      (v) => Number.isFinite(v) && v !== 0 && Math.abs(v) <= 1e6,
    )
  )
    throw new Error(
      'Use finite nonzero transformation factors up to one million.',
    );
  const parsed = parseMath(expression);
  if (
    parsed.kind === 'equation' &&
    ![parsed.left, parsed.right].some(
      (n) => n.kind === 'variable' && n.name === 'y',
    )
  )
    throw new Error(
      'Transform a function of x such as y = x squared; implicit equations are not supported.',
    );
  const { node } = graphFunction(expression);
  const visit = (n: MathNode): MathNode => {
    if (n.kind === 'variable' && n.name === 'x' && inputFactor !== 1)
      return {
        kind: 'binary',
        op: '*',
        left: { kind: 'number', value: inputFactor },
        right: n,
      };
    if (n.kind === 'binary' || n.kind === 'equation')
      return { ...n, left: visit(n.left), right: visit(n.right) };
    if (n.kind === 'unary') return { ...n, operand: visit(n.operand) };
    if (n.kind === 'call') return { ...n, argument: visit(n.argument) };
    return { ...n };
  };
  let transformed = visit(node);
  if (outputFactor !== 1)
    transformed = {
      kind: 'binary',
      op: '*',
      left: { kind: 'number', value: outputFactor },
      right: transformed,
    };
  const equation = formatMath({
    kind: 'equation',
    left: { kind: 'variable', name: 'y' },
    right: transformed,
  });
  parseMath(equation);
  return equation;
}

export function graphIntegral(
  expression: string,
  start: number,
  end: number,
  totalArea = false,
): number {
  if (![start, end].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6))
    throw new Error(
      'Use finite bounds between minus one million and one million.',
    );
  const coefficients = quadraticCoefficients(graphFunction(expression).node);
  if (!coefficients || !coefficients.every(Number.isFinite))
    throw new Error(
      'Integral exploration currently supports linear and quadratic functions of x.',
    );
  if (start === end) return 0;
  const range = validateGraphRange({
    min: Math.min(start, end),
    max: Math.max(start, end),
  });
  const [c = 0, b = 0, a = 0] = coefficients;
  const integrate = (from: number, to: number) => {
    const width = to - from,
      middle = (from + to) / 2;
    return (
      width * (c + b * middle + a * (middle * middle + (width * width) / 12))
    );
  };
  let result = integrate(start, end);
  if (totalArea) {
    const cuts = [
      range.min,
      ...graphRoots(expression, range).filter(
        (x) => x > range.min && x < range.max,
      ),
      range.max,
    ];
    result = cuts
      .slice(1)
      .reduce((sum, to, i) => sum + Math.abs(integrate(cuts[i], to)), 0);
  }
  if (!Number.isFinite(result))
    throw new Error('The integral is outside the supported numerical range.');
  return result === 0 ? 0 : result;
}

export function graphAreaBetween(
  first: string,
  second: string,
  start: number,
  end: number,
): number {
  const a = graphFunction(first).node,
    b = graphFunction(second).node;
  // Each curve must be supported independently, so unsupported terms cannot cancel out.
  graphIntegral(first, start, end);
  graphIntegral(second, start, end);
  const difference = formatMath({ kind: 'binary', op: '-', left: a, right: b });
  return graphIntegral(difference, start, end, true);
}

export type GraphTrace = { graph: number; x: number; expression: string };
export function validateGraphTrace(
  value: unknown,
): asserts value is GraphTrace {
  const v = value as GraphTrace;
  if (
    !v ||
    !Number.isInteger(v.graph) ||
    v.graph < 1 ||
    v.graph > 8 ||
    !Number.isFinite(v.x) ||
    Math.abs(v.x) > 1e6 ||
    typeof v.expression !== 'string' ||
    v.expression.length > 2000
  )
    throw new Error('Invalid graph trace.');
  graphFunction(v.expression);
}
export function includeGraphValue(
  range: GraphRange,
  value: number,
): GraphRange {
  validateGraphRange(range);
  if (!Number.isFinite(value) || Math.abs(value) > 1e6) return range;
  if (value >= range.min && value <= range.max) return range;
  const span = range.max - range.min;
  const min = Math.max(-1e6, Math.min(1e6 - span, value - span / 2));
  return validateGraphRange({ min, max: min + span });
}

export type GraphComparison = {
  expression: string;
  start: number;
  end: number;
};
export function validateGraphComparison(
  value: unknown,
): asserts value is GraphComparison {
  const v = value as GraphComparison;
  if (!v || typeof v.expression !== 'string' || v.expression.length > 2000)
    throw new Error('Invalid graph comparison.');
  graphAverageRate(v.expression, v.start, v.end);
}

export function fitGraphComparison(comparison: GraphComparison) {
  validateGraphComparison(comparison);
  const points = graphAverageRate(
    comparison.expression,
    comparison.start,
    comparison.end,
  );
  const fit = (a: number, b: number): GraphRange => {
    if ([a, b].some((value) => Math.abs(value) > 1e6))
      throw new Error(
        'These points exceed the plot limit of plus or minus one million. Their coordinates remain readable.',
      );
    const low = Math.min(a, b),
      high = Math.max(a, b);
    const padding = Math.max(0.5, (high - low) * 0.15);
    return validateGraphRange({
      min: Math.max(-1e6, low - padding),
      max: Math.min(1e6, high + padding),
    });
  };
  return {
    x: fit(points.start.x, points.end.x),
    y: fit(points.start.y, points.end.y),
  };
}

/** x from an SVG plot click; axis labels and margins do not select points. */
export function graphTraceX(
  point: { x: number; y: number },
  range: GraphRange,
): number | undefined {
  validateGraphRange(range);
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 48 ||
    point.x > 580 ||
    point.y < 20 ||
    point.y > 332
  )
    return undefined;
  return range.min + ((point.x - 48) / 532) * (range.max - range.min);
}
