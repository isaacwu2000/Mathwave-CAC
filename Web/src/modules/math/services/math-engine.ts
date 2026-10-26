/**
 * Deterministic math parser. No dynamic evaluation or external dependencies.
 *
 * AST: numeric/variable leaves, unary +/-; binary +,-,*,/,^; named calls;
 * an equation is permitted only at the root. All operations are immutable.
 * Trig functions use radians. `log` is base ten; `ln` is natural logarithm.
 * Natural language is intentionally a small, explicit grammar, not an LLM.
 */
import type { MathNode, MathPart } from '../types/index.ts';
export type { MathNode, MathPart } from '../types/index.ts';
type Token = { text: string; position: number; naturalOver?: boolean };
const MAX_INPUT = 4000;
const MAX_TOKENS = 256;
const MAX_DEPTH = 48;
const MAX_NODES = 512;
const FUNCTIONS = new Set(['sqrt', 'sin', 'cos', 'log', 'ln']);
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const DENOMINATORS: Record<string, number> = {
  half: 2,
  halves: 2,
  third: 3,
  thirds: 3,
  quarter: 4,
  quarters: 4,
  fourth: 4,
  fourths: 4,
  fifth: 5,
  fifths: 5,
  sixth: 6,
  sixths: 6,
  seventh: 7,
  sevenths: 7,
  eighth: 8,
  eighths: 8,
  ninth: 9,
  ninths: 9,
  tenth: 10,
  tenths: 10,
};
const PHRASES: [string[], string[]][] = [
  [['to', 'the', 'power', 'of'], ['^']],
  [['raised', 'to', 'the', 'power', 'of'], ['^']],
  [['raised', 'to', 'the', 'power'], ['^']],
  [['square', 'root', 'of'], ['sqrt']],
  [['square', 'root'], ['sqrt']],
  [['open', 'parenthesis'], ['(']],
  [['close', 'parenthesis'], [')']],
  [['open', 'parentheses'], ['(']],
  [['close', 'parentheses'], [')']],
  [['left', 'parenthesis'], ['(']],
  [['right', 'parenthesis'], [')']],
  [['multiplied', 'by'], ['*']],
  [['divided', 'by'], ['/']],
  [['is', 'equal', 'to'], ['=']],
  [['equal', 'to'], ['=']],
  [['sine', 'of'], ['sin']],
  [['cosine', 'of'], ['cos']],
  [['natural', 'log', 'of'], ['ln']],
  [['log', 'of'], ['log']],
  [['plus'], ['+']],
  [['minus'], ['-']],
  [['negative'], ['-']],
  [['positive'], ['+']],
  [['times'], ['*']],
  [['over'], ['/']],
  [['equals'], ['=']],
  [['squared'], ['squared']],
  [['cubed'], ['cubed']],
  [['sine'], ['sin']],
  [['cosine'], ['cos']],
];

function fail(message: string): never {
  throw new Error(message);
}
function isNumber(text: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(text);
}
function finite(
  value: number,
  message = 'This expression has no finite real value.',
): number {
  if (!Number.isFinite(value)) fail(message);
  return Object.is(value, -0) ? 0 : value;
}

