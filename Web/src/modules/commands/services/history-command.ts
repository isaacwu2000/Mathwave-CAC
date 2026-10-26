import { ClarificationError, parseMath } from '../../math/index.ts';
import type { HistoryContext } from '../types/history-command.ts';
import { normalizeGraphReferences } from './graph-command.ts';
export type { HistoryContext } from '../types/history-command.ts';
export function validateHistoryContext(
  value: unknown,
): HistoryContext | undefined {
  if (value === undefined) return undefined;
  const h = value as HistoryContext;
  if (
    !h ||
    !Array.isArray(h.steps) ||
    h.steps.length > 50 ||
    !Number.isSafeInteger(h.total) ||
    h.total < 0 ||
    ![h.undoCount, h.redoCount].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 50,
    ) ||
    !h.steps.every(
      (s, i) =>
        s &&
        Number.isInteger(s.number) &&
        s.number >= 1 &&
        s.number <= h.total &&
        (i === 0 || s.number === h.steps[i - 1].number + 1) &&
        typeof s.command === 'string' &&
        s.command.length <= 250,
    )
  )
    throw new Error('Invalid history context.');
  return h;
}
type HistoryAction =
  | { kind: 'revise'; number: number; expression: string }
  | { kind: 'undo' | 'redo'; count: number }
  | { kind: 'restore' | 'cancel' | 'read'; number: number };
function number(text: string): number {
  const words = [
    'zero',
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
  ];
  return /^\d+$/.test(text) ? Number(text) : words.indexOf(text);
}
function keywords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(subtraction|subtracted)\b/g, 'subtract')
    .replace(/\b(division|divided|dividing)\b/g, 'divide')
    .replace(/\b(multiplication|multiplied)\b/g, 'multiply')
    .replace(/\b(addition|added)\b/g, 'add')
    .replace(/\b(wrote|writing)\b/g, 'write')
    .replace(
      /\b(the|my|that|step|operation|please|where|when|i|by|to|from|of|both|sides)\b/g,
      '',
    )
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
      (word) => String(number(word)),
    )
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim();
}
export function parseHistoryCommand(
  text: string,
  context?: HistoryContext,
): HistoryAction | null {
  const revision = text.trim().match(/^revise step (\d+) to (.+)$/i);
  if (revision) {
    const step = Number(revision[1]);
    if (step < 1 || (context && step > context.total))
      throw new ClarificationError(
        'That step does not exist. Choose a number from your saved steps.',
      );
    if (parseMath(revision[2]).kind !== 'equation')
      throw new Error('Enter an equation with an equals sign.');
    return { kind: 'revise', number: step, expression: revision[2] };
  }
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^please\s+/, '')
    .replace(/[.!?]+$/, '')
    .replace(
      /^(undo|redo) (?:the )?last (?=\d|one|two|three|four|five|six|seven|eight|nine|ten)/,
      '$1 ',
    )
    .replace(/^(go back|back up) (?:a|one) step$/, 'undo')
    .replace(
      /^(?:cancel(?: out)?|undo)(?: (?:it|that|this|the current step))?$/,
      'undo',
    )
    .replace(/^undo (?:that|the last thing)$/, 'undo')
    .replace(/^(bring|put) (?:that|it) back$/, 'redo');
  const move = t.match(
    /^(undo|redo|go back)(?:\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:steps?|changes?))?)?(?:\s+(?:last|the last)\s+(?:step|change))?$/,
  );
  if (move) {
    const kind = move[1] === 'redo' ? 'redo' : 'undo';
    const count = move[2] ? number(move[2]) : 1;
    if (count < 1 || count > 50)
      throw new ClarificationError('Choose between one and fifty changes.');
    if (
      context &&
      count > (kind === 'redo' ? context.redoCount : context.undoCount)
    )
      throw new ClarificationError(
        `Only ${kind === 'redo' ? context.redoCount : context.undoCount} changes available to ${kind}.`,
      );
    return { kind, count };
  }
  if (
    /^(cancel|remove|delete) (?:(?:the|my) )?(last|previous) (step|change|operation)$/.test(
      t,
    )
  ) {
    if (!context || context.total === 0)
      throw new ClarificationError('There are no saved steps to cancel.');
    return { kind: 'cancel', number: context.total };
  }
  const numbered = t.match(
    /^(?:restore|return to|go back to|back to|read|undo|cancel|remove|delete)\s+(?:the\s+)?step\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (numbered) {
    const kind = /^(undo|cancel|remove|delete)/.test(t)
      ? 'cancel'
      : t.startsWith('read')
        ? 'read'
        : 'restore';
    const n = number(numbered[1]);
    if (n < (kind === 'restore' ? 0 : 1) || (context && n > context.total))
      throw new ClarificationError(
        'That step does not exist. Choose a number from your saved steps.',
      );
    return { kind, number: n };
  }
  const relative = t.match(
    /^(?:take me back to|go back to|return to) (?:just )?(before|after) (.+)$/,
  );
  if (relative) {
    const n = resolveTarget(relative[2], context);
    return { kind: 'restore', number: relative[1] === 'before' ? n - 1 : n };
  }
  const targeted = t.match(/^(?:cancel|remove|delete)\s+(.+)$/);
  if (!targeted) return null;
  // Mathematical cancellation simplifies the current expression; it does not
  // delete a saved operation, even when the request mentions the current step.
  if (
    /^cancel out\b|^cancel (?:the )?common (?:numeric )?factors(?: on both sides)?$/.test(
      t,
    )
  )
    return null;
  // A numbered curve is graph content, not a fuzzy description of a work step.
  if (
    /^cancel (?:graph|curve|expression) \d+$/.test(
      normalizeGraphReferences(`cancel ${targeted[1].replace(/^the /, '')}`),
    )
  )
    return null;
  // Other cancellation requests (recording, a draft, etc.) belong to the wider interpreter.
  if (/^(recording|listening|draft|problem|assignment)\b/.test(targeted[1]))
    return null;
  return { kind: 'cancel', number: resolveTarget(targeted[1], context) };
}
function resolveTarget(text: string, context?: HistoryContext): number {
  if (!context) throw new ClarificationError('Which saved step do you mean?');
  const tokens = keywords(text).split(/\s+/).filter(Boolean);
  const matches = tokens.length
    ? context.steps.filter((s) => {
        const command = keywords(s.command).split(/\s+/);
        return tokens.every((token) => command.includes(token));
      })
    : [];
  if (matches.length !== 1)
    throw new ClarificationError(
      matches.length
        ? `Which step do you mean: ${matches.map((s) => s.number).join(' or ')}?`
        : 'Which saved step do you mean? Use its step number.',
    );
  return matches[0].number;
}
