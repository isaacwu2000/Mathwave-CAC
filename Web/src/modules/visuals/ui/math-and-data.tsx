'use client';
import { createElement, type ReactNode } from 'react';
import { displayNumber, type MathNode } from '../../math/index.ts';
export function featuredParts(n: MathNode, id = 'root'): string[] {
  if (n.kind === 'equation') return featuredParts(n.left, id + '.left');
  if (n.kind === 'binary' && (n.op === '+' || n.op === '-'))
    return [
      ...featuredParts(n.left, id + '.left'),
      ...featuredParts(n.right, id + '.right'),
    ];
  return [id];
}
/** Renders structured math, joining numerical coefficients to variable factors. */
export function mathElement(n: MathNode): ReactNode {
  const m = (tag: string, ...children: ReactNode[]) =>
    createElement(tag, {}, ...children);
  if (n.kind === 'number') return m('mn', n.value.toString());
  if (n.kind === 'variable') return m('mi', n.name);
  if (n.kind === 'equation')
    return m('mrow', mathElement(n.left), m('mo', '='), mathElement(n.right));
  if (n.kind === 'unary')
    return m(
      'mrow',
      m('mo', n.op === '-' ? '−' : '+'),
      ...(n.operand.kind === 'binary' || n.operand.kind === 'unary'
        ? [m('mo', '('), mathElement(n.operand), m('mo', ')')]
        : [mathElement(n.operand)]),
    );
  if (n.kind === 'call')
    return n.name === 'sqrt'
      ? m('msqrt', mathElement(n.argument))
      : m(
          'mrow',
          m('mi', n.name),
          m('mo', '('),
          mathElement(n.argument),
          m('mo', ')'),
        );
  if (n.op === '/')
    return m('mfrac', mathElement(n.left), mathElement(n.right));
  if (n.op === '^')
    return m(
      'msup',
      m(
        'mrow',
        ...(n.left.kind === 'binary' || n.left.kind === 'unary'
          ? [m('mo', '('), mathElement(n.left), m('mo', ')')]
          : [mathElement(n.left)]),
      ),
      mathElement(n.right),
    );
  const nested = (c: MathNode, right: boolean) => {
    const par =
      c.kind === 'binary' &&
      ((n.op === '*' && (c.op === '+' || c.op === '-')) ||
        (n.op === '-' && right && (c.op === '+' || c.op === '-')));
    return par
      ? m('mrow', m('mo', '('), mathElement(c), m('mo', ')'))
      : mathElement(c);
  };
  return m(
    'mrow',
    nested(n.left, false),
    n.op === '*' &&
      (n.left.kind === 'number' ||
        (n.left.kind === 'unary' && n.left.operand.kind === 'number')) &&
      (n.right.kind === 'variable' ||
        (n.right.kind === 'binary' &&
          n.right.op === '^' &&
          n.right.left.kind === 'variable'))
      ? null
      : m('mo', n.op === '-' ? '−' : n.op === '*' ? '·' : '+'),
    nested(n.right, true),
  );
}
export function Chart({
  values,
  labels,
  selected,
  onSelect,
}: {
  values: Array<number | null>;
  labels: string[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  const finite = values.filter((v): v is number => v !== null);
  if (!finite.length)
    return (
      <p className="chart-empty">No finite points to plot in this view.</p>
    );
  const lo = Math.min(...finite),
    hi = Math.max(...finite),
    span = hi - lo || 1;
  const x = (i: number) => 48 + (i / (values.length - 1 || 1)) * 520,
    y = (v: number) => 184 - ((v - lo) / span) * 150;
  let path = '';
  values.forEach((v, i) => {
    if (v === null) return;
    path += `${i === 0 || values[i - 1] === null ? 'M' : 'L'}${x(i)},${y(v)} `;
  });
  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 610 225" aria-hidden="true">
        <line x1="48" x2="568" y1="184" y2="184" stroke="#d6d9e8" />
        <line
          x1="48"
          x2="568"
          y1="34"
          y2="34"
          stroke="#eceef6"
          strokeDasharray="4 5"
        />
        <line
          x1="48"
          x2="568"
          y1="109"
          y2="109"
          stroke="#eceef6"
          strokeDasharray="4 5"
        />
        <text x="4" y="38">
          {displayNumber(hi)}
        </text>
        <text x="4" y="187">
          {displayNumber(lo)}
        </text>
        <path d={path} stroke="#6558d3" strokeWidth="2.6" fill="none" />
        {values.length <= 100 &&
          values.map((v, i) =>
            v !== null ? (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={i === selected ? 6 : 3}
                fill={i === selected ? '#353053' : '#6558d3'}
              />
            ) : null,
          )}
        <text x="48" y="211">
          {labels[0]}
        </text>
        <text x="568" y="211" textAnchor="end">
          {labels[labels.length - 1]}
        </text>
      </svg>
      {values.length <= 100 && (
        <div className="point-buttons" aria-label="Explore observations">
          {values.map((v, i) => (
            <button
              key={i}
              aria-pressed={i === selected}
              aria-label={`Observation ${i + 1}: ${v === null ? 'undefined' : displayNumber(v)}`}
              onClick={() => onSelect(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