function tokenize(input: string): Token[] {
  if (typeof input !== 'string')
    fail('Enter a mathematical expression as text.');
  if (!input.trim()) fail('Enter an expression or equation first.');
  if (input.length > MAX_INPUT)
    fail(`The input is too long. Use at most ${MAX_INPUT} characters.`);
  const text = input
    .toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt');
  const raw: Token[] = [];
  let position = 0;
  while (position < text.length) {
    if (/\s/.test(text[position])) {
      position++;
      continue;
    }
    const match = text
      .slice(position)
      .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^[a-z]+|^[()+\-*/^=]/);
    if (!match)
      fail(
        `Unsupported character “${text[position]}” near character ${position + 1}. Use numbers, variables, and + - * / ^ = ( ).`,
      );
    raw.push({ text: match[0], position });
    position += match[0].length;
    if (raw.length > MAX_TOKENS)
      fail(`The expression is too long. Use at most ${MAX_TOKENS} tokens.`);
  }
  const tokens: Token[] = [];
  for (let i = 0; i < raw.length;) {
    const word = raw[i].text;
    const phrase = PHRASES.find(([words]) =>
      words.every((w, k) => raw[i + k]?.text === w),
    );
    if (phrase) {
      tokens.push(
        ...phrase[1].map((t) => ({
          text: t,
          position: raw[i].position,
          naturalOver: word === 'over',
        })),
      );
      i += phrase[0].length;
      continue;
    }
    if (Object.hasOwn(NUMBER_WORDS, word) || isNumber(word)) {
      let value = Object.hasOwn(NUMBER_WORDS, word)
        ? NUMBER_WORDS[word]
        : finite(Number(word), 'The number is too large to represent.');
      const at = raw[i].position;
      i++;
      // Natural numbers from zero through ninety-nine, including “twenty one”.
      if (
        Object.hasOwn(NUMBER_WORDS, word) &&
        value >= 20 &&
        value % 10 === 0 &&
        NUMBER_WORDS[raw[i]?.text] >= 1 &&
        NUMBER_WORDS[raw[i]?.text] <= 9
      ) {
        value += NUMBER_WORDS[raw[i].text];
        i++;
      }
      if (raw[i]?.text === 'point') {
        if (!Number.isInteger(value) || value < 0)
          fail('Use a whole number before point, followed by decimal digits.');
        i++;
        let digits = '';
        while (i < raw.length) {
          const part = raw[i].text;
          if (/^\d+$/.test(part)) digits += part;
          else if (Object.hasOwn(NUMBER_WORDS, part) && NUMBER_WORDS[part] < 10)
            digits += String(NUMBER_WORDS[part]);
          else break;
          i++;
        }
        if (!digits)
          fail(
            'Say the digits after point, for example three point zero five.',
          );
        tokens.push({
          text: String(finite(Number(`${value}.${digits}`))),
          position: at,
        });
        continue;
      }
      const denominator = DENOMINATORS[raw[i]?.text];
      if (denominator && Object.hasOwn(DENOMINATORS, raw[i].text)) {
        if (tokens.length && isNumber(tokens[tokens.length - 1].text))
          fail(
            'A whole number followed by a named fraction is ambiguous. Write 2 + 1/2 for a mixed number, or 2 * (1/2) for a product.',
          );
        // A named fraction is one complete factor, so “one half x” is (1/2)*x.
        tokens.push(
          ...['(', String(value), '/', String(denominator), ')'].map((t) => ({
            text: t,
            position: at,
          })),
        );
        i++;
      } else tokens.push({ text: String(value), position: at });
      continue;
    }
    if (
      /^[a-z]$/.test(word) ||
      FUNCTIONS.has(word) ||
      /^[()+\-*/^=]$/.test(word)
    ) {
      tokens.push(raw[i++]);
      continue;
    }
    fail(
      `I don't recognize “${word}”. Use single-letter variables, numbers, explicit math phrases, or sqrt(...), sin(...), cos(...), log(...), ln(...). Write products such as x*y explicitly.`,
    );
  }
  if (tokens.length > MAX_TOKENS)
    fail(`The expression is too long. Use at most ${MAX_TOKENS} tokens.`);
  // “A over B plus C” has two common interpretations. Require explicit grouping.
  const levels: { over: boolean; sum: boolean }[] = [
    { over: false, sum: false },
  ];
  const checkLevel = (level: { over: boolean; sum: boolean }) => {
    if (level.over && level.sum)
      fail(
        'Using ‘over’ alongside plus or minus is ambiguous. Group the numerator and denominator, for example (x + 1) over (x - 2), or use / with standard operator precedence.',
      );
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.text === '(') levels.push({ over: false, sum: false });
    else if (token.text === ')' && levels.length > 1) checkLevel(levels.pop()!);
    else if (token.text === '=') {
      checkLevel(levels[levels.length - 1]);
      levels[levels.length - 1] = { over: false, sum: false };
    } else {
      if (token.naturalOver) levels[levels.length - 1].over = true;
      if (
        (token.text === '+' || token.text === '-') &&
        i > 0 &&
        !['(', '=', '+', '-', '*', '/', '^'].includes(tokens[i - 1].text)
      )
        levels[levels.length - 1].sum = true;
    }
  }
  levels.forEach(checkLevel);
  return tokens;
}

