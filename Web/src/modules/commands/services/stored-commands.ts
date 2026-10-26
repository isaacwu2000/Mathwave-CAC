import { isMathProgramCommand } from './math-program.ts';

const GROUP_PREFIX = 'command-group\n';
export const isStoredCommandGroup = (command: string) =>
  command.startsWith(GROUP_PREFIX);

/**
 * - Encodes a saved group without confusing program semicolons with old separators.
 * - Preserves the old format for English commands and rejects steps over 4,000 characters.
 * - Does not execute commands or change problem state.
 */
export function storeCommandGroup(commands: string[]): string {
  const result =
    commands.length === 1
      ? commands[0]
      : commands.some(isMathProgramCommand)
        ? GROUP_PREFIX + JSON.stringify(commands)
        : commands.join('; ');
  if (result.length > 4000)
    throw new Error('This operation is too large to save as one problem step.');
  return result;
}

/**
 * - Reads old composite steps and new program groups without rewriting source.
 * - Rejects malformed or nested groups; never executes their contents.
 */
export function storedCommands(command: string): string[] {
  if (isMathProgramCommand(command)) return [command];
  if (!command.startsWith(GROUP_PREFIX)) return command.split('; ');
  const commands: unknown = JSON.parse(command.slice(GROUP_PREFIX.length));
  if (
    !Array.isArray(commands) ||
    !commands.length ||
    commands.length > 6 ||
    !commands.every(
      (c) =>
        typeof c === 'string' &&
        c.length > 0 &&
        c.length <= 2000 &&
        !c.startsWith(GROUP_PREFIX),
    )
  )
    throw new Error('Invalid saved command group.');
  return commands;
}
