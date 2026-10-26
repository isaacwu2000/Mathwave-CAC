import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandStatus } from './command-status.tsx';

test.each([
  ['working', 'Working…'],
  ['graphing', 'Graphing…'],
  ['checking', 'Checking…'],
  ['fixing', 'Fixing…'],
] as const)('renders %s as a short italic label', (phase, label) => {
  const html = renderToStaticMarkup(<CommandStatus progress={{ phase }} />);
  expect(html).toContain(`>${label}</em>`);
  expect(html).not.toContain('<section');
  expect(html).not.toContain('<math');
});
