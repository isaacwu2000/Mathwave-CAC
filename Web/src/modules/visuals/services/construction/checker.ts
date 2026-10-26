import type {
  ConstructionName,
  Expression,
  GeometryDiagnostic,
  GeometryValue,
  Statement,
} from './types.ts';

type Kind = GeometryValue['kind'];
type Signature = { inputs: readonly Kind[]; output: Kind; variadic?: boolean };
const signature = (output: Kind, ...inputs: Kind[]): Signature => ({
  output,
  inputs,
});
const unary = [signature('scalar', 'scalar')];
const signatures: Readonly<Record<ConstructionName, readonly Signature[]>> = {
  sqrt: unary,
  cbrt: unary,
  sin: unary,
  cos: unary,
  tan: unary,
  asin: unary,
  acos: unary,
  atan: unary,
  abs: unary,
  exp: unary,
  ln: unary,
  atan2: [signature('scalar', 'scalar', 'scalar')],
  point: [signature('point', 'scalar', 'scalar')],
  line: [signature('line', 'point', 'point')],
  segment: [signature('segment', 'point', 'point')],
  ray: [signature('ray', 'point', 'point')],
  circle: [
    signature('circle', 'point', 'point'),
    signature('circle', 'point', 'scalar'),
  ],
  polygon: [
    { inputs: ['point', 'point', 'point'], output: 'polygon', variadic: true },
  ],
  triangle: [signature('polygon', 'point', 'point', 'point')],
  midpoint: [signature('point', 'point', 'point')],
  distance: [signature('scalar', 'point', 'point')],
  foot: [signature('point', 'point', 'line')],
  reflection: [signature('point', 'point', 'line')],
  parallel: [
    signature('line', 'point', 'line'),
    signature('boolean', 'line', 'line'),
  ],
  perpendicular: [
    signature('line', 'point', 'line'),
    signature('boolean', 'line', 'line'),
  ],
  bisector: [signature('line', 'point', 'point', 'point')],
  circumcenter: [signature('point', 'point', 'point', 'point')],
  centroid: [signature('point', 'point', 'point', 'point')],
  orthocenter: [signature('point', 'point', 'point', 'point')],
  incenter: [signature('point', 'point', 'point', 'point')],
  circumcircle: [signature('circle', 'point', 'point', 'point')],
  incircle: [signature('circle', 'point', 'point', 'point')],
  equal: [signature('boolean', 'scalar', 'scalar')],
  on: ['line', 'circle', 'segment', 'ray'].map((kind) =>
    signature('boolean', 'point', kind as Kind),
  ),
  intersection: (['line', 'circle'] as const).flatMap((a) =>
    (['line', 'circle'] as const).flatMap((b) => [
      signature('point', a, b),
      signature('point', a, b, 'scalar'),
    ]),
  ),
};

/** Resolves every name and overload before numerical evaluation.
 * Rejects cycles, invalid operand types, and non-geometric draw targets with source lines.
 */
export function checkGeometry(
  statements: readonly Statement[],
): GeometryDiagnostic[] {
  const definitions = new Map(
    statements.filter((s) => s.kind === 'define').map((s) => [s.name, s]),
  );
  const known = new Map<string, Kind>();
  const visiting = new Set<string>();
  function reference(name: string): Kind {
    if (name === 'pi' || name === 'e') return 'scalar';
    const type = known.get(name);
    if (type) return type;
    const declaration = definitions.get(name);
    if (!declaration) throw new Error(`Undefined object ${name}.`);
    if (visiting.has(name))
      throw new Error(`Cyclic construction involving ${name}.`);
    visiting.add(name);
    try {
      const result = infer(declaration.expression);
      known.set(name, result);
      return result;
    } finally {
      visiting.delete(name);
    }
  }
  function infer(expr: Expression): Kind {
    switch (expr.kind) {
      case 'number':
        return 'scalar';
      case 'reference':
        return reference(expr.name);
      case 'operator':
        if (expr.args.some((a) => infer(a) !== 'scalar'))
          throw new Error(
            'Arithmetic operands must be scalars, not geometric objects.',
          );
        return 'scalar';
      case 'call': {
        const types = expr.args.map(infer),
          overloads = signatures[expr.name];
        if (!overloads)
          throw new Error(`Unsupported construction ${expr.name}.`);
        const matched = overloads.find(
          (s) =>
            (s.variadic
              ? types.length >= s.inputs.length
              : types.length === s.inputs.length) &&
            types.every(
              (t, i) => t === (s.inputs[i] ?? s.inputs[s.inputs.length - 1]),
            ),
        );
        if (!matched)
          throw new Error(
            `${expr.name} cannot accept (${types.join(', ')}); expected ${overloads.map((s) => `(${s.inputs.join(', ')}${s.variadic ? ', ...' : ''})`).join(' or ')}.`,
          );
        return matched.output;
      }
    }
  }
  const diagnostics: GeometryDiagnostic[] = [];
  for (const statement of statements)
    try {
      if (statement.kind === 'define') reference(statement.name);
      else if (statement.kind === 'assert') {
        if (infer(statement.expression) !== 'boolean')
          throw new Error('assert requires a geometric predicate.');
      } else if (statement.kind === 'measure' || statement.kind === 'label') {
        if (infer(statement.expression) !== 'segment')
          throw new Error(
            `${statement.kind} requires a segment, such as ${statement.kind} segment(A,B)${statement.kind === 'label' ? ', h' : ''}.`,
          );
      } else if (
        statement.kind === 'angle' ||
        statement.kind === 'rightangle'
      ) {
        if (
          statement.expressions.length !== 3 ||
          statement.expressions.some((expr) => infer(expr) !== 'point')
        )
          throw new Error(
            `${statement.kind} requires three points A,B,C with vertex B.`,
          );
      } else
        for (const expression of statement.expressions) {
          if (['scalar', 'boolean'].includes(infer(expression)))
            throw new Error('draw requires geometric objects.');
        }
    } catch (error) {
      diagnostics.push({
        line: statement.line,
        message:
          error instanceof Error ? error.message : 'Invalid construction type.',
      });
    }
  return diagnostics;
}
