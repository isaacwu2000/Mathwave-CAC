import {
  parseMath,
  formatMath,
  evaluateMath,
  type MathNode,
} from './math-engine.ts';
import { ClarificationError } from './clarification.ts';

/**
 * - Applies one operation to both sides and returns a new equation.
 * - Rejects equation operands and zero or variable multiplication/division factors.
 * - Preserves real solutions and the parser's size and nesting limits.
 */
export function applyBothSidesMath(
  equation: MathNode,
  op: '+' | '-' | '*' | '/',
  operand: MathNode,
): MathNode {
  if (equation.kind !== 'equation')
    throw new ClarificationError(
      'Which equation should I apply that to? Enter an equation with equals first.',
    );
  if (operand.kind === 'equation')
    throw new Error(
      'Use an expression, rather than another equation, for that operation.',
    );
  if (op === '*' || op === '/') {
    let value: number;
    try {
      value = evaluateMath(operand);
    } catch {
      throw new Error(
        'Multiplying or dividing by a variable can change the solution set. For now, use a nonzero constant or dictate the next step explicitly.',
      );
    }
    if (!Number.isFinite(value) || value === 0)
      throw new Error(
        'Use a nonzero finite number so this operation preserves the equation.',
      );
  }
  const apply = (side: MathNode): MathNode => ({
    kind: 'binary',
    op,
    left: side,
    right: operand,
  });
  // Also enforce token, input-size and nesting limits on the expanded result.
  return parseMath(
    formatMath({
      kind: 'equation',
      left: apply(equation.left),
      right: apply(equation.right),
    }),
  );
}
