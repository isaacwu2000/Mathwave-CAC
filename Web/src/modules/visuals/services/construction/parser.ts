import {
  isConstructionName,
  type Expression,
  type GeometryDiagnostic,
  type Statement,
} from './types.ts';

/** Parses bounded declarative geometry without loading or executing a scripting engine. */
export function parseGeometry(source: string) {
  const statements: Statement[] = [];
  const diagnostics: GeometryDiagnostic[] = [];
  if (typeof source !== 'string' || !source.trim() || source.length > 16000)
    return {
      statements,
      diagnostics: [
        { line: 1, message: 'Use 1–16000 characters of construction source.' },
      ],
    };
  const lines = source.split(/\r?\n/);
  if (lines.length > 200)
    return {
      statements,
      diagnostics: [
        { line: 1, message: 'Use at most 200 construction lines.' },
      ],
    };
  let nodes = 0;
  function expressions(text: string): Expression[] {
    const tokens: string[] = [];
    const token =
      /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|([()+\-*/^,]))/y;
    let offset = 0;
    while (offset < text.length) {
      token.lastIndex = offset;
      const match = token.exec(text);
      if (!match)
        throw new Error(
          `Unexpected syntax near ${text.slice(offset, offset + 16)}.`,
        );
      tokens.push(match[1] ?? match[2] ?? match[3]);
      offset = token.lastIndex;
    }
    let index = 0;
    const take = (expected: string) => {
      if (tokens[index++] !== expected)
        throw new Error(`Expected ${expected}.`);
    };
    function expression(minimum = 0, depth = 0): Expression {
      if (++nodes > 2000 || depth > 40)
        throw new Error('Construction is too complex.');
      const current = tokens[index++];
      let result: Expression;
      if (current === '+' || current === '-') {
        result = {
          kind: 'operator',
          op: current,
          args: [expression(3, depth + 1)],
        };
      } else if (current === '(') {
        result = expression(0, depth + 1);
        take(')');
      } else if (current && /^(?:\d|\.)/.test(current)) {
        result = { kind: 'number', value: Number(current) };
      } else if (current && /^[A-Za-z]/.test(current)) {
        if (tokens[index] === '(') {
          if (!isConstructionName(current))
            throw new Error(`Unsupported construction ${current}.`);
          index++;
          const args: Expression[] = [];
          if (tokens[index] !== ')') {
            do {
              args.push(expression(0, depth + 1));
              if (tokens[index] !== ',') break;
              index++;
            } while (index < tokens.length);
          }
          take(')');
          result = { kind: 'call', name: current, args };
        } else result = { kind: 'reference', name: current };
      } else
        throw new Error(
          'Expected a number, named object, or construction call.',
        );
      while (index < tokens.length) {
        const op = tokens[index];
        const precedence =
          op === '+' || op === '-'
            ? 1
            : op === '*' || op === '/'
              ? 2
              : op === '^'
                ? 4
                : -1;
        if (precedence < minimum) break;
        index++;
        result = {
          kind: 'operator',
          op: op as '+' | '-' | '*' | '/' | '^',
          args: [
            result,
            expression(precedence + (op === '^' ? 0 : 1), depth + 1),
          ],
        };
      }
      return result;
    }
    const result: Expression[] = [expression()];
    while (tokens[index] === ',') {
      index++;
      result.push(expression());
    }
    if (index !== tokens.length)
      throw new Error('Unexpected text after construction.');
    return result;
  }
  lines.forEach((line, index) => {
    const text = line.replace(/#.*$/, '').trim();
    if (!text) return;
    try {
      const sideLabel = /^label\s+(.+),\s*([A-Za-z][A-Za-z0-9_]{0,31})$/.exec(
        text,
      );
      if (sideLabel) {
        const values = expressions(sideLabel[1]);
        if (values.length !== 1)
          throw new Error('Label one segment at a time.');
        statements.push({
          kind: 'label',
          line: index + 1,
          expression: values[0],
          text: sideLabel[2],
        });
        return;
      }
      const directive = /^(draw|assert|measure|angle|rightangle)\s+(.+)$/.exec(
        text,
      );
      if (directive) {
        const values = expressions(directive[2]);
        const kind = directive[1] as
          | 'draw'
          | 'assert'
          | 'measure'
          | 'angle'
          | 'rightangle';
        if (kind === 'assert' || kind === 'measure') {
          if (values.length !== 1)
            throw new Error(`${kind} needs one expression.`);
          statements.push({ kind, line: index + 1, expression: values[0] });
        } else {
          if (kind !== 'draw' && values.length !== 3)
            throw new Error('Angle marks need three points.');
          statements.push({ kind, line: index + 1, expressions: values });
        }
      } else {
        const declaration = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(text);
        if (!declaration)
          throw new Error('Use name = construction(...) or draw object.');
        const values = expressions(declaration[2]);
        if (values.length !== 1) throw new Error('Define one object per line.');
        statements.push({
          kind: 'define',
          line: index + 1,
          name: declaration[1],
          expression: values[0],
        });
      }
    } catch (error) {
      diagnostics.push({
        line: index + 1,
        message:
          error instanceof Error ? error.message : 'Invalid construction.',
      });
    }
  });
  return { statements, diagnostics };
}
