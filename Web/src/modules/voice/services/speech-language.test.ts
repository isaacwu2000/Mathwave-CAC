import { test } from 'vitest';
import assert from 'node:assert/strict';
import { speechLanguage, recordingLanguage } from '../index.ts';
test('invalid stored locales fall back to supported English and fixtures use their voice locale', () => {
  for (const invalid of [
    null,
    undefined,
    {},
    '',
    'javascript:alert(1)',
    'xx-XX',
  ])
    assert.equal(speechLanguage(invalid), 'en-US');
  assert.equal(speechLanguage('en-IN'), 'en-IN');
  assert.equal(recordingLanguage('Daniel'), 'en-GB');
  assert.equal(recordingLanguage('Karen'), 'en-AU');
  assert.equal(recordingLanguage('Rishi'), 'en-IN');
});
