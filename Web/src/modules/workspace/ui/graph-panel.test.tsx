import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphPanel } from './graph-panel.tsx';

it('offers a closed graph launcher while retaining the desktop graph', () => {
  const html = renderToStaticMarkup(
    <GraphPanel>
      <p>Graph drawing</p>
    </GraphPanel>,
  );
  expect(html).toContain('Show graph');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('Graph drawing');
  expect(html).not.toContain('Hide graph');
  expect(html).not.toContain('data-collapsed');
});
