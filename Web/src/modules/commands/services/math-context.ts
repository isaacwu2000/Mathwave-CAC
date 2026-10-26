import {
  ClarificationError,
  formatMath,
  getParts,
  parseMath,
  type MathNode,
} from '../../math/index.ts';
import type { Workspace } from '../../workspace/state.ts';
function variableFactor(node: MathNode): string | null {
  if (node.kind === 'variable') return node.name;
  if (
    node.kind === 'binary' &&
    node.op === '^' &&
    node.left.kind === 'variable' &&
    node.right.kind === 'number'
  )
    return node.left.name;
  return null;
}
export function mathContext(state: Workspace) {
  if (state.mode !== 'equation' || state.graphScene) return undefined;
  const parts = getParts(parseMath(state.expression));
  const coefficients: { part: number; variable: string; value: string }[] = [];
  parts.forEach((part, i) => {
    if (
      part.node.kind !== 'number' &&
      !(part.node.kind === 'unary' && part.node.operand.kind === 'number')
    )
      return;
    const parent = parts.find(
      (p) => p.id === part.id.replace(/\.(left|right)$/, ''),
    );
    if (parent?.node.kind !== 'binary' || parent.node.op !== '*') return;
    const other = part.id.endsWith('.left')
      ? parent.node.right
      : parent.node.left;
    const variable = variableFactor(other);
    if (variable)
      coefficients.push({
        part: i + 1,
        variable,
        value: formatMath(part.node),
      });
  });
  const numbers = parts.flatMap((part, i) => {
    const node = part.node;
    if (
      node.kind !== 'number' &&
      !(node.kind === 'unary' && node.operand.kind === 'number')
    )
      return [];
    const parent = parts.find(
      (p) => p.id === part.id.replace(/\.(left|right|operand)$/, ''),
    );
    // A signed value is one occurrence, not a second positive number inside it.
    if (parent?.node.kind === 'unary') return [];
    const coefficient = coefficients.find((c) => c.part === i + 1);
    return [
      {
        part: i + 1,
        value: formatMath(node),
        side:
          parts[0].node.kind === 'equation'
            ? part.id.startsWith('root.left')
              ? 'left'
              : 'right'
            : 'expression',
        role: coefficient
          ? 'coefficient'
          : parent?.node.kind === 'binary' &&
              parent.node.op === '^' &&
              part.id.endsWith('.right')
            ? 'exponent'
            : 'constant',
        ...(coefficient ? { variable: coefficient.variable } : {}),
      },
    ];
  });
  const selected = parts[state.selection];
  return {
    selected: selected
      ? {
          part: state.selection + 1,
          label: selected.label,
          expression: formatMath(selected.node),
        }
      : undefined,
    coefficients,
    numbers,
    parts: parts
      .map((p, i) => ({
        part: i + 1,
        label: p.label,
        expression: formatMath(p.node).slice(0, 250),
      }))
      .filter((p) => p.part <= 40 || p.part === state.selection + 1),
  };
}
export function contextualReplacement(
  state: Workspace,
  text: string,
): { part: number; replacement: string; expected?: string } | null {
  const numbered = text.match(
    /^(?:replace|change) part (\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?: matching (.+?))? (?:with|to) (.+)$/i,
  );
  if (numbered)
    return {
      part: /^\d+$/.test(numbered[1])
        ? Number(numbered[1])
        : [
            'one',
            'two',
            'three',
            'four',
            'five',
            'six',
            'seven',
            'eight',
            'nine',
            'ten',
          ].indexOf(numbered[1].toLowerCase()) + 1,
      expected: numbered[2],
      replacement: numbered[3],
    };
  const coefficient = text.match(
    /^(?:replace|change) (?:the |that |this |selected )?coefficient(?: (?:of|on|for) ([a-z]))? (?:with|to) (.+)$/i,
  );
  const selected = text.match(
    /^(?:replace|change) (?:it|(?:this|that|selected)(?: (?:part|term|number|value|expression))?) (?:with|to) (.+)$/i,
  );
  if (!coefficient && !selected) return null;
  if (state.mode !== 'equation' || state.graphScene) return null;
  const context = mathContext(state)!;
  if (coefficient) {
    let matches = context.coefficients.filter(
      (c) => !coefficient[1] || c.variable === coefficient[1].toLowerCase(),
    );
    if (
      /\b(that|this|selected) coefficient\b/i.test(text) &&
      state.selection > 0
    ) {
      const parts = getParts(parseMath(state.expression)),
        id = parts[state.selection]?.id;
      matches = matches.filter(
        (c) =>
          id &&
          (parts[c.part - 1].id === id ||
            parts[c.part - 1].id.startsWith(`${id}.`) ||
            id.startsWith(
              `${parts[c.part - 1].id.replace(/\.(left|right)$/, '')}.`,
            )),
      );
    }
    if (matches.length !== 1)
      throw new ClarificationError(
        'Which coefficient should change? Select its term or name the variable.',
      );
    return { part: matches[0].part, replacement: coefficient[2] };
  }
  if (!state.selection || !context.selected)
    throw new ClarificationError(
      'Which term or part should change? Select or read a part first, or name its number.',
    );
  return { part: context.selected.part, replacement: selected![1] };
}
