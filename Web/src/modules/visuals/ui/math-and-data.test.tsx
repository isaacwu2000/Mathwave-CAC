import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMath } from '../../math/index.ts';
import { mathElement } from './math-and-data.tsx';

it('joins numerical coefficients to variables and their powers', () => {
  for (const expression of ['5*x', '-5*x', '5*x^2', 'x^2+5*x=0']) {
    const html = renderToStaticMarkup(
      createElement('math', null, mathElement(parseMath(expression))),
    );
    expect(html).not.toContain('<mo>·</mo>');
    expect(html).toContain('<mn>5</mn>');
    expect(html).toContain('<mi>x</mi>');
  }
});

it('keeps multiplication explicit between numbers and between variables', () => {
  for (const expression of ['5*3', 'x*y']) {
    expect(
      renderToStaticMarkup(
        createElement('math', null, mathElement(parseMath(expression))),
      ),
    ).toContain('<mo>·</mo>');
  }
});
