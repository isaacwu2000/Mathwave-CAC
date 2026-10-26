import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import type { ProgramValue } from '../types/program.ts';

import {
  PROGRAM_LIMITS,
  programNamespaces as namespaces,
} from '../config/tool-catalog.ts';

/**
 * - Parses TypeScript and interprets only literals, bindings and approved calls.
 * - Passes calls to the supplied operation handler; never executes JavaScript.
 * - Rejects unsupported syntax and bounded-work limits with source locations.
 * - Keeps names local to this program and prevents namespace replacement.
 */
export function interpretTypeScript(
  source: string,
  invoke: (name: string, args: ProgramValue[]) => ProgramValue,
): number {
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    source.length > PROGRAM_LIMITS.characters
  )
    throw new Error('Use a complete program of at most 1800 characters.');
  const file = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  if (
    file.program.body.length > PROGRAM_LIMITS.statements ||
    file.program.directives.length
  )
    throw new Error(
      'Use at most 32 const declarations or calls, without directives.',
    );
  const bindings = new Map<string, ProgramValue>();
  let calls = 0;
  function evaluate(node: Node | null, depth = 0): ProgramValue {
    if (!node || depth > 32)
      throw new Error(
        'Program contains a missing expression or is nested too deeply.',
      );
    const next = (child: Node | null) => evaluate(child, depth + 1);
    switch (node.type) {
      case 'NumericLiteral':
        if (!Number.isFinite(node.value))
          throw new Error('Numbers must be finite.');
        return node.value;
      case 'StringLiteral':
        return node.value;
      case 'Identifier':
        if (!bindings.has(node.name))
          throw new Error(`Undefined binding ${node.name}.`);
        return bindings.get(node.name);
      case 'ArrayExpression':
        if (node.elements.length > 100)
          throw new Error('Use at most 100 array entries.');
        return node.elements.map(next);
      case 'ObjectExpression': {
        const object: Record<string, ProgramValue> = Object.create(null);
        for (const property of node.properties) {
          if (
            property.type !== 'ObjectProperty' ||
            property.computed ||
            property.shorthand ||
            !['Identifier', 'StringLiteral'].includes(property.key.type)
          )
            throw new Error(
              'Use explicit named properties without spreads, methods or computed keys.',
            );
          const key =
            property.key.type === 'Identifier'
              ? property.key.name
              : property.key.type === 'StringLiteral'
                ? property.key.value
                : '';
          if (
            Object.hasOwn(object, key) ||
            ['__proto__', 'prototype', 'constructor'].includes(key)
          )
            throw new Error('Invalid or duplicate property.');
          object[key] = next(property.value);
        }
        return object;
      }
      case 'UnaryExpression': {
        if (!['+', '-'].includes(node.operator))
          throw new Error('Only unary + and - are supported.');
        const value = next(node.argument);
        if (typeof value !== 'number')
          throw new Error('Arithmetic requires numbers.');
        return node.operator === '-' ? -value : value;
      }
      case 'BinaryExpression': {
        const left = next(node.left),
          right = next(node.right);
        if (typeof left !== 'number' || typeof right !== 'number')
          throw new Error('Arithmetic requires numbers.');
        const result =
          node.operator === '+'
            ? left + right
            : node.operator === '-'
              ? left - right
              : node.operator === '*'
                ? left * right
                : node.operator === '/'
                  ? left / right
                  : node.operator === '**'
                    ? left ** right
                    : undefined;
        if (result === undefined)
          throw new Error(
            'Use +, -, *, / or ** for numeric arithmetic; ^ is not exponentiation in TypeScript.',
          );
        if (!Number.isFinite(result))
          throw new Error('Arithmetic must produce a finite real number.');
        return result;
      }
      case 'CallExpression': {
        if (
          ++calls > PROGRAM_LIMITS.calls ||
          node.typeParameters ||
          node.typeArguments
        )
          throw new Error('Use at most 24 calls without type arguments.');
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          callee.property.type !== 'Identifier' ||
          !namespaces.has(callee.object.name) ||
          bindings.has(callee.object.name)
        )
          throw new Error('Use approved calls on an unshadowed namespace.');
        return invoke(
          `${callee.object.name}.${callee.property.name}`,
          node.arguments.map(next),
        );
      }
      default:
        throw new Error(
          'Only literals, const bindings, numeric arithmetic and approved calls are supported.',
        );
    }
  }
  for (const statement of file.program.body) {
    try {
      if (
        statement.type === 'VariableDeclaration' &&
        statement.kind === 'const' &&
        !statement.declare
      ) {
        for (const declaration of statement.declarations) {
          if (
            declaration.id.type !== 'Identifier' ||
            declaration.id.typeAnnotation ||
            declaration.definite ||
            !declaration.init ||
            bindings.has(declaration.id.name) ||
            namespaces.has(declaration.id.name)
          )
            throw new Error(
              'Use unique, initialized const names without type annotations or reserved namespaces.',
            );
          bindings.set(declaration.id.name, evaluate(declaration.init));
        }
      } else if (
        statement.type === 'ExpressionStatement' &&
        statement.expression.type === 'CallExpression'
      )
        evaluate(statement.expression);
      else
        throw new Error(
          'Only const declarations and approved calls are supported.',
        );
    } catch (error) {
      throw new Error(
        `Line ${statement.loc?.start.line ?? 1}, column ${(statement.loc?.start.column ?? 0) + 1}: ${error instanceof Error ? error.message : 'Invalid program.'}`,
      );
    }
  }
  return calls;
}
