import { drawingColors } from '../drawing-colors.ts';
import type { GraphExpression, GraphResult } from '../../types.ts';
import { polygonTriangles } from './drawing.ts';
import { parseGeometry } from './parser.ts';
import type {
  Expression,
  GeometryDiagnostic,
  GeometryValue,
  Point2,
  Statement,
} from './types.ts';
import { intersections, onObject } from './intersections.ts';
import { checkGeometry } from './checker.ts';

const point = (x: number, y: number): Point2 => {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('Point coordinates must be finite real numbers.');
  if (Math.max(Math.abs(x), Math.abs(y)) > 1e6)
    throw new Error('Use coordinates within one million units.');
  return { kind: 'point', x, y };
};
function isKind<K extends GeometryValue['kind']>(
  value: GeometryValue | undefined,
  kind: K,
): value is Extract<GeometryValue, { kind: K }> {
  return value?.kind === kind;
}
function required<K extends GeometryValue['kind']>(
  value: GeometryValue | undefined,
  kind: K,
): Extract<GeometryValue, { kind: K }> {
  if (!isKind(value, kind))
    throw new Error(
      `Expected ${kind}, received ${value?.kind ?? 'missing argument'}.`,
    );
  return value;
}
const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const coordinates = (p: Point2) => `(${p.x},${p.y})`;
const midpoint = (a: Point2, b: Point2) =>
  point(a.x + (b.x - a.x) / 2, a.y + (b.y - a.y) / 2);
function foot(a: Point2, l: import('./types.ts').Line2) {
  const dx = l.b.x - l.a.x,
    dy = l.b.y - l.a.y;
  const t = ((a.x - l.a.x) * dx + (a.y - l.a.y) * dy) / (dx * dx + dy * dy);
  return point(l.a.x + t * dx, l.a.y + t * dy);
}
/** Uses translated coordinates to avoid cancellation from a large common origin. */
function circumcenter(a: Point2, b: Point2, c: Point2) {
  const bx = b.x - a.x,
    by = b.y - a.y,
    cx = c.x - a.x,
    cy = c.y - a.y;
  const determinant = 2 * (bx * cy - by * cx);
  if (
    Math.abs(determinant) <=
    1e-12 * Math.max(bx * bx + by * by, cx * cx + cy * cy)
  )
    throw new Error('Triangle centers require three noncollinear points.');
  return point(
    a.x + ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / determinant,
    a.y + ((cx * cx + cy * cy) * bx - (bx * bx + by * by) * cx) / determinant,
  );
}

/** Compiles a complete construction before any renderer can consume it.
 * Returns typed values and ordinary grapher expressions only when every statement is valid.
 * Invalid source returns diagnostics without partially evaluated geometry.
 */
