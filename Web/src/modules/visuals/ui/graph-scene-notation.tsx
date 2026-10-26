import { createElement, type ReactNode } from 'react';
import { compileGraphScene, type GraphScene } from '../services/graph-scene.ts';
import type { GraphNode } from '../services/graph-expression.ts';
const m = (name: string, ...children: ReactNode[]) =>
  createElement(name, null, ...children);
function notation(node: GraphNode, parent = 0): ReactNode {
  const group = (content: ReactNode, priority: number) =>
    priority < parent
      ? m('mrow', m('mo', '('), content, m('mo', ')'))
      : content;
  switch (node.kind) {
    case 'number':
      return m('mn', String(node.value));
    case 'symbol':
      return m('mi', node.name === 'theta' ? 'θ' : node.name);
    case 'unary':
      return group(m('mrow', m('mo', node.op), notation(node.value, 5)), 5);
    case 'call':
      return m(
        'mrow',
        m('mi', node.name),
        m('mo', '('),
        ...node.args.flatMap((arg, i) =>
          i ? [m('mo', ','), notation(arg)] : [notation(arg)],
        ),
        m('mo', ')'),
      );
    case 'binary': {
      if (node.op === '/')
        return m('mfrac', notation(node.left), notation(node.right));
      if (node.op === '^')
        return m('msup', notation(node.left, 7), notation(node.right));
      const priority =
        node.op === '*' ? 4 : node.op === '+' || node.op === '-' ? 3 : 2;
      return group(
        m(
          'mrow',
          notation(node.left, priority),
          node.op === '*' &&
            (node.left.kind === 'number' ||
              (node.left.kind === 'unary' &&
                node.left.value.kind === 'number')) &&
            (node.right.kind === 'symbol' ||
              (node.right.kind === 'binary' &&
                node.right.op === '^' &&
                node.right.left.kind === 'symbol'))
            ? null
            : m(
                'mo',
                (
                  { '*': '·', '<=': '≤', '>=': '≥', '!=': '≠' } as Record<
                    string,
                    string
                  >
                )[node.op] ?? node.op,
              ),
          notation(node.right, priority + (node.op === '-' ? 1 : 0)),
        ),
        priority,
      );
    }
    case 'piecewise':
      return m(
        'mrow',
        m('mo', '{'),
        createElement(
          'mtable',
          { columnspacing: '1em', columnalign: 'left left' },
          ...node.branches.map((branch) =>
            m(
              'mtr',
              m('mtd', notation(branch.value)),
              m(
                'mtd',
                createElement('mspace', { width: '1em' }),
                branch.condition
                  ? notation(branch.condition)
                  : m('mtext', 'otherwise'),
              ),
            ),
          ),
        ),
      );
  }
}

/** Displays saved graph rows as structured mathematics, with a complete source readback for assistive technology. */
export function GraphSceneNotation({ scene }: { scene: GraphScene }) {
  const compiled = compileGraphScene(scene);
  return (
    <span className="graph-step-notation">
      {compiled.rows.map((row, i) => {
        let content: ReactNode = notation(row.node);
        if (row.kind === 'function')
          content = m(
            'mrow',
            m('mi', row.symbol!),
            m('mo', '('),
            m('mi', row.args!.join(',')),
            m('mo', ')'),
            m('mo', '='),
            content,
          );
        else if (row.kind === 'variable')
          content = m('mrow', m('mi', row.symbol!), m('mo', '='), content);
        else if (
          row.kind === 'explicit' ||
          row.kind === 'horizontal' ||
          row.kind === 'polar'
        )
          content = m(
            'mrow',
            m(
              'mi',
              row.kind === 'explicit'
                ? 'y'
                : row.kind === 'horizontal'
                  ? 'x'
                  : 'r',
            ),
            m('mo', '='),
            content,
          );
        else if (row.second)
          content =
            row.kind === 'parametric' || row.kind === 'point'
              ? m(
                  'mrow',
                  m('mo', '('),
                  content,
                  m('mo', ','),
                  notation(row.second),
                  m('mo', ')'),
                )
              : m(
                  'mrow',
                  content,
                  m(
                    'mo',
                    row.operator === '<'
                      ? '<'
                      : row.operator === '<='
                        ? '≤'
                        : row.operator === '>'
                          ? '>'
                          : row.operator === '>='
                            ? '≥'
                            : '=',
                  ),
                  notation(row.second),
                );
        if (row.restriction)
          content = m(
            'mrow',
            content,
            m('mo', '{'),
            notation(row.restriction),
            m('mo', '}'),
          );
        return (
          <span key={i}>
            {scene.rows[i].name && (
              <span className="graph-notation-name">
                {scene.rows[i].name}:{' '}
              </span>
            )}
            {createElement(
              'math',
              { 'aria-label': scene.rows[i].expression },
              content,
            )}
          </span>
        );
      })}
    </span>
  );
}
