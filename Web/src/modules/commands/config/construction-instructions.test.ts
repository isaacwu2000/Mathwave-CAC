import { expect, test } from 'vitest';
import { constructionInstructionsFor } from './construction-instructions.ts';
import { initialWorkspace } from '../../workspace/state.ts';

test('unrelated commands keep their prompt size and do not invoke a context-selection model', () => {
  for (const request of [
    'subtract three from both sides',
    'graph y=x^2',
    'graph r=sin(theta)',
    'calculate the mean',
    'undo',
  ])
    expect(constructionInstructionsFor(request, initialWorkspace)).toBe('');
  expect(
    constructionInstructionsFor('construct triangle ABC', initialWorkspace),
  ).toContain('geometry.construct');
  expect(
    constructionInstructionsFor('move it up', {
      ...initialWorkspace,
      mode: 'geometry',
      construction: 'A=point(0,0)\ndraw A',
    }),
  ).toContain('geometry.editObject');
});
