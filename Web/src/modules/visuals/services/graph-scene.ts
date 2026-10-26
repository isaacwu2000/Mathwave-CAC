import {
  parseGraphExpression,
  visitGraphNode,
  evaluateGraphNode,
  graphFunctions,
  type GraphNode,
} from './graph-expression.ts';
export type GraphSceneRow = {
  expression: string;
  name?: string;
  domain?: { min: number; max: number };
};
export type GraphScene = { rows: GraphSceneRow[] };
type ParsedRow = {
  kind:
    | 'variable'
    | 'function'
    | 'explicit'
    | 'horizontal'
    | 'implicit'
    | 'inequality'
    | 'polar'
    | 'parametric'
    | 'point';
  node: GraphNode;
  second?: GraphNode;
  restriction?: GraphNode;
  symbol?: string;
  args?: string[];
  operator?: string;
};
const reserved = new Set([
  'x',
  'y',
  'r',
  't',
  'theta',
  'pi',
  'e',
  'and',
  'or',
  ...Object.keys(graphFunctions),
]);

/** Finds a delimiter outside parentheses and piecewise braces; nested expressions keep their own delimiters. */
function splitTop(source: string, delimiter: string): string[] {
  let depth = 0,
    start = 0;
  const result: string[] = [];
  for (let i = 0; i < source.length; i++) {
    if ('({'.includes(source[i])) depth++;
    if (')}'.includes(source[i])) depth--;
    if (depth === 0 && source[i] === delimiter) {
      result.push(source.slice(start, i));
      start = i + 1;
    }
  }
  result.push(source.slice(start));
  return result;
}

/** Compiles and validates the complete row collection, with finite scalar definitions and acyclic dependencies.
 * Returned sample values are y, x, radius, or a relation residual according to row kind. No state is changed.
 */
