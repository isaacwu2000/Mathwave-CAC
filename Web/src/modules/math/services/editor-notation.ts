import { convertAsciiMathToLatex, convertLatexToAsciiMath } from 'mathlive/ssr';
import { evaluateMath, parseMath } from './math-engine.ts';

const mathWords = new Set([
  'sqrt',
  'cbrt',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'log',
  'ln',
  'exp',
  'abs',
  'pi',
  'theta',
  'alpha',
  'beta',
  'gamma',
  'sum',
  'prod',
  'int',
  'lim',
  'infty',
  'infinity',
  'floor',
  'ceil',
  'min',
  'max',
]);
const reversibleCommands = new Set([
  'le',
  'leq',
  'ge',
  'geq',
  'ne',
  'neq',
  'theta',
  'lbrace',
  'rbrace',
  'frac',
  'dfrac',
  'tfrac',
  'sqrt',
  'left',
  'right',
  'cdot',
  'times',
  'div',
  'sin',
  'cos',
  'tan',
  'ln',
  'log',
  'exp',
  'pi',
  'text',
  'placeholder',
]);

function textLatex(source: string) {
  return `\\text{${source.replace(/[{}%$#&_]/g, '\\$&')}}`;
}

function expressionLatex(source: string): string {
  // Keep boundaries around command words; the converter discards plain spaces.
  const parts = source.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  try {
    return (
      (parts[1] ? textLatex(parts[1]) : '') +
      convertAsciiMathToLatex(parts[2].replaceAll('**', '^')).replace(
        /\\(lbrace|rbrace)(?=[A-Za-z])/g,
        '\\$1 ',
      ) +
      (parts[3] ? textLatex(parts[3]) : '')
    );
  } catch {
    return textLatex(source);
  }
}

/** Formats expressions without evaluating them; mixed input keeps prose upright. */
export function mathInputLatex(
  source: string,
  mixed = false,
  graph = false,
): string {
  if (source.includes('\\')) return source;
  if (graph)
    return expressionLatex(
      source.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g, (name) =>
        name.length > 1 && !mathWords.has(name)
          ? `"${name === 'and' || name === 'or' ? ` ${name} ` : name}"`
          : name,
      ),
    );
  if (!mixed) return expressionLatex(source);
  let result = '',
    start = 0;
  for (const match of source.matchAll(
    /[a-zA-Z]{2,}(?:['’][a-zA-Z]+)?\s*|[?!:;"'“”‘’]/g,
  )) {
    if (mathWords.has(match[0].trim())) continue;
    result += expressionLatex(source.slice(start, match.index));
    result += textLatex(match[0]);
    start = match.index + match[0].length;
  }
  return result + expressionLatex(source.slice(start));
}

/** Returns engine notation, retaining unsupported mathematics for visible errors. */
export function mathInputText(latex: string, graph = false): string {
  // Keep structures the plain engine notation cannot represent in their original form.
  if (
    /\\sqrt\s*\[/.test(latex) ||
    [...latex.matchAll(/\\([a-zA-Z]+)/g)].some(
      (match) => !reversibleCommands.has(match[1]),
    )
  )
    return latex;
  // Graph identifiers stay together, while braces and conditions must convert as one mathematical structure.
  if (graph) {
    try {
      return convertLatexToAsciiMath(latex).replace(
        /"([A-Za-z0-9_ ]*)"/g,
        '$1',
      );
    } catch {
      return latex;
    }
  }
  // Read prose directly so quotes and spaces do not become mathematical syntax.
  let source = '',
    start = 0;
  const convert = (math: string) => {
    try {
      return convertLatexToAsciiMath(
        math.replace(/([_^])\{\}/g, '$1{\\placeholder{}}'),
      );
    } catch {
      return math;
    }
  };
  for (const match of latex.matchAll(/\\text\{((?:\\.|[^{}])*)\}/g)) {
    source += convert(latex.slice(start, match.index));
    source += match[1].replace(/\\([{}%$#&_])/g, '$1');
    start = match.index + match[0].length;
  }
  return (source + convert(latex.slice(start)))
    .replaceAll('**', '^')
    .replace(/\\placeholder(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .trim();
}

/** Evaluates a constant field; variables, equations and non-finite values throw. */
export function mathInputNumber(
  source: string,
  min?: number,
  max?: number,
  integer = false,
): number {
  if (!source.trim()) throw new Error('Enter a value.');
  const result = evaluateMath(parseMath(source));
  if (min !== undefined && result < min)
    throw new Error(`Use a value of at least ${min}.`);
  if (max !== undefined && result > max)
    throw new Error(`Use a value of at most ${max}.`);
  if (integer && !Number.isInteger(result))
    throw new Error('Use a whole number.');
  return result;
}
