import { isVisualTool } from '../config/tool-catalog.ts';
import type { Workspace } from '../../workspace/state.ts';
import { validateInterpretation } from './command-interpreter.ts';
import {
  isMathProgramCommand,
  MATH_PROGRAM_PREFIX,
  runMathProgram,
} from './math-program.ts';
import { runCommand } from './run-command.ts';
import { storeCommandGroup } from './stored-commands.ts';

/**
 * - Calculates a preview by applying existing visual commands in order.
 * - Rejects unrelated actions and plans too large for one saved problem step.
 * - Does not change the supplied workspace or save partial results on failure.
 */
export function previewGraphCommands(initial: Workspace, commands: string[]) {
  if (!Array.isArray(commands) || !commands.length || commands.length > 6)
    throw new Error('Use one to six complete graph operations.');
  storeCommandGroup(commands);
  let state = initial,
    message = '';
  for (const command of commands) {
    if (typeof command === 'string' && isMathProgramCommand(command)) {
      const result = runMathProgram(
        state,
        command.slice(MATH_PROGRAM_PREFIX.length),
      );
      if (
        !result.saved ||
        result.control ||
        result.operations.some((name) => !isVisualTool(name)) ||
        !(result.state.graph || result.state.mode === 'geometry')
      )
        throw new Error(
          'This program must save only graph or geometry operations.',
        );
      state = result.state;
      message = result.message;
      continue;
    }
    if (
      typeof command !== 'string' ||
      !/^(graph(?: |$)|plot |add (?:graph |tangent to graph |normal to graph |secant to graph |derivative of graph )|edit graph |remove graph |shift graph |reflect graph |scale graph |view x |range |zoom (?:in|out)$|pan graph |reset graph$|fit graph$|fit comparison$|hide comparison$|hide construction$|show centroid$|median [abc]$|inradius$|circumradius$|altitude [abc]$|(?:draw |create |make |geometry )?(?:a )?(?:circle|square|rectangle|triangle|right triangle|regular polygon|annulus|sector|cube|rectangular prism|sphere|cylinder|cone|parallelogram|trapezoid)\b|set (?:radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c) |scale shape by |double shape$|halve shape$)/i.test(
        command,
      )
    )
      throw new Error('This build contains an unsupported graph operation.');
    validateInterpretation({ status: 'command', command, message: '' }, state);
    const result = runCommand(state, command);
    if (
      result.action ||
      !(result.state.graph || result.state.mode === 'geometry')
    )
      throw new Error(
        'This operation does not produce a graph or geometry preview.',
      );
    state = result.state;
    message = result.message;
  }
  return { state, message };
}
