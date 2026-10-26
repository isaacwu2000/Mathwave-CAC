import { compileGeometry } from './construction/compileGeometry.ts';
import type { GeometryValue } from './construction/types.ts';
import { displayNumber } from '../../math/index.ts';

/** Validates the entire source; invalid dependencies, assertions or domains never return partial work. */
export function validateConstruction(source: unknown) {
  if (typeof source !== 'string')
    throw new Error('Construction source must be text.');
  const result = compileGeometry(source);
  if (result.status !== 'valid')
    throw new Error(
      result.diagnostics.map((d) => `Line ${d.line}: ${d.message}`).join('\n'),
    );
  return result;
}

/** Describes computed geometry rather than trusting an authored label or model answer. */
export function describeConstructionValue(
  name: string,
  value: GeometryValue,
): string {
  const p = (v: { x: number; y: number }) =>
    `(${displayNumber(v.x)}, ${displayNumber(v.y)})`;
  switch (value.kind) {
    case 'point':
      return `${name}: point ${p(value)}.`;
    case 'scalar':
      return `${name}: ${displayNumber(value.value)}.`;
    case 'boolean':
      return `${name}: ${value.value ? 'true' : 'false'}.`;
    case 'circle':
      return `${name}: circle centered at ${p(value.center)}, radius ${displayNumber(value.radius)}.`;
    case 'polygon':
      return `${name}: polygon through ${value.vertices.map(p).join(', ')}.`;
    default:
      return `${name}: ${value.kind} through ${p(value.a)} and ${p(value.b)}.`;
  }
}

/** Reads one named object or the complete checked construction; does not save a step. */
export function describeConstruction(source: string, name?: string) {
  const result = validateConstruction(source);
  if (name !== undefined) {
    const value = result.values.get(name);
    if (!value) throw new Error(`Undefined object ${name}.`);
    return describeConstructionValue(name, value);
  }
  return [...result.values]
    .map(([key, value]) => describeConstructionValue(key, value))
    .join(' ');
}

/** Replaces one existing definition and rechecks every dependent object and assertion. */
export function editConstruction(
  source: string,
  name: string,
  expression: string,
) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || /[\r\n#]/.test(expression))
    throw new Error('Edit one named construction at a time.');
  validateConstruction(source);
  const matcher = new RegExp(`^\\s*${name}\\s*=`);
  let found = false;
  const next = source
    .split(/\r?\n/)
    .map((line) => {
      if (!matcher.test(line)) return line;
      found = true;
      return `${name}=${expression}`;
    })
    .join('\n');
  if (!found) throw new Error(`Undefined object ${name}.`);
  validateConstruction(next);
  return next;
}