function assertTree(node: MathNode): void {
  let count = 0;
  const walk = (current: MathNode, depth: number) => {
    if (++count > MAX_NODES || depth > MAX_DEPTH)
      fail(
        'The expression is too complex. Use fewer operations or parentheses.',
      );
    if (!current || typeof current !== 'object')
      fail('Invalid mathematical expression.');
    switch (current.kind) {
      case 'number':
        finite(current.value);
        break;
      case 'variable':
        if (!/^[a-z]$/.test(current.name))
          fail('Variables must be single lowercase letters.');
        break;
      case 'unary':
        if (!['+', '-'].includes(current.op))
          fail('Unsupported unary operation.');
        walk(current.operand, depth + 1);
        break;
      case 'binary':
        if (!['+', '-', '*', '/', '^'].includes(current.op))
          fail('Unsupported operation.');
        walk(current.left, depth + 1);
        walk(current.right, depth + 1);
        break;
      case 'equation':
        if (depth !== 0)
          fail(
            'An equation can only appear at the top level, not inside an expression.',
          );
        walk(current.left, depth + 1);
        walk(current.right, depth + 1);
        break;
      case 'call':
        if (!FUNCTIONS.has(current.name)) fail('Unsupported function.');
        walk(current.argument, depth + 1);
        break;
      default:
        fail('Invalid mathematical expression.');
    }
  };
  walk(node, 0);
}

export function parseMath(input: string): MathNode {
  const tokens = tokenize(input);
  let index = 0;
  const peek = () => tokens[index]?.text;
  const startsFactor = (text: string | undefined) =>
    text !== undefined &&
    (isNumber(text) ||
      /^[a-z]$/.test(text) ||
      FUNCTIONS.has(text) ||
      text === '(');
  const expression = (minimum = 1, depth = 0): MathNode => {
    if (depth > MAX_DEPTH)
      fail(
        'The expression is nested too deeply. Use fewer parentheses or powers.',
      );
    const token = tokens[index++];
    if (!token)
      fail(
        'The expression ends before an operand. Add a number, variable, or parenthesized expression.',
      );
    let left: MathNode;
    if (isNumber(token.text))
      left = { kind: 'number', value: finite(Number(token.text)) };
    else if (/^[a-z]$/.test(token.text))
      left = { kind: 'variable', name: token.text };
    else if (token.text === '+' || token.text === '-')
      left = {
        kind: 'unary',
        op: token.text,
        operand: expression(3, depth + 1),
      };
    else if (token.text === '(') {
      if (peek() === ')') fail('Empty parentheses are not an expression.');
      left = expression(1, depth + 1);
      if (peek() !== ')')
        fail(
          'A closing parenthesis is missing. Equations are only allowed outside parentheses.',
        );
      index++;
    } else if (FUNCTIONS.has(token.text)) {
      if (peek() !== '(')
        fail(
          `Make the function's argument explicit: use ${token.text}(...) or say “${token.text} open parenthesis ... close parenthesis”.`,
        );
      index++;
      const argument = expression(1, depth + 1);
      if (peek() !== ')')
        fail(
          `A closing parenthesis is missing after ${token.text}'s argument.`,
        );
      index++;
      left = {
        kind: 'call',
        name: token.text as Extract<MathNode, { kind: 'call' }>['name'],
        argument,
      };
    } else
      fail(
        `Expected a number, variable, or expression, but found “${token.text}”.`,
      );
    for (;;) {
      const next = peek();
      if (next === 'squared' || next === 'cubed') {
        index++;
        left = {
          kind: 'binary',
          op: '^',
          left,
          right: { kind: 'number', value: next === 'squared' ? 2 : 3 },
        };
        continue;
      }
      const implicit = startsFactor(next);
      const op = implicit ? '*' : next;
      const precedence =
        op === '+' || op === '-'
          ? 1
          : op === '*' || op === '/'
            ? 2
            : op === '^'
              ? 4
              : 0;
      if (!precedence || precedence < minimum) break;
      if (
        implicit &&
        isNumber(next!) &&
        isNumber(tokens[index - 1]?.text ?? '')
      )
        fail(
          'Adjacent numbers are ambiguous. Insert an operator, or write a mixed number as 2 + 1/2.',
        );
      if (!implicit) index++;
      const right = expression(
        op === '^' ? precedence : precedence + 1,
        depth + 1,
      );
      if (op === '/' && startsFactor(peek()))
        fail(
          'Division followed by implicit multiplication is ambiguous. Use (1 / 2) * x or 1 / (2 * x) to show the intended denominator.',
        );
      left = {
        kind: 'binary',
        op: op as Extract<MathNode, { kind: 'binary' }>['op'],
        left,
        right,
      };
    }
    return left;
  };
  let node = expression();
  if (peek() === '=') {
    index++;
    node = { kind: 'equation', left: node, right: expression() };
  }
  if (index < tokens.length) {
    if (peek() === '=')
      fail(
        'Use one equals sign per equation. Chained equalities are not supported.',
      );
    if (peek() === ')')
      fail(
        'There is a closing parenthesis without a matching opening parenthesis.',
      );
    fail(`Unexpected “${peek()}”. Insert an operator or check the expression.`);
  }
  assertTree(node);
  return node;
}