export function compileGraphScene(
  value: unknown,
  maxEvaluationSteps = Infinity,
) {
  let evaluationSteps = 0;
  const scene = value as GraphScene;
  if (
    !scene ||
    !Array.isArray(scene.rows) ||
    scene.rows.length < 1 ||
    scene.rows.length > 24
  )
    throw new Error('Use 1–24 graph rows.');
  const labels = new Set<string>();
  const rows: ParsedRow[] = scene.rows.map((row, index) => {
    if (
      !row ||
      typeof row.expression !== 'string' ||
      !row.expression.trim() ||
      row.expression.length > 2000
    )
      throw new Error(`Row ${index + 1}: use 1–2000 expression characters.`);
    if (row.name !== undefined) {
      if (
        typeof row.name !== 'string' ||
        !row.name.trim() ||
        row.name.length > 80 ||
        labels.has(row.name.toLowerCase())
      )
        throw new Error('Graph names must be unique and 1–80 characters.');
      labels.add(row.name.toLowerCase());
    }
    if (
      row.domain &&
      (!Number.isFinite(row.domain.min) ||
        !Number.isFinite(row.domain.max) ||
        row.domain.min >= row.domain.max ||
        Math.max(Math.abs(row.domain.min), Math.abs(row.domain.max)) > 1e6)
    )
      throw new Error(
        'Use increasing finite parameter bounds within one million.',
      );
    let source = row.expression.trim().replaceAll('θ', 'theta');
    let restriction: GraphNode | undefined;
    // A trailing brace without branch colons restricts the preceding curve's domain.
    if (source.endsWith('}')) {
      let depth = 0;
      for (let i = source.length - 1; i >= 0; i--) {
        if (source[i] === '}') depth++;
        if (source[i] === '{') depth--;
        if (depth === 0) {
          if (i > 0 && !source.slice(i + 1, -1).includes(':')) {
            restriction = parseGraphExpression(source.slice(i + 1, -1));
            source = source.slice(0, i).trim();
          }
          break;
        }
      }
    }
    const definition =
      /^([A-Za-z][A-Za-z0-9_]*)(?:\(\s*([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)?)\s*\))?\s*=(?!=)(.*)$/.exec(
        source,
      );
    if (definition?.[1] === 'z')
      throw new Error(
        'Use a 2D expression in x and y; 3D plotting is separate.',
      );
    if (definition && !reserved.has(definition[1])) {
      const args = definition[2]?.split(',').map((s) => s.trim());
      if (
        args &&
        (new Set(args).size !== args.length ||
          args.some((a) =>
            ['pi', 'e', ...Object.keys(graphFunctions)].includes(a),
          ))
      )
        throw new Error(
          'Use distinct function parameters that do not replace constants or built-in functions.',
        );
      return {
        kind: args ? 'function' : 'variable',
        symbol: definition[1],
        args,
        node: parseGraphExpression(definition[3]),
        restriction,
      };
    }
    if (source.startsWith('(') && source.endsWith(')')) {
      const tuple = splitTop(source.slice(1, -1), ',');
      if (tuple.length === 2) {
        const node = parseGraphExpression(tuple[0]),
          second = parseGraphExpression(tuple[1]);
        let usesParameter = false;
        for (const part of [node, second, restriction])
          if (part)
            visitGraphNode(part, (n) => {
              if (n.kind === 'symbol' && n.name === 't') usesParameter = true;
            });
        return {
          kind: usesParameter ? 'parametric' : 'point',
          node,
          second,
          restriction,
        };
      }
    }
    if (/^r\s*=/.test(source))
      return {
        kind: 'polar',
        node: parseGraphExpression(source.replace(/^r\s*=/, '')),
        restriction,
      };
    const node = parseGraphExpression(source);
    if (
      node.kind === 'binary' &&
      ['=', '<', '<=', '>', '>='].includes(node.op)
    ) {
      if (node.op === '=') {
        let hasY = false,
          hasX = false;
        visitGraphNode(node.right, (n) => {
          if (n.kind === 'symbol' && n.name === 'y') hasY = true;
          if (n.kind === 'symbol' && n.name === 'x') hasX = true;
        });
        if (node.left.kind === 'symbol' && node.left.name === 'y' && !hasY)
          return { kind: 'explicit', node: node.right, restriction };
        let leftY = false,
          leftX = false;
        visitGraphNode(node.left, (n) => {
          if (n.kind === 'symbol' && n.name === 'y') leftY = true;
          if (n.kind === 'symbol' && n.name === 'x') leftX = true;
        });
        if (node.right.kind === 'symbol' && node.right.name === 'y' && !leftY)
          return { kind: 'explicit', node: node.left, restriction };
        if (node.left.kind === 'symbol' && node.left.name === 'x' && !hasX)
          return { kind: 'horizontal', node: node.right, restriction };
        if (node.right.kind === 'symbol' && node.right.name === 'x' && !leftX)
          return { kind: 'horizontal', node: node.left, restriction };
      }
      return {
        kind: node.op === '=' ? 'implicit' : 'inequality',
        node: node.left,
        second: node.right,
        operator: node.op,
        restriction,
      };
    }
    if (node.kind === 'binary' && ['and', 'or'].includes(node.op))
      return { kind: 'inequality', node, operator: 'compound', restriction };
    return { kind: 'explicit', node, restriction };
  });
  const definitions = new Map<string, ParsedRow>();
  rows.forEach((row) => {
    if (row.symbol) {
      if (definitions.has(row.symbol))
        throw new Error(`Duplicate definition ${row.symbol}.`);
      definitions.set(row.symbol, row);
    }
  });
  const checked = new Set<string>(),
    visiting = new Set<string>();
  const check = (row: ParsedRow) => {
    const locals = new Set(
      row.kind === 'variable'
        ? []
        : row.kind === 'function'
          ? row.args
          : row.kind === 'explicit'
            ? ['x']
            : row.kind === 'horizontal'
              ? ['y']
              : row.kind === 'point'
                ? []
                : row.kind === 'polar'
                  ? ['theta']
                  : row.kind === 'parametric'
                    ? ['t']
                    : ['x', 'y'],
    );
    const inspect = (node: GraphNode) =>
      visitGraphNode(node, (n) => {
        if (n.kind === 'symbol') {
          if (['pi', 'e'].includes(n.name) || locals.has(n.name)) return;
          const def = definitions.get(n.name);
          if (!def || def.args) throw new Error(`Undefined scalar ${n.name}.`);
          checkDefinition(n.name);
        }
        if (n.kind === 'call') {
          const builtin = graphFunctions[n.name],
            def = definitions.get(n.name);
          if (builtin) {
            if (n.args.length < builtin.min || n.args.length > builtin.max)
              throw new Error(`Check the arguments to ${n.name}.`);
          } else {
            if (!def?.args || def.args.length !== n.args.length)
              throw new Error(
                `Undefined function or wrong arguments: ${n.name}.`,
              );
            checkDefinition(n.name);
          }
        }
      });
    inspect(row.node);
    if (row.second) inspect(row.second);
    if (row.restriction) inspect(row.restriction);
  };
  function checkDefinition(name: string) {
    if (checked.has(name)) return;
    if (visiting.has(name)) throw new Error(`Cyclic graph definition ${name}.`);
    visiting.add(name);
    check(definitions.get(name)!);
    visiting.delete(name);
    checked.add(name);
  }
  rows.forEach(check);
  const costs = new Map<string, number>();
  const cost = (node: GraphNode, locals: Set<string>): number => {
    let total = 0;
    visitGraphNode(node, (n) => {
      total++;
      const name =
        n.kind === 'call'
          ? n.name
          : n.kind === 'symbol' && !locals.has(n.name)
            ? n.name
            : undefined;
      if (name && definitions.has(name)) {
        if (!costs.has(name)) {
          const definition = definitions.get(name)!;
          const scope = new Set(definition.args ?? []);
          costs.set(
            name,
            cost(definition.node, scope) +
              (definition.restriction
                ? cost(definition.restriction, scope)
                : 0),
          );
        }
        total += costs.get(name)!;
      }
      if (total > 2000)
        throw new Error(
          'Graph function expansion is too complex. Simplify its definitions.',
        );
    });
    return total;
  };
  rows.forEach((row) => {
    const scope = new Set(row.args ?? ['x', 'y', 't', 'theta']);
    const total =
      cost(row.node, scope) +
      (row.second ? cost(row.second, scope) : 0) +
      (row.restriction ? cost(row.restriction, scope) : 0);
    if (total > 2000)
      throw new Error('Graph function expansion is too complex.');
  });
  const constants = new Map<string, number>();
  const evaluate = (node: GraphNode, locals: Record<string, number>): number =>
    evaluateGraphNode(
      node,
      (name) => {
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        if (Object.hasOwn(locals, name)) return locals[name];
        if (constants.has(name)) return constants.get(name)!;
        const def = definitions.get(name)!;
        const result = evaluate(def.node, {});
        if (!Number.isFinite(result))
          throw new Error(`Variable ${name} must be finite and defined.`);
        constants.set(name, result);
        return result;
      },
      (name, args) => {
        if (!args.every(Number.isFinite)) return NaN;
        const builtin = graphFunctions[name];
        if (builtin) return builtin.calculate(...args);
        const def = definitions.get(name)!;
        const scope = Object.fromEntries(
          def.args!.map((arg, i) => [arg, args[i]]),
        );
        if (def.restriction && !evaluate(def.restriction, scope)) return NaN;
        return evaluate(def.node, scope);
      },
      () => {
        if (++evaluationSteps > maxEvaluationSteps)
          throw new Error(
            'This graph view needs too much calculation. Use fewer or simpler expressions.',
          );
      },
    );
  rows.forEach((row) => {
    if (row.kind === 'variable')
      evaluate({ kind: 'symbol', name: row.symbol! }, {});
  });
  // Reject constant domain errors in every branch before any preview can be saved.
  rows.forEach((row) => {
    const locals = new Set(row.args ?? ['x', 'y', 't', 'theta']);
    const inspect = (node: GraphNode) =>
      visitGraphNode(node, (part) => {
        let varying = false;
        visitGraphNode(part, (n) => {
          if (n.kind === 'symbol' && locals.has(n.name)) varying = true;
        });
        if (!varying && !Number.isFinite(evaluate(part, {})))
          throw new Error(
            'Graph expression must have a finite, defined constant domain.',
          );
      });
    inspect(row.node);
    if (row.second) inspect(row.second);
    if (row.restriction) inspect(row.restriction);
  });
  const condition = (
    node: GraphNode,
    locals: Record<string, number>,
  ): { slack: number; strict: boolean } => {
    if (node.kind !== 'binary')
      throw new Error('Combine inequalities using comparisons and and/or.');
    if (node.op === 'and' || node.op === 'or') {
      const left = condition(node.left, locals),
        right = condition(node.right, locals);
      if (!Number.isFinite(left.slack) || !Number.isFinite(right.slack))
        return { slack: NaN, strict: false };
      return node.op === 'and'
        ? left.slack < right.slack
          ? left
          : right
        : left.slack > right.slack
          ? left
          : right;
    }
    if (!['<', '<=', '>', '>='].includes(node.op))
      throw new Error(
        'Use inequalities in a comparison chain; restrict equations with braces.',
      );
    const a = evaluate(node.left, locals),
      b = evaluate(node.right, locals);
    return {
      slack: node.op === '<' || node.op === '<=' ? b - a : a - b,
      strict: node.op === '<' || node.op === '>',
    };
  };
  rows.forEach((row) => {
    if (row.operator === 'compound') condition(row.node, { x: 0, y: 0 });
  });
  const sample = (index: number, x: number, y = 0, t = x): number | null => {
    const row = rows[index];
    if (!row) throw new Error('That graph row does not exist.');
    const locals: Record<string, number> = { x, y, t, theta: t };
    if (row.kind === 'function')
      row.args?.forEach((arg, i) => (locals[arg] = i === 0 ? x : y));
    if (row.restriction && !evaluate(row.restriction, locals)) return null;
    if (row.operator === 'compound') {
      const value = -condition(row.node, locals).slack;
      return Number.isFinite(value) ? value : null;
    }
    const a = evaluate(row.node, locals),
      b = row.second ? evaluate(row.second, locals) : 0;
    const result =
      row.kind === 'implicit' || row.kind === 'inequality' ? a - b : a;
    return Number.isFinite(result) ? result : null;
  };
  const point = (index: number, t: number): { x: number; y: number } | null => {
    const row = rows[index];
    if (!row) throw new Error('That graph row does not exist.');
    const domain = scene.rows[index].domain;
    if (row.kind !== 'point' && domain && (t < domain.min || t > domain.max))
      return null;
    const first = sample(index, t, row.kind === 'horizontal' ? t : 0, t);
    if (first === null) return null;
    if (row.kind === 'function' && row.args?.length !== 1)
      throw new Error('A point query needs a one-parameter function.');
    if (row.kind === 'polar')
      return { x: first * Math.cos(t), y: first * Math.sin(t) };
    if (row.kind === 'parametric' || row.kind === 'point') {
      const second = evaluate(row.second!, { t });
      return Number.isFinite(second) ? { x: first, y: second } : null;
    }
    return row.kind === 'horizontal' ? { x: first, y: t } : { x: t, y: first };
  };
  const contains = (index: number, x: number, y: number) => {
    const row = rows[index],
      value = sample(index, x, y);
    if (value === null) return false;
    if (row.operator === 'compound')
      return Boolean(evaluate(row.node, { x, y }));
    return row.operator === '<'
      ? value < 0
      : row.operator === '<='
        ? value <= 0
        : row.operator === '>'
          ? value > 0
          : row.operator === '>='
            ? value >= 0
            : Math.abs(value) <= 1e-9;
  };
  const strict = (index: number, x: number, y: number) =>
    rows[index].operator === 'compound'
      ? condition(rows[index].node, { x, y }).strict
      : rows[index].operator === '<' || rows[index].operator === '>';
  return { rows, constants, sample, point, contains, strict };
}

/** Produces a concise, faithful readback of named rows and computed scalar assignments. */
export function describeGraphScene(scene: GraphScene) {
  const compiled = compileGraphScene(scene);
  return scene.rows
    .map(
      (row, i) =>
        `${row.name || `Graph row ${i + 1}`}: ${row.expression}${compiled.rows[i].kind === 'variable' ? ` (${compiled.constants.get(compiled.rows[i].symbol!)})` : ''}.`,
    )
    .join(' ');
}
