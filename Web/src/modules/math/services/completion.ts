import { parseMath } from './math-engine.ts';
import type { MathNode } from '../types/index.ts';

type Fraction = { n: bigint; d: bigint };
type Linear = [constant: Fraction, coefficient: Fraction];
const zero = BigInt(0),
  one = BigInt(1);
function fraction(n: bigint, d = one): Fraction {
  if (d === zero || n.toString().length > 128 || d.toString().length > 128)
    throw new Error('Outside exact completion range.');
  let a = n < zero ? -n : n,
    b = d < zero ? -d : d;
  while (b !== zero) [a, b] = [b, a % b];
  const sign = d < zero ? -one : one;
  return { n: (sign * n) / a, d: (sign * d) / a };
}
const add = (a: Fraction, b: Fraction) =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
const negate = (a: Fraction) => fraction(-a.n, a.d);
const divide = (a: Fraction, b: Fraction) => fraction(a.n * b.d, a.d * b.n);

/** Converts a bounded linear expression to exact constant and x coefficients. */
function linear(node: MathNode): Linear {
  if (node.kind === 'number' && Number.isSafeInteger(node.value))
    return [fraction(BigInt(node.value)), fraction(zero)];
  if (node.kind === 'variable' && node.name === 'x')
    return [fraction(zero), fraction(one)];
  if (node.kind === 'unary') {
    const value = linear(node.operand);
    return node.op === '-' ? [negate(value[0]), negate(value[1])] : value;
  }
  if (node.kind !== 'binary')
    throw new Error('Unsupported completion expression.');
  const [a, b] = linear(node.left),
    [c, d] = linear(node.right);
  if (node.op === '+') return [add(a, c), add(b, d)];
  if (node.op === '-') return [add(a, negate(c)), add(b, negate(d))];
  if (node.op === '*' && (b.n === zero || d.n === zero))
    return [multiply(a, c), add(multiply(a, d), multiply(b, c))];
  // A variable denominator may hide a domain restriction even if it cancels.
  if (node.op === '/' && d.n === zero && !containsVariable(node.right))
    return [divide(a, c), divide(b, c)];
  throw new Error('Unsupported completion expression.');
}
function containsVariable(node: MathNode): boolean {
  if (node.kind === 'variable') return true;
  if (node.kind === 'unary') return containsVariable(node.operand);
  if (node.kind === 'binary' || node.kind === 'equation')
    return containsVariable(node.left) || containsVariable(node.right);
  if (node.kind === 'call') return containsVariable(node.argument);
  return false;
}
/** Detects numeric spellings that the parser could round before exact verification. */
export function hasInexactCompletionLiteral(text: string): boolean {
  return /\d*\.\d+|\d+[eE][+-]?\d+|\bpoint\b/i.test(text);
}
function equation(text: string) {
  // The parser stores numbers as floats; reject decimal/scientific literals before parsing.
  if (hasInexactCompletionLiteral(text))
    throw new Error('Exact literals required.');
  const node = parseMath(text);
  if (node.kind !== 'equation') throw new Error('An equation is required.');
  const [a, b] = linear(node.left),
    [c, d] = linear(node.right);
  return { node, root: divide(add(c, negate(a)), add(b, negate(d))) };
}
function isolated(node: MathNode): boolean {
  return (
    node.kind === 'equation' &&
    ((node.left.kind === 'variable' &&
      node.left.name === 'x' &&
      !containsVariable(node.right)) ||
      (node.right.kind === 'variable' &&
        node.right.name === 'x' &&
        !containsVariable(node.left)))
  );
}

/**
 * Verifies a complete solution of an originally unsolved linear equation in x.
 * - Uses exact fractions with integer literals; unsupported domains return null.
 * - Requires x isolated, or a successful explicit deterministic solve command.
 * - Never treats rounded decimals, identities, contradictions, or nonlinear work as verified.
 */
export function verifyLinearCompletion(
  original: string,
  candidate: string,
  explicitSolve = false,
): string | null {
  try {
    const start = equation(original),
      end = equation(candidate);
    if (isolated(start.node) || (!explicitSolve && !isolated(end.node)))
      return null;
    if (start.root.n !== end.root.n || start.root.d !== end.root.d) return null;
    return `x = ${end.root.n}${end.root.d === one ? '' : `/${end.root.d}`}`;
  } catch {
    return null;
  }
}
