import { expect, test } from 'vitest';
import { previewGraphDraft, graphDraftChanged } from './graph-draft.ts';
test('valid edits preview without losing the last curve during incomplete input', () => {
  expect(previewGraphDraft('x', 'x^2').expression).toBe('x^2');
  const incomplete = previewGraphDraft('x^2', 'x+');
  expect(incomplete.expression).toBe('x^2');
  expect(incomplete.error).toBeTruthy();
});

test('autosave ignores notation-only changes and incomplete drafts', () => {
  expect(graphDraftChanged('x^2 + 5 * x + 6', 'y=x^2+5x+6')).toBe(false);
  expect(graphDraftChanged('x^2 + 5 * x + 6', 'x^2+5x+7')).toBe(true);
  expect(graphDraftChanged('x^2 + 5 * x + 6', 'x+')).toBe(false);
});
