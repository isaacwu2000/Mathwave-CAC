export type GraphNode =
  | { kind: 'number'; value: number }
  | { kind: 'symbol'; name: string }
  | { kind: 'unary'; op: string; value: GraphNode }
  | { kind: 'binary'; op: string; left: GraphNode; right: GraphNode }
  | { kind: 'call'; name: string; args: GraphNode[] }
  | {
      kind: 'piecewise';
      branches: { condition?: GraphNode; value: GraphNode }[];
    };

/** Parses bounded scalar mathematics, comparisons and piecewise branches without executing source code. */
export function parseGraphExpression(source: string): GraphNode {
  if (!source.trim() || source.length > 2000)
    throw new Error('Use a graph expression of 1–2000 characters.');
  const tokens: string[] = [];
  const matcher =
    /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(<=|>=|!=|[+\-*/^<>=(){},:]))/y;
  let offset = 0;
  while (offset < source.trimEnd().length) {
    matcher.lastIndex = offset;
    const m = matcher.exec(source);
    if (!m)
      throw new Error(
        `Unsupported syntax near ${source.slice(offset, offset + 16)}.`,
      );
    tokens.push(m[1] ?? m[2] ?? m[3]);
    offset = matcher.lastIndex;
  }
  let index = 0,
    nodes = 0;
  const take = (token: string) => {
    if (tokens[index++] !== token) throw new Error(`Expected ${token}.`);
  };
  function expression(minimum = 0, depth = 0): GraphNode {
    if (++nodes > 512 || depth > 32)
      throw new Error('Graph expression is too complex.');
    const token = tokens[index++];
    let node: GraphNode;
    if (token === '+' || token === '-')
      node = { kind: 'unary', op: token, value: expression(5, depth + 1) };
    else if (token === '(') {
      node = expression(0, depth + 1);
      take(')');
    } else if (token === '{') {
      const branches: { condition?: GraphNode; value: GraphNode }[] = [];
      while (index < tokens.length) {
        const first = expression(0, depth + 1);
        if (tokens[index] === ':') {
          index++;
          branches.push({ condition: first, value: expression(0, depth + 1) });
        } else branches.push({ value: first });
        if (tokens[index] !== ',') break;
        index++;
      }
      take('}');
      if (
        !branches.length ||
        branches.length > 16 ||
        branches.slice(0, -1).some((b) => !b.condition)
      )
        throw new Error(
          'Use at most 16 branches, with an optional default only at the end.',
        );
      node = { kind: 'piecewise', branches };
    } else if (token && /^(?:\d|\.)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('Numbers must be finite.');
      node = { kind: 'number', value };
    } else if (token && /^[A-Za-z]/.test(token)) {
      if (
        tokens[index] === '(' &&
        !['x', 'y', 'r', 't', 'theta', 'pi', 'e'].includes(token)
      ) {
        index++;
        const args: GraphNode[] = [];
        if (tokens[index] !== ')')
          while (index < tokens.length) {
            args.push(expression(0, depth + 1));
            if (tokens[index] !== ',') break;
            index++;
          }
        take(')');
        if (args.length > 8)
          throw new Error('Use at most eight function arguments.');
        node = { kind: 'call', name: token, args };
      } else node = { kind: 'symbol', name: token };
    } else throw new Error('Complete the mathematical expression.');
    while (index < tokens.length) {
      let op = tokens[index];
      // Adjacent mathematical factors multiply; function calls are handled above.
      const implicit =
        op === '(' ||
        Boolean(
          op && /^(?:\d|\.|[A-Za-z])/.test(op) && !['and', 'or'].includes(op),
        );
      if (implicit) op = '*';
      const precedence =
        op === 'or'
          ? 0
          : op === 'and'
            ? 1
            : ['<', '<=', '>', '>=', '=', '!='].includes(op)
              ? 2
              : op === '+' || op === '-'
                ? 3
                : op === '*' || op === '/'
                  ? 4
                  : op === '^'
                    ? 6
                    : -1;
      if (precedence < minimum) break;
      if (!implicit) index++;
      const right = expression(precedence + (op === '^' ? 0 : 1), depth + 1);
      const last =
        node.kind === 'binary' && node.op === 'and' ? node.right : node;
      if (
        ['<', '<=', '>', '>='].includes(op) &&
        last.kind === 'binary' &&
        ['<', '<=', '>', '>='].includes(last.op)
      ) {
        node = {
          kind: 'binary',
          op: 'and',
          left: node,
          right: { kind: 'binary', op, left: last.right, right },
        };
      } else node = { kind: 'binary', op, left: node, right };
    }
    return node;
  }
  const node = expression();
  if (index !== tokens.length)
    throw new Error('Unexpected text after the graph expression.');
  return node;
}