export function compileGeometry(source: string):
  | {
      status: 'valid';
      values: ReadonlyMap<string, GeometryValue>;
      expressions: GraphExpression[];
      labels: NonNullable<GraphResult['labels']>;
      objects: GeometryValue[];
      arcs: {
        x: number;
        y: number;
        radius: number;
        start: number;
        end: number;
      }[];
    }
  | { status: 'invalid'; diagnostics: GeometryDiagnostic[] } {
  const parsed = parseGeometry(source);
  const diagnostics = [...parsed.diagnostics];
  if (diagnostics.length) return { status: 'invalid', diagnostics };
  diagnostics.push(...checkGeometry(parsed.statements));
  if (diagnostics.length) return { status: 'invalid', diagnostics };
  const definitions = new Map<string, Extract<Statement, { kind: 'define' }>>();
  const values = new Map<string, GeometryValue>();
  const visiting = new Set<string>();
  const expressions: GraphExpression[] = [];
  const visiblePoints = new Set<string>();
  const objects: GeometryValue[] = [];
  const arcs: {
    x: number;
    y: number;
    radius: number;
    start: number;
    end: number;
  }[] = [];
  for (const statement of parsed.statements)
    if (statement.kind === 'define') {
      if (
        definitions.has(statement.name) ||
        ['pi', 'e', 'draw'].includes(statement.name)
      )
        diagnostics.push({
          line: statement.line,
          message: `Duplicate or reserved name ${statement.name}.`,
        });
      else definitions.set(statement.name, statement);
    }
  function resolve(name: string): GeometryValue {
    const known = values.get(name);
    if (known) return known;
    if (name === 'pi' || name === 'e')
      return { kind: 'scalar', value: name === 'pi' ? Math.PI : Math.E };
    const definition = definitions.get(name);
    if (!definition) throw new Error(`Undefined object ${name}.`);
    if (visiting.has(name))
      throw new Error(`Cyclic construction involving ${name}.`);
    visiting.add(name);
    try {
      const value = evaluate(definition.expression);
      values.set(name, value);
      return value;
    } finally {
      visiting.delete(name);
    }
  }
  function evaluate(expr: Expression): GeometryValue {
    const value = evaluateUnchecked(expr);
    switch (value.kind) {
      case 'scalar':
        if (!Number.isFinite(value.value))
          throw new Error('Computed scalars must be finite.');
        break;
      case 'line':
      case 'segment':
      case 'ray':
        if (
          !Number.isFinite(distance(value.a, value.b)) ||
          distance(value.a, value.b) === 0
        )
          throw new Error(
            'Linear objects require distinct points at a finite distance.',
          );
        break;
      case 'circle':
        if (!Number.isFinite(value.radius) || value.radius <= 0)
          throw new Error('Circle radius must be positive and finite.');
        if (value.radius > 1e6)
          throw new Error('Use a circle radius within one million units.');
        break;
      case 'point':
      case 'polygon':
      case 'boolean':
        break;
    }
    return value;
  }
  function evaluateUnchecked(expr: Expression): GeometryValue {
    switch (expr.kind) {
      case 'number':
        if (!Number.isFinite(expr.value))
          throw new Error('Numbers must be finite.');
        return { kind: 'scalar', value: expr.value };
      case 'reference':
        return resolve(expr.name);
      case 'operator': {
        const operands = expr.args.map(
          (a) => required(evaluate(a), 'scalar').value,
        );
        const [a, b] = operands;
        const value =
          expr.op === '+'
            ? b === undefined
              ? a
              : a + b
            : expr.op === '-'
              ? b === undefined
                ? -a
                : a - b
              : expr.op === '*'
                ? a * b
                : expr.op === '/'
                  ? a / b
                  : a ** b;
        if (!Number.isFinite(value))
          throw new Error('Arithmetic must produce a finite real number.');
        return { kind: 'scalar', value };
      }
      case 'call': {
        const args = expr.args.map(evaluate);
        const p = (i: number) => required(args[i], 'point');
        const arity = (n: number) => {
          if (args.length !== n)
            throw new Error(`${expr.name} needs ${n} arguments.`);
        };
        switch (expr.name) {
          case 'sqrt':
          case 'cbrt':
          case 'sin':
          case 'cos':
          case 'tan':
          case 'asin':
          case 'acos':
          case 'atan':
          case 'abs':
          case 'exp':
          case 'ln':
          case 'atan2': {
            const numbers = args.map((a) => required(a, 'scalar').value);
            const fn = expr.name === 'ln' ? Math.log : Math[expr.name];
            const value = (fn as (...args: number[]) => number)(...numbers);
            if (!Number.isFinite(value))
              throw new Error(
                'Scalar function must produce a finite real number.',
              );
            return { kind: 'scalar', value };
          }
          case 'point':
            arity(2);
            return point(
              required(args[0], 'scalar').value,
              required(args[1], 'scalar').value,
            );
          case 'distance':
            arity(2);
            return { kind: 'scalar', value: distance(p(0), p(1)) };
          case 'midpoint':
            arity(2);
            return midpoint(p(0), p(1));
          case 'parallel':
          case 'perpendicular': {
            arity(2);
            const b = required(args[1], 'line');
            const dx = b.b.x - b.a.x,
              dy = b.b.y - b.a.y;
            if (args[0].kind === 'line') {
              const a = args[0],
                ax = a.b.x - a.a.x,
                ay = a.b.y - a.a.y;
              const al = Math.hypot(ax, ay),
                bl = Math.hypot(dx, dy);
              const product =
                expr.name === 'parallel'
                  ? (ax / al) * (dy / bl) - (ay / al) * (dx / bl)
                  : (ax / al) * (dx / bl) + (ay / al) * (dy / bl);
              if (!Number.isFinite(product))
                throw new Error('Predicate exceeds finite numeric precision.');
              return { kind: 'boolean', value: Math.abs(product) <= 1e-9 };
            }
            const a = p(0),
              length = Math.hypot(dx, dy);
            return {
              kind: 'line',
              a,
              b:
                expr.name === 'parallel'
                  ? point(a.x + dx / length, a.y + dy / length)
                  : point(a.x - dy / length, a.y + dx / length),
            };
          }
          case 'bisector': {
            arity(3);
            const a = p(0),
              vertex = p(1),
              c = p(2),
              la = distance(a, vertex),
              lc = distance(c, vertex);
            if (!la || !lc)
              throw new Error('Bisector needs distinct arm points and vertex.');
            const dx = (a.x - vertex.x) / la + (c.x - vertex.x) / lc,
              dy = (a.y - vertex.y) / la + (c.y - vertex.y) / lc;
            if (Math.hypot(dx, dy) < 1e-12)
              throw new Error(
                'A straight angle needs an explicit bisector choice.',
              );
            return {
              kind: 'line',
              a: vertex,
              b: point(vertex.x + dx, vertex.y + dy),
            };
          }
          case 'reflection': {
            arity(2);
            const a = p(0),
              f = foot(a, required(args[1], 'line'));
            return point(2 * f.x - a.x, 2 * f.y - a.y);
          }
          case 'equal': {
            arity(2);
            const a = required(args[0], 'scalar').value,
              b = required(args[1], 'scalar').value;
            return {
              kind: 'boolean',
              value:
                Math.abs(a - b) <=
                1e-9 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE),
            };
          }
          case 'on': {
            arity(2);
            const object = args[1];
            if (
              object.kind !== 'line' &&
              object.kind !== 'circle' &&
              object.kind !== 'segment' &&
              object.kind !== 'ray'
            )
              throw new Error(
                'on needs a point and a line, circle, segment, or ray.',
              );
            return { kind: 'boolean', value: onObject(p(0), object) };
          }
          case 'intersection': {
            if (args.length !== 2 && args.length !== 3)
              throw new Error(
                'intersection needs two objects and an optional branch (1 or 2).',
              );
            const a = args[0],
              b = args[1];
            if (
              (a.kind !== 'line' && a.kind !== 'circle') ||
              (b.kind !== 'line' && b.kind !== 'circle')
            )
              throw new Error('intersection needs lines or circles.');
            const points = intersections(a, b);
            if (!points.length)
              throw new Error('Objects have no real intersection.');
            if (points.length === 2 && args.length !== 3)
              throw new Error(
                'Two intersections: specify branch 1 or 2 (ordered by x, then y).',
              );
            const branch =
              args.length === 3 ? required(args[2], 'scalar').value : 1;
            if (branch !== 1 && branch !== 2)
              throw new Error('Intersection branch must be 1 or 2.');
            const selected = points[branch - 1];
            if (!selected)
              throw new Error(
                'The requested intersection branch does not exist.',
              );
            return point(selected.x, selected.y);
          }
          case 'line':
          case 'segment':
          case 'ray': {
            arity(2);
            const a = p(0),
              b = p(1);
            if (distance(a, b) === 0)
              throw new Error(`${expr.name} needs distinct points.`);
            return { kind: expr.name, a, b };
          }
          case 'foot': {
            arity(2);
            return foot(p(0), required(args[1], 'line'));
          }
          case 'circumcenter':
          case 'circumcircle':
          case 'centroid':
          case 'orthocenter':
          case 'incenter':
          case 'incircle': {
            arity(3);
            const a = p(0),
              b = p(1),
              c = p(2);
            const o = circumcenter(a, b, c);
            if (expr.name === 'circumcenter') return o;
            if (expr.name === 'circumcircle')
              return { kind: 'circle', center: o, radius: distance(o, a) };
            if (expr.name === 'centroid')
              return point((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
            if (expr.name === 'orthocenter')
              return point(
                a.x + b.x + c.x - 2 * o.x,
                a.y + b.y + c.y - 2 * o.y,
              );
            const la = distance(b, c),
              lb = distance(a, c),
              lc = distance(a, b),
              perimeter = la + lb + lc;
            const center = point(
              (la * a.x + lb * b.x + lc * c.x) / perimeter,
              (la * a.y + lb * b.y + lc * c.y) / perimeter,
            );
            return expr.name === 'incenter'
              ? center
              : {
                  kind: 'circle',
                  center,
                  radius: distance(
                    center,
                    foot(center, { kind: 'line', a, b }),
                  ),
                };
          }
          case 'circle': {
            arity(2);
            const center = p(0),
              radius =
                args[1].kind === 'point'
                  ? distance(center, p(1))
                  : required(args[1], 'scalar').value;
            if (!Number.isFinite(radius) || radius <= 0)
              throw new Error('Circle radius must be positive and finite.');
            return { kind: 'circle', center, radius };
          }
          case 'triangle':
          case 'polygon': {
            if (expr.name === 'triangle') arity(3);
            const vertices = args.map((_v, i) => p(i));
            polygonTriangles(vertices.map((v) => [v.x, v.y, 0]));
            return { kind: 'polygon', vertices };
          }
          default: {
            throw new Error('Unsupported construction.');
          }
        }
      }
    }
  }
  function draw(value: GeometryValue) {
    objects.push(value);
    if (expressions.length >= 60) throw new Error('Draw at most 60 objects.');
    const points =
      value.kind === 'point'
        ? [value]
        : value.kind === 'circle'
          ? [value.center]
          : value.kind === 'polygon'
            ? value.vertices
            : 'a' in value
              ? [value.a, value.b]
              : [];
    points.forEach((p) => visiblePoints.add(coordinates(p)));
    let expression: string;
    switch (value.kind) {
      case 'point':
        expression = coordinates(value);
        break;
      case 'line':
      case 'segment':
      case 'ray':
        expression = `${value.kind}(${coordinates(value.a)},${coordinates(value.b)})`;
        break;
      case 'circle':
        expression = `(${value.center.x}+${value.radius}*cos(t),${value.center.y}+${value.radius}*sin(t))`;
        break;
      case 'polygon':
        expression = `polygon(${value.vertices.map(coordinates).join(',')})`;
        break;
      case 'scalar':
      case 'boolean':
        throw new Error(
          'Cannot draw a scalar or assertion; draw a geometric object.',
        );
    }
    expressions.push({
      id: `geometry-${expressions.length + 1}`,
      expression,
      visible: true,
      color: drawingColors.stroke,
      ...(value.kind === 'circle'
        ? { parameters: { t: { min: 0, max: 2 * Math.PI } } }
        : {}),
    });
  }
  const annotations: NonNullable<GraphResult['labels']> = [];
  for (const statement of parsed.statements) {
    try {
      if (statement.kind === 'define') resolve(statement.name);
      else if (statement.kind === 'assert') {
        if (!required(evaluate(statement.expression), 'boolean').value)
          throw new Error('Assertion does not hold for this construction.');
      } else if (statement.kind === 'label') {
        const { a, b } = required(evaluate(statement.expression), 'segment');
        if (distance(a, b) < 1e-10)
          throw new Error('Label a segment with distinct endpoints.');
        annotations.push({
          text: statement.text,
          position: [(a.x + b.x) / 2, (a.y + b.y) / 2, 0],
        });
      } else if (statement.kind === 'measure') {
        const { a, b } = required(evaluate(statement.expression), 'segment');
        annotations.push({
          text: String(Number(Math.hypot(b.x - a.x, b.y - a.y).toPrecision(4))),
          position: [(a.x + b.x) / 2, (a.y + b.y) / 2, 0],
        });
      } else if (
        statement.kind === 'angle' ||
        statement.kind === 'rightangle'
      ) {
        // Normalize the arms so perpendicularity is scale-independent.
        // Tolerances admit rounding, not visibly false angle marks;
        // annotation size follows the shorter arm to stay near its vertex.
        const [a, b, c] = statement.expressions.map((expr) =>
          required(evaluate(expr), 'point'),
        );
        const ab = Math.hypot(a.x - b.x, a.y - b.y),
          cb = Math.hypot(c.x - b.x, c.y - b.y);
        if (ab < 1e-10 || cb < 1e-10)
          throw new Error(
            'Angle arms must have distinct endpoints from their vertex.',
          );
        const u = { x: (a.x - b.x) / ab, y: (a.y - b.y) / ab },
          v = { x: (c.x - b.x) / cb, y: (c.y - b.y) / cb };
        const dot = u.x * v.x + u.y * v.y;
        if (dot > 1 - 1e-12)
          throw new Error(
            'Angle arms point in the same direction; use three points defining a nonzero angle.',
          );
        const radius = Math.min(ab, cb) * 0.12;
        if (statement.kind === 'rightangle') {
          if (Math.abs(dot) > 1e-7)
            throw new Error(
              'Cannot mark a right angle: these arms are not perpendicular. Correct the construction or use angle A,B,C.',
            );
          const p: Point2 = {
            kind: 'point',
            x: b.x + radius * u.x,
            y: b.y + radius * u.y,
          };
          const q: Point2 = {
            kind: 'point',
            x: p.x + radius * v.x,
            y: p.y + radius * v.y,
          };
          const r: Point2 = {
            kind: 'point',
            x: b.x + radius * v.x,
            y: b.y + radius * v.y,
          };
          draw({ kind: 'segment', a: p, b: q });
          draw({ kind: 'segment', a: q, b: r });
        } else {
          if (expressions.length >= 60)
            throw new Error('Draw at most 60 objects, including angle marks.');
          const start = Math.atan2(u.y, u.x);
          // The signed cross/dot angle selects the minor arc in either orientation.
          const sweep = Math.atan2(u.x * v.y - u.y * v.x, dot);
          const mid = start + sweep / 2;
          arcs.push({
            x: b.x,
            y: b.y,
            radius,
            start: Math.min(start, start + sweep),
            end: Math.max(start, start + sweep),
          });
          annotations.push({
            text: `${Number(((Math.abs(sweep) * 180) / Math.PI).toPrecision(4))}°`,
            position: [
              b.x + 2 * radius * Math.cos(mid),
              b.y + 2 * radius * Math.sin(mid),
              0,
            ],
          });
          expressions.push({
            id: `geometry-${expressions.length + 1}`,
            expression: `(${b.x}+${radius}*cos(t),${b.y}+${radius}*sin(t))`,
            visible: true,
            color: drawingColors.stroke,
            parameters: {
              t: {
                min: Math.min(start, start + sweep),
                max: Math.max(start, start + sweep),
              },
            },
          });
        }
      } else for (const expr of statement.expressions) draw(evaluate(expr));
    } catch (error) {
      diagnostics.push({
        line: statement.line,
        message: error instanceof Error ? error.message : 'Invalid geometry.',
      });
    }
  }
  if (!expressions.length && !diagnostics.length)
    diagnostics.push({
      line: 1,
      message: 'Use draw to select visible geometry.',
    });
  if (diagnostics.length) return { status: 'invalid', diagnostics };
  const labeled = new Map<string, { names: string[]; point: Point2 }>();
  for (const [name, value] of values)
    if (value.kind === 'point' && visiblePoints.has(coordinates(value))) {
      const key = coordinates(value),
        entry = labeled.get(key) ?? { names: [], point: value };
      entry.names.push(name);
      labeled.set(key, entry);
    }
  const labels: NonNullable<GraphResult['labels']> = [...labeled.values()].map(
    ({ names, point }) => ({
      text: names.join(' = '),
      position: [point.x, point.y, 0],
    }),
  );
  return {
    status: 'valid',
    values,
    expressions,
    labels: [...labels, ...annotations],
    objects,
    arcs,
  };
}
