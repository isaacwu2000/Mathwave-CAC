import { isDeepStrictEqual } from 'node:util';
import {
  commandSource,
  storedCommands,
  storeCommandGroup,
  runCommand,
  isMathProgramCommand,
} from '../../src/modules/commands/index.ts';
import { blankWorkspace } from '../../src/modules/problems/index.ts';
import type { Workspace } from '../../src/modules/workspace/state.ts';

type Timeline = {
  steps: { command: string; state: Workspace }[];
  initialState?: Workspace;
  undoStates?: Workspace[];
};

/** Finds the original input state of each step, including bounded recovery journals. */
function beforeStep(timeline: Timeline, index: number): Workspace {
  return index
    ? timeline.steps[index - 1].state
    : (timeline.initialState ??
        (timeline.undoStates?.length === timeline.steps.length
          ? timeline.undoStates[0]
          : undefined) ??
        blankWorkspace());
}

/** Compiles and validates a sequence against each preceding result without persisting it. */
function compileCommands(commands: string[], state: Workspace): string[] {
  return commands.map((command) => {
    const source = commandSource(command, state);
    state = runCommand(state, source).state;
    return source;
  });
}

/**
 * Converts every persisted step and pending proposal, including recovery snapshots.
 * - Copies the document and preserves states, timestamps, display labels and recovery links.
 * - Applied conversation turns retain their words and correction metadata without duplicate commands.
 * - Unknown executable input aborts migration; no snapshot replacement or guessed operation is used.
 */
export function migrateDslHistory<T>(document: T): T {
  const visit = (value: unknown, workspace?: Workspace): unknown => {
    if (Array.isArray(value))
      return value.map((item) => visit(item, workspace));
    if (!value || typeof value !== 'object') return value;
    const original = value as Record<string, unknown>;
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === 'steps' && Array.isArray(item)) {
          const timeline = original as unknown as Timeline;
          return [
            key,
            item.map((step, index) => visit(step, beforeStep(timeline, index))),
          ];
        }
        return [
          key,
          visit(item, (original.state as Workspace | undefined) ?? workspace),
        ];
      }),
    );
    if (Array.isArray(original.steps)) {
      const steps = original.steps as { command: string; state: Workspace }[];
      for (const [index, step] of steps.entries()) {
        if (storedCommands(step.command).every(isMathProgramCommand)) continue;
        const base = beforeStep(original as unknown as Timeline, index);
        const replay = (commands: string[]) =>
          commands.reduce(
            (state, command) => runCommand(state, command).state,
            base,
          );
        const before = JSON.parse(
          JSON.stringify(replay(storedCommands(step.command))),
        );
        const after = JSON.parse(
          JSON.stringify(
            replay(compileCommands(storedCommands(step.command), base)),
          ),
        );
        if (!isDeepStrictEqual(before, after))
          throw new Error(
            `History migration changed ${step.command.split(' ')[0]} in ${Object.keys(
              after,
            )
              .filter((key) => !isDeepStrictEqual(before[key], after[key]))
              .join(', ')}; no data was written.`,
          );
      }
    }
    if (
      typeof result.command === 'string' &&
      result.state &&
      typeof result.at === 'string'
    ) {
      const original = result.command;
      result.command = storeCommandGroup(
        compileCommands(
          storedCommands(original),
          workspace ?? blankWorkspace(),
        ),
      );
      if (result.command !== original && !result.displayCommand)
        result.displayCommand = original;
    }
    if (
      typeof result.request === 'string' &&
      typeof result.stateKey === 'string' &&
      Array.isArray(result.commands)
    ) {
      if (['reply', 'explanation'].includes(String(result.status)))
        result.commands = compileCommands(
          result.commands.map(String),
          workspace ?? blankWorkspace(),
        );
      else delete result.commands;
    }
    return result;
  };
  return visit(document) as T;
}
