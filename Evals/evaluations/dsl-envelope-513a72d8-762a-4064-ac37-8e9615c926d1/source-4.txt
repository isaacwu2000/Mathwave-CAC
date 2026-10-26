import type { ProgramValue } from '../types/program.ts';
import type { ToolDefinition, ToolParameter } from '../types/tool.ts';

/** Checks the catalog's argument contract; handlers retain mathematical domain and ownership checks. */
export function validateToolArguments(
  name: string,
  tool: ToolDefinition,
  args: ProgramValue[],
) {
  const required = tool.parameters.filter((p) => !p.optional).length;
  if (args.length < required || args.length > tool.parameters.length)
    throw new Error(
      `${name} expects ${required === tool.parameters.length ? required : `${required}-${tool.parameters.length}`} arguments.`,
    );
  const matches = (
    value: ProgramValue,
    type: ToolParameter['type'],
  ): boolean => {
    if (type === 'number')
      return typeof value === 'number' && Number.isFinite(value);
    if (type === 'string') return typeof value === 'string';
    if (type === 'graphSelector')
      return typeof value === 'string' || matches(value, 'number');
    if (type === 'numbers' || type === 'strings')
      return (
        Array.isArray(value) &&
        value.every((v) => matches(v, type === 'numbers' ? 'number' : 'string'))
      );
    if (type === 'operand')
      return (
        typeof value === 'string' ||
        matches(value, 'number') ||
        matches(value, 'math')
      );
    if (type === 'mathOrPart')
      return matches(value, 'math') || matches(value, 'part');
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    if (type === 'dimensions')
      return Object.values(value).every((v) => matches(v, 'number'));
    if (type === 'work') return 'state' in value;
    return 'kind' in value && value.kind === type;
  };
  tool.parameters.forEach((parameter, i) => {
    if (i < args.length && !matches(args[i], parameter.type))
      throw new Error(`${name}: ${parameter.name} requires ${parameter.type}.`);
  });
}
