import { parseMath, formatMath } from '../../math/index.ts';
import type { Workspace } from '../../workspace/state.ts';
import { runCommand } from './run-command.ts';

/** Recognizes a complete explicit math request without changing work or guessing intent. */
export function directMathCommand(
  text: string,
  state: Workspace,
): string | null {
  let command = text
    .trim()
    .replace(/[.?]+$/, '')
    .replace(/^(?:please|can you|could you)\s+/i, '')
    .replace(/\s+please$/i, '')
    .trim();
  if (
    /\b(?:then|but|actually|instead|if|unless|because|explain|why|or|not|don't)\b/i.test(
      command,
    )
  )
    return null;
  if (/^(?:zoom in|zoom out|reset graph)$/i.test(command) && state.graph) {
    try {
      return runCommand(state, command).changed ? command : null;
    } catch {
      return null;
    }
  }
  // A complete function needs no interpretation. Keep the stated equation
  // and one editable curve instead of asking a model to choose a scene.
  const graph = command.match(
    /^(?:(?:i['’]ll|i will)\s+)?(?:(?:create|make|show me)\s+(?:a\s+|the\s+)?)?(?:graph|plot)\s+(?:of\s+)?(.+)$/i,
  );
  if (graph) {
    try {
      const node = parseMath(graph[1]);
      if (
        node.kind === 'equation' &&
        !(node.left.kind === 'variable' && node.left.name === 'y')
      )
        return null;
      const entry = `graph ${formatMath(node)}`;
      return runCommand(state, entry).written ? entry : null;
    } catch {
      return null;
    }
  }
  // Explicit replacements have one parsed target and one parsed replacement.
  // The engine rejects missing or repeated targets rather than guessing a term.
  const replacement = command.match(
    /^(?:now\s+)?((?:replace|change)\s+(.+?)\s+(?:with|to)\s+(.+))$/i,
  );
  if (
    replacement &&
    state.mode === 'equation' &&
    !state.graphScene &&
    !state.graphExpressions?.length
  ) {
    try {
      parseMath(replacement[2]);
      parseMath(replacement[3]);
      return runCommand(state, replacement[1]).written ? replacement[1] : null;
    } catch {
      return null;
    }
  }
  // In an equation, a bare arithmetic operation applies to both sides.
  // Parse the entire operand before expanding it so pronouns and side edits still ask.
  const shorthand = command.match(
    /^(add|subtract|take away|multiply by|divide by)\s+(.+)$/i,
  );
  if (shorthand && state.mode === 'equation') {
    try {
      if (
        parseMath(state.expression).kind === 'equation' &&
        parseMath(shorthand[2]).kind !== 'equation'
      ) {
        const verb = shorthand[1]
          .toLowerCase()
          .replace('take away', 'subtract');
        command =
          verb === 'add'
            ? `add ${shorthand[2]} to both sides`
            : verb === 'subtract'
              ? `subtract ${shorthand[2]} from both sides`
              : `${verb.split(' ')[0]} both sides by ${shorthand[2]}`;
      }
    } catch {
      /* Leave incomplete or ambiguous requests to the interpreter. */
    }
  }
  const write = command.match(/^write\s+(.+)$/i);
  const sides =
    /^(?:add .+ to both sides|subtract .+ from both sides|multiply both sides by .+|divide both sides by .+)$/i.test(
      command,
    );
  const simple =
    /^(?:simplify|read|read(?: the)? (?:equation|left side|right side))$/i.test(
      command,
    );
  // A complete problem introduces work; it does not authorize calculating its answer.
  if (!write && !sides && !simple && state.mode === 'equation') {
    const problem = command
      .replace(/^(?:okay|ok)[,.]?\s+/i, '')
      .replace(
        /^(?:let(?:['’]s| us) (?:solve|work on) (?:the|this) problem|here(?: is|['’]s)|the problem is)[\s:]+/i,
        '',
      );
    try {
      parseMath(problem);
      const entry = `write ${problem}`;
      return runCommand(state, entry).written ? entry : null;
    } catch {
      return null;
    }
  }
  if (!write && !sides && !simple) return null;
  try {
    if (write) parseMath(write[1]);
    if (sides && parseMath(state.expression).kind !== 'equation') return null;
    const result = runCommand(state, command);
    return (result.written || simple) && !result.action ? command : null;
  } catch {
    return null;
  }
}
