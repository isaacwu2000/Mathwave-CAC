import { test } from 'vitest';
import assert from 'node:assert/strict';
import { panelCommand } from '../index.ts';
test('inline tools can be opened and closed with spoken or typed commands', () => {
  assert.deepEqual(panelCommand('Please show my steps.'), {
    panel: 'steps',
    open: true,
  });
  assert.deepEqual(panelCommand('hide the work'), {
    panel: 'steps',
    open: false,
  });
  assert.deepEqual(panelCommand('Open voice settings'), {
    panel: 'settings',
    open: true,
  });
  assert.deepEqual(panelCommand('close reading settings'), {
    panel: 'settings',
    open: false,
  });
  assert.deepEqual(panelCommand('show saved problems'), {
    panel: 'library',
    open: true,
  });
  assert.deepEqual(panelCommand('hide problem'), {
    panel: 'library',
    open: false,
  });
  assert.deepEqual(panelCommand('show more calculations'), {
    panel: 'calculations',
    open: true,
  });
});
test('panel commands do not capture math commands or problem navigation', () => {
  for (const command of [
    'read work',
    'open problem 1',
    'show graph',
    'show outliers',
    'open parenthesis x plus one close parenthesis',
    'hide steps and delete my work',
  ])
    assert.equal(panelCommand(command), null, command);
});