function precedence(node: MathNode): number {
  if (node.kind === 'equation') return 0;
  if (node.kind === 'binary')
    return node.op === '+' || node.op === '-'
      ? 1
      : node.op === '*' || node.op === '/'
        ? 2
        : 4;
  return node.kind === 'unary' || (node.kind === 'number' && node.value < 0)
    ? 3
    : 5;
}
function format(node: MathNode): string {
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'variable':
      return node.name;
    case 'call':
      return `${node.name}(${format(node.argument)})`;
    case 'equation':
      return `${format(node.left)} = ${format(node.right)}`;
    case 'unary':
      return (
        node.op +
        (precedence(node.operand) <= 3
          ? `(${format(node.operand)})`
          : format(node.operand))
      );
    case 'binary': {
      const p = precedence(node);
      const lp = precedence(node.left),
        rp = precedence(node.right);
      const left =
        lp < p || (node.op === '^' && lp === p)
          ? `(${format(node.left)})`
          : format(node.left);
      const right =
        rp < p || (rp === p && node.op !== '^')
          ? `(${format(node.right)})`
          : format(node.right);
      return node.op === '^'
        ? `${left}^${right}`
        : `${left} ${node.op} ${right}`;
    }
  }
}
export function formatMath(node: MathNode): string {
  assertTree(node);
  return format(node);
}

/** Names fractions with whole-number parts and magnitude below one, without reducing them. */
function fractionName(node: MathNode): string | null {
  if (node.kind !== 'binary' || node.op !== '/' || node.right.kind !== 'number')
    return null;
  const left = node.left.kind === 'unary' ? node.left.operand : node.left;
  if (left.kind !== 'number') return null;
  const numerator = left.value;
  const denominator = node.right.value;
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator < 1 ||
    numerator >= denominator ||
    denominator > 10
  )
    return null;
  const numbers = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
  ];
  const fractions = [
    '',
    '',
    'half',
    'third',
    'quarter',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
  ];
  const name =
    numerator === 1 ? fractions[denominator] : `${fractions[denominator]}s`;
  const sign =
    node.left.kind === 'unary'
      ? `${node.left.op === '-' ? 'negative' : 'positive'} `
      : '';
  return `${sign}${numbers[numerator]} ${name}`;
}

