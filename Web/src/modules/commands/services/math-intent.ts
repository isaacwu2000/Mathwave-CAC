import {
  applyBothSidesMath,
  ClarificationError,
  formatMath,
  parseMath,
} from '../../math/index.ts';

type MathOperation =
  | { kind: 'swap' }
  | { kind: 'arithmetic'; operator: '+' | '-' | '*' | '/'; operand: string };

/** Parses explicit equation operations for both execution and persisted DSL source; rejects ambiguous operands. */
export function parseMathOperation(input: string): MathOperation | null {
  if (
    /^(?:swap|switch|flip|reverse) (?:the )?(?:two )?sides(?: of (?:the|this) equation)?$/i.test(
      input.trim(),
    )
  ) {
    return { kind: 'swap' };
  }
  const target =
    '(?:(?:the )?(?:both|each) sides?(?: of (?:the|this) equation)?|(?:the|this) equation)';
  const normalized = input
    .trim()
    .replace(
      /^(?:double|triple|halve) (?:(?:the )?(?:both|each) sides?|(?:the|this) equation)$/i,
      (text) =>
        /^halve/i.test(text)
          ? 'divide both sides by 2'
          : `multiply both sides by ${/^double/i.test(text) ? 2 : 3}`,
    );
  const patterns: [RegExp, '+' | '-' | '*' | '/'][] = [
    [new RegExp(`^add (.+?) (?:to|on) ${target}$`, 'i'), '+'],
    [new RegExp(`^subtract (.+?) (?:from|on) ${target}$`, 'i'), '-'],
    [new RegExp(`^take (.+?) away from ${target}$`, 'i'), '-'],
    [new RegExp(`^take away (.+?) from ${target}$`, 'i'), '-'],
    [new RegExp(`^multiply ${target} by (.+)$`, 'i'), '*'],
    [new RegExp(`^divide ${target} by (.+)$`, 'i'), '/'],
    [new RegExp(`^multiply by (.+?) on ${target}$`, 'i'), '*'],
    [new RegExp(`^divide by (.+?) on ${target}$`, 'i'), '/'],
    [
      new RegExp(`^add (.+?) (?:to|on) (?:the )?left and right sides?$`, 'i'),
      '+',
    ],
    [
      new RegExp(`^subtract (.+?) from (?:the )?left and right sides?$`, 'i'),
      '-',
    ],
  ];
  for (const [pattern, op] of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    if (
      /^(?:it|this|that|(?:this|that|the) (?:number|value|term|expression))$/i.test(
        match[1],
      )
    )
      throw new ClarificationError(
        'Which number or expression should I use? Say the operation again with its exact value.',
      );
    return {
      kind: 'arithmetic',
      operator: op,
      operand: formatMath(parseMath(match[1])),
    };
  }
  if (/^(add|subtract|multiply|divide)\b/i.test(input))
    throw new ClarificationError(
      'Which operation do you mean? For example, say “subtract three from both sides.”',
    );
  return null;
}

/** Applies the parsed operation without guessing a target or changing any saved work. */
export function interpretOperation(
  expression: string,
  input: string,
): string | null {
  const operation = parseMathOperation(input);
  if (!operation) return null;
  const equation = parseMath(expression);
  if (operation.kind === 'swap') {
    if (equation.kind !== 'equation')
      throw new ClarificationError(
        'Which equation should I swap? Enter an equation with equals first.',
      );
    return formatMath({
      ...equation,
      left: equation.right,
      right: equation.left,
    });
  }
  return formatMath(
    applyBothSidesMath(
      equation,
      operation.operator,
      parseMath(operation.operand),
    ),
  );
}
