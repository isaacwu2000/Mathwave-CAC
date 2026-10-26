import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphSceneView } from './graph-scene-view.tsx';
import { GraphView } from './graph-view.tsx';

it('opens both expression editors with compact controls and no name or empty input', () => {
  const props = { onCommand: () => {}, interactive: true };
  const views = [
    <GraphView key="curve" {...props} expression="x^2" />,
    <GraphSceneView
      key="scene"
      {...props}
      scene={{ rows: [{ expression: 'x=3' }] }}
      x={{ min: -5, max: 5 }}
      y={{ min: -5, max: 5 }}
    />,
  ];
  for (const view of views) {
    const html = renderToStaticMarkup(view);
    expect(html).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?Expressions/);
    expect(html).toContain('Hide graph 1');
    expect(html).toContain('Remove graph 1');
    expect(html).toContain('Add expression');
    expect(html).toContain('Graph expression 1');
    expect(html).not.toContain('Name (optional)');
    expect(html).not.toContain('New graph expression');
  }
});
