import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProblemPdfWork } from './problem-pdf.tsx';
import { blankWorkspace } from '../../problems/index.ts';

test('exports the recorded equation without command text or spoken descriptions', () => {
  const markup = renderToStaticMarkup(
    <ProblemPdfWork
      state={{ ...blankWorkspace(), expression: '(x+1)/3=sqrt(16)' }}
      ready={() => {}}
    />,
  );
  expect(markup).toContain('<mfrac>');
  expect(markup).toContain('<msqrt>');
  expect(markup).not.toContain('<p>');
});

test('exports statistics as mathematical values and a chart without generated prose', () => {
  const markup = renderToStaticMarkup(
    <ProblemPdfWork
      state={{ ...blankWorkspace(), mode: 'statistics', data: [2, 4, 4, 6, 9] }}
      ready={() => {}}
    />,
  );
  expect(markup).toContain('<mn>9</mn>');
  expect(markup).toContain('<svg');
  expect(markup).not.toContain('5 observations');
  expect(markup).not.toContain('Mean');
  expect(markup).not.toContain('<p>');
});