/** Builds readback with explicit groups only where they protect the operation order. */
function spoken(node: MathNode): string {
  const group = (n: MathNode) =>
    (n.kind === 'binary' || n.kind === 'unary') &&
    (!fractionName(n) || (n.kind === 'binary' && n.left.kind === 'unary'))
      ? `the quantity ${spoken(n)} end quantity`
      : spoken(n);
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'variable':
      return node.name;
    case 'unary':
      return `${node.op === '-' ? 'negative' : 'positive'} ${group(node.operand)}`;
    case 'equation':
      return `${spoken(node.left)} equals ${spoken(node.right)}`;
    case 'call': {
      const names = {
        sqrt: 'square root',
        sin: 'sine',
        cos: 'cosine',
        log: 'base ten logarithm',
        ln: 'natural logarithm',
      };
      const simple =
        node.argument.kind === 'number' || node.argument.kind === 'variable';
      return `${names[node.name]} of ${spoken(node.argument)}${simple ? '' : `, end ${names[node.name]}`}`;
    }
    case 'binary': {
      if (node.op === '/') {
        const named = fractionName(node);
        if (named) return named;
        const numerator =
          node.left.kind === 'binary' &&
          node.left.op === '/' &&
          !fractionName(node.left)
            ? group(node.left)
            : spoken(node.left);
        const whole =
          node.left.kind === 'binary' && ['+', '-'].includes(node.left.op);
        return `${numerator}${whole ? ', all' : ''} divided by ${group(node.right)}`;
      }
      if (node.op === '^') {
        if (node.right.kind === 'number' && node.right.value === 2)
          return `${group(node.left)} squared`;
        if (node.right.kind === 'number' && node.right.value === 3)
          return `${group(node.left)} cubed`;
        return `${group(node.left)} raised to the power ${group(node.right)}`;
      }
      // Fractions need a closing boundary inside another operation; ordinary
      // products and left-to-right sums can be read without extra group words.
      const operand = (child: MathNode, right: boolean) => {
        if (child.kind !== 'binary') return spoken(child);
        const sum = child.op === '+' || child.op === '-';
        const needsGroup =
          (child.op === '/' && !fractionName(child)) ||
          (sum && (node.op === '*' || (right && node.op === '-')));
        return needsGroup ? group(child) : spoken(child);
      };
      return `${operand(node.left, false)} ${{ '+': 'plus', '-': 'minus', '*': 'times' }[node.op]} ${operand(node.right, true)}`;
    }
  }
}
/** Returns natural equation readback; rejects invalid trees without changing them. */
export function speakMath(node: MathNode): string {
  assertTree(node);
  return spoken(node);
}

function evaluate(node: MathNode, variables: Record<string, number>): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'variable':
      if (!Object.hasOwn(variables, node.name))
        fail(`Give ${node.name} a value before evaluating.`);
      return finite(
        variables[node.name],
        `The value of ${node.name} must be a finite number.`,
      );
    case 'equation':
      fail(
        'An equation has two sides, not one numeric value. Select a side to evaluate, or solve the equation.',
      );
    case 'unary':
      return finite(
        (node.op === '-' ? -1 : 1) * evaluate(node.operand, variables),
      );
    case 'call': {
      const value = evaluate(node.argument, variables);
      if (node.name === 'sqrt' && value < 0)
        fail('A square root of a negative number is not real.');
      if ((node.name === 'log' || node.name === 'ln') && value <= 0)
        fail('A logarithm needs a positive argument.');
      return finite(
        {
          sqrt: Math.sqrt,
          sin: Math.sin,
          cos: Math.cos,
          log: Math.log10,
          ln: Math.log,
        }[node.name](value),
      );
    }
    case 'binary': {
      const left = evaluate(node.left, variables),
        right = evaluate(node.right, variables);
      if (node.op === '/' && right === 0)
        fail('Division by zero is undefined.');
      if (node.op === '^' && left === 0 && right === 0)
        fail('0^0 is undefined in this calculator.');
      if (node.op === '+') return finite(left + right);
      if (node.op === '-') return finite(left - right);
      if (node.op === '*') return finite(left * right);
      if (node.op === '/') return finite(left / right);
      return finite(Math.pow(left, right));
    }
  }
}
export function evaluateMath(
  node: MathNode,
  variables: Record<string, number> = {},
): number {
  assertTree(node);
  if (!variables || typeof variables !== 'object')
    fail('Provide variable values as an object, for example { x: 2 }.');
  return evaluate(node, variables);
}

export function getParts(node: MathNode): MathPart[] {
  assertTree(node);
  const parts: MathPart[] = [];
  const walk = (current: MathNode, id: string, label: string) => {
    parts.push({ id, label, spoken: spoken(current), node: current });
    if (current.kind === 'equation') {
      walk(current.left, `${id}.left`, 'Left side of equation');
      walk(current.right, `${id}.right`, 'Right side of equation');
    } else if (current.kind === 'binary') {
      const labels = {
        '+': ['First term of sum', 'Second term of sum'],
        '-': ['Starting term', 'Subtracted term'],
        '*': ['First factor', 'Second factor'],
        '/': ['Numerator', 'Denominator'],
        '^': ['Base', 'Exponent'],
      };
      walk(current.left, `${id}.left`, labels[current.op][0]);
      walk(current.right, `${id}.right`, labels[current.op][1]);
    } else if (current.kind === 'unary')
      walk(current.operand, `${id}.operand`, 'Signed expression');
    else if (current.kind === 'call')
      walk(current.argument, `${id}.argument`, `${current.name} argument`);
  };
  walk(
    node,
    'root',
    node.kind === 'equation' ? 'Whole equation' : 'Whole expression',
  );
  return parts;
}

