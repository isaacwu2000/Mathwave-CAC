import { ClarificationError } from '../../math/index.ts';
import type { Workspace } from '../../workspace/state.ts';
import type { Interpretation } from '../types/command-interpreter.ts';
import type { ConversationTurn } from '../types/conversation.ts';
export type { ConversationTurn } from '../types/conversation.ts';
/** Revision hint for rejecting stale suggestions; commands still undergo validation. */
export function workspaceKey(state: Workspace): string {
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
/** Returns [] for omitted history; rejects malformed turns or more than 12 turns/12,000 characters. */
export function validateConversation(value: unknown): ConversationTurn[] {
  return validateTurns(value, 12, 12000);
}
/** Returns [] for older backups; rejects malformed turns or more than 48 turns/32,000 characters. */
export function validateConversationArchive(
  value: unknown,
): ConversationTurn[] {
  return validateTurns(value, 48, 32000);
}
/** Validates bounded serialized evidence, throwing on invalid shape, count or size. */
function validateTurns(
  value: unknown,
  count: number,
  characters: number,
): ConversationTurn[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > count ||
    JSON.stringify(value).length > characters
  )
    throw new Error('Invalid conversation.');
  return value.map((turn) => {
    if (
      !turn ||
      typeof turn.request !== 'string' ||
      turn.request.length > 2000 ||
      typeof turn.response !== 'string' ||
      turn.response.length > 1000 ||
      ![
        'command',
        'reply',
        'clarification',
        'unsupported',
        'explanation',
        'correction',
      ].includes(turn.status) ||
      typeof turn.stateKey !== 'string' ||
      turn.stateKey.length > 100 ||
      (turn.stepCount !== undefined &&
        (!Number.isInteger(turn.stepCount) || turn.stepCount < 0)) ||
      (turn.undoDepth !== undefined &&
        (!Number.isInteger(turn.undoDepth) ||
          turn.undoDepth < 1 ||
          turn.undoDepth > 50)) ||
      (turn.interaction !== undefined &&
        (typeof turn.interaction !== 'string' ||
          !/^control:[a-z]$/.test(turn.interaction))) ||
      (turn.revisable !== undefined && typeof turn.revisable !== 'boolean') ||
      (turn.commands !== undefined &&
        (!Array.isArray(turn.commands) ||
          turn.commands.length > 6 ||
          !turn.commands.every(
            (c: unknown) =>
              typeof c === 'string' && c.length > 0 && c.length <= 2000,
          )))
    )
      throw new Error('Invalid conversation.');
    return {
      request: turn.request,
      response: turn.response,
      status: turn.status,
      stateKey: turn.stateKey,
      commands: turn.commands,
      revisable: turn.revisable,
      stepCount: turn.stepCount,
      undoDepth: turn.undoDepth,
      interaction: turn.interaction,
    };
  });
}
export function explanationRequest(text: string): boolean {
  return /^(?:please\s+)?(?:(?:can|could|would) you (?:please )?)?(?:explain\b|why\b|what does\b|how does\b|what would happen\b)/i.test(
    text.trim(),
  );
}
export function resolveConversation(
  text: string,
  turns: ConversationTurn[],
  state: Workspace,
): Interpretation | null {
  if (
    !/^(?:(?:okay|ok|yes|sure)[, ]*\s*)?(?:do (?:that|it)|go ahead|apply (?:that|it))?[.!]*$/i.test(
      text.trim(),
    ) ||
    !text.trim()
  )
    return null;
  const last = turns.at(-1);
  if (
    !last ||
    !['explanation', 'reply'].includes(last.status) ||
    !last.commands?.length
  )
    return null;
  if (last.stateKey !== workspaceKey(state))
    throw new ClarificationError(
      'Your work changed since that suggestion. What should I apply to the current work?',
    );
  return {
    status: 'command',
    command: '',
    message: '',
    commands: [...last.commands],
  };
}

const ignoredContextWords = new Set([
  'the',
  'that',
  'this',
  'with',
  'from',
  'were',
  'what',
  'could',
  'would',
  'please',
  'have',
  'about',
  'back',
  'earlier',
  'thing',
  'explain',
  'again',
]);
/**
 * Selects six recent and up to four relevant older turns without another model call.
 * Retains the latest older applied operation within the 6,000-character evidence budget.
 * Accepts validated turns; compacts oversized evidence without mutating saved history.
 * Turns are context only; state/revision checks still govern every action.
 */
export function conversationContext(
  request: string,
  recent: ConversationTurn[],
  archive: ConversationTurn[] = [],
) {
  const latest = recent.slice(-6);
  const older = [...archive, ...recent.slice(0, -6)];
  const words = (text: string) =>
    new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) || [])
        .map((w) => (w.length > 4 ? w.replace(/s$/, '') : w))
        .filter((w) => w.length > 2 && !ignoredContextWords.has(w)),
    );
  const query = words(request);
  const scored = older
    .map((turn, index) => {
      const tokens = words(`${turn.request} ${turn.response}`);
      return {
        turn,
        index,
        score: [...query].filter((w) => tokens.has(w)).length,
      };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const selected = new Set(scored.slice(0, 3).map((t) => t.index));
  const lastAction = older.findLastIndex((t) => t.revisable);
  if (lastAction >= 0) selected.add(lastAction);
  if (!selected.size && older.length) selected.add(older.length - 1);
  const earlier = older.filter((_, i) => selected.has(i));
  // Drop other evidence first so the original operation survives read-only discussion.
  while (earlier.length && JSON.stringify(earlier).length > 6000) {
    const index = earlier.findIndex((turn) => turn !== older[lastAction]);
    if (index < 0) {
      // A large action still keeps its wording; executable detail stays in saved history.
      earlier[0] = { ...earlier[0], commands: undefined };
      // Escaped characters count toward serialized size, so shorten the reply before the request.
      while (JSON.stringify(earlier).length > 6000) {
        const field = earlier[0].response.length ? 'response' : 'request';
        earlier[0] = {
          ...earlier[0],
          [field]: earlier[0][field].slice(
            0,
            Math.floor(earlier[0][field].length / 2),
          ),
        };
      }
      break;
    }
    earlier.splice(index, 1);
  }
  return { recent: latest, earlier };
}