export const graphFunctions: Record<
  string,
  { min: number; max: number; calculate: (...args: number[]) => number }
> = {
  sin: { min: 1, max: 1, calculate: Math.sin },
  cos: { min: 1, max: 1, calculate: Math.cos },
  tan: { min: 1, max: 1, calculate: Math.tan },
  asin: { min: 1, max: 1, calculate: Math.asin },
  acos: { min: 1, max: 1, calculate: Math.acos },
  atan: { min: 1, max: 1, calculate: Math.atan },
  atan2: { min: 2, max: 2, calculate: Math.atan2 },
  sqrt: { min: 1, max: 1, calculate: Math.sqrt },
  cbrt: { min: 1, max: 1, calculate: Math.cbrt },
  abs: { min: 1, max: 1, calculate: Math.abs },
  exp: { min: 1, max: 1, calculate: Math.exp },
  ln: { min: 1, max: 1, calculate: Math.log },
  log: { min: 1, max: 2, calculate: (x, b = 10) => Math.log(x) / Math.log(b) },
  floor: { min: 1, max: 1, calculate: Math.floor },
  ceil: { min: 1, max: 1, calculate: Math.ceil },
  round: { min: 1, max: 1, calculate: Math.round },
  min: { min: 1, max: 8, calculate: Math.min },
  max: { min: 1, max: 8, calculate: Math.max },
};

/** Visits every branch, including currently unselected branches, so invalid names cannot hide in a piecewise function. */
export function visitGraphNode(
  node: GraphNode,
  visit: (node: GraphNode) => void,
) {
  visit(node);
  if (node.kind === 'unary') visitGraphNode(node.value, visit);
  if (node.kind === 'binary') {
    visitGraphNode(node.left, visit);
    visitGraphNode(node.right, visit);
  }
  if (node.kind === 'call') node.args.forEach((n) => visitGraphNode(n, visit));
  if (node.kind === 'piecewise')
    node.branches.forEach((b) => {
      if (b.condition) visitGraphNode(b.condition, visit);
      visitGraphNode(b.value, visit);
    });
}

/** Evaluates only the parsed scalar operators; undefined domains return NaN for a gap in the plot. */
export function evaluateGraphNode(
  node: GraphNode,
  symbol: (name: string) => number,
  call: (name: string, args: number[]) => number,
  step: () => void = () => {},
): number {
  step();
  const next = (n: GraphNode) => evaluateGraphNode(n, symbol, call, step);
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'symbol':
      return symbol(node.name);
    case 'unary':
      return node.op === '-' ? -next(node.value) : next(node.value);
    case 'call':
      return call(node.name, node.args.map(next));
    case 'piecewise': {
      const branch = node.branches.find(
        (b) => !b.condition || Boolean(next(b.condition)),
      );
      return branch ? next(branch.value) : NaN;
    }
    case 'binary': {
      const a = next(node.left);
      if (node.op === 'and')
        return Number(Boolean(a) && Boolean(next(node.right)));
      if (node.op === 'or')
        return Number(Boolean(a) || Boolean(next(node.right)));
      const b = next(node.right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? NaN : a / b;
        case '^':
          return a ** b;
        case '<':
          return Number(a < b);
        case '<=':
          return Number(a <= b);
        case '>':
          return Number(a > b);
        case '>=':
          return Number(a >= b);
        case '=':
          return Number(a === b);
        case '!=':
          return Number(a !== b);
        default:
          return NaN;
      }
    }
  }
}