function same(a: MathNode, b: MathNode): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'number':
      return a.value === (b as typeof a).value;
    case 'variable':
      return a.name === (b as typeof a).name;
    case 'unary':
      return (
        a.op === (b as typeof a).op && same(a.operand, (b as typeof a).operand)
      );
    case 'call':
      return (
        a.name === (b as typeof a).name &&
        same(a.argument, (b as typeof a).argument)
      );
    case 'binary':
      return (
        a.op === (b as typeof a).op &&
        same(a.left, (b as typeof a).left) &&
        same(a.right, (b as typeof a).right)
      );
    case 'equation':
      return (
        same(a.left, (b as typeof a).left) &&
        same(a.right, (b as typeof a).right)
      );
  }
}
export function replaceMath(
  node: MathNode,
  from: string,
  to: string,
): MathNode {
  assertTree(node);
  const target = parseMath(from),
    replacement = parseMath(to);
  const matches = getParts(node).filter((part) => same(part.node, target));
  if (matches.length === 0)
    fail(
      `No part matches “${format(target)}”. Choose an exact sub-expression.`,
    );
  if (matches.length > 1)
    fail(
      `“${format(target)}” occurs ${matches.length} times. Choose a larger, unique sub-expression to replace.`,
    );
  if (replacement.kind === 'equation' && matches[0].id !== 'root')
    fail('A sub-expression cannot be replaced with a whole equation.');
  const walk = (current: MathNode): MathNode => {
    if (same(current, target)) return replacement;
    if (current.kind === 'binary' || current.kind === 'equation')
      return {
        ...current,
        left: walk(current.left),
        right: walk(current.right),
      };
    if (current.kind === 'unary')
      return { ...current, operand: walk(current.operand) };
    if (current.kind === 'call')
      return { ...current, argument: walk(current.argument) };
    return { ...current };
  };
  const result = walk(node);
  assertTree(result);
  return result;
}

/** Replace exactly one structural occurrence, even when its value repeats. */
export function replacePartMath(
  node: MathNode,
  partNumber: number,
  to: string,
): MathNode {
  const parts = getParts(node),
    target = parts[partNumber - 1];
  if (!Number.isInteger(partNumber) || !target)
    fail('That part does not exist.');
  const replacement = parseMath(to);
  if (replacement.kind === 'equation' && target.id !== 'root')
    fail('A sub-expression cannot be replaced with a whole equation.');
  const walk = (current: MathNode, id: string): MathNode => {
    if (id === target.id) return replacement;
    if (current.kind === 'binary' || current.kind === 'equation')
      return {
        ...current,
        left: walk(current.left, `${id}.left`),
        right: walk(current.right, `${id}.right`),
      };
    if (current.kind === 'unary')
      return { ...current, operand: walk(current.operand, `${id}.operand`) };
    if (current.kind === 'call')
      return { ...current, argument: walk(current.argument, `${id}.argument`) };
    return { ...current };
  };
  const result = walk(node, 'root');
  assertTree(result);
  return result;
}

