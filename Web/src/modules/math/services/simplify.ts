import { evaluateMath, type MathNode } from './math-engine.ts';

export function isSimplificationCommand(text: string): boolean {
  const input = text.trim();
  return [
    /^(?:simplify|reduce|clean up)(?: (?:it|this|that|both sides|(?:the|this|that|my) (?:(?:current|last) )?(?:step|equation|expression|fraction|fractions|work)))?$/i,
    /^(?:combine|collect|group)(?: the| these| my)? (?:constants|like terms)(?: together)?(?: (?:on|in) (?:both sides|(?:the|this|current) (?:step|equation|expression)))?$/i,
    /^cancel out(?: the| these)? (?:addition|subtraction|multiplication|division|constants|like terms|common (?:numeric )?factors)(?: in (?:the |this )?(?:current |last )?step| on both sides)?$/i,
    /^cancel (?:the )?common (?:numeric )?factors(?: on both sides)?$/i,
  ].some((pattern) => pattern.test(input));
}

/** Combine additive terms and numeric factors without canceling variable
 * denominators or undefined expressions. Preserve equation sides. */
export function simplifyMath(node: MathNode): MathNode {
  if (node.kind === 'equation')
    return {
      ...node,
      left: simplifyMath(node.left),
      right: simplifyMath(node.right),
    };
  if (node.kind === 'number' || node.kind === 'variable') return { ...node };
  if (node.kind === 'call')
    return { ...node, argument: simplifyMath(node.argument) };
  if (node.kind === 'unary') {
    const operand = simplifyMath(node.operand);
    if (operand.kind === 'number')
      return {
        kind: 'number',
        value: node.op === '-' ? -operand.value : operand.value,
      };
    return { ...node, operand };
  }
  const left = simplifyMath(node.left),
    right = simplifyMath(node.right);
  if (left.kind === 'number' && right.kind === 'number') {
    // Invalid constant arithmetic must stay visible, not silently disappear.
    try {
      return { kind: 'number', value: evaluateMath({ ...node, left, right }) };
    } catch {
      return { ...node, left, right };
    }
  }
  // Cancel only known, nonzero numeric factors. Variable denominators retain
  // their domain restrictions (x/x cannot silently become 1).
  const scale = (term: MathNode, coefficient: number): MathNode => {
    if (coefficient === 1) return term;
    if (coefficient === -1) return { kind: 'unary', op: '-', operand: term };
    return {
      kind: 'binary',
      op: '*',
      left: { kind: 'number', value: coefficient },
      right: term,
    };
  };
  if (node.op === '/' && right.kind === 'number' && right.value !== 0) {
    if (right.value === 1) return left;
    const reducible = (term: MathNode): boolean =>
      term.kind === 'number' ||
      (term.kind === 'binary' &&
        term.op === '*' &&
        (term.left.kind === 'number' || term.right.kind === 'number')) ||
      (term.kind === 'binary' &&
        (term.op === '+' || term.op === '-') &&
        reducible(term.left) &&
        reducible(term.right));
    if (
      left.kind === 'binary' &&
      (left.op === '+' || left.op === '-') &&
      reducible(left)
    ) {
      // Divide every additive term by the same known nonzero constant.
      // Recurse only into the smaller children to preserve domain restrictions.
      return simplifyMath({
        ...left,
        left: { kind: 'binary', op: '/', left: left.left, right },
        right: { kind: 'binary', op: '/', left: left.right, right },
      });
    }
    if (left.kind === 'binary' && left.op === '*') {
      const factor =
        left.left.kind === 'number'
          ? left.left
          : left.right.kind === 'number'
            ? left.right
            : null;
      const term = left.left === factor ? left.right : left.left;
      if (factor && factor.value !== 0) {
        const ratio = factor.value / right.value;
        if (Number.isFinite(ratio) && ratio !== 0) return scale(term, ratio);
      }
    }
  }
  if (node.op === '*') {
    const factor =
      left.kind === 'number' ? left : right.kind === 'number' ? right : null;
    const term = left === factor ? right : left;
    if (factor && factor.value !== 0) {
      if (factor.value === 1) return term;
      if (
        term.kind === 'binary' &&
        term.op === '/' &&
        term.right.kind === 'number' &&
        term.right.value !== 0
      ) {
        const ratio = factor.value / term.right.value;
        if (Number.isFinite(ratio) && ratio !== 0)
          return scale(term.left, ratio);
      }
    }
  }
  if (node.op !== '+' && node.op !== '-') return { ...node, left, right };
  let constant = 0;
  const terms: { node: MathNode; sign: number }[] = [];
  const variables = new Map<
    string,
    { coefficient: number; position: number }
  >();
  const collect = (n: MathNode, sign: number): void => {
    if (n.kind === 'binary' && (n.op === '+' || n.op === '-')) {
      collect(n.left, sign);
      collect(n.right, n.op === '-' ? -sign : sign);
    } else if (n.kind === 'unary')
      collect(n.operand, n.op === '-' ? -sign : sign);
    else if (n.kind === 'number') constant += sign * n.value;
    else {
      const variable =
        n.kind === 'variable'
          ? n
          : n.kind === 'binary' && n.op === '*'
            ? n.left.kind === 'number' && n.right.kind === 'variable'
              ? n.right
              : n.right.kind === 'number' && n.left.kind === 'variable'
                ? n.left
                : null
            : null;
      if (variable) {
        const coefficient =
          n.kind === 'binary'
            ? n.left.kind === 'number'
              ? n.left.value
              : n.right.kind === 'number'
                ? n.right.value
                : 1
            : 1;
        const existing = variables.get(variable.name);
        if (existing) existing.coefficient += sign * coefficient;
        else {
          variables.set(variable.name, {
            coefficient: sign * coefficient,
            position: terms.length,
          });
          terms.push({ node: variable, sign: 1 });
        }
      } else terms.push({ node: n, sign });
    }
  };
  collect(left, 1);
  collect(right, node.op === '-' ? -1 : 1);
  if (!Number.isFinite(constant)) return { ...node, left, right };
  for (const [name, { coefficient, position }] of variables) {
    if (!Number.isFinite(coefficient)) return { ...node, left, right };
    const variable: MathNode = { kind: 'variable', name };
    terms[position] = {
      sign: Math.sign(coefficient),
      node:
        Math.abs(coefficient) === 1
          ? variable
          : {
              kind: 'binary',
              op: '*',
              left: { kind: 'number', value: Math.abs(coefficient) },
              right: variable,
            },
    };
  }
  if (constant !== 0)
    terms.push({
      node: { kind: 'number', value: Math.abs(constant) },
      sign: Math.sign(constant),
    });
  let result: MathNode | null = null;
  for (const term of terms) {
    if (term.sign === 0) continue;
    result = result
      ? {
          kind: 'binary',
          op: term.sign < 0 ? '-' : '+',
          left: result,
          right: term.node,
        }
      : term.sign < 0
        ? { kind: 'unary', op: '-', operand: term.node }
        : term.node;
  }
  return result || { kind: 'number', value: 0 };
}
