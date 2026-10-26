import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeometryView } from './geometry-view.tsx';

it('shows only the geometry drawing when controls are tucked away', () => {
  const html = renderToStaticMarkup(
    <GeometryView
      geometry={{ shape: 'right triangle', dimensions: { a: 3, b: 4 } }}
      canUndo={false}
      onCommand={() => {}}
      controls={false}
    />,
  );
  expect(html).toContain('Opening graph');
  expect(html).not.toContain('Edit dimensions');
  expect(html).not.toContain('Double size');
  expect(html).not.toContain('Change a dimension');
});