type Polynomial = [number, number, number];
function checkedPolynomial(values: Polynomial): Polynomial {
  return values.map((value) =>
    finite(value, "The equation's coefficients exceed the numeric range."),
  ) as Polynomial;
}
function polynomial(node: MathNode): Polynomial {
  if (node.kind === 'number') return [node.value, 0, 0];
  if (node.kind === 'variable') {
    if (node.name !== 'x')
      fail(
        `Solving supports only equations in x. The variable ${node.name} is not supported.`,
      );
    return [0, 1, 0];
  }
  if (node.kind === 'unary')
    return checkedPolynomial(
      polynomial(node.operand).map(
        (c) => (node.op === '-' ? -1 : 1) * c,
      ) as Polynomial,
    );
  if (node.kind === 'call') {
    const argument = polynomial(node.argument);
    if (argument[1] !== 0 || argument[2] !== 0)
      fail(
        'Solving supports linear and quadratic polynomials in x; functions containing x are not supported.',
      );
    return [
      evaluate(
        { ...node, argument: { kind: 'number', value: argument[0] } },
        {},
      ),
      0,
      0,
    ];
  }
  if (node.kind !== 'binary')
    fail('Choose one linear or quadratic equation in x.');
  const left = polynomial(node.left),
    right = polynomial(node.right);
  if (node.op === '+' || node.op === '-')
    return checkedPolynomial(
      left.map(
        (c, i) => c + (node.op === '+' ? 1 : -1) * right[i],
      ) as Polynomial,
    );
  if (node.op === '/') {
    if (right[1] !== 0 || right[2] !== 0)
      fail(
        'Solving does not support x in a denominator. Only division by a nonzero constant is supported.',
      );
    if (right[0] === 0) fail('Division by zero is undefined.');
    return checkedPolynomial(left.map((c) => c / right[0]) as Polynomial);
  }
  const multiply = (a: Polynomial, b: Polynomial): Polynomial => {
    const result = [0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) result[i + j] += a[i] * b[j];
    result.forEach((c) =>
      finite(c, "The equation's coefficients exceed the numeric range."),
    );
    if (result[3] !== 0 || result[4] !== 0)
      fail(
        'Solving supports degree at most two. Higher powers or products are not supported.',
      );
    return checkedPolynomial(result.slice(0, 3) as Polynomial);
  };
  if (node.op === '*') return multiply(left, right);
  if (right[1] !== 0 || right[2] !== 0)
    fail('Solving does not support x in an exponent.');
  if (left[1] === 0 && left[2] === 0)
    return [
      evaluate(
        {
          kind: 'binary',
          op: '^',
          left: { kind: 'number', value: left[0] },
          right: { kind: 'number', value: right[0] },
        },
        {},
      ),
      0,
      0,
    ];
  if (!Number.isInteger(right[0]) || right[0] < 0 || right[0] > 2)
    fail(
      'Solving supports only powers 0, 1, or 2 of expressions containing x.',
    );
  if (right[0] === 0)
    fail(
      'A variable expression raised to zero may exclude values where its base is zero. Rewrite the equation with its domain explicitly; this solver does not track domain restrictions.',
    );
  return right[0] === 1 ? left : multiply(left, left);
}

function conciseNumber(value: number): string {
  finite(value, 'The solution exceeds the numeric range.');
  return String(Number(value.toPrecision(12)));
}
function polynomialText(coefficients: Polynomial): string {
  const terms: string[] = [];
  for (let power = 2; power >= 0; power--) {
    const coefficient = coefficients[power];
    if (coefficient === 0) continue;
    const magnitude = Math.abs(coefficient);
    const term =
      power === 0
        ? String(magnitude)
        : `${magnitude === 1 ? '' : `${magnitude}*`}x${power === 2 ? '^2' : ''}`;
    terms.push(
      terms.length === 0
        ? `${coefficient < 0 ? '-' : ''}${term}`
        : `${coefficient < 0 ? '-' : '+'} ${term}`,
    );
  }
  return terms.join(' ') || '0';
}

export function solveMath(node: MathNode): string {
  assertTree(node);
  if (node.kind !== 'equation')
    fail('Enter an equation with an equals sign, such as 2*x + 3 = 7.');
  const left = polynomial(node.left),
    right = polynomial(node.right);
  const coefficients = checkedPolynomial(
    left.map((c, i) => c - right[i]) as Polynomial,
  );
  const [c, b, a] = coefficients;
  const steps = [
    `Subtract the right side from both sides: (${format(node.left)}) - (${format(node.right)}) = 0.`,
    `Collect like terms: ${polynomialText(coefficients)} = 0.`,
  ];
  const finish = (answer: string) =>
    `${answer}\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
  if (a === 0 && b === 0) {
    steps.push(
      `The coefficients of x^2 and x are both zero, leaving ${c} = 0.`,
    );
    steps.push(
      c === 0
        ? 'This is true for every real x.'
        : 'This is a contradiction, so no value of x satisfies the equation.',
    );
    return finish(c === 0 ? 'Every real x is a solution.' : 'No solution.');
  }
  const rootText = (value: number) => {
    const text = conciseNumber(value);
    return `x ${Number(text) === value ? '=' : '≈'} ${text}`;
  };
  if (a === 0) {
    const root = finite(-c / b, 'The solution exceeds the numeric range.');
    if (c !== 0 && root === 0)
      fail('The solution is too small to represent reliably.');
    steps.push(
      `This is linear: the coefficient of x is ${b}, and the constant is ${c}.`,
    );
    steps.push(
      `Subtract the constant from both sides: ${b}*x = ${finite(-c)}.`,
    );
    steps.push(
      `Divide both sides by ${b}: x = (${finite(-c)}) / (${b}). Therefore, ${rootText(root)}.`,
    );
    return finish(`${rootText(root)}.`);
  }
  // Normalize before squaring, then use a stable quadratic formula to reduce cancellation.
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  const an = a / scale,
    bn = b / scale,
    cn = c / scale;
  if ((a !== 0 && an === 0) || (b !== 0 && bn === 0) || (c !== 0 && cn === 0))
    fail(
      'The coefficients differ too much in scale for a reliable numeric solution.',
    );
  const discriminant = bn * bn - 4 * an * cn;
  const discriminantMagnitude = Math.abs(bn * bn) + Math.abs(4 * an * cn);
  if (
    (discriminant !== 0 &&
      Math.abs(discriminant) <= 8 * Number.EPSILON * discriminantMagnitude) ||
    (discriminant === 0 && bn !== 0 && cn === 0)
  ) {
    fail(
      'The discriminant is too close to zero for this floating-point solver to classify reliably. Try equivalent integer coefficients or a higher-precision solver.',
    );
  }
  steps.push(
    `For a*x^2 + b*x + c = 0, the coefficients are a = ${a}, b = ${b}, c = ${c}.`,
  );
  const rawDiscriminant = b * b - 4 * a * c;
  // Show original coefficients when their discriminant is representable. If it
  // overflows or underflows, make the numerical normalization an explicit step.
  const useOriginal =
    Number.isFinite(rawDiscriminant) &&
    Math.sign(rawDiscriminant) === Math.sign(discriminant);
  const da = useOriginal ? a : an,
    db = useOriginal ? b : bn,
    dc = useOriginal ? c : cn;
  const shownDiscriminant = useOriginal ? rawDiscriminant : discriminant;
  if (!useOriginal)
    steps.push(
      `Divide every term by the nonzero scale ${scale} to keep arithmetic in range. Use a = ${an}, b = ${bn}, c = ${cn} in the following steps.`,
    );
  steps.push(
    `Compute the discriminant: D = b^2 - 4*a*c = (${db})^2 - 4*(${da})*(${dc}) = ${shownDiscriminant}.`,
  );
  if (discriminant < 0) {
    steps.push(
      'D is negative, so sqrt(D) is not real. There are no real solutions.',
    );
    return finish('No real solutions; the discriminant is negative.');
  }
  if (discriminant === 0) {
    const root = finite(
      -bn / (2 * an),
      'The solution exceeds the numeric range.',
    );
    if (bn !== 0 && root === 0)
      fail('The solution is too small to represent reliably.');
    steps.push(
      `D is zero, so the quadratic formula has one repeated root: x = -b / (2*a) = -(${db}) / (2*(${da})). Therefore, ${rootText(root)}.`,
    );
    return finish(`${rootText(root)} (a repeated root).`);
  }
  const q = -0.5 * (bn + (bn >= 0 ? 1 : -1) * Math.sqrt(discriminant));
  const roots = [
    finite(q / an, 'The solution exceeds the numeric range.'),
    finite(cn / q, 'The solution exceeds the numeric range.'),
  ].sort((p, r) => p - r);
  if (cn !== 0 && roots.some((root) => root === 0))
    fail('A solution is too small to represent reliably.');
  steps.push(
    `D is positive. Apply the quadratic formula: x = (-b plus or minus sqrt(D)) / (2*a) = (-(${db}) plus or minus sqrt(${shownDiscriminant})) / (2*(${da})).`,
  );
  steps.push(
    `The two real solutions are ${rootText(roots[0])} and ${rootText(roots[1])}.${roots.some((root) => Number(conciseNumber(root)) !== root) ? ' The symbol ≈ marks a rounded decimal.' : ''}`,
  );
  return finish(`${rootText(roots[0])} or ${rootText(roots[1])}.`);
}
